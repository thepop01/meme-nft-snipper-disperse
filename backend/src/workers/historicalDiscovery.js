import { upsertMeme, getTrackedMemes, SYSTEM_MINTS, canonicalizeCa } from './memeRegistry.js';
import { executeWithThrottle } from './rateLimiter.js';
import { CURRENT_MCAP_THRESHOLD } from './worker1CurrentMcap.js';
import { ATH_MCAP_THRESHOLD } from './worker2AthMcap.js';
import { log } from '../bus.js';

function toSafeNumber(val, fallback = null) {
  if (val == null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function firstNumber(...values) {
  for (const v of values) {
    const parsed = toSafeNumber(v);
    if (parsed != null) return parsed;
  }
  return null;
}

export function normalizePumpFunCoin(coin, cutoffTs = null) {
  if (!coin || !coin.mint || typeof coin.mint !== 'string') return null;
  const ca = coin.mint.trim();
  if (!ca || SYSTEM_MINTS.has(ca)) return null;

  const curMcap = firstNumber(coin.usd_market_cap, coin.market_cap_usd) || 0;
  let athMcap = firstNumber(coin.ath_market_cap) || 0;
  const athTimestamp = toSafeNumber(coin.ath_market_cap_timestamp, 0);
  const createdTimestamp = toSafeNumber(coin.created_timestamp, 0);

  // Sanitize internal pump.fun unit overflows / unscaled lamports (> $50B is impossible for meme coin ATH)
  const MAX_REALISTIC_ATH = 50_000_000_000;
  if (athMcap > MAX_REALISTIC_ATH) {
    athMcap = curMcap >= 4_000_000 ? curMcap : 4_000_000;
  }

  // Time cutoff check (default 6 months):
  // Qualifies if token was created within window, peaked within window, OR is currently active (>= $2M).
  if (cutoffTs != null && cutoffTs > 0) {
    const isRecent = createdTimestamp >= cutoffTs ||
      athTimestamp >= cutoffTs ||
      curMcap >= CURRENT_MCAP_THRESHOLD;
    if (!isRecent) return null;
  }

  const qualifiesWorker1 = curMcap >= CURRENT_MCAP_THRESHOLD;
  const qualifiesWorker2 = athMcap >= ATH_MCAP_THRESHOLD && athTimestamp > 0;

  if (!qualifiesWorker1 && !qualifiesWorker2) {
    return null;
  }

  return {
    ca,
    name: coin.name || 'Unknown',
    symbol: coin.symbol || '?',
    chain: 'solana',
    currentMcap: curMcap,
    athMcap,
    athTimestamp: athTimestamp > 0 ? athTimestamp : (qualifiesWorker1 ? 0 : Date.now()),
    volume24hUsd: firstNumber(coin.volume_24h, coin.volume_24h_usd) || 0,
    source: 'pumpfun',
  };
}

export async function fetchPumpFunHistoricalCoins({
  maxOffset = 600,
  cutoffTs = null,
  sorts = ['market_cap', 'last_trade_timestamp'],
} = {}) {
  const discovered = new Map();

  for (const sort of sorts) {
    for (let offset = 0; offset <= maxOffset; offset += 50) {
      try {
        const batch = await executeWithThrottle('pumpfun', async () => {
          const res = await fetch(
            `https://frontend-api-v3.pump.fun/coins?offset=${offset}&limit=50&sort=${sort}&order=DESC&includeNsfw=false`,
            {
              signal: AbortSignal.timeout(8_000),
              headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            }
          );
          if (!res.ok) throw new Error(`PumpFun coins status ${res.status}`);
          return res.json();
        });

        if (!Array.isArray(batch) || batch.length === 0) break;

        let addedInBatch = 0;
        for (const coin of batch) {
          const norm = normalizePumpFunCoin(coin, cutoffTs);
          if (norm && !discovered.has(norm.ca)) {
            discovered.set(norm.ca, norm);
            addedInBatch++;
          }
        }

        // If market_cap sorting drops well below thresholds, stop paginating this sort
        if (sort === 'market_cap') {
          const last = batch[batch.length - 1];
          const lastMcap = Number(last?.usd_market_cap || last?.market_cap_usd || 0);
          const lastAth = Number(last?.ath_market_cap || 0);
          if (lastMcap < 100_000 && lastAth < ATH_MCAP_THRESHOLD && offset >= 250) {
            break;
          }
        }
      } catch (err) {
        log('warn', `[historicalDiscovery] Pump.fun page ${offset} (${sort}) error: ${err.message}`);
        break; // Continue to next sort
      }
    }
  }

  return Array.from(discovered.values());
}

export async function fetchGeckoTerminalSolanaPools({ maxPages = 5, cutoffTs = null } = {}) {
  const discovered = new Map();

  for (let page = 1; page <= maxPages; page++) {
    try {
      const result = await executeWithThrottle('geckoterminal', async () => {
        const res = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/solana/pools?page=${page}&include=base_token`,
          {
            signal: AbortSignal.timeout(8_000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              Accept: 'application/json',
            },
          }
        );
        if (!res.ok) throw new Error(`GeckoTerminal pools status ${res.status}`);
        return res.json();
      });

      const included = new Map((result?.included || []).map(item => [item?.id, item]));
      const pools = Array.isArray(result?.data) ? result.data : [];
      if (pools.length === 0) break;

      for (const pool of pools) {
        const baseId = pool.relationships?.base_token?.data?.id;
        const base = included.get(baseId)?.attributes || {};
        const ca = base.address || (typeof baseId === 'string' ? baseId.replace(/^solana_/, '') : null);
        if (!ca || SYSTEM_MINTS.has(ca)) continue;

        const attrs = pool.attributes || {};
        const mcap = firstNumber(attrs.market_cap_usd, attrs.fdv_usd);
        if (mcap == null || mcap < CURRENT_MCAP_THRESHOLD) continue;

        const createdTs = attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : 0;
        if (cutoffTs != null && createdTs > 0 && createdTs < cutoffTs && mcap < CURRENT_MCAP_THRESHOLD) {
          continue;
        }

        discovered.set(ca, {
          ca,
          name: base.name || attrs.name || 'Unknown',
          symbol: base.symbol || '?',
          chain: 'solana',
          currentMcap: mcap,
          athMcap: mcap >= ATH_MCAP_THRESHOLD ? mcap : 0,
          athTimestamp: mcap >= ATH_MCAP_THRESHOLD ? (createdTs || Date.now()) : 0,
          volume24hUsd: firstNumber(attrs.volume_usd?.h24, attrs.volume24hUsd) || 0,
          source: 'geckoterminal',
        });
      }
    } catch (err) {
      log('warn', `[historicalDiscovery] GeckoTerminal page ${page} error: ${err.message}`);
      break;
    }
  }

  return Array.from(discovered.values());
}

/**
 * Harvest historical Solana runner memes across the last 6 months (or custom window).
 * Ingests qualifying tokens meeting Worker 1 (Current Mcap >= $2M) or Worker 2 (ATH Mcap >= $4M)
 * into the shared registry without storing any raw transactions (strictly metadata and metrics).
 */
export async function runHistoricalSolanaHarvest({
  maxAgeMonths = 6,
  maxOffset = 600,
  customPumpFetcher = null,
  customGeckoFetcher = null,
} = {}) {
  const cutoffTs = maxAgeMonths ? Date.now() - maxAgeMonths * 30 * 24 * 3600 * 1000 : null;
  log('info', `[historicalDiscovery] Starting Solana runner harvest (last ${maxAgeMonths} months, cutoff: ${cutoffTs ? new Date(cutoffTs).toISOString() : 'none'})`);

  const initialRegistry = new Set(getTrackedMemes().map(m => m.ca));

  let pumpRunners = [];
  try {
    if (customPumpFetcher) {
      pumpRunners = await customPumpFetcher();
    } else {
      pumpRunners = await fetchPumpFunHistoricalCoins({ maxOffset, cutoffTs });
    }
  } catch (err) {
    log('warn', `[historicalDiscovery] Pump.fun harvest failed: ${err.message}`);
  }

  let geckoRunners = [];
  try {
    if (customGeckoFetcher) {
      geckoRunners = await customGeckoFetcher();
    } else {
      geckoRunners = await fetchGeckoTerminalSolanaPools({ maxPages: 5, cutoffTs });
    }
  } catch (err) {
    log('warn', `[historicalDiscovery] GeckoTerminal harvest failed: ${err.message}`);
  }

  let totalIngested = 0;
  let newMemes = 0;
  let updatedMemes = 0;

  const combined = [...pumpRunners, ...geckoRunners];
  for (const item of combined) {
    if (!item || !item.ca) continue;
    const isNew = !initialRegistry.has(item.ca);
    const res = upsertMeme(item);
    if (res) {
      totalIngested++;
      if (isNew) {
        newMemes++;
        initialRegistry.add(item.ca);
      } else {
        updatedMemes++;
      }
    }
  }

  const finalMemes = getTrackedMemes({ chain: 'solana' });
  log('info', `[historicalDiscovery] Harvest complete. Discovered ${combined.length} candidates. Added ${newMemes} new, updated ${updatedMemes}. Total Solana tracked memes: ${finalMemes.length}`);

  return {
    totalIngested,
    newMemes,
    updatedMemes,
    totalSolanaMemes: finalMemes.length,
    pumpDiscovered: pumpRunners.length,
    geckoDiscovered: geckoRunners.length,
  };
}

/**
 * Normalize GeckoTerminal Robinhood DEX pool into a standardized runner meme candidate.
 */
export function normalizeRobinhoodPool(pool, includedMap = new Map(), cutoffTs = null) {
  if (!pool) return null;
  const baseId = pool.relationships?.base_token?.data?.id;
  const base = includedMap.get(baseId)?.attributes || {};
  const rawCa = pool.attributes?.base_token_address || base.address || (typeof baseId === 'string' ? baseId.replace(/^robinhood_/, '') : null);
  const ca = canonicalizeCa(rawCa, 'robinhood');
  if (!ca) return null;

  const attrs = pool.attributes || {};
  const mcap = firstNumber(attrs.market_cap_usd, attrs.fdv_usd);
  if (mcap == null || mcap < 100_000) return null;

  const createdTs = attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : 0;
  if (cutoffTs != null && createdTs > 0 && createdTs < cutoffTs && mcap < CURRENT_MCAP_THRESHOLD) {
    return null;
  }

  const qualifiesWorker1 = mcap >= CURRENT_MCAP_THRESHOLD;
  const qualifiesWorker2 = mcap >= ATH_MCAP_THRESHOLD;

  if (!qualifiesWorker1 && !qualifiesWorker2) {
    return null;
  }

  return {
    ca,
    poolAddress: pool.attributes?.address || (typeof pool.id === 'string' ? pool.id.replace(/^robinhood_/, '') : null),
    name: base.name || attrs.name || 'Unknown',
    symbol: base.symbol || '?',
    chain: 'robinhood',
    currentMcap: mcap,
    athMcap: qualifiesWorker2 ? mcap : 0,
    athTimestamp: qualifiesWorker2 ? (createdTs || Date.now()) : 0,
    volume24hUsd: firstNumber(attrs.volume_usd?.h24, attrs.volume24hUsd) || 0,
    source: 'geckoterminal',
  };
}

/**
 * Fetch Robinhood pools from GeckoTerminal (both paginated pools and trending pools).
 */
export async function fetchGeckoTerminalRobinhoodPools({ maxPages = 5, cutoffTs = null } = {}) {
  const discovered = new Map();

  // 1. Paginated general pools
  for (let page = 1; page <= maxPages; page++) {
    try {
      const result = await executeWithThrottle('geckoterminal', async () => {
        const res = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/robinhood/pools?page=${page}&include=base_token`,
          {
            signal: AbortSignal.timeout(8_000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              Accept: 'application/json',
            },
          }
        );
        if (!res.ok) throw new Error(`GeckoTerminal Robinhood pools status ${res.status}`);
        return res.json();
      });

      const included = new Map((result?.included || []).map(item => [item?.id, item]));
      const pools = Array.isArray(result?.data) ? result.data : [];
      if (pools.length === 0) break;

      for (const pool of pools) {
        const norm = normalizeRobinhoodPool(pool, included, cutoffTs);
        if (norm && !discovered.has(norm.ca)) {
          discovered.set(norm.ca, norm);
        }
      }
    } catch (err) {
      log('warn', `[historicalDiscovery] GeckoTerminal Robinhood page ${page} error: ${err.message}`);
      break;
    }
  }

  // 2. Trending pools
  try {
    const trendingResult = await executeWithThrottle('geckoterminal', async () => {
      const res = await fetch(
        'https://api.geckoterminal.com/api/v2/networks/robinhood/trending_pools?include=base_token',
        {
          signal: AbortSignal.timeout(8_000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
        }
      );
      if (!res.ok) throw new Error(`GeckoTerminal Robinhood trending status ${res.status}`);
      return res.json();
    });

    const included = new Map((trendingResult?.included || []).map(item => [item?.id, item]));
    const trendingPools = Array.isArray(trendingResult?.data) ? trendingResult.data : [];
    for (const pool of trendingPools) {
      const norm = normalizeRobinhoodPool(pool, included, cutoffTs);
      if (norm && !discovered.has(norm.ca)) {
        discovered.set(norm.ca, norm);
      }
    }
  } catch (err) {
    log('warn', `[historicalDiscovery] GeckoTerminal Robinhood trending error: ${err.message}`);
  }

  return Array.from(discovered.values());
}

/**
 * Fetch Robinhood Chain pairs from DexScreener multi-keyword search.
 */
export async function fetchDexScreenerRobinhoodPairs({
  queries = ['robinhood', 'hood', 'rh', 'eth', 'usdt', 'meme', 'doge', 'pepe', 'cat', 'sol'],
  cutoffTs = null,
} = {}) {
  const discovered = new Map();

  for (const q of queries) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];

      for (const p of pairs) {
        if (!p || (p.chainId !== 'robinhood' && p.chainId !== 'rh')) continue;
        const rawCa = p.baseToken?.address;
        const ca = canonicalizeCa(rawCa, 'robinhood');
        if (!ca || discovered.has(ca)) continue;

        const mcap = firstNumber(p.marketCap, p.fdv) || 0;
        if (mcap < 100_000) continue;

        const createdTs = toSafeNumber(p.pairCreatedAt, 0);
        if (cutoffTs != null && createdTs > 0 && createdTs < cutoffTs && mcap < CURRENT_MCAP_THRESHOLD) {
          continue;
        }

        const qualifiesWorker1 = mcap >= CURRENT_MCAP_THRESHOLD;
        const qualifiesWorker2 = mcap >= ATH_MCAP_THRESHOLD;
        if (!qualifiesWorker1 && !qualifiesWorker2) continue;

        discovered.set(ca, {
          ca,
          name: p.baseToken?.name || 'Unknown',
          symbol: p.baseToken?.symbol || '?',
          chain: 'robinhood',
          currentMcap: mcap,
          athMcap: qualifiesWorker2 ? mcap : 0,
          athTimestamp: qualifiesWorker2 ? (createdTs || Date.now()) : 0,
          volume24hUsd: firstNumber(p.volume?.h24, p.volume24hUsd) || 0,
          source: 'dexscreener',
        });
      }
    } catch (err) {
      log('warn', `[historicalDiscovery] DexScreener search (${q}) error: ${err.message}`);
    }
  }

  return Array.from(discovered.values());
}

