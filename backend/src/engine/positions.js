// Open position tracking with automatic exits: take-profit, stop-loss,
// trailing stop, and max-hold-time. Prices refresh on a polling loop.
import { load, save } from '../store.js';
import { emit, log } from '../bus.js';
import { executeSell, getSolPriceUsd } from '../trading/executor.js';
import { fetchPriceUsd, fetchPricesBatch } from '../discovery/enrich.js';
import {
  ensureLegacyLot, recordConfirmedFill, remainingCostBasis,
} from './accounting.js';

let positions = load('positions', []);
let trades = load('trades', []);
let pollTimer = null;
const selling = new Set(); // reentrancy guard for sells
let positionsDirty = false;
let positionsTimer = null;

const POLL_INTERVAL_MS = 5000;

export function getPositions() {
  return positions;
}

export function getTrades() {
  return trades.slice(0, 200);
}

function persist() {
  save('positions', positions);
}

function persistTrades() {
  save('trades', trades.slice(0, 1000));
}

function markPositionsDirty() {
  positionsDirty = true;
  if (!positionsTimer) {
    positionsTimer = setTimeout(() => {
      if (positionsDirty) {
        // Prune old closed positions (keep last 200)
        const closed = positions.filter(p => p.status === 'closed');
        if (closed.length > 200) {
          const toRemove = new Set(closed.slice(200).map(p => p.id));
          positions = positions.filter(p => !toRemove.has(p.id));
        }
        persist();
        positionsDirty = false;
      }
      positionsTimer = null;
    }, 2000);
  }
}

export function recordTrade(trade) {
  trades.unshift({ ...trade, timestamp: Date.now() });
  persistTrades();
  emit('trade:executed', { trade: trades[0] });
}

export async function openPosition(token, buyResult, exitRules, botId = null) {
  const walletAddress = String(buyResult.walletAddress || (buyResult.dryRun ? 'paper' : 'legacy')).toLowerCase();
  const existing = positions.find(position => position.status === 'open'
    && position.mint === token.mint
    && String(position.walletAddress || (position.dryRun ? 'paper' : 'legacy')).toLowerCase() === walletAddress);
  const position = existing || {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    onCurve: token.onCurve || false,
    decimals: token.decimals ?? 6,
    botId,
    entryPriceUsd: buyResult.priceUsd,
    currentPriceUsd: buyResult.priceUsd,
    peakPriceUsd: buyResult.priceUsd,
    chainId: buyResult.chainId || token.chain || 'solana',
    walletAddress,
    tokenAmount: 0,
    solSpent: 0,
    realizedPnlSol: 0,
    feesSol: 0,
    pnlSol: 0,
    pnlPct: 0,
    openedAt: Date.now(),
    dryRun: buyResult.dryRun,
    exitRules, // { takeProfitPct, stopLossPct, trailingStopPct, maxHoldMin, slippagePct }
    status: 'open',
  };
  const previousQuantity = position.tokenAmount;
  const addedCost = Number(buyResult.solSpent || 0) + Number(buyResult.networkFeeSol || 0);
  position.tokenAmount += Number(buyResult.tokenAmount || 0);
  position.solSpent += addedCost;
  position.feesSol = Number(position.feesSol || 0) + Number(buyResult.networkFeeSol || 0);
  position.entryPriceUsd = position.tokenAmount > 0
    ? ((position.entryPriceUsd * previousQuantity) + (Number(buyResult.priceUsd || 0) * Number(buyResult.tokenAmount || 0))) / position.tokenAmount
    : buyResult.priceUsd;
  position.currentPriceUsd = buyResult.priceUsd;
  position.peakPriceUsd = Math.max(position.peakPriceUsd || 0, buyResult.priceUsd || 0);
  position.exitRules = exitRules || position.exitRules;
  if (!existing) positions.push(position);

  const fill = recordConfirmedFill({
    side: 'buy', chainId: position.chainId, walletAddress,
    tokenAddress: token.mint, symbol: token.symbol,
    tokenQuantity: buyResult.tokenAmount, quoteQuantitySol: buyResult.solSpent,
    networkFeeSol: buyResult.networkFeeSol, priceUsd: buyResult.priceUsd,
    txSignature: buyResult.txSignature, positionId: position.id,
    dryRun: buyResult.dryRun, source: botId ? 'bot' : 'manual',
  });
  markPositionsDirty();
  emit('position:update', { position });

  recordTrade({
    side: 'buy',
    mint: token.mint,
    symbol: token.symbol,
    solAmount: buyResult.solSpent,
    priceUsd: buyResult.priceUsd,
    txSignature: buyResult.txSignature,
    fillId: fill.id,
    walletAddress,
    networkFeeSol: fill.networkFeeSol,
    dryRun: buyResult.dryRun,
    botId,
  });

  startPolling();
  return position;
}

