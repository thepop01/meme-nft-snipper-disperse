// Wires mintRunner's execWallet to real chain execution:
// preflight simulate -> fee math -> send -> receipt -> minted ids -> auto-list.
// NFT_DRY_RUN (default true) simulates everything.
import { ethers } from 'ethers';
import { getNftChain } from './chains.js';
import { fetchMintTx, simulateMint, extractMintedTokenIds } from './mintTx.js';
import { getGasSnapshot, computeTxFees } from './gas.js';
import { log } from '../bus.js';

const isDryRun = () => process.env.NFT_DRY_RUN !== 'false';
const GAS_RETRY_WINDOW_MS = 2 * 60 * 1000;
const LIST_RETRY_WINDOW_MS = 10 * 60 * 1000;
const RECEIPT_TIMEOUT_MS = 3 * 60 * 1000;

export function makeExecWallet() {
  return async function execWallet({ job, wallet, privateKey }) {
    if (isDryRun()) {
      return { txHash: `0xDRYRUN_${Math.random().toString(16).slice(2, 10)}`, minted: [] };
    }
    const chain = getNftChain(job.drop.chain);
    if (!chain) throw new Error(`Unknown chain ${job.drop.chain}`);
    if (!chain.rpc) throw new Error(`RPC not configured for ${job.drop.chain}`);
    const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
    const signer = new ethers.Wallet(privateKey, provider);

    // 1. Calldata from OpenSea (never guessed).
    const tx = await fetchMintTx(job.drop.slug, wallet.address, wallet.quantity);

    // 2. Preflight — abort before spending gas if it would revert.
    const sim = await simulateMint(provider, tx, wallet.address);
    if (sim.result === 'not-eligible') throw new Error(`Preflight revert: ${sim.reason}`);

    // 3. Fees per mode, retrying while above cap inside the window.
    const gasLimit = (await provider.estimateGas({ ...tx, from: wallet.address })) * 12n / 10n;
    const balance = await provider.getBalance(wallet.address);
    const deadline = Date.now() + GAS_RETRY_WINDOW_MS;
    let fees;
    for (;;) {
      const snap = await getGasSnapshot(provider);
      fees = computeTxFees({
        mode: job.gas.mode, snap,
        maxFeeGwei: job.gas.maxFeeGwei, maxPriorityGwei: job.gas.maxPriorityGwei,
        gasLimit, balanceWei: balance, mintCostWei: tx.value,
      });
      if (!fees.aboveCap) break;
      if (job.policy.abortIfGasAboveCap || Date.now() > deadline) {
        throw new Error('Gas above cap at fire time');
      }
      await new Promise(r => setTimeout(r, 12_000)); // roughly a block
    }

    // 4. Send + receipt. A stuck/underpriced tx must not hang the job forever —
    // time out and fail the wallet so remaining wallets still run.
    const sent = await signer.sendTransaction({
      to: tx.to, data: tx.data, value: tx.value, gasLimit,
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
    const minted = extractMintedTokenIds(receipt, wallet.address);

    // 5. Optional auto-list (never fails the mint).
    if (job.policy.autoList && minted.length > 0) {
      autoList({ job, wallet, signer, minted, provider }).catch(err =>
        log('error', `Auto-list failed for ${wallet.address}: ${err.message}`));
    }
    return { txHash: sent.hash, minted };
  };
}

// Lists each minted token on OpenSea via Seaport. Retries for up to 10 min —
// new collections index slowly. Updates the job wallet's listing field via the
// callback the runner passes in job records (routes re-read the job to update).
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
