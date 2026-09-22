import '../config.js';
import { getUnbackfilledMemes, markMemeBackfilled, recordBackfillAttempt, SYSTEM_MINTS } from './memeRegistry.js';
import { selectEarlyBuyersDual } from '../smartwallets/tracker.js';
import { persistWallets } from '../smartwallets/persist.js';
import { runGmgnCli } from '../smartwallets/sniperHarvester.js';
import { executeWithThrottle } from './rateLimiter.js';
import { log } from '../bus.js';

let rotationIndex = 0;

/**
 * Fetch trades from Birdeye DeFi API (ascending order from launch) with pagination.
 *
 * @param {string} ca
 * @param {Object} [options]
 * @param {number} [options.maxPages=5]
 * @param {number} [options.athTimestamp]
 * @returns {Promise<Array>}
 */
export async function fetchBirdeyeTrades(ca, options = {}) {
  if (!ca || typeof ca !== 'string' || ca.startsWith('0x')) return [];
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) return [];

  const maxPages = options.maxPages || 12;
  const normAthTs = options.athTimestamp
    ? (options.athTimestamp > 0 && options.athTimestamp < 100_000_000_000 ? options.athTimestamp * 1000 : options.athTimestamp)
    : null;

  const allTrades = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * 50;
    try {
      const pageItems = await executeWithThrottle('birdeye', async () => {
        const url = `https://public-api.birdeye.so/defi/txs/token?address=${ca}&tx_type=swap&sort_type=asc&offset=${offset}&limit=50`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: {
            'X-API-KEY': apiKey,
            'x-chain': 'solana',
            'Accept': 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Birdeye error ${res.status}`);
        const json = await res.json();
        return json.data?.items || [];
      });

      if (!Array.isArray(pageItems) || pageItems.length === 0) break;

      let crossedAth = false;
      for (const it of pageItems) {
        const tokenPriceUsd = it.base?.price ?? it.tokenPrice ?? it.basePrice ?? ((it.pricePair && (it.quotePrice || it.quote?.price)) ? it.pricePair * (it.quotePrice || it.quote.price) : null);
        const timestamp = it.blockUnixTime ? it.blockUnixTime * 1000 : 0;
        if (normAthTs && timestamp && timestamp >= normAthTs) {
          crossedAth = true;
        }
        if (it.owner) {
          allTrades.push({
            wallet: it.owner,
            timestamp,
            entryMcap: tokenPriceUsd ? (tokenPriceUsd * 1_000_000_000) : null,
          });
        }
      }

      if (crossedAth || pageItems.length < 50) {
        break;
      }
    } catch (err) {
      if (page === 0) throw err;
      log('warn', `[worker3] Birdeye pagination stopped at page ${page} for ${ca}: ${err?.message || String(err)}`);
      break;
    }
  }

  return allTrades;
}

/**
 * Fetch Pump.fun token data and genesis creator trade.
 *
 * @param {string} ca
 * @returns {Promise<Array>}
 */
export async function fetchPumpFunTrades(ca) {
  if (!ca || typeof ca !== 'string' || ca.startsWith('0x')) return [];

  return executeWithThrottle('pumpfun', async () => {
    const url = `https://frontend-api-v3.pump.fun/coins/${ca}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`PumpFun error ${res.status}`);
    }
    const coin = await res.json();
    if (!coin || !coin.creator) return [];

    const trades = [
      {
        wallet: coin.creator,
        timestamp: coin.created_timestamp ? Number(coin.created_timestamp) : (coin.ath_market_cap_timestamp ? Number(coin.ath_market_cap_timestamp) - 3_600_000 : Date.now()),
        entryMcap: coin.market_cap_usd ? Math.min(Number(coin.market_cap_usd), 10_000) : 5_000,
        isCreator: true,
      },
    ];

    trades.coinMetadata = {
      creator: coin.creator,
      athMcap: coin.ath_market_cap ? Number(coin.ath_market_cap) : null,
      athTimestamp: coin.ath_market_cap_timestamp ? Number(coin.ath_market_cap_timestamp) : null,
      complete: coin.complete,
      raydiumPool: coin.raydium_pool || null,
    };

    return trades;
  });
}

