// Limit orders for meme tokens. These are bot-managed trigger orders, not
// on-chain limit orders: the backend watches prices on a 5s tick and fires a
// market order through the existing executor when the trigger price crosses.
// Works in DRY_RUN (paper fills) and for bonding-curve tokens the same way
// manual buys do. Trade-off vs on-chain (Jupiter Trigger API): fills need the
// backend running, and the fill price is the market price at detection, which
// can gap past the trigger on fast moves.
import { load, save } from '../store.js';
import { emit, log } from '../bus.js';
import { pushAlert } from '../alerts.js';
import { getToken } from '../discovery/registry.js';
import { executeBuy } from '../trading/executor.js';
import { openPosition, closePosition, getPositions } from './positions.js';
import { fetchPricesBatch, fetchPriceUsd } from '../discovery/enrich.js';
import { config } from '../config.js';
import { assertTokenBuyable } from '../analysis/safety.js';

const STORE = 'limit-orders';
const TICK_MS = 5000;
const MAX_OPEN_ORDERS = 50;
const MAX_ATTEMPTS = 3;           // execution attempts before the order fails
const DEFAULT_EXPIRY_HOURS = 7 * 24;
const KEEP_CLOSED = 200;          // retained filled/cancelled/expired/failed orders

let orders = load(STORE, []);
for (const order of orders) {
  if (['triggered', 'submitted'].includes(order.status)) {
    // The backend died between trigger and confirmed fill. We cannot tell
    // whether the buy landed on-chain, so auto-retrying could double-buy.
    // Park the order for manual review instead of re-firing it.
    order.status = 'interrupted';
    order.interruptedAt = Date.now();
    order.error = 'Backend restarted during execution — verify on-chain whether the trade landed, then cancel or re-create this order';
  }
}
let tickTimer = null;
let ticking = false;
const executing = new Set();      // order ids with an execution in flight

function persist() {
  // Keep all open orders plus the most recent closed ones
  const open = orders.filter(o => o.status === 'open');
  const closed = orders.filter(o => o.status !== 'open')
    .sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt))
    .slice(0, KEEP_CLOSED);
  orders = [...open, ...closed];
  save(STORE, orders);
}

