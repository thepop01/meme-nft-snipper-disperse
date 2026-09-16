import { upsertMeme } from './memeRegistry.js';
import { executeWithThrottle } from './rateLimiter.js';
import { log } from '../bus.js';

export const ATH_MCAP_THRESHOLD = 4_000_000;
const GECKOTERMINAL_TRENDING_URL = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token';

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

function normalizeTimestamp(value) {
  const parsed = numberOrNull(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function normalizePool(pool, includedById = new Map()) {
  try {
    const attrs = pool?.attributes || {};
    const relationships = pool?.relationships || {};
    const baseId = relationships.base_token?.data?.id;
    const base = includedById.get(baseId)?.attributes || {};
    const ca = pool?.ca
      ?? pool?.tokenAddress
      ?? attrs.base_token_address
      ?? base.address
      ?? (typeof baseId === 'string' ? baseId.replace(/^solana_/, '') : null)
      ?? (typeof pool?.id === 'string' ? pool.id.replace(/^solana_/, '') : null);
    if (!ca || typeof ca !== 'string') return null;

    // GeckoTerminal trending_pools endpoint returns CURRENT valuations,
    // not historical ATH. Do NOT use fdv_usd or market_cap_usd as athMcap.
    // Only accept fields explicitly named ATH or all_time_high.
    const athMcap = firstNumber(
      pool.athMcap,
      pool.ath_mcap,
      pool.allTimeHighMcap,
      pool.all_time_high_mcap,
      attrs.athMcap,
      attrs.ath_mcap,
      attrs.all_time_high_market_cap_usd,
      base.athMcap,
    );
    if (athMcap == null) return null;

    // ATH timestamp must be present and valid. Do NOT default to Date.now()
    // as that fabricates T_ATH and breaks Worker 3's pre-ATH filtering.
    const athTimestamp = normalizeTimestamp(
      pool.athTimestamp
      ?? pool.ath_timestamp
      ?? attrs.athTimestamp
      ?? attrs.ath_timestamp
      ?? attrs.ath_at,
    );
    if (athTimestamp == null) return null; // Skip if no valid ATH timestamp

    const currentMcap = firstNumber(
      pool.currentMcap,
      pool.current_mcap,
      pool.marketCap,
      pool.market_cap_usd,
      attrs.currentMcap,
      attrs.market_cap_usd,
    );

    return {
      ca,
      name: pool.name ?? attrs.name ?? base.name,
      symbol: pool.symbol ?? attrs.symbol ?? base.symbol,
      chain: pool.chain || 'solana',
      athMcap,
      athTimestamp,
      currentMcap,
      volume24hUsd: firstNumber(
        pool.volume24hUsd,
        pool.volume_24h_usd,
        pool.volume?.h24,
        attrs.volume24hUsd,
        attrs.volume_usd?.h24,
      ),
    };
  } catch (_) {
    return null; // Skip malformed items
  }
}

function responsePools(data) {
  if (Array.isArray(data)) return { pools: data, included: [] };
  if (Array.isArray(data?.pools)) return { pools: data.pools, included: data.included || [] };
  return { pools: Array.isArray(data?.data) ? data.data : [], included: data?.included || [] };
}

/**
 * Fetch ATH market-cap candidates from GeckoTerminal's free endpoint.
 * The network call is always guarded by the shared endpoint circuit breaker.
 */
export async function fetchAthMcapGt4m() {
  return executeWithThrottle('geckoterminal', async () => {
    const res = await fetch(GECKOTERMINAL_TRENDING_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`GeckoTerminal trending error ${res.status}`);
    const data = await res.json();
    const { pools, included } = responsePools(data);
    const includedById = new Map(included.map(item => [item?.id, item]));
    return pools.map(pool => normalizePool(pool, includedById)).filter(Boolean);
  });
}

function itemsFromFetcherResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.tokens)) return result.tokens;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

/**
 * Run one ATH discovery pass. A provider failure is isolated to this pass so
 * a background scheduler can continue running later passes.
 */
export async function runWorker2Pass(customFetcher = fetchAthMcapGt4m) {
  let count = 0;
  try {
    const items = itemsFromFetcherResult(await customFetcher());
    for (const item of items) {
      const athMcap = numberOrNull(item?.athMcap);
      if (athMcap == null || athMcap < ATH_MCAP_THRESHOLD) continue;

      const athTimestamp = numberOrNull(item?.athTimestamp);
      const currentMcap = numberOrNull(item?.currentMcap);
      const volume24hUsd = numberOrNull(item?.volume24hUsd);
      const record = upsertMeme({
        ca: item?.ca,
        name: item?.name,
        symbol: item?.symbol,
        chain: item?.chain || 'solana',
        athMcap,
        athTimestamp,
        ...(currentMcap == null ? {} : { currentMcap }),
        ...(volume24hUsd == null ? {} : { volume24hUsd }),
        source: 'ath_gt_4m',
      });
      if (record) count++;
    }
  } catch (error) {
    log('warn', `[worker2] ATH mcap pass failed: ${error?.message || String(error)}`);
  }
  return count;
}
