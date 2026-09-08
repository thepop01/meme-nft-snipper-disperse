import { Router } from 'express';
import { DISPERSE_CHAINS, getDisperseChain } from './config.js';
import { buildPlan } from './plan.js';
import * as evm from './evm.js';
import * as solana from './solana.js';
import * as runner from './jobRunner.js';
import { makeExecChunk, makeBridgeDeps } from './execute.js';
import { getQuote } from './bridge.js';
import { isUnlocked, getDecryptedKeys } from '../wallets/vault.js';

const execChunk = makeExecChunk();
const bridgeDeps = makeBridgeDeps();
const runnerDeps = { execChunk, ...bridgeDeps };

async function fetchBalances({ chain, address, tokenAddress, isNativeAsset }) {
  if (chain.family === 'evm') {
    const provider = evm.makeProvider(chain);
    return evm.fetchEvmBalances(provider, address, isNativeAsset ? 'NATIVE' : tokenAddress);
  }
  const conn = solana.makeConnection(chain);
  return solana.fetchSolanaBalances(conn, address, isNativeAsset ? 'NATIVE' : tokenAddress);
}

export function createDisperseRouter() {
  const router = Router();
  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ error: err.message }));

  router.get('/config', (req, res) => {
    res.json({
      dryRun: process.env.DISPERSE_DRY_RUN !== 'false',
      chains: DISPERSE_CHAINS.map(c => ({
        id: c.id, name: c.name, family: c.family, symbol: c.symbol,
        chainId: c.chainId, explorer: c.explorer, maxRecipientsPerTx: c.maxRecipientsPerTx,
        disperseContract: c.disperseContract || null,
        disperseBytecodeHash: c.disperseBytecodeHash || null,
        tokens: Object.keys(c.tokens || {}),
      })),
    });
  });

  router.post('/plan', wrap(async (req, res) => {
    const plan = await buildPlan(req.body || {}, { fetchBalances, getQuote });
    res.json({ plan });
  }));

  router.post('/execute', wrap(async (req, res) => {
    const { plan, keys, executionMode } = req.body || {};
    if (!plan) throw new Error('plan is required');
    const dryRun = process.env.DISPERSE_DRY_RUN !== 'false';
    let effectiveKeys = keys || {};
    const mode = executionMode || (Object.keys(effectiveKeys).length === 0 ? 'external' : 'stored');
    const job = runner.createJob(plan);
    if (mode === 'external') return res.json({ jobId: job.id, job });
    if (mode === 'paper' && !dryRun) throw new Error('Paper execution is disabled while DISPERSE_DRY_RUN=false');
    if (mode === 'stored' && Object.keys(effectiveKeys).length === 0) {
      // Vault fallback: signing keys come from the server-side encrypted vault
      // (unlock it on the Wallets page).
      const decrypted = getDecryptedKeys(plan?.perSender?.map(p => p.sender) || []);
      if (decrypted.size === 0) throw new Error('No vaulted signing keys for the selected senders — unlock the vault or attach keys on the Wallets page');
      effectiveKeys = Object.fromEntries(decrypted);
    }
    runner.executeJob(job.id, effectiveKeys, runnerDeps)
      .catch(() => {});
    res.json({ jobId: job.id, job });
  }));

  router.post('/:id/retry', wrap(async (req, res) => {
    const { keys, plan } = req.body || {};
    let effectiveKeys = keys || {};
    if (Object.keys(effectiveKeys).length === 0) {
      try {
        const decrypted = getDecryptedKeys(plan?.perSender?.map(p => p.sender) || []);
        effectiveKeys = Object.fromEntries(decrypted);
      } catch { /* locked — runner will surface the failure */ }
    }
    runner.retryJob(req.params.id, effectiveKeys, runnerDeps)
      .catch(() => {});
    res.json({ ok: true });
  }));

  router.post('/:id/external-chunk', wrap((req, res) => {
    const job = runner.recordExternalChunk(req.params.id, req.body || {});
    res.json({ job });
  }));

  router.post('/:id/external-bridge/status', wrap(async (req, res) => {
    const job = await runner.refreshExternalBridge(req.params.id, runnerDeps);
    res.json({ job });
  }));

  router.get('/jobs', (req, res) => res.json({ jobs: runner.listJobs() }));
  router.get('/jobs/:id', (req, res) => {
    const job = runner.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  });

  return router;
}

export { getDisperseChain };