export async function closePosition(positionId, fraction = 1, reason = 'manual', confirmedResult = null, options = {}) {
  if (selling.has(positionId)) throw new Error('Sell already in progress for this position');
  const position = positions.find(p => p.id === positionId && p.status === 'open');
  if (!position) throw new Error('Position not found or already closed');

  if (typeof fraction !== 'number' || !isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error('fraction must be a number between 0 and 1');
  }

  selling.add(positionId);
  try {
    const slippagePct = position.exitRules?.slippagePct ?? 10;
    // Keep retries for the same position snapshot on one durable submission
    // intent. Once a partial sell changes tokenAmount, the next intentional
    // sell gets a new key; an ambiguous send cannot be rebroadcast meanwhile.
    const sellIntentKey = options.idempotencyKey || `position:${position.id}:sell:${fraction}:${position.tokenAmount}`;
    const result = confirmedResult || await executeSell(position, {
      fraction, slippagePct, idempotencyKey: sellIntentKey,
    });

    const soldTokens = Number(result.soldTokens || position.tokenAmount * fraction);
    ensureLegacyLot(position);
    const fill = recordConfirmedFill({
      side: 'sell', chainId: position.chainId || 'solana',
      walletAddress: result.walletAddress || position.walletAddress || (position.dryRun ? 'paper' : 'legacy'),
      tokenAddress: position.mint, symbol: position.symbol,
      tokenQuantity: soldTokens,
      quoteQuantitySol: result.grossSolReceived ?? result.solReceived,
      networkFeeSol: result.networkFeeSol, priceUsd: result.priceUsd,
      txSignature: result.txSignature, positionId: position.id,
      dryRun: result.dryRun, source: reason,
    });
    const pnlSol = fill.realizedPnlSol;

    recordTrade({
      side: 'sell',
      mint: position.mint,
      symbol: position.symbol,
      solAmount: result.solReceived,
      priceUsd: result.priceUsd,
      pnlSol,
      reason,
      txSignature: result.txSignature,
      fillId: fill.id,
      costBasisSol: fill.costBasisSol,
      networkFeeSol: fill.networkFeeSol,
      dryRun: result.dryRun,
      botId: position.botId,
    });

    position.realizedPnlSol = Number(position.realizedPnlSol || 0) + pnlSol;
    position.feesSol = Number(position.feesSol || 0) + fill.networkFeeSol + fill.feeSol;
    if (soldTokens >= position.tokenAmount * 0.999) {
      position.status = 'closed';
      position.closedAt = Date.now();
      position.closeReason = reason;
    } else {
      position.tokenAmount -= soldTokens;
      position.solSpent = remainingCostBasis({
        chainId: position.chainId || 'solana',
        walletAddress: position.walletAddress || (position.dryRun ? 'paper' : 'legacy'),
        tokenAddress: position.mint,
      });
    }
    markPositionsDirty();
    emit('position:update', { position });
    log('info', `Position ${position.symbol || position.mint.slice(0, 6)} sell ${(fraction * 100).toFixed(0)}% (${reason}), pnl ${pnlSol.toFixed(4)} SOL`);
    return position;
  } finally {
    selling.delete(positionId);
  }
}

export function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshPositions, POLL_INTERVAL_MS);
}

async function refreshPositions() {
  const open = positions.filter(p => p.status === 'open');
  if (open.length === 0) return;

  const solPrice = await getSolPriceUsd();
  const mints = open.map(p => p.mint);
  const prices = await fetchPricesBatch(mints);

  for (const p of open) {
    const price = prices.get(p.mint);
    if (!price) continue;

    p.currentPriceUsd = price;
    p.peakPriceUsd = Math.max(p.peakPriceUsd || price, price);
    p.pnlPct = p.entryPriceUsd > 0 ? ((price - p.entryPriceUsd) / p.entryPriceUsd) * 100 : 0;
    const currentSolValue = (p.tokenAmount * price) / solPrice;
    p.pnlSol = currentSolValue - p.solSpent;
    emit('position:update', { position: p });

    await checkExits(p);
  }
  markPositionsDirty();
}

async function checkExits(p) {
  if (selling.has(p.id)) return; // skip if sell in progress
  const rules = p.exitRules || {};
  try {
    if (rules.takeProfitPct && p.pnlPct >= rules.takeProfitPct) {
      await closePosition(p.id, 1, `take-profit +${rules.takeProfitPct}%`);
      return;
    }
    if (rules.stopLossPct && p.pnlPct <= -Math.abs(rules.stopLossPct)) {
      await closePosition(p.id, 1, `stop-loss -${Math.abs(rules.stopLossPct)}%`);
      return;
    }
    if (rules.trailingStopPct && p.peakPriceUsd > p.entryPriceUsd) {
      const drawdownPct = ((p.peakPriceUsd - p.currentPriceUsd) / p.peakPriceUsd) * 100;
      if (drawdownPct >= rules.trailingStopPct) {
        await closePosition(p.id, 1, `trailing-stop -${rules.trailingStopPct}% from peak`);
        return;
      }
    }
    if (rules.maxHoldMin && Date.now() - p.openedAt > rules.maxHoldMin * 60_000) {
      await closePosition(p.id, 1, `max-hold ${rules.maxHoldMin}min`);
    }
  } catch (err) {
    log('error', `auto-exit failed for ${p.mint}: ${err.message}`);
  }
}