export function getLimitOrders() {
  return [...orders].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Create a limit order.
 * Buy:  { side:'buy', mint, triggerPriceUsd, solAmount, slippagePct?, exitRules?, expiresHours?, direction? }
 * Sell: { side:'sell', positionId, triggerPriceUsd, fraction?, expiresHours?, direction? }
 * Direction defaults from the trigger vs the current price (buy below = dip
 * buy, buy above = breakout; sell above = take profit, sell below = stop).
 */
export async function createLimitOrder(params) {
  if (!config.dryRun && !config.allowServerSigner) {
    throw new Error('Live trigger orders require a separately enabled server signer; provider-native limit orders are not available for this token');
  }
  const side = params.side === 'sell' ? 'sell' : 'buy';
  const triggerPriceUsd = Number(params.triggerPriceUsd);
  if (!isFinite(triggerPriceUsd) || triggerPriceUsd <= 0) {
    throw new Error('triggerPriceUsd must be a positive number');
  }
  if (orders.filter(o => o.status === 'open').length >= MAX_OPEN_ORDERS) {
    throw new Error(`Too many open limit orders (max ${MAX_OPEN_ORDERS})`);
  }

  let order;
  if (side === 'buy') {
    const { mint } = params;
    if (!mint) throw new Error('mint is required for a buy limit order');
    const solAmount = Number(params.solAmount);
    if (!isFinite(solAmount) || solAmount <= 0) throw new Error('solAmount must be a positive number');

    const token = getToken(mint);
    if (!token) throw new Error('Token is no longer available in the registry');
    assertTokenBuyable(token);
    const currentPriceUsd = token.priceUsd ?? await fetchPriceUsd(mint);
    if (currentPriceUsd == null) {
      throw new Error('No current price for this token — cannot place a limit order yet');
    }
    const direction = params.direction === 'above' || params.direction === 'below'
      ? params.direction
      : (triggerPriceUsd < currentPriceUsd ? 'below' : 'above');
    assertNotAlreadyTriggered(direction, triggerPriceUsd, currentPriceUsd);

    order = {
      id: newId(),
      side, mint, direction, triggerPriceUsd,
      solAmount,
      slippagePct: Number(params.slippagePct) || 10,
      exitRules: sanitizeExitRules(params.exitRules, Number(params.slippagePct) || 10),
      // Snapshot so the buy still works after the token ages out of the registry
      symbol: token?.symbol ?? params.symbol ?? null,
      name: token?.name ?? params.name ?? null,
      onCurve: token?.onCurve ?? false,
      decimals: token?.decimals ?? 6,
      priceAtCreationUsd: currentPriceUsd,
      walletAddress: params.walletAddress || null,
    };
  } else {
    const { positionId } = params;
    if (!positionId) throw new Error('positionId is required for a sell limit order');
    const position = getPositions().find(p => p.id === positionId && p.status === 'open');
    if (!position) throw new Error('Position not found or already closed');
    const fraction = Number(params.fraction) || 1;
    if (!isFinite(fraction) || fraction <= 0 || fraction > 1) throw new Error('fraction must be between 0 and 1');

    const currentPriceUsd = position.currentPriceUsd ?? position.entryPriceUsd;
    const direction = params.direction === 'above' || params.direction === 'below'
      ? params.direction
      : (triggerPriceUsd > currentPriceUsd ? 'above' : 'below');
    assertNotAlreadyTriggered(direction, triggerPriceUsd, currentPriceUsd);

    order = {
      id: newId(),
      side, direction, triggerPriceUsd, positionId, fraction,
      mint: position.mint,
      symbol: position.symbol ?? null,
      name: position.name ?? null,
      priceAtCreationUsd: currentPriceUsd,
      walletAddress: params.walletAddress || position.walletAddress || null,
    };
  }

  const expiresHours = Number(params.expiresHours) || DEFAULT_EXPIRY_HOURS;
  Object.assign(order, {
    status: 'open',
    type: 'server-trigger',
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresHours * 3600_000,
    attempts: 0,
    originalAmount: side === 'buy' ? order.solAmount : order.fraction,
    filledAmount: 0,
    remainingAmount: side === 'buy' ? order.solAmount : order.fraction,
    triggeredAt: null,
    submittedAt: null,
    lastPriceUsd: order.priceAtCreationUsd,
    error: null,
    filledAt: null,
    closedAt: null,
  });

  orders.push(order);
  persist();
  emit('limitorder:update', { order });
  log('info', `Limit ${side} placed: ${order.symbol || order.mint.slice(0, 6)} ${order.direction} $${triggerPriceUsd}`);
  startLimitOrderLoop();
  return order;
}

export function cancelLimitOrder(id) {
  const order = orders.find(o => o.id === id && o.status === 'open');
  if (!order) throw new Error('Limit order not found or not open');
  if (executing.has(id)) throw new Error('Order is executing — cannot cancel');
  closeOrder(order, 'cancelled');
  return order;
}

function assertNotAlreadyTriggered(direction, trigger, current) {
  const crossed = direction === 'below' ? current <= trigger : current >= trigger;
  if (crossed) {
    throw new Error(
      `Trigger $${trigger} is already ${direction === 'below' ? 'at or below' : 'at or above'} the current price ($${current}) — use a market order instead`,
    );
  }
}

function sanitizeExitRules(rules, slippagePct) {
  const r = rules || {};
  return {
    takeProfitPct: r.takeProfitPct ? Number(r.takeProfitPct) : null,
    stopLossPct: r.stopLossPct ? Number(r.stopLossPct) : null,
    trailingStopPct: r.trailingStopPct ? Number(r.trailingStopPct) : null,
    maxHoldMin: r.maxHoldMin ? Number(r.maxHoldMin) : null,
    slippagePct,
  };
}

function newId() {
  return 'lo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function closeOrder(order, status, extra = {}) {
  order.status = status;
  order.closedAt = Date.now();
  Object.assign(order, extra);
  persist();
  emit('limitorder:update', { order });
}

// --- Trigger loop ---

export function startLimitOrderLoop() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    runLimitTick().catch(err => log('error', `Limit order tick failed: ${err.message}`));
  }, TICK_MS);
  tickTimer.unref?.();
}

export async function runLimitTick({
  fetchPrices = fetchPricesBatch,
  execBuy = executeBuy,
  openPos = openPosition,
  closePos = closePosition,
  now = Date.now(),
} = {}) {
  if (ticking) return;
  ticking = true;
  try {
    const open = orders.filter(o => o.status === 'open');
    if (open.length === 0) return;

    // Expire first — no price data needed
    for (const o of open) {
      if (o.expiresAt && now > o.expiresAt) {
        closeOrder(o, 'expired');
        pushAlert({
          type: 'meme', severity: 'info',
          title: `Limit ${o.side} expired: ${o.symbol || o.mint.slice(0, 6)}`,
          body: `Trigger $${o.triggerPriceUsd} never hit`,
        });
      }
    }

    const active = orders.filter(o => o.status === 'open');
    if (active.length === 0) return;

    const prices = await fetchPrices([...new Set(active.map(o => o.mint))]);
    for (const order of active) {
      const price = prices.get(order.mint);
      if (price == null) continue; // not indexed yet (fresh curve token) — retry next tick
      order.lastPriceUsd = price;

      const hit = order.direction === 'below' ? price <= order.triggerPriceUsd : price >= order.triggerPriceUsd;
      if (!hit || executing.has(order.id)) continue;

      executing.add(order.id);
      try {
        await fillOrder(order, price, { execBuy, openPos, closePos });
      } finally {
        executing.delete(order.id);
      }
    }
    persist(); // persist lastPriceUsd updates
  } finally {
    ticking = false;
  }
}

