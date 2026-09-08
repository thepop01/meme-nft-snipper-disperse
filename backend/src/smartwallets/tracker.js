// Smart-wallet tracker: finds last-30-day runners (ATH >= $1M) and scores
// early-buyer wallets against EARLY_BUY_TIERS. Storage via store.js
// (backend/data/smart-wallets.json). Both chains: solana + robinhood.
import { load, save } from '../store.js';
import { LOOKBACK_MS, tierForAth, qualifiesEarlyBuy } from './tiers.js';

const STORE_KEY = 'smart-wallets';

function tokenAth(token) {
  // Prefer explicit ATH fields, fall back to max of history + current mcap.
  const candidates = [
    token.ath, token.athMcap, token.maxMcap, token.marketCapUsd,
    ...(Array.isArray(token.history) ? token.history.map(h => h.marketCapUsd) : []),
  ].filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function tokenAgeOk(token, now = Date.now()) {
  const ts = token.createdAt || token.firstSeenAt || token.athTs;
  if (!ts) return true; // unknown age -> include, don't silently drop
  return now - ts <= LOOKBACK_MS;
}

// trades: [{ wallet, address, chain, buyMcap, ts }] — caller supplies
// buy-side fills from Helius/GMGN/pumpportal trade tape. Pure filter.
export function selectEarlyBuyers({ athMcap, buys }) {
  const tier = tierForAth(athMcap);
  if (!tier) return { tier: null, buyers: [] };
  const buyers = (buys || []).filter(b => qualifiesEarlyBuy({ athMcap, buyMcap: b.buyMcap }));
  return { tier, buyers };
}

// Scan registry tokens for 30-day runners. Returns runner summaries without
// requiring trade history (buyer extraction happens in selectEarlyBuyers
// once per-token trades are available).
export function findRunners(tokens, now = Date.now()) {
  return (tokens || [])
    .map(token => ({ token, ath: tokenAth(token) }))
    .filter(({ ath }) => ath != null && ath >= 1_000_000)
    .filter(({ token }) => tokenAgeOk(token, now))
    .map(({ token, ath }) => ({
      mint: token.mint,
      chain: token.chain || 'solana',
      symbol: token.symbol || '?',
      ath,
      tier: tierForAth(ath),
      createdAt: token.createdAt || null,
    }));
}

export function loadWallets() {
  return load(STORE_KEY, { updatedAt: null, wallets: [], runners: [] });
}

export function saveWallets(doc) {
  save(STORE_KEY, { ...doc, updatedAt: new Date().toISOString() });
}

export function upsertWallets(existing, newcomers) {
  const byKey = new Map(existing.map(w => [`${w.chain}:${String(w.address).toLowerCase()}`, w]));
  for (const w of newcomers) {
    const key = `${w.chain}:${String(w.address).toLowerCase()}`;
    const prev = byKey.get(key);
    byKey.set(key, {
      address: w.address,
      chain: w.chain,
      source: w.source || prev?.source || 'manual',
      score: w.score ?? prev?.score ?? null,
      hits: (prev?.hits || 0) + (w.hits || 1),
      firstSeenAt: prev?.firstSeenAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      evidence: w.evidence || prev?.evidence || null,
    });
  }
  return [...byKey.values()];
}
