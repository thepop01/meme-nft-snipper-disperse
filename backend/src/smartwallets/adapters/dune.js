// Dune Analytics (dune.com) 30d Leaderboard Query Adapter
// Ingests community SQL query results for Robinhood Chain (4663) and Solana memecoin traders.

import { isEvmAddress as isEvm, isSolAddress as isSol } from '../addresses.js';

export function normalizeDuneRows(payload) {
  const rows = payload?.result?.rows || payload?.rows || payload?.data || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const rawAddr = r.trader_address || r.address || r.wallet || r.user;
    if (!rawAddr) continue;

    const chain = (r.chain === 'solana' || isSol(rawAddr)) ? 'solana' : 'robinhood';
    const normAddr = chain === 'robinhood' ? String(rawAddr).toLowerCase() : String(rawAddr);

    if (chain === 'solana' && !isSol(normAddr)) continue;
    if (chain === 'robinhood' && !isEvm(normAddr)) continue;

    const pnl = Number(r.total_realized_profit_usd ?? r.pnl_usd ?? r.profit ?? 0) || 0;
    const winRate = Number(r.win_rate_pct ?? r.win_rate ?? 0) || 0;
    const trades = Number(r.trade_count ?? r.trades ?? 0) || 0;
    const openTrades = Number(r.open_trades ?? 0) || 0;

    out.push({
      address: normAddr,
      chain,
      category: openTrades >= 5 && pnl > 100 ? 'smart' : 'tracked',
      source: 'dune-analytics',
      score: pnl,
      hits: 1,
      realizedProfitUsd: pnl,
      winRatePct: winRate,
      totalTrades: trades,
      openTrades,
      profitableTrades: Math.round(trades * (winRate / 100)),
      tags: ['dune_leaderboard', chain === 'robinhood' ? 'robinhood_alpha' : 'solana_alpha'],
      evidence: {
        platform: 'dune.com',
        queryId: r.query_id || null,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

export async function fetchDuneLeaderboard(queryId, { apiKey = process.env.DUNE_API_KEY } = {}) {
  if (!apiKey || !queryId) return [];

  const url = `https://api.dune.com/api/v1/query/${queryId}/results`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'x-dune-api-key': apiKey,
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Dune API error ${res.status}`);
    const json = await res.json();
    return normalizeDuneRows(json);
  } catch {
    return [];
  }
}