/**
 * Harvest historical Robinhood runner memes across the last 6 months (or custom window).
 * Ingests qualifying tokens meeting Worker 1 (Current Mcap >= $2M) or Worker 2 (ATH Mcap >= $4M)
 * into the shared registry without storing any raw transactions (strictly metadata and metrics).
 */
export async function runHistoricalRobinhoodHarvest({
  maxAgeMonths = 6,
  maxPages = 5,
  customGeckoFetcher = null,
  customDexFetcher = null,
} = {}) {
  const cutoffTs = maxAgeMonths ? Date.now() - maxAgeMonths * 30 * 24 * 3600 * 1000 : null;
  log('info', `[historicalDiscovery] Starting Robinhood runner harvest (last ${maxAgeMonths} months, cutoff: ${cutoffTs ? new Date(cutoffTs).toISOString() : 'none'})`);

  const initialRegistry = new Set(getTrackedMemes().map(m => m.ca));

  let geckoRunners = [];
  try {
    if (customGeckoFetcher) {
      geckoRunners = await customGeckoFetcher();
    } else {
      geckoRunners = await fetchGeckoTerminalRobinhoodPools({ maxPages, cutoffTs });
    }
  } catch (err) {
    log('warn', `[historicalDiscovery] GeckoTerminal Robinhood harvest failed: ${err.message}`);
  }

  let dexRunners = [];
  try {
    if (customDexFetcher) {
      dexRunners = await customDexFetcher();
    } else {
      dexRunners = await fetchDexScreenerRobinhoodPairs({ cutoffTs });
    }
  } catch (err) {
    log('warn', `[historicalDiscovery] DexScreener Robinhood harvest failed: ${err.message}`);
  }

  let totalIngested = 0;
  let newMemes = 0;
  let updatedMemes = 0;

  const combined = [...geckoRunners, ...dexRunners];
  for (const item of combined) {
    if (!item || !item.ca) continue;
    const isNew = !initialRegistry.has(item.ca);
    const res = upsertMeme(item);
    if (res) {
      totalIngested++;
      if (isNew) {
        newMemes++;
        initialRegistry.add(item.ca);
      } else {
        updatedMemes++;
      }
    }
  }

  const finalMemes = getTrackedMemes({ chain: 'robinhood' });
  log('info', `[historicalDiscovery] Robinhood harvest complete. Discovered ${combined.length} candidates. Added ${newMemes} new, updated ${updatedMemes}. Total Robinhood tracked memes: ${finalMemes.length}`);

  return {
    totalIngested,
    newMemes,
    updatedMemes,
    totalRobinhoodMemes: finalMemes.length,
    geckoDiscovered: geckoRunners.length,
    dexDiscovered: dexRunners.length,
  };
}

