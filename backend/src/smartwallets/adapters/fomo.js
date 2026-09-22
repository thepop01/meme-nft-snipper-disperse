// FOMO (fomo.family / fomoapi.io) Social Smart Money Adapter
// Discovers top Solana and EVM meme traders, handles, realized PnL, holdings, and follow graphs.

import { isEvmAddress as isEvm, isSolAddress as isSol } from '../addresses.js';

export const FOMO_DEFAULT_KEY = 'fapi_94b6ee2400a462a2304dacdb14b256af4e5cac8502533b11e7304bcccde3eb1f';
export const FOMO_BASE_URL = 'https://api.fomoapi.io';

export function getFomoHeaders(apiKey) {
  const token = apiKey || process.env.FOMO_API_KEY || FOMO_DEFAULT_KEY;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

/**
 * Calculates total portfolio and meme holdings from a FOMO holdings array.
 */
export function calculateHoldingsUsd(holdings) {
  if (!Array.isArray(holdings)) return { balanceUsd: 0, memeHoldingsUsd: 0 };
  let balanceUsd = 0;
  let memeHoldingsUsd = 0;

  for (const h of holdings) {
    const val = Number(h?.valueUsd ?? 0) || 0;
    balanceUsd += val;
    const netId = Number(h?.token?.networkId ?? h?.networkId);
    const chain = String(h?.token?.chain ?? h?.chain ?? '');
    // Holdings on Robinhood Chain (4663) or Solana SPL tokens are primarily meme/community tokens
    if (netId === 4663 || chain === 'robinhood' || netId === 1399811149 || chain === 'solana' || !netId) {
      memeHoldingsUsd += val;
    }
  }

  return {
    balanceUsd: Math.round(balanceUsd * 100) / 100,
    memeHoldingsUsd: Math.round(memeHoldingsUsd * 100) / 100,
  };
}

/**
 * Normalizes FOMO leaderboard or user payload into internal wallet objects.
 */
export function normalizeFomoPayload(payload, { defaultCategory = null, window = null } = {}) {
  const rows = payload?.traders || payload?.leaderboard || (Array.isArray(payload) ? payload : (payload && typeof payload === 'object' && payload.wallets ? [payload] : []));
  const out = [];

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const sol = r?.wallets?.solana || r?.solana_address || (isSol(r?.address) ? r.address : null);
    const evm = r?.wallets?.evm || r?.evm_address || (isEvm(r?.address) ? r.address : null);
    const pnl = Number(r.pnl_usd ?? r.pnlUsd ?? r.realized_pnl ?? r.pnl ?? 0) || 0;
    const winRate = Number(r.win_rate ?? r.winRate ?? r.winrate_pct ?? 0) || 0;
    const trades = Number(r.trades ?? r.trades_count ?? r.tradesCount ?? r.total_trades ?? r.numTrades ?? 0) || 0;
    const openTrades = Number(r.open_trades ?? r.openTrades ?? 0) || 0;
    const volumeUsd = Number(r.volume_usd ?? r.volumeUsd ?? r.totalVolumeUsd ?? 0) || 0;
    const handle = r.handle || r.userHandle || r.username || r.twitterUsername || null;
    const avgHoldingTimeSec = Number(r.profile?.averageHoldTimeSeconds ?? r.averageHoldTimeSeconds ?? 0) || null;

    // If holdings array is present, compute live balance
    const { balanceUsd, memeHoldingsUsd } = calculateHoldingsUsd(r.holdings);
    const isWhale = balanceUsd >= 5000 || memeHoldingsUsd >= 5000;

    let category = defaultCategory;
    if (!category) {
      if (isWhale) {
        category = 'whale';
      } else if ((openTrades >= 5 || trades >= 5) && pnl > 100) {
        category = 'smart';
      } else {
        category = 'tracked';
      }
    }

    const baseTags = ['fomo_family', 'social_alpha'];
    if (isWhale) baseTags.push('whale', 'top_holder');
    if (pnl > 5000) baseTags.push('top_trader');
    if (handle) baseTags.push(`fomo_${handle}`);

    if (isSol(sol)) {
      out.push({
        address: sol,
        chain: 'solana',
        category,
        source: 'fomo-leaderboard',
        score: pnl,
        hits: 1,
        realizedProfitUsd: pnl,
        winRatePct: winRate,
        totalTrades: trades,
        openTrades,
        profitableTrades: Math.round(trades * (winRate / 100)),
        volumeUsd,
        balanceUsd,
        memeHoldingsUsd,
        avgHoldingTimeSec,
        twitterUsername: handle,
        tags: [...new Set(baseTags)],
        evidence: {
          platform: 'fomo.family',
          handle,
          window: window || r.window || '30d',
          importedAt: new Date().toISOString(),
        },
      });
    }

    if (isEvm(evm)) {
      const normEvm = String(evm).toLowerCase();
      out.push({
        address: normEvm,
        chain: 'robinhood',
        category,
        source: 'fomo-leaderboard',
        score: pnl,
        hits: 1,
        realizedProfitUsd: pnl,
        winRatePct: winRate,
        totalTrades: trades,
        openTrades,
        profitableTrades: Math.round(trades * (winRate / 100)),
        volumeUsd,
        balanceUsd,
        memeHoldingsUsd,
        avgHoldingTimeSec,
        twitterUsername: handle,
        tags: [...new Set(baseTags)],
        evidence: {
          platform: 'fomo.family',
          handle,
          window: window || r.window || '30d',
          importedAt: new Date().toISOString(),
        },
      });
    }
  }

  return out;
}

