import crypto from 'node:crypto';
import { load, save } from '../store.js';
import { emit } from '../bus.js';
import { recordWalletActivity } from '../wallets/repository.js';

const FILLS_STORE = 'fills';
const LOTS_STORE = 'position-lots';
const MAX_FILLS = 20_000;

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const keyFor = fill => [fill.chainId, fill.walletAddress, fill.tokenAddress, fill.txSignature, fill.side]
  .map(value => String(value || '').toLowerCase()).join(':');

function readFills() { return load(FILLS_STORE, []); }
function readLots() { return load(LOTS_STORE, []); }
function writeFills(fills) { save(FILLS_STORE, fills.slice(-MAX_FILLS)); }
function writeLots(lots) { save(LOTS_STORE, lots); }

function normalizedFill(input) {
  const side = String(input.side || '').toLowerCase();
  if (!['buy', 'sell'].includes(side)) throw new Error('Fill side must be buy or sell');
  const quantity = number(input.tokenQuantity);
  const quoteQuantity = number(input.quoteQuantitySol);
  if (!(quantity > 0)) throw new Error('Confirmed token quantity must be positive');
  if (!(quoteQuantity >= 0)) throw new Error('Confirmed quote quantity cannot be negative');
  const filledAt = Number(input.filledAt || Date.now());
  return Object.freeze({
    id: input.id || `fill_${crypto.randomUUID()}`,
    chainId: input.chainId || 'solana',
    walletAddress: String(input.walletAddress || 'paper').toLowerCase(),
    tokenAddress: String(input.tokenAddress || input.mint || '').toLowerCase(),
    symbol: input.symbol || null,
    side,
    tokenQuantity: quantity,
    quoteQuantitySol: quoteQuantity,
    grossQuoteQuantitySol: number(input.grossQuoteQuantitySol || quoteQuantity),
    feeSol: number(input.feeSol),
    networkFeeSol: number(input.networkFeeSol),
    priceUsd: input.priceUsd == null ? null : number(input.priceUsd),
    quoteUsd: input.quoteUsd == null ? null : number(input.quoteUsd),
    txSignature: input.txSignature || `paper-${crypto.randomUUID()}`,
    orderId: input.orderId || null,
    positionId: input.positionId || null,
    dryRun: Boolean(input.dryRun),
    status: 'confirmed',
    filledAt,
    source: input.source || 'manual',
    costBasisSol: 0,
    realizedPnlSol: 0,
    matchedQuantity: 0,
    unmatchedQuantity: 0,
  });
}

function sameAsset(lot, fill) {
  return lot.chainId === fill.chainId
    && lot.walletAddress === fill.walletAddress
    && lot.tokenAddress === fill.tokenAddress;
}

export function recordConfirmedFill(input) {
  const fills = readFills();
  const candidate = normalizedFill(input);
  const idempotencyKey = keyFor(candidate);
  const existing = fills.find(fill => keyFor(fill) === idempotencyKey);
  if (existing) return existing;

  const lots = readLots();
  let fill = { ...candidate };
  if (fill.side === 'buy') {
    const totalCost = fill.quoteQuantitySol + fill.feeSol + fill.networkFeeSol;
    lots.push({
      id: `lot_${crypto.randomUUID()}`,
      chainId: fill.chainId,
      walletAddress: fill.walletAddress,
      tokenAddress: fill.tokenAddress,
      symbol: fill.symbol,
      acquiredAt: fill.filledAt,
      sourceFillId: fill.id,
      sourcePositionId: fill.positionId,
      originalQuantity: fill.tokenQuantity,
      remainingQuantity: fill.tokenQuantity,
      originalCostSol: totalCost,
      remainingCostSol: totalCost,
      unitCostSol: totalCost / fill.tokenQuantity,
      dryRun: fill.dryRun,
    });
    fill.costBasisSol = totalCost;
    fill.matchedQuantity = fill.tokenQuantity;
  } else {
    let remaining = fill.tokenQuantity;
    let costBasis = 0;
    const candidates = lots.filter(lot => sameAsset(lot, fill) && lot.remainingQuantity > 1e-12)
      .sort((a, b) => a.acquiredAt - b.acquiredAt);
    for (const lot of candidates) {
      if (remaining <= 1e-12) break;
      const consumed = Math.min(remaining, lot.remainingQuantity);
      const consumedCost = lot.unitCostSol * consumed;
      lot.remainingQuantity = Math.max(0, lot.remainingQuantity - consumed);
      lot.remainingCostSol = Math.max(0, lot.remainingCostSol - consumedCost);
      remaining -= consumed;
      costBasis += consumedCost;
    }
    const netProceeds = Math.max(0, fill.quoteQuantitySol - fill.feeSol - fill.networkFeeSol);
    fill.costBasisSol = costBasis;
    fill.matchedQuantity = fill.tokenQuantity - Math.max(0, remaining);
    fill.unmatchedQuantity = Math.max(0, remaining);
    fill.realizedPnlSol = netProceeds - costBasis;
  }

  fills.push(Object.freeze(fill));
  writeFills(fills);
  writeLots(lots);
  if (fill.walletAddress && fill.walletAddress !== 'paper') {
    recordWalletActivity(fill.walletAddress, fill.filledAt);
  }
  emit('fill:confirmed', { fill });
  return fill;
}

