import { getDisperseChain } from './config.js';
import * as evm from './evm.js';
import * as sol from './solana.js';
import * as bridge from './bridge.js';
import { ethers } from 'ethers';

function isDryRun() {
  return process.env.DISPERSE_DRY_RUN !== 'false';
}

export function makeExecChunk() {
  return async function execChunk({ plan, sender, privateKey, chunk }) {
    if (isDryRun()) {
      return { disperseHash: `0xDRYRUN_${Math.random().toString(16).slice(2, 10)}` };
    }
    const chain = getDisperseChain(plan.crossChain ? plan.destChain : plan.sourceChain);
    if (chain.family === 'evm') {
      const provider = evm.makeProvider(chain);
      if (!chain.disperseBytecodeHash) {
        throw new Error(`Live disperse is disabled on ${chain.name}: DISPERSE_BYTECODE_HASH_${chain.id.toUpperCase()} is not pinned`);
      }
      await evm.verifyDisperseContract(provider, chain.disperseContract, chain.disperseBytecodeHash);
      const signer = evm.makeSigner(privateKey, provider);
      const amounts = chunk.amounts.map(a => BigInt(a));
      const typedChunk = { recipients: chunk.recipients, amounts };
      if (plan.isNativeAsset) {
        return { disperseHash: await evm.disperseNativeChunk(signer, chain, typedChunk) };
      }
      const totalNeeded = amounts.reduce((a, b) => a + b, 0n);
      return evm.disperseTokenChunk(signer, chain, plan.tokenAddress, typedChunk,
        { totalNeeded, allowUnlimited: plan.allowUnlimited });
    }
    const connection = sol.makeConnection(chain);
    const payer = sol.keypairFromBase58(privateKey);
    const amounts = chunk.amounts.map(a => BigInt(a));
    const typedChunk = { recipients: chunk.recipients, amounts };
    const sig = plan.isNativeAsset
      ? await sol.disperseNativeChunk(connection, payer, typedChunk)
      : await sol.disperseTokenChunk(connection, payer, plan.tokenAddress, typedChunk);
    return { disperseHash: sig };
  };
}

export function makeBridgeDeps() {
  const dry = () => process.env.DISPERSE_DRY_RUN !== 'false';

  async function execBridge({ plan, privateKey, bridge: leg }) {
    if (dry()) {
      return { txHash: `0xDRYRUN_BRIDGE_${Math.random().toString(16).slice(2, 10)}` };
    }
    const chain = getDisperseChain(plan.sourceChain);
    const provider = evm.makeProvider(chain);
    const signer = evm.makeSigner(privateKey, provider);
    const req = leg.transactionRequest;
    if (plan.srcTokenAddress && plan.srcTokenAddress !== 'NATIVE' && leg.approvalAddress) {
      const token = new ethers.Contract(plan.srcTokenAddress, evm.ERC20_ABI, signer);
      const owner = await signer.getAddress();
      const need = BigInt(leg.fromAmount);
      const current = await token.allowance(owner, leg.approvalAddress);
      if (current < need) {
        if (current > 0n) { await (await token.approve(leg.approvalAddress, 0n)).wait(); }
        await (await token.approve(leg.approvalAddress, need)).wait();
      }
    }
    const tx = await signer.sendTransaction({
      to: req.to, data: req.data, value: req.value ? BigInt(req.value) : 0n,
    });
    await tx.wait();
    return { txHash: tx.hash };
  }

  async function pollBridge({ plan, bridge: leg }) {
    if (dry()) {
      return { status: 'DONE', receivedAmount: leg.estimatedReceived };
    }
    const src = getDisperseChain(plan.sourceChain);
    const dst = getDisperseChain(plan.destChain);
    return bridge.pollStatus({
      tool: leg.tool, fromChainId: src.chainId, toChainId: dst.chainId, txHash: leg.txHash,
    });
  }

  return { execBridge, pollBridge, pollIntervalMs: 15000 };
}
