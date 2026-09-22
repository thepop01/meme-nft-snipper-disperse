// PumpPortal ingestion: raw event tape plus staged, per-launch trade collection.
import WebSocket from 'ws';
import { log } from '../bus.js';
import { registerToken, setTokenImage } from './registry.js';
import { resolveImageUrl, isMetadataUri } from './tokenMedia.js';
import { assetKey, eventId, EVENT_TYPES, validateEnvelope } from '../tape/identity.js';
import { systemClock } from './clock.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
let activeFeed = null;

function toLamports(sol) {
  if (sol == null) return null;
  const value = Number(sol);
  return Number.isFinite(value) ? Math.round(value * LAMPORTS_PER_SOL) : null;
}

function tapeType(message) {
  if (message.txType === 'create') return EVENT_TYPES.TOKEN_CREATED;
  if (message.txType === 'buy' || message.txType === 'sell') return EVENT_TYPES.TRADE_OBSERVED;
  if (message.txType === 'migrate') return EVENT_TYPES.MIGRATION_OBSERVED;
  return null;
}

// Pure mapping except for the supplied append. The clock is injected so replay stays deterministic.
export async function handlePumpMessage(tape, message, { clock = systemClock } = {}) {
  const type = tapeType(message);
  if (!type || !message.mint) return { appended: false, ignored: true };
  const envelope = {
    assetKey: assetKey('solana', 'pumpfun', message.mint), source: 'pumpportal',
    schemaVersion: type === EVENT_TYPES.TOKEN_CREATED ? 2 : 1,
    type, chainTs: message.blockTime == null ? null : Number(message.blockTime) * 1000,
    receivedAt: clock.now(), slot: message.slot ?? null, signature: message.signature ?? null,
    instructionIndex: message.instructionIndex ?? 0,
  };
  if (type === EVENT_TYPES.TOKEN_CREATED) {
    envelope.payload = {
      creator: message.traderPublicKey ?? null, curve: message.bondingCurveKey ?? null,
      rawSupply: message.rawSupply == null ? null : String(message.rawSupply),
      decimals: message.decimals ?? null,
      curveTargetSol: message.curveTargetSol == null ? null : String(message.curveTargetSol),
      initialBuyLamports: toLamports(message.solAmount),
    };
  } else if (type === EVENT_TYPES.TRADE_OBSERVED) {
    envelope.payload = {
      side: message.txType, wallet: message.traderPublicKey ?? null,
      lamports: toLamports(message.solAmount), rawTokens: String(message.tokenAmountRaw ?? '0'),
    };
  } else {
    // Preserve the price/supply evidence needed to derive a reproducible, supply-aware
    // migration anchor in the causal extractor.  `anchorMcap` remains a provider fallback.
    envelope.payload = {
      pool: message.pool ?? null,
      priceUsd: message.priceUsd ?? message.usdPrice ?? null,
      rawSupply: message.rawSupply ?? message.tokenSupply ?? null,
      decimals: message.decimals ?? null,
      anchorMcap: message.anchorMcap ?? null,
    };
  }
  envelope.eventId = eventId(envelope);
  if (!validateEnvelope(envelope).ok) return { appended: false, invalid: true };
  return { appended: await tape.append(envelope), envelope };
}

// Market snapshots deliberately store price plus supply evidence, never the provider's
// market-cap field. That keeps every downstream mcap calculation supply-aware and replayable.
export async function appendMarketSnapshot(tape, { assetKey: key, mint, chainTs, rawSupply, decimals }, message, { clock = systemClock } = {}) {
  const priceUsd = message.priceUsd ?? message.usdPrice ?? null;
  if (!Number.isFinite(Number(priceUsd)) || Number(priceUsd) <= 0) return { appended: false, ignored: true };
  const envelope = {
    assetKey: key, source: 'pumpportal', schemaVersion: 1, type: EVENT_TYPES.MARKET_SNAPSHOT,
    chainTs: Number.isFinite(Number(chainTs)) ? Number(chainTs) : clock.now(), receivedAt: clock.now(), slot: message.slot ?? null,
    signature: `market:${message.signature ?? `${mint}:${chainTs}`}`, instructionIndex: 0,
    payload: { priceUsd: Number(priceUsd), rawSupply: rawSupply == null ? null : String(rawSupply), decimals: decimals ?? null,
      liquidityUsd: message.liquidityUsd ?? null, intervalVolumeUsd: message.volumeUsd ?? message.intervalVolumeUsd ?? null, source: 'pumpportal' },
  };
  envelope.eventId = eventId(envelope);
  if (!validateEnvelope(envelope).ok) return { appended: false, invalid: true };
  return { appended: await tape.append(envelope), envelope };
}