// Legacy positions predate immutable fills. A synthetic opening lot lets their
// next confirmed sell use FIFO without rewriting historical trade records.
export function ensureLegacyLot(position) {
  const lots = readLots();
  if (lots.some(lot => lot.sourcePositionId === position.id && lot.remainingQuantity > 0)) return;
  const quantity = number(position.tokenAmount);
  if (!(quantity > 0)) return;
  const walletAddress = String(position.walletAddress || (position.dryRun ? 'paper' : 'legacy')).toLowerCase();
  const tokenAddress = String(position.mint || '').toLowerCase();
  const existingQuantity = lots
    .filter(lot => lot.chainId === (position.chainId || 'solana') && lot.walletAddress === walletAddress && lot.tokenAddress === tokenAddress)
    .reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  const missing = Math.max(0, quantity - existingQuantity);
  if (!(missing > 1e-12)) return;
  const cost = number(position.solSpent) * (missing / quantity);
  lots.push({
    id: `lot_legacy_${crypto.randomUUID()}`,
    chainId: position.chainId || 'solana', walletAddress, tokenAddress,
    symbol: position.symbol || null, acquiredAt: position.openedAt || Date.now(),
    sourceFillId: null, sourcePositionId: position.id,
    originalQuantity: missing, remainingQuantity: missing,
    originalCostSol: cost, remainingCostSol: cost,
    unitCostSol: cost / missing, dryRun: Boolean(position.dryRun), legacy: true,
  });
  writeLots(lots);
}

export function getFills(filters = {}) {
  const walletSet = filters.walletAddresses?.length
    ? new Set(filters.walletAddresses.map(address => String(address).toLowerCase())) : null;
  return readFills().filter(fill => {
    if (walletSet && !walletSet.has(fill.walletAddress)) return false;
    if (filters.walletAddress && fill.walletAddress !== String(filters.walletAddress).toLowerCase()) return false;
    if (filters.tokenAddress && fill.tokenAddress !== String(filters.tokenAddress).toLowerCase()) return false;
    if (filters.chainId && fill.chainId !== filters.chainId) return false;
    if (filters.from && fill.filledAt < Number(filters.from)) return false;
    if (filters.to && fill.filledAt > Number(filters.to)) return false;
    return true;
  }).sort((a, b) => b.filledAt - a.filledAt);
}

export function getLots(filters = {}) {
  return readLots().filter(lot => {
    if (filters.walletAddress && lot.walletAddress !== String(filters.walletAddress).toLowerCase()) return false;
    if (filters.tokenAddress && lot.tokenAddress !== String(filters.tokenAddress).toLowerCase()) return false;
    return true;
  });
}

export function remainingCostBasis({ chainId = 'solana', walletAddress, tokenAddress }) {
  return readLots().filter(lot => lot.chainId === chainId
    && lot.walletAddress === String(walletAddress).toLowerCase()
    && lot.tokenAddress === String(tokenAddress).toLowerCase())
    .reduce((sum, lot) => sum + lot.remainingCostSol, 0);
}

export function pnlSummary(filters = {}) {
  const fills = getFills(filters);
  const sells = fills.filter(fill => fill.side === 'sell');
  const realizedPnlSol = sells.reduce((sum, fill) => sum + fill.realizedPnlSol, 0);
  const feesSol = fills.reduce((sum, fill) => sum + fill.feeSol + fill.networkFeeSol, 0);
  const wins = sells.filter(fill => fill.realizedPnlSol > 0);
  const losses = sells.filter(fill => fill.realizedPnlSol < 0);
  const group = (items, keyFn) => Object.values(items.reduce((out, fill) => {
    const key = keyFn(fill);
    out[key] ||= { key, realizedPnlSol: 0, feesSol: 0, fills: 0 };
    out[key].realizedPnlSol += fill.realizedPnlSol;
    out[key].feesSol += fill.feeSol + fill.networkFeeSol;
    out[key].fills += 1;
    return out;
  }, {}));
  return {
    realizedPnlSol, feesSol, fillCount: fills.length, sellCount: sells.length,
    winRate: sells.length ? wins.length / sells.length : null,
    averageWinSol: wins.length ? wins.reduce((sum, fill) => sum + fill.realizedPnlSol, 0) / wins.length : 0,
    averageLossSol: losses.length ? losses.reduce((sum, fill) => sum + fill.realizedPnlSol, 0) / losses.length : 0,
    largestGainSol: wins.length ? Math.max(...wins.map(fill => fill.realizedPnlSol)) : 0,
    largestLossSol: losses.length ? Math.min(...losses.map(fill => fill.realizedPnlSol)) : 0,
    byToken: group(sells, fill => `${fill.chainId}:${fill.tokenAddress}`),
    byWallet: group(sells, fill => fill.walletAddress),
    byDay: group(sells, fill => new Date(fill.filledAt).toISOString().slice(0, 10)),
  };
}