/**
 * Fetch trades from Helius Enhanced Transactions API.
 *
 * @param {string} ca
 * @returns {Promise<Array>}
 */
export async function fetchHeliusTrades(ca) {
  if (!ca || typeof ca !== 'string' || ca.startsWith('0x')) return [];
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return [];

  return executeWithThrottle('helius', async () => {
    const url = `https://api.helius.xyz/v0/addresses/${ca}/transactions?api-key=${apiKey}&type=SWAP&limit=100`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Helius error ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    return items
      .map(tx => ({
        wallet: tx.feePayer,
        timestamp: tx.timestamp ? tx.timestamp * 1000 : 0,
        entryMcap: null,
      }))
      .filter(t => t.wallet);
  });
}

const tokenPoolCache = new Map();

/**
 * Fetch trades for Robinhood Chain (EVM) tokens via GeckoTerminal pool DEX trades API.
 * Resolves token pool address, then pulls DEX swap trades with wallet addresses and timestamps.
 * Raw swap transaction data is processed strictly in-memory and NEVER persisted to disk.
 *
 * @param {string} ca
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
export async function fetchGeckoTerminalRobinhoodTrades(ca, options = {}) {
  if (!ca || typeof ca !== 'string') return [];
  const canonCa = ca.toLowerCase().trim();

  // 1. Resolve pool address for the token (or use pre-resolved poolAddress)
  let poolAddr = options.poolAddress || tokenPoolCache.get(canonCa) || null;

  if (!poolAddr) {
    try {
      poolAddr = await executeWithThrottle('geckoterminal', async () => {
        const poolUrl = `https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${canonCa}/pools`;
        const poolRes = await fetch(poolUrl, {
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
        });
        if (poolRes.status === 404) return null;
        if (!poolRes.ok) {
          throw new Error(`GeckoTerminal token pools HTTP ${poolRes.status}`);
        }
        const poolJson = await poolRes.json();
        const pools = poolJson.data || [];
        if (!Array.isArray(pools) || pools.length === 0) return null;

        const primaryPool = pools[0];
        const addr = primaryPool.attributes?.address || primaryPool.id?.replace(/^robinhood_/, '') || null;
        if (addr) tokenPoolCache.set(canonCa, addr);
        return addr;
      });
    } catch (err) {
      log('warn', `[worker3] GeckoTerminal pool resolution error for ${ca}: ${err?.message || String(err)}`);
      return [];
    }
  } else {
    tokenPoolCache.set(canonCa, poolAddr);
  }

  if (!poolAddr) return [];

  // 2. Fetch trades for pool
  let rawTrades = [];
  try {
    rawTrades = await executeWithThrottle('geckoterminal', async () => {
      const tradesUrl = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${poolAddr}/trades`;
      const tradesRes = await fetch(tradesUrl, {
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });
      if (tradesRes.status === 404) return [];
      if (!tradesRes.ok) {
        throw new Error(`GeckoTerminal pool trades HTTP ${tradesRes.status}`);
      }
      const tradesJson = await tradesRes.json();
      return tradesJson.data || [];
    });
  } catch (err) {
    log('warn', `[worker3] GeckoTerminal trades error for pool ${poolAddr}: ${err?.message || String(err)}`);
    return [];
  }

  if (!Array.isArray(rawTrades) || rawTrades.length === 0) return [];

  // 3. Map raw trades into standardized trade objects
  const trades = [];
  for (const item of rawTrades) {
    const attrs = item.attributes || {};
    const wallet = attrs.tx_from_address;
    if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x')) continue;

    const ts = attrs.block_timestamp ? new Date(attrs.block_timestamp).getTime() : 0;
    const isBuy = attrs.kind === 'buy';
    const volUsd = Number(attrs.volume_in_usd) || null;
    const priceUsd = Number(attrs.price_from_in_usd || attrs.price_to_in_usd) || null;

    trades.push({
      wallet: wallet.toLowerCase(),
      timestamp: ts,
      entryMcap: priceUsd && Number.isFinite(priceUsd) ? priceUsd * 1_000_000_000 : null,
      isBuy,
      volumeUsd: volUsd,
    });
  }

  trades.source = 'geckoterminal';
  return trades;
}

/**
 * Fetch trades from GMGN CLI traders API.
 * Returns trades with open position timestamps (start_holding_at) and realized PnL.
 *
 * @param {string} ca
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
export async function fetchGmgnTrades(ca, options = {}) {
  if (!ca || typeof ca !== 'string') return [];
  const isRobinhood = ca.startsWith('0x') || options.chain === 'robinhood';
  const cliChain = isRobinhood ? 'robinhood' : 'sol';

  try {
    const rawStdout = await executeWithThrottle('gmgn', async () => {
      return await runGmgnCli([
        'token',
        'traders',
        '--chain',
        cliChain,
        '--address',
        ca,
        '--tag',
        'sniper',
        '--raw',
      ]);
    });

    const parsed = JSON.parse(rawStdout);
    const list = parsed?.data?.snipers || parsed?.snipers || parsed?.list || parsed?.data?.traders || parsed?.data || (Array.isArray(parsed) ? parsed : []);
    if (!Array.isArray(list) || list.length === 0) return [];

    const trades = [];
    for (const item of list) {
      const wallet = item.address || item.wallet || item.wallet_address || item.maker;
      if (!wallet) continue;

      const tsSec = item.start_holding_at || item.created_at || item.last_active_timestamp || 0;
      const pnl = Number(item.realized_pnl ?? item.realized_profit ?? item.profit_usd ?? item.profit ?? item.pnl_usd ?? 0);
      const cost = Number(item.buy_volume_cur ?? item.cost ?? item.cost_cur ?? item.buy_volume ?? item.snipe_cost ?? 0);

      trades.push({
        wallet: isRobinhood ? wallet.toLowerCase() : wallet,
        timestamp: tsSec ? tsSec * 1000 : 0,
        entryMcap: null,
        pnl,
        cost,
        isBuy: true,
      });
    }

    trades.source = 'gmgn';
    return trades;
  } catch (err) {
    log('debug', `[worker3] GMGN trade extraction failed for ${ca}: ${err.message}`);
    return [];
  }
}

/**
 * Multi-source trade fetcher with automatic fallback.
 * Birdeye provides sort_type=asc (chronological swaps from launch) as the primary
 * source for pre-ATH early buyers with multi-page pagination.
 * Pump.fun provides token creator / slot-0 genesis trade and ATH enrichment.
 * GMGN provides verified pre-ATH sniper & early buyer entries.
 * Helius provides the high-throughput fallback.
 *
 * @param {string} ca
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
export async function fetchEarlyBuyerTrades(ca, options = {}) {
  if (!ca || typeof ca !== 'string') return [];

  const isRobinhood = ca.startsWith('0x') || options.chain === 'robinhood';
  if (isRobinhood) {
    try {
      const trades = await fetchGeckoTerminalRobinhoodTrades(ca, options);
      if (Array.isArray(trades) && trades.length > 0) {
        trades.source = 'geckoterminal';
        return trades;
      }
    } catch (err) {
      log('warn', `[worker3] GeckoTerminal Robinhood trades failed for ${ca}: ${err?.message || String(err)}`);
    }

    // Fallback to GMGN CLI for Robinhood Chain tokens
    try {
      const gmgnTrades = await fetchGmgnTrades(ca, options);
      if (Array.isArray(gmgnTrades) && gmgnTrades.length > 0) {
        gmgnTrades.source = 'gmgn';
        return gmgnTrades;
      }
    } catch (err) {
      log('warn', `[worker3] GMGN Robinhood trades failed for ${ca}: ${err?.message || String(err)}`);
    }

    return [];
  }

  let pumpTrades = [];
  if (typeof ca === 'string' && (ca.endsWith('pump') || options.isPumpFun)) {
    try {
      pumpTrades = await fetchPumpFunTrades(ca);
    } catch (err) {
      log('warn', `[worker3] pumpfun check failed for ${ca}: ${err?.message || String(err)}`);
    }
  }

  const providers = [
    { name: 'birdeye', fn: (c) => fetchBirdeyeTrades(c, options) },
    { name: 'gmgn', fn: (c) => fetchGmgnTrades(c, options) },
    { name: 'pumpfun', fn: fetchPumpFunTrades },
    { name: 'helius', fn: fetchHeliusTrades },
  ];

  for (const { name, fn } of providers) {
    try {
      const trades = await fn(ca);
      if (Array.isArray(trades) && trades.length > 0) {
        if (pumpTrades.length > 0 && name !== 'pumpfun') {
          const existingWallets = new Set(trades.map(t => t.wallet));
          for (const pt of pumpTrades) {
            if (pt.wallet && !existingWallets.has(pt.wallet)) {
              trades.unshift(pt);
            }
          }
        }
        trades.source = name;
        if (pumpTrades.coinMetadata) {
          trades.coinMetadata = pumpTrades.coinMetadata;
        }
        return trades;
      }
    } catch (err) {
      log('warn', `[worker3] provider ${name} attempt failed for ${ca}: ${err?.message || String(err)}`);
    }
  }

  if (pumpTrades.length > 0) {
    pumpTrades.source = 'pumpfun';
    return pumpTrades;
  }

  return [];
}

/**
 * Resolve the entry market cap from a trade object, checking multiple field names.
 */
