// MadeOnSol (madeonsol.com) Sniper, KOL & Alpha Leaderboard Adapter
// Queries MadeOnSol v1 API for smart KOLs, early buyer snipers, and deployer hunters.

import { isSolAddress as isSol } from '../addresses.js';

function getAuthHeaders() {
  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
  const apiKey = process.env.MADEONSOL_API_KEY;
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

/**
 * Normalizes MadeOnSol Alpha Leaderboard (Early Buyer Snipers) into internal wallet format.
 */
export function normalizeMadeOnSolAlphaPayload(payload) {
  const rows = payload?.leaderboard || payload?.snipers || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const addr = r.wallet || r.address || r.wallet_address;
    if (!isSol(addr)) continue;

    const pnlSol = Number(r.net_pnl_sol ?? 0) || 0;
    const pnlUsd = Number(r.profit_usd ?? r.pnl_usd ?? (pnlSol * 150)) || 0; // approximate USD if not provided
    const winRate = Number(r.win_rate ?? 0) * 100;
    const trades = Number(r.total_buys ?? r.tokens_traded ?? r.successful_snipes ?? 1) || 1;
    const bestRank = Number(r.best_rank ?? 0);
    const avgRank = Number(r.avg_rank ?? 0);
    const symbol = r.token_symbol || r.symbol || null;

    out.push({
      address: addr,
      chain: 'solana',
      category: 'tracked',
      source: 'madeonsol',
      score: pnlUsd,
      hits: trades,
      realizedProfitUsd: pnlUsd,
      winRatePct: winRate,
      totalTrades: trades,
      tags: [
        'sniper',
        'madeonsol_sniper',
        'alpha_buyer',
        symbol,
        bestRank === 1 ? 'rank_1_buyer' : null,
        avgRank > 0 && avgRank <= 5 ? 'early_sniper' : null,
        pnlUsd >= 5000 ? 'high_profit_sniper' : null,
      ].filter(Boolean),
      evidence: {
        platform: 'madeonsol.com',
        type: 'alpha_sniper',
        rank: r.rank || null,
        bestRank: r.best_rank || null,
        avgRank: r.avg_rank || null,
        roi: r.roi || null,
        netPnlSol: pnlSol,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Normalizes MadeOnSol KOL Leaderboard into internal wallet format.
 */
export function normalizeMadeOnSolKolPayload(payload) {
  const rows = payload?.leaderboard || payload?.kols || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const addr = r.wallet || r.address;
    if (!isSol(addr)) continue;

    const pnl = Number(r.pnl ?? r.profit_usd ?? 0) || 0;
    const buyCount = Number(r.buy_count ?? 0) || 0;
    const sellCount = Number(r.sell_count ?? 0) || 0;
    const trades = buyCount + sellCount;
    const winRate = Number(r.win_rate ?? 0);
    const name = r.name || null;
    const strategy = r.strategy_tag || r.auto_strategy_tag || null;

    out.push({
      address: addr,
      chain: 'solana',
      label: name ? `@${name}` : null,
      category: pnl > 100 ? 'smart' : 'tracked',
      source: 'madeonsol',
      score: pnl,
      hits: trades || 1,
      realizedProfitUsd: pnl,
      winRatePct: winRate > 1 ? winRate : winRate * 100,
      totalTrades: trades,
      twitterUsername: name,
      tags: [
        'kol',
        'madeonsol_kol',
        'smart_money',
        strategy,
        pnl >= 5000 ? 'whale_kol' : null,
      ].filter(Boolean),
      evidence: {
        platform: 'madeonsol.com',
        type: 'kol_leaderboard',
        name,
        strategyTag: strategy,
        medianHoldMinutes: r.median_hold_minutes_30d || null,
        earlyEntryPercentile: r.percentile_early_entry_30d || null,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Normalizes MadeOnSol Deployer Leaderboard into internal wallet format.
 */
export function normalizeMadeOnSolDeployerPayload(payload) {
  const rows = payload?.deployers || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const addr = r.wallet_address || r.wallet;
    if (!isSol(addr)) continue;

    const deployed = Number(r.total_tokens_deployed ?? 0) || 0;
    const bonded = Number(r.total_tokens_bonded ?? 0) || 0;
    const bondingRate = Number(r.bonding_rate ?? 0) * 100;
    const peakMcUsd = Number(r.peak_mc_usd ?? 0) || 0;
    const tier = r.tier || 'unranked';

    out.push({
      address: addr,
      chain: 'solana',
      category: 'tracked',
      source: 'madeonsol',
      score: peakMcUsd,
      hits: deployed,
      totalTrades: deployed,
      tags: [
        'pumpfun_deployer',
        'deployer_hunter',
        `tier_${tier}`,
        bondingRate >= 50 ? 'high_bonding_deployer' : null,
      ].filter(Boolean),
      evidence: {
        platform: 'madeonsol.com',
        type: 'deployer_leaderboard',
        totalDeployed: deployed,
        totalBonded: bonded,
        bondingRatePct: bondingRate,
        peakMcUsd,
        tier,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Generic normalizer for backwards compatibility with existing unit tests.
 */
export function normalizeMadeOnSolPayload(payload) {
  if (payload?.leaderboard && payload.leaderboard[0]?.net_pnl_sol !== undefined) {
    return normalizeMadeOnSolAlphaPayload(payload);
  }
  if (payload?.leaderboard && payload.leaderboard[0]?.strategy_tag !== undefined) {
    return normalizeMadeOnSolKolPayload(payload);
  }
  if (payload?.deployers) {
    return normalizeMadeOnSolDeployerPayload(payload);
  }
  return normalizeMadeOnSolAlphaPayload(payload);
}

/**
 * Fetch top early snipers from MadeOnSol Alpha Leaderboard.
 */
export async function fetchMadeOnSolAlphaLeaderboard({ limit = 50, offset = 0 } = {}) {
  const url = `https://madeonsol.com/api/v1/alpha/leaderboard?limit=${Number(limit) || 50}&offset=${Number(offset) || 0}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getAuthHeaders(),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`MadeOnSol Alpha API response ${res.status}`);
    const json = await res.json();
    return normalizeMadeOnSolAlphaPayload(json);
  } catch {
    return [];
  }
}

/**
 * Fetch top KOL traders from MadeOnSol KOL Leaderboard.
 */
export async function fetchMadeOnSolKolLeaderboard({ window = '30d' } = {}) {
  const url = `https://madeonsol.com/api/v1/kol/leaderboard?window=${window}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getAuthHeaders(),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`MadeOnSol KOL API response ${res.status}`);
    const json = await res.json();
    return normalizeMadeOnSolKolPayload(json);
  } catch {
    return [];
  }
}

/**
 * Fetch top deployers from MadeOnSol Deployer Hunter.
 */
export async function fetchMadeOnSolDeployerLeaderboard({ limit = 50, offset = 0 } = {}) {
  const url = `https://madeonsol.com/api/v1/deployer-hunter/leaderboard?limit=${Number(limit) || 50}&offset=${Number(offset) || 0}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getAuthHeaders(),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`MadeOnSol Deployer API response ${res.status}`);
    const json = await res.json();
    return normalizeMadeOnSolDeployerPayload(json);
  } catch {
    return [];
  }
}

/**
 * Normalizes MadeOnSol KOL Wallets directory payload into internal wallet format.
 */
export function normalizeMadeOnSolKolWalletsPayload(payload) {
  const rows = payload?.wallets || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const addr = r.wallet_address || r.wallet;
    if (!isSol(addr)) continue;

    const name = r.name || null;
    const followers = Number(r.twitter_followers ?? 0) || 0;
    const strategy = r.strategy_tag || 'kol';
    const twitterHandle = r.twitter_url 
      ? r.twitter_url.replace(/https?:\/\/(www\.)?(x|twitter)\.com\//, '').replace(/\/$/, '') 
      : (name || null);

    out.push({
      address: addr,
      chain: 'solana',
      category: 'tracked',
      source: 'madeonsol',
      score: followers,
      hits: 1,
      twitterUsername: twitterHandle,
      tags: [
        'kol',
        'madeonsol_kol',
        'alpha_caller',
        `strategy_${strategy}`,
        followers >= 10000 ? 'major_kol' : 'active_caller',
      ],
      evidence: {
        platform: 'madeonsol.com',
        type: 'kol_wallets_directory',
        name,
        followers,
        strategyTag: strategy,
        twitterUrl: r.twitter_url,
        isActive: r.is_active,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Fetch directory of tracked KOL wallets from MadeOnSol.
 */
export async function fetchMadeOnSolKolWallets({ limit = 100, offset = 0 } = {}) {
  const url = `https://madeonsol.com/api/v1/kol/wallets?limit=${Number(limit) || 100}&offset=${Number(offset) || 0}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getAuthHeaders(),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`MadeOnSol KOL Wallets API response ${res.status}`);
    const json = await res.json();
    return normalizeMadeOnSolKolWalletsPayload(json);
  } catch {
    return [];
  }
}

/**
 * Backwards compatible fetcher for existing route.
 */
export async function fetchMadeOnSolSnipers({ limit = 50 } = {}) {
  return fetchMadeOnSolAlphaLeaderboard({ limit, offset: 0 });
}

/**
 * Normalizes MadeOnSol /alpha/{wallet}/linked response into parent/child relationships.
 */
export function normalizeMadeOnSolLinkedPayload(wallet, payload) {
  if (!payload || typeof payload !== 'object') return [];

  const rawList = payload.linked || payload.sub_wallets || payload.wallets || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const item of rawList) {
    if (!item) continue;
    const linkedAddr = typeof item === 'string' ? item : (item.wallet || item.address || item.linked_wallet);
    if (!linkedAddr || linkedAddr === wallet) continue;

    const relationship = item.relationship || (item.is_funder ? 'parent' : 'child');
    const amount = Number(item.funded_amount || item.amount || 0);
    const txHash = item.tx_hash || item.txHash || item.signature || null;

    if (relationship === 'parent' || item.is_funder) {
      out.push({
        parentAddress: linkedAddr,
        childAddress: wallet,
        amount,
        txHash,
        chain: 'solana',
        source: 'madeonsol_linked',
        evidence: typeof item === 'object' ? item : { linkedAddress: linkedAddr },
      });
    } else {
      out.push({
        parentAddress: wallet,
        childAddress: linkedAddr,
        amount,
        txHash,
        chain: 'solana',
        source: 'madeonsol_linked',
        evidence: typeof item === 'object' ? item : { linkedAddress: linkedAddr },
      });
    }
  }

  return out;
}

/**
 * Fetch linked wallets for a Solana address from MadeOnSol /alpha/{wallet}/linked.
 */
export async function fetchMadeOnSolLinkedWallets(wallet) {
  if (!wallet) return [];

  try {
    const res = await fetch(`https://madeonsol.com/api/v1/alpha/${encodeURIComponent(wallet)}/linked`, {
      signal: AbortSignal.timeout(8000),
      headers: getAuthHeaders(),
    });
    if (res.status === 403 || res.status === 404) {
      return [];
    }
    if (!res.ok) throw new Error(`MadeOnSol status ${res.status}`);
    const json = await res.json();
    return normalizeMadeOnSolLinkedPayload(wallet, json);
  } catch {
    return [];
  }
}


