import { Router } from 'express';
import { SMART_WALLET_SOURCES } from './sources.js';
import { EARLY_BUY_TIERS, LOOKBACK_MS } from './tiers.js';
import { findRunners, loadWallets, saveWallets, upsertWallets } from './tracker.js';

export function createSmartWalletsRouter({ getTokens = () => [] } = {}) {
  const toScore = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const router = Router();

  router.get('/', (req, res) => {
    const doc = loadWallets();
    res.json({ ...doc, tiers: EARLY_BUY_TIERS, lookbackMs: LOOKBACK_MS, sources: SMART_WALLET_SOURCES });
  });

  router.get('/sources', (req, res) => res.json({ sources: SMART_WALLET_SOURCES }));

  router.get('/tiers', (req, res) => res.json({ tiers: EARLY_BUY_TIERS, lookbackMs: LOOKBACK_MS }));

  // 30-day runners currently in the registry (ATH >= $1M).
  router.get('/runners', (req, res) => {
    const runners = findRunners(getTokens());
    res.json({ count: runners.length, runners: runners.slice(0, 200) });
  });

  // Manual upsert (finder jobs + UI). Body: { wallets: [{ address, chain, source, score, evidence }] }
  router.post('/', (req, res) => {
    const isEvmAddr = v => /^0x[0-9a-fA-F]{40}$/.test(String(v || ''));
    const isSolAddr = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));
    const incoming = (Array.isArray(req.body?.wallets) ? req.body.wallets : []).filter(w => w && typeof w === 'object');
    const clean = incoming
      .map(w => ({ ...w, chain: w?.chain === 'robinhood' ? 'robinhood' : 'solana' }))
      .filter(w => typeof w?.address === 'string' && (w.chain === 'robinhood' ? isEvmAddr(w.address) : isSolAddr(w.address)))
      .map(w => ({ address: w.chain === 'robinhood' ? w.address.toLowerCase() : w.address, chain: w.chain, source: String(w.source || 'manual').slice(0, 64), score: toScore(w.score), hits: (() => { const h = toScore(w.hits); return h == null ? 1 : h; })(), evidence: w.evidence || null }))
      .slice(0, 500);
    if (!clean.length) return res.status(400).json({ error: 'no valid wallets: address must be 0x-40hex (robinhood) or base58 32-44 (solana)' });
    const doc = loadWallets();
    const wallets = upsertWallets(doc.wallets || [], clean);
    saveWallets({ ...doc, wallets });
    res.status(201).json({ count: wallets.length, wallets: wallets.slice(0, 200) });
  });

  return router;
}