export function makeBaselineCloser(tape, subs, budget) {
  return async (closed) => {
    const envelope = {
      assetKey: closed.assetKey, source: 'pumpportal', schemaVersion: 1,
      type: EVENT_TYPES.BASELINE_CLOSED, chainTs: closed.ts, receivedAt: closed.ts,
      slot: null, signature: `baseline:${closed.assetKey}:${closed.ts}`, instructionIndex: 0,
      payload: { reason: closed.reason, swapsObserved: closed.swapsObserved, durationMs: closed.durationMs },
    };
    envelope.eventId = eventId(envelope);
    if (validateEnvelope(envelope).ok) await tape.append(envelope);
    if (!budget.isHot(closed.assetKey)) subs.unsubscribeTrades(closed.assetKey.split(':')[2]);
  };
}

// The control layer remains separate from mapping to make subscription and censoring behavior testable.
export async function routePumpMessage(ctx, message) {
  const { tape, baseline, subs, budget, structuralEvidence, structuralState, clock = systemClock } = ctx;
  if (!message?.mint) return { appended: false, ignored: true };
  const key = assetKey('solana', 'pumpfun', message.mint);
  const result = await handlePumpMessage(tape, message, { clock });
  if (message.txType === 'create') {
    budget.registerLaunch(key);
    subs.subscribeTrades(message.mint);
    baseline.open(key);
    structuralState?.set(key, {
      assetKey: key, mint: message.mint, creationTs: result.envelope?.chainTs ?? clock.now(),
      creator: result.envelope?.payload?.creator ?? null, rawSupply: result.envelope?.payload?.rawSupply ?? null,
      decimals: result.envelope?.payload?.decimals ?? null, trades: [],
    });
  } else if (message.txType === 'buy' || message.txType === 'sell') {
    if (message.txType === 'buy') budget.recordBuy(key);
    await baseline.recordSwap(key);
    const state = structuralState?.get(key);
    if (state && result.envelope?.payload) state.trades.push({ ...result.envelope.payload, chainTs: result.envelope.chainTs, solLamports: result.envelope.payload.lamports });
    if (message.txType === 'buy' && structuralEvidence && state && budget.isStructuralEligible?.(key)) {
      // Collector de-duplicates each asset and bounds all expensive work internally.
      structuralEvidence.collect(state).catch(error => log('warn', `Structural evidence failed: ${error.message}`));
    }
    // Hot and control assets pass the same stage-B gate before a market observation is kept.
    // This mirrors structural-evidence depth and does not use DexScreener's fixed-supply cap.
    if (state && budget.isStructuralEligible?.(key)) await appendMarketSnapshot(tape, state, message, { clock });
  } else if (message.txType === 'migrate') {
    const state = structuralState?.get(key);
    if (state && result.envelope?.payload) {
      state.rawSupply = result.envelope.payload.rawSupply ?? state.rawSupply;
      state.decimals = result.envelope.payload.decimals ?? state.decimals;
      await appendMarketSnapshot(tape, state, message, { clock });
    }
  }
  return result;
}

