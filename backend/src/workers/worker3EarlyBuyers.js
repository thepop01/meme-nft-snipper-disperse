import { getUnbackfilledMemes, markMemeBackfilled } from './memeRegistry.js';
import { loadWallets, saveWallets, upsertWallets } from '../smartwallets/tracker.js';
import { log } from '../bus.js';

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
 * Resolve the timestamp from a trade object.
 */
function tradeTimestamp(trade) {
  const v = trade.timestamp ?? trade.ts ?? trade.blockTime;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

  // --- Rule 1: Quota Buyers ---
  // Sort by timestamp ascending, take first N unique wallets with timestamp < athTimestamp.
  const preAthTrades = trades
    .filter(t => tradeTimestamp(t) < athTimestamp)
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
 * Process the next unbackfilled meme token:
 * 1. Fetch trade history via the provided fetcher.
 * 2. Extract qualifying early buyers.
 * 3. Upsert those wallets into the tracker store.
 * 4. Mark the meme as backfilled.
 *
 * @param {Function} customTradeFetcher – async (ca) => Array of trade objects
 * @returns {Promise<{ca: string, buyersCount: number}|null>}
 */
export async function processNextUnbackfilledMeme(customTradeFetcher) {
  const pending = getUnbackfilledMemes(1);
  if (!pending || pending.length === 0) return null;

  const meme = pending[0];
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
