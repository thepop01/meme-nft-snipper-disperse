import { loadWallets, saveWallets } from '../smartwallets/tracker.js';
import { log } from '../bus.js';

/**
 * Extract transaction signature from a trade object, checking multiple field names.
 */
function txSignature(trade) {
  const v = trade.txSignature ?? trade.signature ?? trade.tx ?? trade.txHash;
  return typeof v === 'string' ? v : null;
}

/**
 * Extract timestamp from a trade object.
 */
function tradeTimestamp(trade) {
  const v = trade.timestamp ?? trade.ts ?? trade.blockTime;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract contract address from a trade object.
 */
function tradeCA(trade) {
  const v = trade.ca ?? trade.contractAddress ?? trade.mint ?? trade.address;
  return typeof v === 'string' ? v : null;
}

/**
 * Extract entry market cap from a trade object.
 */
function entryMcap(trade) {
  const v = trade.entryMcap ?? trade.buyMcap ?? trade.marketCapUsd;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract exit market cap from a trade object.
 */
function exitMcap(trade) {
  const v = trade.exitMcap ?? trade.sellMcap;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract realized PnL from a trade object.
 */
function tradePnl(trade) {
  const v = trade.pnl ?? trade.profitUsd ?? trade.realizedProfitUsd;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract entry USD amount from a trade object.
 */
function entryUsd(trade) {
  const v = trade.entryUsd ?? trade.buyUsd ?? trade.investmentUsd;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract exit USD amount from a trade object.
 */
function exitUsd(trade) {
  const v = trade.exitUsd ?? trade.sellUsd ?? trade.proceedsUsd;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract holding time in seconds from a trade object.
 */
function holdingTimeSec(trade) {
  const v = trade.holdingTimeSec ?? trade.holdTimeSec ?? trade.durationSec;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Accumulate wallet execution metrics from a stream of trades.
 * Metrics are computed in-flight: raw transaction history is NOT stored.
 *
 * Returns updated wallet record with:
 * - captureRatioPct: Avg realized exit mcap / token ATH
 * - soldAbove50AthPct: % of exit volume above 50% of token ATH
 * - roundTripRatePct: % of winning positions that fell back below entry
 * - roiPct: Total realized PnL / Total invested USD
 * - winRatePct: Profitable trades / total trades
 * - avgHoldingTimeSec: Average holding duration
 * - tradedTokenCAs: Distinct token contract addresses
 * - lastProcessedTxSignature: Most recent tx signature (watermark)
 * - lastProcessedTimestamp: Most recent tx timestamp (watermark)
 *
 * CRITICAL: rawTrades is NEVER stored. Only aggregated metrics persist.
 *
 * @param {Object} existingWallet – Current wallet record
 * @param {Array} newTrades – Array of trade objects to process
 * @param {Object} tokenAthMap – Map of contract address to ATH market cap
 * @returns {Object} – Updated wallet record with computed metrics
 */
export function accumulateWalletMetrics(existingWallet, newTrades, tokenAthMap) {
  if (!Array.isArray(newTrades) || newTrades.length === 0) {
    return {
      ...existingWallet,
      captureRatioPct: 0,
      soldAbove50AthPct: 0,
      roundTripRatePct: 0,
      roiPct: 0,
      winRatePct: 0,
      avgHoldingTimeSec: 0,
      tradedTokenCAs: [],
    };
  }

  // Accumulate metrics across all trades (in-flight, no storage)
  let totalCaptureRatio = 0;
  let capturedTrades = 0;

  let totalExitVolume = 0;
  let volumeAbove50AthPct = 0;

  let roundTripWins = 0;
  let winningTrades = 0;

  let totalPnl = 0;
  let totalInvested = 0;

  let profitableTrades = 0;

  let totalHoldingTime = 0;

  const tradedTokens = new Set();
  let mostRecentTxSig = null;
  let mostRecentTs = 0;

  for (const trade of newTrades) {
    const ca = tradeCA(trade);
    const entry = entryMcap(trade);
    const exit = exitMcap(trade);
    const pnl = tradePnl(trade);
    const eUsd = entryUsd(trade);
    const exUsd = exitUsd(trade);
    const holdTime = holdingTimeSec(trade);
    const sig = txSignature(trade);
    const ts = tradeTimestamp(trade);

    // Track most recent transaction for watermark cursor
    if (ts > mostRecentTs) {
      mostRecentTs = ts;
      mostRecentTxSig = sig;
    } else if (ts === mostRecentTs && sig && (!mostRecentTxSig || sig > mostRecentTxSig)) {
      mostRecentTxSig = sig;
    }

    // Track distinct tokens traded
    if (ca) {
      tradedTokens.add(ca);
    }

    // 1. Capture Ratio: Avg(exitMcap) / token ATH
    if (ca && exit != null) {
      const ath = tokenAthMap[ca];
      if (ath && ath > 0) {
        totalCaptureRatio += exit / ath;
        capturedTrades++;
      }
    }

    // 2. % Sold > 50% ATH
    if (ca && exUsd != null) {
      const ath = tokenAthMap[ca];
      if (ath && ath > 0) {
        const threshold50Pct = (ath * 0.5);
        if (exit != null && exit >= threshold50Pct) {
          volumeAbove50AthPct += exUsd;
        }
        totalExitVolume += exUsd;
      }
    }

    // 3. Round-Trip Rate: % winning positions back to below entry
    if (entry != null && exit != null && pnl != null && pnl > 0) {
      winningTrades++;
      if (exit < entry) {
        roundTripWins++;
      }
    }

    // 4. ROI: Total PnL / Total Invested
    if (eUsd != null) {
      totalInvested += eUsd;
    }
    if (pnl != null) {
      totalPnl += pnl;
    }

    // 5. Win Rate: count profitable
    if (pnl != null && pnl > 0) {
      profitableTrades++;
    }

    // 6. Average Holding Time
    if (holdTime > 0) {
      totalHoldingTime += holdTime;
    }
  }

  const tradeCount = newTrades.length;

  // Compute final metrics
  const captureRatioPct = capturedTrades > 0
    ? (totalCaptureRatio / capturedTrades) * 100
    : 0;

  const soldAbove50AthPct = totalExitVolume > 0
    ? (volumeAbove50AthPct / totalExitVolume) * 100
    : 0;

  const roundTripRatePct = winningTrades > 0
    ? (roundTripWins / winningTrades) * 100
    : 0;

  const roiPct = totalInvested > 0
    ? (totalPnl / totalInvested) * 100
    : 0;

  const winRatePct = tradeCount > 0
    ? (profitableTrades / tradeCount) * 100
    : 0;

  const avgHoldingTimeSec = tradeCount > 0
    ? totalHoldingTime / tradeCount
    : 0;

  // Return updated wallet with metrics (NO rawTrades stored)
  return {
    ...existingWallet,
    captureRatioPct: Math.max(0, Math.min(100, captureRatioPct)),
    soldAbove50AthPct: Math.max(0, Math.min(100, soldAbove50AthPct)),
    roundTripRatePct: Math.max(0, Math.min(100, roundTripRatePct)),
    roiPct,
    winRatePct: Math.max(0, Math.min(100, winRatePct)),
    avgHoldingTimeSec,
    tradedTokenCAs: Array.from(tradedTokens),
    lastProcessedTxSignature: mostRecentTxSig || null,
    lastProcessedTimestamp: mostRecentTs || null,
  };
}

/**
 * Process one metrics pass: fetch activity for up to 5 wallets since watermark,
 * compute metrics in-flight, persist only aggregated metrics (never raw trades).
 *
 * @param {Function} customActivityFetcher – async (walletAddress, lastProcessedTxSig, lastProcessedTs) => Array of trades
 * @param {Object} tokenAthMap – Map of contract address to ATH market cap
 * @returns {Promise<number>} – Count of wallets processed
 */
export async function processWalletMetricsPass(customActivityFetcher, tokenAthMap) {
  const MAX_WALLETS_PER_PASS = 5;
  let processed = 0;

  try {
    const doc = loadWallets();
    const wallets = doc.wallets || [];

    // Process up to MAX_WALLETS_PER_PASS wallets
    for (let i = 0; i < wallets.length && processed < MAX_WALLETS_PER_PASS; i++) {
      const wallet = wallets[i];
      const walletAddr = wallet?.address;

      if (!walletAddr) continue;

      try {
        // Fetch activity since watermark
        const lastSig = wallet?.lastProcessedTxSignature ?? null;
        const lastTs = wallet?.lastProcessedTimestamp ?? null;

        const trades = await customActivityFetcher(walletAddr, lastSig, lastTs);

        if (Array.isArray(trades) && trades.length > 0) {
          // Accumulate metrics (in-flight, no storage)
          const updated = accumulateWalletMetrics(wallet, trades, tokenAthMap);
          wallets[i] = updated;
        } else if (trades !== null && trades !== undefined) {
          // Activity fetcher returned empty but valid result; still update watermark if present
          // (e.g., first pass with no activity yet)
          wallets[i] = { ...wallet };
        }

        processed++;
      } catch (err) {
        log('warn', `[worker4] failed to process wallet ${walletAddr}: ${err?.message || String(err)}`);
        // Continue to next wallet on error
      }
    }

    // Persist only metrics (never raw trades)
    saveWallets({ ...doc, wallets });
  } catch (err) {
    log('warn', `[worker4] metrics pass failed: ${err?.message || String(err)}`);
  }

  return processed;
}
