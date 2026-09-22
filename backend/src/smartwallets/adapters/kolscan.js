// Kolscan (kolscan.io) Solana KOL & Alpha Caller Adapter
// Discovers top influencer/caller wallets, tracking win rate, calls, and realized PnL.

import { isSolAddress as isSol } from '../addresses.js';

/**
 * Normalizes Kolscan payload into internal wallet format.
 */
export function normalizeKolscanPayload(payload) {
  const rows = payload?.kols || payload?.leaderboard || payload?.data || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const address = r.address || r.wallet || r.wallet_address;
    if (!isSol(address)) continue;

    const pnl = Number(r.pnl_usd ?? r.pnlUsd ?? r.pnl ?? 0) || 0;
    const winRate = Number(r.winrate ?? r.win_rate ?? r.winRatePct ?? 0) || 0;
    const trades = Number(r.calls_count ?? r.trades_count ?? r.calls ?? 0) || 0;
    const openTrades = Number(r.open_trades ?? 0) || 0;
    const handle = r.twitter || r.username || r.name || null;

    out.push({
      address,
      chain: 'solana',
      category: openTrades >= 5 && pnl > 100 ? 'smart' : 'tracked',
      source: 'kolscan',
      score: pnl,
      hits: 1,
      realizedProfitUsd: pnl,
      winRatePct: winRate,
      totalTrades: trades,
      openTrades,
      profitableTrades: Math.round(trades * (winRate / 100)),
      twitterUsername: handle,
      tags: ['kolscan', 'alpha_caller', pnl > 10000 ? 'whale_kol' : 'active_caller'],
      evidence: {
        platform: 'kolscan.io',
        name: r.name || handle,
        followers: r.followers || null,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Fetch top callers from Kolscan across timeframes (1d, 7d, 30d, all).
 */
export async function fetchKolscanLeaderboard({ timeframe = '7d', limit = 50 } = {}) {
  const tfMap = { '24h': '1', '1d': '1', '7d': '7', '30d': '30', 'all': 'all' };
  const tfParam = tfMap[timeframe] || '7';
  const url = `https://kolscan.io/leaderboard?timeframe=${tfParam}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Kolscan response ${res.status}`);
    }

    const html = await res.text();
    const regex = /href=["']\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})/g;
    let m;
    const foundWallets = new Set();
    const rows = [];
    while ((m = regex.exec(html)) !== null) {
      const address = m[1];
      if (!foundWallets.has(address)) {
        foundWallets.add(address);
        rows.push({
          address,
          timeframe,
          platform: 'kolscan.io',
        });
        if (rows.length >= (Number(limit) || 50)) break;
      }
    }

    return normalizeKolscanPayload(rows);
  } catch {
    return [];
  }
}
