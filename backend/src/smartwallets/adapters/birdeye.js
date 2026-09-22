// Birdeye (birdeye.so) Wallet Portfolio & Verified PnL Adapter
// Queries multi-token balances, computing meme holdings and whale status.

import { WHALE_WALLET_MIN_USD } from '../tiers.js';

const STABLES_AND_NATIVE = new Set([
  'SOL', 'WSOL', 'USDC', 'USDT', 'USDH', 'DAI', 'PYUSD', 'EURC'
]);

/**
 * Parses Birdeye portfolio response and computes balanceUsd & memeHoldingsUsd.
 */
export function parseBirdeyePortfolio(address, raw) {
  if (!raw || typeof raw !== 'object') {
    return { address, balanceUsd: 0, memeHoldingsUsd: 0, isWhale: false, tokens: [] };
  }

  const items = raw?.data?.items || raw?.items || (Array.isArray(raw) ? raw : []);
  let totalUsd = Number(raw?.data?.totalUsd ?? raw?.totalUsd ?? 0);
  let memeUsd = 0;
  const tokens = [];

  for (const item of items) {
    const sym = String(item.symbol || '').toUpperCase();
    const val = Number(item.valueUsd ?? item.value ?? 0);
    tokens.push({
      symbol: sym,
      valueUsd: val,
      amount: Number(item.uiAmount ?? item.amount ?? 0),
      mint: item.address || item.mint || null,
    });

    if (!STABLES_AND_NATIVE.has(sym)) {
      memeUsd += val;
    }
  }

  if (totalUsd === 0 && items.length > 0) {
    totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
  }

  const isWhale = totalUsd >= WHALE_WALLET_MIN_USD || memeUsd >= WHALE_WALLET_MIN_USD;

  return {
    address,
    balanceUsd: totalUsd,
    memeHoldingsUsd: memeUsd,
    isWhale,
    tokens: tokens.slice(0, 50),
  };
}

/**
 * Fetches token balances for a wallet via Birdeye API.
 */
export async function fetchBirdeyePortfolio(address, { apiKey = process.env.BIRDEYE_API_KEY } = {}) {
  const url = `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${encodeURIComponent(address)}`;
  
  const headers = { 'Accept': 'application/json' };
  if (apiKey) {
    headers['X-API-KEY'] = apiKey;
    headers['x-chain'] = 'solana';
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Birdeye API error ${res.status}`);
    }

    const json = await res.json();
    return parseBirdeyePortfolio(address, json);
  } catch {
    return { address, balanceUsd: 0, memeHoldingsUsd: 0, isWhale: false, tokens: [] };
  }
}
