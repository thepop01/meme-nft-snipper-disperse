import { upsertMeme } from './memeRegistry.js';
import { executeWithThrottle } from './rateLimiter.js';
import { log } from '../bus.js';

export const CURRENT_MCAP_THRESHOLD = 2_000_000;
const DEXSCREENER_BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/latest/v1';

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function normalizeChain(item) {
  const chain = String(item?.chain ?? item?.chainId ?? '').toLowerCase();
  if (chain === 'robinhood' || chain === 'hood') return 'robinhood';
  return 'solana';
}

function responseItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tokens)) return data.tokens;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizeBoost(item) {
  const attrs = item?.attributes || {};
  const token = item?.token || item?.baseToken || {};
  const ca = item?.ca
    ?? item?.tokenAddress
    ?? item?.address
    ?? token.address
    ?? attrs.address;
  if (!ca || typeof ca !== 'string') return null;

  // The boosts endpoint does not always expose market cap. Prefer an explicit
  // provider value and retain the historical boost amount fallback for the
  // endpoint's compact response shape.
  const currentMcap = firstNumber(
    item.currentMcap,
    item.current_mcap,
    item.marketCap,
    item.market_cap_usd,
    item.fdv,
    item.fdvUsd,
    attrs.currentMcap,
    attrs.market_cap_usd,
    attrs.fdv_usd,
    numberOrNull(item.totalAmount) == null ? null : Number(item.totalAmount) * 1000,
  );

  return {
    ca,
    name: item.name ?? token.name ?? attrs.name,
    symbol: item.symbol ?? token.symbol ?? attrs.symbol,
    chain: normalizeChain(item),
    currentMcap,
    volume24hUsd: firstNumber(
      item.volume24hUsd,
      item.volume_24h_usd,
      item.volume?.h24,
      attrs.volume24hUsd,
      attrs.volume_usd?.h24,
    ),
  };
}

/**
 * Fetch current market-cap candidates from DexScreener's free endpoint.
 * The network call is always guarded by the shared endpoint circuit breaker.
 */
export async function fetchCurrentMcapGt2m() {
  return executeWithThrottle('dexscreener', async () => {
    const res = await fetch(DEXSCREENER_BOOSTS_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`DexScreener boosts error ${res.status}`);
    const data = await res.json();
    return responseItems(data).map(normalizeBoost).filter(Boolean);
  });
}

function itemsFromFetcherResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.tokens)) return result.tokens;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

/**
 * Run one current-market-cap discovery pass. A provider failure is isolated to
 * this pass so a background scheduler can continue running later passes.
 */
export async function runWorker1Pass(customFetcher = fetchCurrentMcapGt2m) {
  let count = 0;
  try {
    const items = itemsFromFetcherResult(await customFetcher());
    for (const item of items) {
      const currentMcap = numberOrNull(item?.currentMcap);
      if (currentMcap == null || currentMcap < CURRENT_MCAP_THRESHOLD) continue;

      const volume24hUsd = numberOrNull(item?.volume24hUsd);
      const record = upsertMeme({
        ca: item?.ca,
        name: item?.name,
        symbol: item?.symbol,
        chain: item?.chain || 'solana',
        currentMcap,
        // Worker 1 does not establish an ATH. Explicit zero values ensure the
        // shared registry never receives a synthetic ATH from this worker.
        athMcap: 0,
        athTimestamp: 0,
        ...(volume24hUsd == null ? {} : { volume24hUsd }),
        source: 'current_gt_2m',
      });
      if (record) count++;
    }
  } catch (error) {
    log('warn', `[worker1] current mcap pass failed: ${error?.message || String(error)}`);
  }
  return count;
}
