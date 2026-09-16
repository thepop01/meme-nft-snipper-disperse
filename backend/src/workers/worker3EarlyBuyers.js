import { getUnbackfilledMemes, markMemeBackfilled } from './memeRegistry.js';
import { loadWallets, saveWallets, upsertWallets } from '../smartwallets/tracker.js';
import { executeWithThrottle } from './rateLimiter.js';
import { log } from '../bus.js';

let rotationIndex = 0;

/**
 * Fetch trades from Birdeye DeFi API (ascending order from launch).
 *
 * @param {string} ca
 * @returns {Promise<Array>}
 */
export async function fetchBirdeyeTrades(ca) {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) return [];

  return executeWithThrottle('birdeye', async () => {
    const url = `https://public-api.birdeye.so/defi/txs/token?address=${ca}&tx_type=swap&sort_type=asc&offset=0&limit=100`;
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
    const items = json.data?.items || [];
    return items
      .map(it => ({
        wallet: it.owner,
        timestamp: it.blockUnixTime ? it.blockUnixTime * 1000 : 0,
        entryMcap: it.base?.price ? (it.base.price * 1_000_000_000) : null,
        pnl: 1,
      }))
      .filter(t => t.wallet);
  });
}

/**
 * Fetch trades from Helius Enhanced Transactions API.
 *
 * @param {string} ca
 * @returns {Promise<Array>}
 */
export async function fetchHeliusTrades(ca) {
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
        pnl: 1,
      }))
      .filter(t => t.wallet);
  });
}

/**
 * Multi-source rotating fetcher with automatic fallback.
 * Rotates starting provider between Birdeye and Helius, falling back to the other.
 *
 * @param {string} ca
 * @returns {Promise<Array>}
 */
export async function fetchEarlyBuyerTrades(ca) {
  const providers = [fetchBirdeyeTrades, fetchHeliusTrades];
  const startIdx = rotationIndex++ % providers.length;
  const ordered = [providers[startIdx], providers[(startIdx + 1) % providers.length]];

  for (const fetcher of ordered) {
    try {
      const trades = await fetcher(ca);
      if (Array.isArray(trades) && trades.length > 0) {
        return trades;
      }
    } catch (err) {
      log('warn', `[worker3] provider attempt failed for ${ca}: ${err?.message || String(err)}`);
    }
  }
  return [];
}

/**
 * Calculate the quota of first-buyer wallets for a given ATH market cap.
 * N = round(athMcap * 0.00004), minimum 1.
 *
 * @param {number} athMcap
 * @returns {number}
 */
