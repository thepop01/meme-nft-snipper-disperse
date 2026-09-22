// MemeMoves (mememoves.com/smart-money) Adapter
// Multi-wallet accumulation signals and cluster leaderboards.

import { isSolAddress as isSol } from '../addresses.js';

/**
 * Normalizes MemeMoves payload into internal wallet format.
 */
export function normalizeMemeMovesPayload(payload) {
  const tokens = payload?.tokens || payload?.data || (Array.isArray(payload) ? payload : []);
  const out = [];
  const seen = new Set();

  for (const t of tokens) {
    const symbol = t.symbol || 'MEME';
    const accWallets = t.accumulating_wallets || t.wallets || [];

    for (const w of accWallets) {
      const addr = w.address || w.wallet;
      if (!isSol(addr) || seen.has(addr)) continue;
      seen.add(addr);

      const pnl = Number(w.pnl_usd ?? w.pnl ?? 0) || 0;
      const buys = Number(w.buys ?? w.trades ?? 1) || 1;

      out.push({
        address: addr,
        chain: 'solana',
        category: pnl > 100 && buys >= 5 ? 'smart' : 'tracked',
        source: 'mememoves',
        score: pnl,
        hits: buys,
        realizedProfitUsd: pnl,
        totalTrades: buys,
        tags: ['mememoves_cluster', 'convergence_buyer', symbol],
        evidence: {
          platform: 'mememoves.com',
          tokenSymbol: symbol,
          tokenMint: t.mint || null,
          clusterScore: t.cluster_score || null,
          importedAt: new Date().toISOString(),
        },
      });
    }
  }

  return out;
}

/**
 * Fetch top converging wallets from MemeMoves public feed.
 */
export async function fetchMemeMovesLeaderboard({ limit = 50 } = {}) {
  const url = `https://mememoves.com/api/smart-money?limit=${Number(limit) || 50}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`MemeMoves API response ${res.status}`);
    }

    const json = await res.json();
    return normalizeMemeMovesPayload(json);
  } catch {
    return [];
  }
}