function entryMcap(trade) {
  const v = trade.entryMcap ?? trade.buyMcap ?? trade.marketCapUsd;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the realized PnL from a trade object, checking multiple field names.
 */
function tradePnl(trade) {
  const v = trade.pnl ?? trade.profitUsd ?? trade.realizedProfitUsd;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the timestamp from a trade object (normalizes seconds to milliseconds).
 */
function tradeTimestamp(trade) {
  const v = trade.timestamp ?? trade.ts ?? trade.blockTime;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 100_000_000_000 ? n * 1000 : n;
}

/**
 * Extract qualifying early buyer wallet addresses from a list of trades.
 *
 * @param {Array} trades        – Array of trade objects
 * @param {number} athMcap      – All-time-high market cap
 * @param {number} athTimestamp  – Timestamp of ATH (strict cutoff)
 * @param {Object} [options]    – Optional options including maxQuota
 * @returns {string[]}          – Array of qualifying wallet addresses
 */
export function extractEarlyBuyers(trades, athMcap, athTimestamp, options) {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  if (!Number.isFinite(athMcap) || athMcap <= 0) return [];
  if (!Number.isFinite(athTimestamp) || athTimestamp <= 0) return [];

  const normAthTimestamp = (athTimestamp > 0 && athTimestamp < 100_000_000_000)
    ? athTimestamp * 1000
    : athTimestamp;

  const preAthTrades = trades
    .filter(t => tradeTimestamp(t) < normAthTimestamp)
    .sort((a, b) => tradeTimestamp(a) - tradeTimestamp(b));

  const buys = preAthTrades.map(trade => {
    const pnl = tradePnl(trade);
    return {
      wallet: trade.wallet || trade.address || trade.maker,
      buyMcap: entryMcap(trade),
      ts: tradeTimestamp(trade),
      ...(pnl == null ? {} : { profitUsd: pnl }),
    };
  });
  const dual = selectEarlyBuyersDual({
    buys,
    athMcap,
    requireProfitable: true,
  });
  const capped = options?.maxQuota;
  const buyers = dual.allBuyers || [];
  return buyers.slice(0, Number.isFinite(capped) ? capped : buyers.length).map(b => b.address);
}

/**
 * Process a single meme token for early buyer extraction.
 *
 * @param {Object} meme
 * @param {Function} [customTradeFetcher]
 * @returns {Promise<{ca: string, buyersCount: number}|null>}
 */
export async function processMemeToken(meme, customTradeFetcher = fetchEarlyBuyerTrades) {
  if (!meme || !meme.ca || SYSTEM_MINTS.has(meme.ca)) return null;
  const { ca, athMcap, athTimestamp } = meme;
  const isEvm = ca.startsWith('0x');
  const chain = meme.chain || (isEvm ? 'robinhood' : 'solana');

  try {
    const trades = await customTradeFetcher(ca, { athMcap, athTimestamp, chain, poolAddress: meme.poolAddress });
    const wallets = extractEarlyBuyers(trades, athMcap, athTimestamp);

    const source = trades.source || 'custom';

    if (wallets.length > 0) {
      // Build wallet records for upsert
      const newcomers = wallets.map(addr => {
        const addrIsEvm = addr.startsWith('0x');
        return {
          address: addrIsEvm ? addr.toLowerCase() : addr,
          chain,
          category: 'tracked',
          source: isEvm ? 'worker3-robinhood-early-buyer' : 'worker3-early-buyer',
          qualificationMethod: 'pre_ath_early_buyer',
          methods: ['pre_ath_early_buyer'],
          tags: ['tracked', 'early_buyer', isEvm ? 'robinhood_early_buyer' : 'solana_early_buyer'],
          earlyBuyerInfo: {
            method: 'pre_ath_early_buyer',
            mint: ca,
            symbol: meme.symbol || null,
            athMcap,
            athTimestamp,
          },
        };
      });

      await persistWallets(null, newcomers);

      markMemeBackfilled(ca);
      log('info', `[worker3] backfilled ${ca} — ${wallets.length} early buyer(s) harvested (source: ${source}, chain: ${chain})`);
    } else if (trades.length > 0) {
      markMemeBackfilled(ca);
      log('info', `[worker3] backfilled ${ca} — 0 early buyers qualified from ${source} trades`);
    } else {
      const attempts = (Number(meme.backfillAttempts) || 0) + 1;
      recordBackfillAttempt(ca);

      if (attempts >= 2) {
        markMemeBackfilled(ca);
        log('info', `[worker3] backfilled ${ca} — marked completed after ${attempts} attempts (0 early buyers qualified)`);
      } else {
        log('warn', `[worker3] 0 early buyers qualified for ${ca} via ${source} (trades: ${trades.length}, attempt ${attempts}); rotated for retry`);
      }
    }

    return { ca, buyersCount: wallets.length };
  } catch (err) {
    log('warn', `[worker3] failed to process ${ca}: ${err?.message || String(err)}`);
    return null;
  }
}

/**
 * Process the next unbackfilled meme token:
 * 1. Fetch trade history via the provided fetcher (defaults to multi-source rotating fetcher).
 * 2. Extract qualifying early buyers.
 * 3. Upsert those wallets into the tracker store.
 * 4. Mark the meme as backfilled.
 *
 * @param {Function} [customTradeFetcher] – async (ca) => Array of trade objects
 * @param {string|null} [chain=null] – Optional chain filter ('solana', 'robinhood', or null for all)
 * @returns {Promise<{ca: string, buyersCount: number}|null>}
 */
export async function processNextUnbackfilledMeme(customTradeFetcher = fetchEarlyBuyerTrades, chain = null) {
  const pending = getUnbackfilledMemes(1, chain);
  if (!pending || pending.length === 0) return null;
  return processMemeToken(pending[0], customTradeFetcher);
}

/**
 * Process a batch of unbackfilled meme tokens sequentially so the provider throttle stays one meme at a time.
 *
 * @param {number} [batchSize=3]
 * @param {Function} [customTradeFetcher]
 * @param {string|null} [chain=null] – Optional chain filter ('solana', 'robinhood', or null for all)
 * @returns {Promise<Array<{ca: string, buyersCount: number}>>}
 */
export async function processUnbackfilledMemesBatch(batchSize = 3, customTradeFetcher = fetchEarlyBuyerTrades, chain = null) {
  const pending = getUnbackfilledMemes(batchSize, chain);
  if (!pending || pending.length === 0) return [];

  const results = [];
  for (const meme of pending) {
    try {
      const res = await processMemeToken(meme, customTradeFetcher);
      if (res) results.push(res);
    } catch (_) {}
  }

  return results;
}
