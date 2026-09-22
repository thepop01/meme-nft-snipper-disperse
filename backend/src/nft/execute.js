// Wires mintRunner's execWallet to real chain execution:
// validated REST transaction -> explicit successful simulation -> fee math ->
// send -> receipt -> minted ids -> auto-list. NFT_DRY_RUN defaults to true.
import { ethers } from 'ethers';
import { getNftChain, getNftExecutionSupport, getNftSaleAdapter } from './chains.js';
import {
  fetchMintTx,
  simulateMint,
  assertSimulationEligible,
  validateMintTransaction,
  extractMintedTokenIds,
} from './mintTx.js';
import { getGasSnapshot, computeTxFees } from './gas.js';
import { log } from '../bus.js';

const isDryRun = () => process.env.NFT_DRY_RUN !== 'false';
const GAS_RETRY_WINDOW_MS = 2 * 60 * 1000;
const LIST_RETRY_WINDOW_MS = 10 * 60 * 1000;
const RECEIPT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_MAX_GAS_LIMIT = 2_000_000n;

function address(value, label) {
  try {
    return ethers.getAddress(String(value || ''));
  } catch {
    throw new Error(`${label} must be a valid EVM address`);
  }
}

function positiveQuantity(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Mint quantity must be a positive integer');
  return value;
}

function optionalWei(value, label) {
  if (value == null || value === '') return null;
  try {
    const n = BigInt(value);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw new Error(`${label} must be a non-negative integer in wei`);
  }
}

function valueCapFor(job, quantity) {
  const configured = job.policy?.maxMintValueWei
    ?? job.drop?.maxValueWei
    ?? job.drop?.priceWei
    ?? job.drop?.price;
  if (configured == null || configured === '') {
    throw new Error('Mint native-value cap is required before execution');
  }
  const cap = optionalWei(configured, 'Maximum mint value');
  // Drop/stage price is a per-item value. An explicitly named maxValueWei is
  // a transaction cap and must not be multiplied.
  if (job.policy?.maxMintValueWei != null || job.drop?.maxValueWei != null) return cap;
  return cap * BigInt(quantity);
}

async function assertProviderChain(provider, expectedChainId) {
  const network = await provider.getNetwork();
  if (BigInt(network.chainId) !== BigInt(expectedChainId)) {
    throw new Error(`Provider chain mismatch: expected ${expectedChainId}, got ${network.chainId}`);
  }
}