export function calculateFirstBuyersQuota(athMcap) {
  const n = Math.round((Number(athMcap) || 0) * 0.00004);
  return Math.max(1, n);
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
 * Qualification rules (both applied to the same set of pre-ATH trades):
 *
 * Rule 1 – Quota Buyers: first N unique wallets to buy, where
 *   N = calculateFirstBuyersQuota(athMcap). Must buy strictly before T_ATH.
 *
 * Rule 2 – Value Buyers: wallet bought at entry market cap <= 25% of ATH
 *   with positive realized PnL. Must buy strictly before T_ATH.
 *
 * The result is the union of both rule sets, deduplicated.
 *
 * @param {Array} trades        – Array of trade objects
 * @param {number} athMcap      – All-time-high market cap
 * @param {number} athTimestamp  – Timestamp of ATH (strict cutoff)
 * @param {Object} [options]    – Reserved for future use
 * @returns {string[]}          – Array of qualifying wallet addresses
 */
export function extractEarlyBuyers(trades, athMcap, athTimestamp, options) {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  if (!Number.isFinite(athMcap) || athMcap <= 0) return [];
  if (!Number.isFinite(athTimestamp) || athTimestamp <= 0) return [];

  const quota = calculateFirstBuyersQuota(athMcap);
  const valueThreshold = athMcap * 0.25;
  const normAthTimestamp = (athTimestamp > 0 && athTimestamp < 100_000_000_000)
    ? athTimestamp * 1000
    : athTimestamp;

  // --- Rule 1: Quota Buyers ---
  // Sort by timestamp ascending, take first N unique wallets with timestamp < athTimestamp.
  const preAthTrades = trades
    .filter(t => tradeTimestamp(t) < normAthTimestamp)
    .sort((a, b) => tradeTimestamp(a) - tradeTimestamp(b));

  const quotaBuyers = new Set();
  for (const trade of preAthTrades) {
    const addr = trade.wallet || trade.address || trade.maker;
    if (!addr) continue;
    if (quotaBuyers.size >= quota) break;
    quotaBuyers.add(String(addr));
  }

  // --- Rule 2: Value Buyers ---
  // Entry mcap <= 25% of ATH and positive PnL, strictly before T_ATH.
  const valueBuyers = new Set();
  for (const trade of preAthTrades) {
    const addr = trade.wallet || trade.address || trade.maker;
    if (!addr) continue;

    const em = entryMcap(trade);
    const pnl = tradePnl(trade);
    if (em != null && em <= valueThreshold && pnl != null && pnl > 0) {
      valueBuyers.add(String(addr));
    }
  }

  // Union of both rule sets (already deduplicated within each set)
  return [...new Set([...quotaBuyers, ...valueBuyers])];
}

/**
 * Process a single meme token for early buyer extraction.
 *
 * @param {Object} meme
 * @param {Function} [customTradeFetcher]
 * @returns {Promise<{ca: string, buyersCount: number}|null>}
 */
export async function processMemeToken(meme, customTradeFetcher = fetchEarlyBuyerTrades) {
  if (!meme || !meme.ca) return null;
  const { ca, athMcap, athTimestamp } = meme;

  try {
    const trades = await customTradeFetcher(ca);
    const wallets = extractEarlyBuyers(trades, athMcap, athTimestamp);

    if (wallets.length > 0) {
      // Build wallet records for upsert
      const newcomers = wallets.map(addr => ({
        address: addr,
        chain: meme.chain || 'solana',
        category: 'tracked',
        source: 'worker3-early-buyer',
        qualificationMethod: 'pre_ath_early_buyer',
        methods: ['pre_ath_early_buyer'],
        tags: ['tracked', 'early_buyer'],
        earlyBuyerInfo: {
          method: 'pre_ath_early_buyer',
          mint: ca,
          symbol: meme.symbol || null,
          athMcap,
          athTimestamp,
        },
      }));

      const doc = loadWallets();
      const merged = upsertWallets(doc.wallets || [], newcomers);
      saveWallets({ ...doc, wallets: merged });
    }

    markMemeBackfilled(ca);
    log('info', `[worker3] backfilled ${ca} — ${wallets.length} early buyer(s) harvested`);

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
 * @returns {Promise<{ca: string, buyersCount: number}|null>}
 */
export async function processNextUnbackfilledMeme(customTradeFetcher = fetchEarlyBuyerTrades) {
  const pending = getUnbackfilledMemes(1);
  if (!pending || pending.length === 0) return null;
  return processMemeToken(pending[0], customTradeFetcher);
}

/**
 * Process a batch of unbackfilled meme tokens in parallel to distribute the workload.
 *
 * @param {number} [batchSize=3]
 * @param {Function} [customTradeFetcher]
 * @returns {Promise<Array<{ca: string, buyersCount: number}>>}
 */
export async function processUnbackfilledMemesBatch(batchSize = 3, customTradeFetcher = fetchEarlyBuyerTrades) {
  const pending = getUnbackfilledMemes(batchSize);
  if (!pending || pending.length === 0) return [];

  const results = await Promise.allSettled(
    pending.map(meme => processMemeToken(meme, customTradeFetcher))
  );

  return results
    .filter(r => r.status === 'fulfilled' && r.value != null)
    .map(r => r.value);
}
