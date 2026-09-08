// Express router for NFT mint v2. Mounted at /api/nft in server.js.
import { Router } from 'express';
import { ethers } from 'ethers';
import { refreshCache, queryDrops, getCachedDrops, NFT_CHAINS, fetchRecentlyMinted } from './drops.js';
import { getNftChain, NFT_CHAIN_CONFIG } from './chains.js';
import { getGasSnapshot } from './gas.js';
import { fetchMintTx, simulateMint } from './mintTx.js';
import * as runner from './mintRunner.js';
import { makeExecWallet } from './execute.js';
import { save, load } from '../store.js';
import { isUnlocked, getDecryptedKeys } from '../wallets/vault.js';

export function createNftRouter() {
  const router = Router();
  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch(err => res.status(err.status || 400).json({ error: err.message }));

  runner._setDeps({ execWallet: makeExecWallet() });

  router.get('/drops', (req, res) => {
    const { status, chain, q } = req.query;
    res.json({
      dryRun: process.env.NFT_DRY_RUN !== 'false',
      chains: NFT_CHAINS,
      drops: queryDrops({ status: status || 'active', chain: chain || null, q: q || '' }),
    });
  });

  router.post('/drops/refresh', wrap(async (req, res) => {
    const out = await refreshCache();
    res.json({ count: out.drops.length });
  }));

  router.get('/drops/lookup', wrap(async (req, res) => {
    const slug = req.query.slug;
    if (!slug) throw new Error('slug required');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
    const resp = await fetch(`https://api.opensea.io/api/v2/drops/${slug}`, { headers });
    if (!resp.ok) throw new Error(`OpenSea lookup ${resp.status}`);
    const raw = await resp.json();
    const { normalizeDrop } = await import('./normalize.js');
    const d = normalizeDrop(raw);
    if (!d) throw new Error('Drop could not be normalized');
    const { NFT_CHAINS: chains } = await import('./drops.js');
    if (!chains.includes(d.chain)) throw new Error(`Chain ${d.chain} not supported`);
    const prev = getCachedDrops();
    const key = `${d.chain}:${d.slug}`;
    if (!prev.find(p => `${p.chain}:${p.slug}` === key)) {
      d.firstSeen = Date.now();
      // Preserve prune bookkeeping — resetting absentCount/fetchedAt here made
      // drops mid-prune linger and clobbered per-fetch timestamps.
      const store = load('nft-drops', { drops: [], fetchedAt: {}, absentCount: {} });
      save('nft-drops', {
        drops: [...prev, d],
        fetchedAt: store.fetchedAt || {},
        absentCount: store.absentCount || {},
      });
    }
    res.json({ drop: d });
  }));

  router.get('/gas', wrap(async (req, res) => {
    const chain = getNftChain(req.query.chain);
    if (!chain) throw new Error('Unknown chain');
    if (!chain.rpc) throw new Error(`RPC not configured for ${req.query.chain}. Set RPC_${String(req.query.chain).toUpperCase()} in backend/.env`);
    const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
    const snap = await getGasSnapshot(provider);
    res.json({
      baseFeeGwei: Number(snap.baseFeeWei) / 1e9,
      priorityFeeGwei: Number(snap.priorityFeeWei) / 1e9,
    });
  }));

  // Per-wallet eligibility + balances for the wallet panel.
  router.post('/eligibility', wrap(async (req, res) => {
    const { slug, chain: chainName, wallets, quantity = 1 } = req.body || {};
    const chain = getNftChain(chainName);
    if (!chain) throw new Error('Unknown chain');
    if (!chain.rpc) throw new Error(`RPC not configured for ${chainName}. Set RPC_${String(chainName).toUpperCase()} in backend/.env`);
    const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
    const out = [];
    for (const address of wallets || []) {
      const entry = { address, balanceWei: null, eligibility: 'unknown', reason: null };
      try { entry.balanceWei = (await provider.getBalance(address)).toString(); } catch { /* keep null */ }
      try {
        const tx = await fetchMintTx(slug, address, quantity);
        const sim = await simulateMint(provider, tx, address);
        entry.eligibility = sim.result;
        entry.reason = sim.reason;
        entry.mintCostWei = tx.value.toString();
      } catch (err) {
        entry.eligibility = /manual/i.test(err.message) ? 'manual-only' : 'unknown';
        entry.reason = err.message;
      }
      out.push(entry);
    }
    res.json({ wallets: out });
  }));

  // Jobs
  router.get('/jobs', (req, res) => res.json({ jobs: runner.listJobs() }));
  router.get('/jobs/:id', (req, res) => {
    const job = runner.getMintJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  });
  router.post('/jobs', wrap((req, res) => {
    const body = req.body || {};
    if (!body.drop || typeof body.drop !== 'object' || !body.drop.slug) {
      throw Object.assign(new Error('drop with a slug is required'), { status: 400 });
    }
    if (!Array.isArray(body.wallets) || body.wallets.length === 0 ||
        body.wallets.some(w => !w.address)) {
      throw Object.assign(new Error('at least one wallet with an address is required'), { status: 400 });
    }
    if (!Number.isFinite(Number(body.scheduledTime)) ||
        Number(body.scheduledTime) < Date.now() - 60_000) {
      throw Object.assign(new Error('scheduledTime must be a valid timestamp in the near future'), { status: 400 });
    }
    res.json({ job: runner.scheduleJob({
      ...body,
      gas: body.gas && body.gas.mode ? body.gas : { mode: 'caps', maxFeeGwei: 50, maxPriorityGwei: 2 },
      policy: body.policy || {},
    }) });
  }));
  router.post('/jobs/:id/arm', wrap(async (req, res) => {
    let keys = (req.body || {}).keys || {};
    // Vault fallback: with no client-supplied keys, pull them from the signer
    // vault for this job's wallets (requires the vault to be unlocked).
    if (Object.keys(keys).length === 0 && isUnlocked()) {
      const job = runner.getMintJob(req.params.id);
      if (job) {
        const decrypted = getDecryptedKeys(job.wallets.map(w => String(w.address).toLowerCase()));
        keys = Object.fromEntries(decrypted);
      }
    }
    res.json({ job: runner.armJob(req.params.id, keys) });
  }));
  router.post('/jobs/:id/cancel', wrap((req, res) => res.json({ job: runner.cancelJob(req.params.id) })));

  return router;
}