export function makeExecWallet() {
  return async function execWallet({ job, wallet, privateKey }) {
    const chainName = job?.drop?.chain;
    const saleAdapter = getNftSaleAdapter(job?.drop || {});
    const support = getNftExecutionSupport(chainName, saleAdapter || '');
    if (!support.supported) {
      throw new Error(`manual-only: ${support.reason}`);
    }
    const chain = support.chain;
    const quantity = positiveQuantity(Number(wallet?.quantity));
    const signerAddress = address(wallet?.address, 'Signer address');
    if (!privateKey) throw new Error('Private key is required for mint execution');

    // A dry run never broadcasts, but still refuses unsupported/ad-hoc jobs.
    // Real execution continues through transaction validation and simulation.
    if (isDryRun()) {
      return { txHash: `0xDRYRUN_${Math.random().toString(16).slice(2, 10)}`, minted: [] };
    }

    if (!chain.rpc) throw new Error(`RPC not configured for ${chainName}`);
    const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
    await assertProviderChain(provider, chain.chainId);
    const signer = new ethers.Wallet(privateKey, provider);
    const actualSigner = address(signer.address, 'Signer address');
    if (actualSigner.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(`Private key does not match signer ${signerAddress}`);
    }

    // 1. Calldata from the documented OpenSea REST endpoint (never guessed).
    const tx = await fetchMintTx(job.drop.slug, signerAddress, quantity, { saleAdapter });
    const target = job.drop.mintTarget || job.drop.targetContract || job.drop.saleContract;
    const maxValueWei = valueCapFor(job, quantity);
    const checked = validateMintTransaction(tx, {
      expectedChainId: chain.chainId,
      signerAddress,
      expectedTarget: target,
      quantity,
      maxValueWei,
    });

    // 2. Preflight — only an explicit successful eth_call may proceed.
    const sim = await simulateMint(provider, checked, signerAddress);
    assertSimulationEligible(sim);

    // 3. Fees per mode, retrying while above cap inside the window.
    let estimatedGas = await provider.estimateGas({
      to: checked.to, data: checked.data, value: checked.value, from: signerAddress,
    });
    if (estimatedGas <= 0n) throw new Error('Provider returned an invalid gas estimate');
    const maxGasLimit = optionalWei(job.policy?.maxGasLimit, 'Maximum gas limit') ?? DEFAULT_MAX_GAS_LIMIT;
    if (estimatedGas > maxGasLimit) throw new Error(`Estimated gas exceeds cap (${estimatedGas} > ${maxGasLimit})`);
    const gasLimit = estimatedGas * 12n / 10n;
    if (gasLimit > maxGasLimit) throw new Error(`Gas limit exceeds cap (${gasLimit} > ${maxGasLimit})`);
    const balance = await provider.getBalance(signerAddress);
    const deadline = Date.now() + GAS_RETRY_WINDOW_MS;
    let fees;
    for (;;) {
      const snap = await getGasSnapshot(provider);
      fees = computeTxFees({
        mode: job.gas.mode, snap,
        maxFeeGwei: job.gas.maxFeeGwei, maxPriorityGwei: job.gas.maxPriorityGwei,
        gasLimit, balanceWei: balance, mintCostWei: checked.value,
      });
      const gasCost = gasLimit * fees.maxFeePerGas;
      const maxGasCostWei = optionalWei(job.policy?.maxGasCostWei, 'Maximum gas cost');
      if (maxGasCostWei != null && gasCost > maxGasCostWei) {
        throw new Error(`Estimated gas cost exceeds cap (${gasCost} > ${maxGasCostWei})`);
      }
      if (checked.value + gasCost > balance) throw new Error('Insufficient balance for mint cost + gas');
      if (!fees.aboveCap) break;
      if (job.policy.abortIfGasAboveCap || Date.now() > deadline) {
        throw new Error('Gas above cap at fire time');
      }
      await new Promise(r => setTimeout(r, 12_000));
    }

    // 4. Send + receipt. Explicit chainId prevents a provider/signing config
    // mismatch from turning into a cross-chain broadcast.
    const sent = await signer.sendTransaction({
      to: checked.to, data: checked.data, value: checked.value, chainId: chain.chainId,
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    let receipt;
    try {
      receipt = await Promise.race([
        sent.wait(),
        new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error(
            `No receipt after ${RECEIPT_TIMEOUT_MS / 1000}s — tx ${sent.hash} may still land on-chain; check the wallet before retrying`)), RECEIPT_TIMEOUT_MS);
          t.unref?.();
        }),
      ]);
    } catch (err) {
      throw new Error(`${err.message} (tx ${sent.hash})`);
    }
    const minted = extractMintedTokenIds(receipt, signerAddress);

    // 5. Optional auto-list (never fails the mint).
    if (job.policy.autoList && minted.length > 0) {
      autoList({ job, wallet, signer, minted, provider }).catch(err =>
        log('error', `Auto-list failed for ${signerAddress}: ${err.message}`));
    }
    return { txHash: sent.hash, minted };
  };
}

// Lists each minted token on OpenSea via Seaport. Retries for up to 10 min —
// new collections index slowly. This path is separate from mint submission.
export async function autoList({ job, wallet, signer, minted }) {
  const { Seaport } = await import('@opensea/seaport-js');
  const seaport = new Seaport(signer);
  const priceWei = job.policy.autoList.fixedPriceEth
    ? ethers.parseEther(String(job.policy.autoList.fixedPriceEth))
    : BigInt(job.drop.price || 0) * BigInt(Math.round((job.policy.autoList.multiplier || 2) * 100)) / 100n;
  const deadline = Date.now() + LIST_RETRY_WINDOW_MS;

  for (const item of minted) {
    for (;;) {
      try {
        const { executeAllActions } = await seaport.createOrder({
          offer: [{ itemType: 2, token: item.contract, identifier: item.tokenId }],
          consideration: [{ amount: priceWei.toString(), recipient: wallet.address }],
          endTime: String(Math.floor(Date.now() / 1000) + (job.policy.autoList.durationDays || 7) * 86400),
        }, wallet.address);
        await executeAllActions();
        item.listed = true;
        break;
      } catch (err) {
        if (Date.now() > deadline) { item.listed = false; item.listError = err.message; break; }
        await new Promise(r => setTimeout(r, 30_000));
      }
    }
  }
  return minted;
}