/**
 * Fetch live top traders from fomoapi for a specific window (24h, 7d, 30d, all).
 */
export async function fetchFomoLeaderboard({ chain = 'all', limit = 150, window = '30d', apiKey = null } = {}) {
  const url = `${FOMO_BASE_URL}/v2/leaderboard/${encodeURIComponent(window)}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getFomoHeaders(apiKey),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`FOMO API response ${res.status}`);
    }

    const json = await res.json();
    let wallets = normalizeFomoPayload(json, { window });
    if (chain && chain !== 'all') {
      wallets = wallets.filter(w => w.chain === chain);
    }
    if (limit && wallets.length > limit * 2) {
      wallets = wallets.slice(0, limit * 2);
    }
    return wallets;
  } catch (err) {
    return [];
  }
}

/**
 * Fetch all leaderboards (24h, 7d, 30d, all) and return deduplicated list of wallets and unique handles.
 */
export async function fetchFomoAllLeaderboards({ chain = 'all', apiKey = null, windows = ['24h', '7d', '30d', 'all'] } = {}) {
  const allWallets = [];
  const handleSet = new Set();

  for (const win of windows) {
    const wallets = await fetchFomoLeaderboard({ chain, window: win, apiKey });
    for (const w of wallets) {
      allWallets.push(w);
      if (w.twitterUsername) {
        handleSet.add(w.twitterUsername);
      }
    }
  }

  // Deduplicate wallets by chain + address, retaining highest PnL / best metrics
  const walletMap = new Map();
  for (const w of allWallets) {
    const key = `${w.chain}:${w.address.toLowerCase()}`;
    const existing = walletMap.get(key);
    if (!existing) {
      walletMap.set(key, w);
    } else {
      existing.hits = (existing.hits || 1) + 1;
      if ((w.realizedProfitUsd || 0) > (existing.realizedProfitUsd || 0)) {
        existing.realizedProfitUsd = w.realizedProfitUsd;
        existing.score = w.score;
      }
      if ((w.totalTrades || 0) > (existing.totalTrades || 0)) {
        existing.totalTrades = w.totalTrades;
      }
      if (w.balanceUsd && (!existing.balanceUsd || w.balanceUsd > existing.balanceUsd)) {
        existing.balanceUsd = w.balanceUsd;
        existing.memeHoldingsUsd = w.memeHoldingsUsd;
      }
      for (const t of w.tags || []) {
        if (!existing.tags.includes(t)) existing.tags.push(t);
      }
    }
  }

  return {
    wallets: Array.from(walletMap.values()),
    handles: Array.from(handleSet),
  };
}

/**
 * Fetch the list of traders a user follows.
 */
export async function fetchFomoUserFollowing(handle, { apiKey = null } = {}) {
  if (!handle) return [];
  const url = `${FOMO_BASE_URL}/v2/users/${encodeURIComponent(handle)}/following`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getFomoHeaders(apiKey),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.following) ? json.following : [];
  } catch {
    return [];
  }
}

/**
 * Fetch a trader's detailed profile and resolved wallets (Solana & EVM).
 */
export async function fetchFomoUserProfile(handle, { apiKey = null } = {}) {
  if (!handle) return null;
  const url = `${FOMO_BASE_URL}/v2/users/${encodeURIComponent(handle)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getFomoHeaders(apiKey),
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch a trader's live token holdings across Solana and Robinhood.
 */
export async function fetchFomoUserBalances(handle, { apiKey = null } = {}) {
  if (!handle) return [];
  const url = `${FOMO_BASE_URL}/v2/users/${encodeURIComponent(handle)}/balances`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getFomoHeaders(apiKey),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.holdings) ? json.holdings : [];
  } catch {
    return [];
  }
}

/**
 * Fetch a trader's trade history.
 */
export async function fetchFomoUserTrades(handle, { apiKey = null } = {}) {
  if (!handle) return [];
  const url = `${FOMO_BASE_URL}/v2/users/${encodeURIComponent(handle)}/trades`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: getFomoHeaders(apiKey),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.trades) ? json.trades : [];
  } catch {
    return [];
  }
}
