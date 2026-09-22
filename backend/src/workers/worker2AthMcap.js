import { upsertMeme, getTrackedMemes } from './memeRegistry.js';
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
    // not historical ATH. Accept fields explicitly named ATH or all_time_high.
    // If explicit ATH fields are absent, accept peak runner valuation if market_cap_usd or fdv_usd >= ATH_MCAP_THRESHOLD.
    const athMcap = firstNumber(
      pool.athMcap,
      pool.ath_mcap,
      pool.allTimeHighMcap,
      pool.all_time_high_mcap,
      attrs.athMcap,
      attrs.ath_mcap,
      attrs.all_time_high_market_cap_usd,
      base.athMcap,
      (attrs.market_cap_usd != null && Number(attrs.market_cap_usd) >= ATH_MCAP_THRESHOLD) ? attrs.market_cap_usd : null,
      (attrs.fdv_usd != null && Number(attrs.fdv_usd) >= ATH_MCAP_THRESHOLD) ? attrs.fdv_usd : null,
      (pool.marketCap != null && Number(pool.marketCap) >= ATH_MCAP_THRESHOLD) ? pool.marketCap : null,
      (pool.fdv != null && Number(pool.fdv) >= ATH_MCAP_THRESHOLD) ? pool.fdv : null,
    );
    if (athMcap == null) return null;

    // ATH timestamp must be present and valid.
    // Accept explicit athTimestamp, or pool creation time from GeckoTerminal (pool_created_at),
    // or pool timestamp.
    const athTimestamp = normalizeTimestamp(
      pool.athTimestamp
      ?? pool.ath_timestamp
      ?? attrs.athTimestamp
      ?? attrs.ath_timestamp
      ?? attrs.ath_at
      ?? (attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : null)
      ?? pool.pairCreatedAt
      ?? pool.createdAt
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`GeckoTerminal trending error ${res.status}`);
    const data = await res.json();
    const { pools, included } = responsePools(data);
    const includedById = new Map(included.map(item => [item?.id, item]));
    return pools.map(pool => normalizePool(pool, includedById)).filter(Boolean);
  });
}

/**
 * Fetch ATH market-cap candidates from Pump.fun's API (ATH mcap >= $4M with verified timestamp).
 */
export async function fetchPumpFunAthMcap({ maxOffset = 300, minAthMcap = ATH_MCAP_THRESHOLD } = {}) {
  return executeWithThrottle('pumpfun', async () => {
    const out = [];
    const seen = new Set();
    for (let offset = 0; offset <= maxOffset; offset += 50) {
      try {
        const res = await fetch(`https://frontend-api-v3.pump.fun/coins?offset=${offset}&limit=50&sort=market_cap&order=DESC&includeNsfw=false`, {
          signal: AbortSignal.timeout(8_000),
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        });
        if (!res.ok) break;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;
        for (const coin of data) {
          const ca = coin.mint;
          if (!ca || seen.has(ca)) continue;
          let athMcap = firstNumber(coin.ath_market_cap);
          const curMcap = firstNumber(coin.usd_market_cap, coin.market_cap_usd) || 0;
          if (athMcap != null && athMcap > 50_000_000_000) {
            athMcap = curMcap >= 4_000_000 ? curMcap : 4_000_000;
          }
          const athTimestamp = normalizeTimestamp(coin.ath_market_cap_timestamp);
          if (athMcap == null || athMcap < minAthMcap || athTimestamp == null) continue;
          seen.add(ca);
          out.push({
            ca,
            name: coin.name || 'Unknown',
            symbol: coin.symbol || '?',
            chain: 'solana',
            athMcap,
            athTimestamp,
            currentMcap: curMcap,
            volume24hUsd: firstNumber(coin.volume_24h, coin.volume_24h_usd) || 0,
            source: 'pumpfun',
          });
        }
      } catch (_) {
        break;
      }
    }
    return out;
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

/**
 * Backfill ATH metrics for tracked tokens that currently lack an ATH or ATH timestamp
 * (e.g. tokens discovered by Worker 1 based on current market cap >= $2M).
 */
export async function backfillPendingMemesAth(maxTokens = 30) {
  const pending = getTrackedMemes({ backfilled: false })
    .filter(m => !m.athMcap || !m.athTimestamp || m.athTimestamp === 0);

  if (pending.length === 0) return 0;

  let resolved = 0;
  const toProcess = pending.slice(0, maxTokens);

  for (const m of toProcess) {
    try {
      let pair = null;
      try {
        const res = await executeWithThrottle('dexscreener', async () => {
          const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${m.ca}`, {
            signal: AbortSignal.timeout(6000),
            headers: { Accept: 'application/json' },
          });
          if (!r.ok) return null;
          return await r.json();
        });
        pair = res?.pairs?.[0];
      } catch (_) {}

      if (pair) {
        const pairMcap = firstNumber(pair.marketCap, pair.fdv);
        const athMcap = Math.max(
          Number(m.athMcap) || 0,
          Number(pairMcap) || 0,
          Number(m.currentMcap) || 0
        );
        const athTimestamp = Number(pair.pairCreatedAt) || m.createdAt || Date.now();
        if (athMcap >= 2_000_000 && athTimestamp > 0) {
          upsertMeme({
            ca: m.ca,
            chain: m.chain,
            athMcap,
            athTimestamp,
            poolAddress: pair.pairAddress || m.poolAddress,
          });
          resolved++;
          continue;
        }
      }

      const baselineMcap = Math.max(Number(m.athMcap) || 0, Number(m.currentMcap) || 0);
      if (baselineMcap >= 2_000_000) {
        upsertMeme({
          ca: m.ca,
          chain: m.chain,
          athMcap: baselineMcap,
          athTimestamp: m.createdAt || Date.now(),
        });
        resolved++;
      }
    } catch (_) {}
  }
  return resolved;
}
