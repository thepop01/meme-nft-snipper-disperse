// Nock Scout (nockterminal.com/wallets) Robinhood & EVM Copyable PnL Adapter
// Discovers top EVM wallets on Robinhood Chain / Base ranked by copyable PnL.

import { isEvmAddress as isEvm } from '../addresses.js';

/**
 * Normalizes Nock Scout payload into internal wallet format.
 */
export function normalizeNockPayload(payload) {
  const rows = payload?.wallets || payload?.data || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const rawAddr = r.address || r.wallet;
    if (!isEvm(rawAddr)) continue;

    const normAddr = String(rawAddr).toLowerCase();
    const pnl = Number(r.copyable_pnl_usd ?? r.pnl_usd ?? r.pnl ?? 0) || 0;
    const winRate = Number(r.win_rate ?? r.winrate ?? 0) || 0;
    const trades = Number(r.trades ?? r.trades_count ?? 0) || 0;
    const openTrades = Number(r.open_trades ?? 0) || 0;

    out.push({
      address: normAddr,
      chain: 'robinhood',
      category: openTrades >= 5 && pnl > 100 ? 'smart' : 'tracked',
      source: 'nockscout',
      score: pnl,
      hits: 1,
      realizedProfitUsd: pnl,
      winRatePct: winRate,
      totalTrades: trades,
      openTrades,
      profitableTrades: Math.round(trades * (winRate / 100)),
      tags: ['nock_scout', 'robinhood_pnl', pnl > 10000 ? 'top_evm_trader' : 'active_evm_trader'],
      evidence: {
        platform: 'nockterminal.com',
        rank: r.rank || null,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Fetch top wallets from Nock Scout leaderboard.
 */
export async function fetchNockLeaderboard({ limit = 50 } = {}) {
  const url = `https://nockterminal.com/api/wallets?chain=robinhood&limit=${Number(limit) || 50}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Nock Scout API response ${res.status}`);
    }

    const json = await res.json();
    return normalizeNockPayload(json);
  } catch {
    return [];
  }
}