async function fillOrder(order, price, { execBuy, openPos, closePos }) {
  // Once a buy executor returns, the chain action is confirmed even if
  // position bookkeeping fails. Keep that fact local to this fill so the catch
  // path cannot reopen the order and broadcast a duplicate buy.
  let buyExecutionSucceeded = false;
  try {
    order.status = 'triggered';
    order.triggeredAt ||= Date.now();
    persist();
    emit('limitorder:update', { order });
    order.status = 'submitted';
    order.submittedAt = Date.now();
    persist();
    emit('limitorder:update', { order });
    if (order.side === 'buy') {
      // Prefer the live registry record; fall back to the snapshot
      const token = getToken(order.mint) ?? {
        mint: order.mint, symbol: order.symbol, name: order.name,
        onCurve: order.onCurve, decimals: order.decimals,
      };
      const buyResult = await execBuy({ ...token, priceUsd: price }, {
        solAmount: order.solAmount,
        slippagePct: order.slippagePct,
        // Keep retries tied to this order/trigger, never to a fresh random
        // submission. Unknown outcomes remain parked for reconciliation.
        idempotencyKey: `limit-order:${order.id}`,
      });
      buyExecutionSucceeded = true;
      buyResult.solSpent = order.solAmount;
      if (order.walletAddress) buyResult.walletAddress = order.walletAddress;
      const position = await openPos({ ...token, priceUsd: price }, buyResult, order.exitRules, null);
      closeOrder(order, 'filled', {
        filledAt: Date.now(), filledPriceUsd: buyResult.priceUsd, positionId: position.id,
        filledAmount: order.originalAmount, remainingAmount: 0,
      });
    } else {
      const position = getPositions().find(p => p.id === order.positionId && p.status === 'open');
      if (!position) {
        closeOrder(order, 'cancelled', { error: 'Position closed before the trigger hit' });
        return;
      }
      await closePos(order.positionId, order.fraction, `limit-sell @ $${order.triggerPriceUsd}`);
      closeOrder(order, 'filled', {
        filledAt: Date.now(), filledPriceUsd: price,
        filledAmount: order.originalAmount, remainingAmount: 0,
      });
    }
    pushAlert({
      type: 'meme', severity: 'success',
      title: `Limit ${order.side} filled: ${order.symbol || order.mint.slice(0, 6)}`,
      body: `Trigger $${order.triggerPriceUsd} hit at $${price}`,
    });
    log('info', `Limit ${order.side} FILLED ${order.symbol || order.mint.slice(0, 6)} @ $${price}`);
  } catch (err) {
    order.attempts += 1;
    order.error = err.message;
    log('warn', `Limit ${order.side} attempt ${order.attempts} failed for ${order.mint.slice(0, 8)}: ${err.message}`);
    // An executor timeout/transport error is not a confirmed pre-submit
    // rejection. Keep the persisted submitted state for manual reconciliation
    // rather than allowing the next price tick to broadcast a second trade.
    if (err?.submissionOutcome === 'unknown' || buyExecutionSucceeded) {
      // Keep this terminal state out of the normal "closed" retention path's
      // retry loop; restart handling also parks submitted/interrupted orders.
      const reason = buyExecutionSucceeded
        ? `Buy submitted successfully but position bookkeeping failed: ${err.message}`
        : `${err.message} — verify the transaction before retrying`;
      closeOrder(order, 'interrupted', {
        interruptedAt: Date.now(),
        error: reason,
      });
      pushAlert({
        type: 'meme', severity: 'critical',
        title: `Limit ${order.side} ${buyExecutionSucceeded ? 'BOOKKEEPING FAILURE' : 'UNKNOWN OUTCOME'}: ${order.symbol || order.mint.slice(0, 6)}`,
        body: buyExecutionSucceeded ? reason : `${err.message} — manual reconciliation required`,
      });
    } else if (order.attempts >= MAX_ATTEMPTS) {
      closeOrder(order, 'failed');
      pushAlert({
        type: 'meme', severity: 'critical',
        title: `Limit ${order.side} FAILED: ${order.symbol || order.mint.slice(0, 6)}`,
        body: `${err.message} (${MAX_ATTEMPTS} attempts)`,
      });
    } else {
      order.status = 'open';
      persist();
      emit('limitorder:update', { order });
    }
  }
}