function registerCreation(message, clock) {
  if (message.txType !== 'create' || !message.mint) return;
  const solPriceUsd = 135;
  const marketCapUsd = message.marketCapSol ? Math.round(Number(message.marketCapSol) * solPriceUsd) : 4500;
  const supply = message.rawSupply ? (Number(message.rawSupply) / 1e6) : 1_000_000_000;
  const initialPriceUsd = marketCapUsd / (supply || 1_000_000_000);
  const initialLiquidityUsd = Math.round(30 * solPriceUsd);

  registerToken({
    mint: message.mint, symbol: message.symbol || '?', name: message.name || 'Unknown',
    imageUrl: isMetadataUri(message.uri) ? null : (message.uri || null), source: 'pumpfun', creator: message.traderPublicKey || null,
    createdAt: message.blockTime == null ? clock.now() : Number(message.blockTime) * 1000,
    marketCapSol: message.marketCapSol || null, initialBuySol: message.solAmount || null,
    marketCapUsd,
    priceUsd: initialPriceUsd,
    liquidityUsd: initialLiquidityUsd,
    curveTargetSol: message.curveTargetSol ?? null, rawSupply: message.rawSupply ?? null,
    decimals: message.decimals ?? null, onCurve: true,
    bondingCurveKey: message.bondingCurveKey ?? null, chain: 'solana', launchpad: 'pumpfun',
  });
  // message.uri is a metadata JSON, not an image — resolve the real image
  // asynchronously so token cards render logos instead of broken <img> tags.
  resolveImageUrl(message.uri)
    .then(image => { if (image) setTokenImage(message.mint, image); })
    .catch(() => { /* resolver caches failures; enrichment will retry */ });
}

export function startPumpFeed(tape, deps) {
  if (activeFeed) return activeFeed;
  const { baseline, budget, stats, structuralEvidence = null, clock = systemClock } = deps;
  let socket = null;
  let stopped = false;
  let reconnectDelay = 2_000;
  const tradeSubscriptions = new Set();
  const structuralState = new Map();
  const send = (method, keys) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method, ...(keys ? { keys } : {}) }));
  };
  const subs = {
    subscribeTrades(mint) { tradeSubscriptions.add(mint); send('subscribeTokenTrade', [mint]); },
    unsubscribeTrades(mint) { tradeSubscriptions.delete(mint); send('unsubscribeTokenTrade', [mint]); },
  };
  baseline.onClose = makeBaselineCloser(tape, subs, budget);

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket('wss://pumpportal.fun/api/data');
    socket.on('open', () => {
      reconnectDelay = 2_000;
      log('info', 'PumpPortal feed connected');
      send('subscribeNewToken');
      send('subscribeMigration');
      for (const mint of tradeSubscriptions) send('subscribeTokenTrade', [mint]);
    });
    socket.on('message', async (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { stats.parseFailure(); return; }
      const type = tapeType(message);
      if (!type) return;
      stats.received(type);
      if (message.blockTime != null) stats.lag(clock.now() - Number(message.blockTime) * 1000);
      if (message.txType === 'create') {
        try { registerCreation(message, clock); } catch (regErr) { log('warn', `registerCreation error: ${regErr.message}`); }
      }
      try {
        const result = await routePumpMessage({ tape, baseline, subs, budget, structuralEvidence, structuralState, clock }, message);
        if (result.appended === false && !result.invalid && !result.ignored) stats.duplicate();
      } catch (error) {
        log('warn', `PumpPortal ingestion failed: ${error.message}`);
      }
    });
    socket.on('close', () => {
      if (stopped) return;
      stats.reconnect();
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
      log('warn', `PumpPortal feed closed, reconnecting in ${delay / 1000}s`);
      setTimeout(connect, delay).unref?.();
    });
    socket.on('error', (error) => {
      log('error', `PumpPortal feed error: ${error.message}`);
      socket.close();
    });
  };
  connect();
  const tickTimer = setInterval(() => { baseline.tick().catch(error => log('warn', `Baseline tick failed: ${error.message}`)); }, 1_000);
  tickTimer.unref?.();
  activeFeed = {
    stop() { stopped = true; clearInterval(tickTimer); socket?.close(); activeFeed = null; },
  };
  return activeFeed;
}

export function stopPumpFeed() { activeFeed?.stop(); }
