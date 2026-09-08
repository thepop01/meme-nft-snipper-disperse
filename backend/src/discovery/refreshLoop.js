// Live-price refresh for curated tokens, custom-list matches, tracked tokens,
// and open positions. One DexScreener batch (chunked at 30 mints, 500ms
// between chunks) per tick.
//
// Phase 2 cadence tiers:
//   curated + open positions + tracked normal: 45s tick (fast path)
//   tracked-but-quiet-48h: 30 min tick (slow path)
import { emit, log } from '../bus.js';
import { pushAlert } from '../alerts.js';
import {
  getCuratedTokens, getTokenByMint, getTokenByKey, applyMarketPatch, flagRugged,
} from './registry.js';

// Maps our internal chain names to DexScreener's `chainId` slug. EVM addresses
// can collide across chains, so price refresh must filter pairs by chain.
const DEXSCREENER_CHAIN_ID = {
  solana: 'solana', monad: 'monad', robinhood: 'robinhood',
};
import { trackedMints, evaluateTokens } from '../analysis/customLists.js';
import { getPositions } from '../engine/positions.js';
import { computeTraction } from '../analysis/traction.js';
import {
  getTracked, getTrackedByMint, updateTrackedMarket, getTrackedCadence,
} from '../analysis/tracked.js';
import { applyAttentionBonus, getAttentionSignals } from '../analysis/attention.js';

const FAST_TICK_MS = 45_000;   // curated + positions + tracked normal
const SLOW_TICK_MS = 30 * 60_000; // tracked-but-quiet-48h
const CHUNK = 30;
const CHUNK_GAP_MS = 500;
const RUG_DROP_PCT = 70;
// Spike thresholds: trigger re-analysis when these are exceeded
const VOLUME_SPIKE_MULT = 3;    // 3x volume jump
const LIQ_SPIKE_MULT = 2;       // 2x liquidity jump
let fastRunning = false;
let slowRunning = false;

// A prior snapshot must be a distinct object. Comparing a mutated token to itself
// is the dormant-spike bug this guards against.
export function detectSpikeBetween(before, after, cfg = {}) {
  if (!before || !after || before === after) return false;
  const priorVolume = Number(before.volumeUsd ?? before.volume24hUsd ?? 0);
  const currentVolume = Number(after.volumeUsd ?? after.volume24hUsd ?? 0);
  return priorVolume > 0 && currentVolume / priorVolume >= (cfg.volumeRatio ?? VOLUME_SPIKE_MULT);
}

// Returns chain-aware descriptors { mint, chain } so the fetcher can filter
// DexScreener pairs by chain and processPrices can look tokens up by their
// chain-aware key (EVM tokens are keyed chain:addr, not by mint alone).
export function collectRefreshMints() {
  const out = new Map(); // key -> { mint, chain }
  const add = (mint, chain) => { if (mint) out.set(`${chain || 'solana'}:${mint}`, { mint, chain: chain || 'solana' }); };
  for (const t of getCuratedTokens()) add(t.mint, t.chain);
  for (const t of trackedMints()) add(typeof t === 'string' ? t : t.mint, typeof t === 'string' ? 'solana' : t.chain);
  for (const p of getPositions()) if (p.mint) add(p.mint, p.chain);
  return [...out.values()];
}

/**
 * Collect descriptors for the slow path (tracked-but-quiet-48h tokens).
 */
function collectSlowMints() {
  const { slow } = getTrackedCadence();
  return slow.map(m => typeof m === 'string' ? { mint: m, chain: 'solana' } : { mint: m.mint, chain: m.chain || 'solana' });
}

// Default price fetcher: DexScreener multi-token endpoint.
// `descriptors` is [{ mint, chain }]. Results carry chain back so the caller
// can patch the correct chain-aware token record.
export async function fetchPricesFromDexScreener(descriptors) {
  const mints = descriptors.map(d => d.mint);
  // Keyed by dexChain:mint — the same address can be tracked on two chains,
  // and a mint-only key silently starves one chain of all price updates.
  const descByChainMint = new Map(descriptors.map(d => [`${DEXSCREENER_CHAIN_ID[d.chain || 'solana']}:${d.mint}`, d]));
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`);
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const data = await res.json();
  const best = new Map(); // chainMint key -> highest-liquidity pair for that token+chain
  for (const pair of data.pairs || []) {
    const mint = pair.baseToken?.address;
    if (!mint) continue;
    const key = `${pair.chainId}:${mint}`;
    const desc = descByChainMint.get(key);
    if (!desc) continue; // pair from a chain we're not tracking this mint on
    const liq = pair.liquidity?.usd ?? 0;
    if (!best.has(key) || liq > (best.get(key).liquidity?.usd ?? 0)) best.set(key, pair);
  }
  return [...best.entries()].map(([key, pair]) => {
    const [dexChain, mint] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    return {
      mint,
      chain: Object.keys(DEXSCREENER_CHAIN_ID).find(c => DEXSCREENER_CHAIN_ID[c] === dexChain) || dexChain,
      priceUsd: pair.priceUsd != null ? Number(pair.priceUsd) : null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
      volume24hUsd: pair.volume?.h24 ?? null,
    };
  });
}

// Shared price processing logic
function processPrices(prices, fetchPrices) {
  const refreshed = [];
  for (const p of prices) {
    const chain = p.chain || 'solana';
    const key = chain === 'solana' ? p.mint : `${chain}:${p.mint}`;
    const existing = getTokenByKey(key) || getTokenByMint(p.mint);
    if (!existing) continue;
    // Capture values before applyMarketPatch mutates the registry token in place.
    const before = { ...existing };
    const peak = before.peakLiquidityUsd ?? 0;
    const token = applyMarketPatch(existing.key ?? p.mint, {
      priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd,
      marketCapUsd: p.marketCapUsd, volume24hUsd: p.volume24hUsd, chain,
    });
    if (!token) continue;
    // Rug detection against the pre-patch peak.
    if (!token.rugged && peak > 0 && p.liquidityUsd != null &&
        p.liquidityUsd < peak * (1 - RUG_DROP_PCT / 100)) {
      flagRugged(existing.key ?? p.mint, `liquidity -${RUG_DROP_PCT}% from peak`);
      pushAlert({
        type: 'meme', severity: 'critical',
        title: `${token.symbol || p.mint.slice(0, 6)} flagged as rugged`,
        body: `Liquidity collapsed from $${Math.round(peak)} to $${Math.round(p.liquidityUsd)}`,
      });
    }
    refreshed.push(token);

    // Phase 4: apply attention signals (boosted/profiled/socials)
    applyAttentionBonus(token);

    // Phase 2: update tracked tier market data + sleeper wake detection
    const trackedEntry = getTrackedByMint(p.mint);
    if (trackedEntry) {
      const wakeEvent = updateTrackedMarket(p.mint, {
        priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd,
        marketCapUsd: p.marketCapUsd, volume24hUsd: p.volume24hUsd,
      });
      if (wakeEvent) {
        pushAlert({
          type: 'meme', severity: 'high',
          title: `Tracked token waking: ${token.symbol || p.mint.slice(0, 6)}`,
          body: wakeEvent.reasons.join('; '),
        });
      }
    }

    // Spike detection: re-score traction and trigger re-analysis for sleepers
    detectSpike(token, before);
  }
  return refreshed;
}

// Fast tick: curated + positions + tracked normal (45s)
export async function runRefreshTick({ fetchPrices = fetchPricesFromDexScreener } = {}) {
  if (fastRunning) return;
  fastRunning = true;
  try {
    const mints = collectRefreshMints();
    const refreshed = [];
    for (let i = 0; i < mints.length; i += CHUNK) {
      const chunk = mints.slice(i, i + CHUNK);
      let prices;
      try {
        prices = await fetchPrices(chunk);
      } catch (err) {
        log('warn', `Price refresh chunk failed: ${err.message}`);
        continue;
      }
      refreshed.push(...processPrices(prices, fetchPrices));
      if (i + CHUNK < mints.length) await new Promise(r => setTimeout(r, CHUNK_GAP_MS));
    }
    evaluateTokens(refreshed, { respectCadence: true });
  } finally {
    fastRunning = false;
  }
}

// Slow tick: tracked-but-quiet-48h (30 min)
export async function runSlowRefreshTick({ fetchPrices = fetchPricesFromDexScreener } = {}) {
  if (slowRunning) return;
  slowRunning = true;
  try {
    const mints = collectSlowMints();
    if (mints.length === 0) return;
    const refreshed = [];
    for (let i = 0; i < mints.length; i += CHUNK) {
      const chunk = mints.slice(i, i + CHUNK);
      let prices;
      try {
        prices = await fetchPrices(chunk);
      } catch (err) {
        log('warn', `Slow refresh chunk failed: ${err.message}`);
        continue;
      }
      refreshed.push(...processPrices(prices, fetchPrices));
      if (i + CHUNK < mints.length) await new Promise(r => setTimeout(r, CHUNK_GAP_MS));
    }
    evaluateTokens(refreshed, { respectCadence: true });
  } finally {
    slowRunning = false;
  }
}

export function startRefreshLoop() {
  // Fast tick: 45s for curated + positions + tracked normal
  setInterval(() => runRefreshTick().catch(err =>
    log('error', `Refresh tick failed: ${err.message}`)), FAST_TICK_MS);
  // Slow tick: 30 min for tracked-but-quiet-48h
  setInterval(() => runSlowRefreshTick().catch(err =>
    log('error', `Slow refresh tick failed: ${err.message}`)), SLOW_TICK_MS);
}

// Detect sudden volume/liquidity spikes and re-trigger analysis for sleeping tokens.
function detectSpike(token, before) {
  if (!token || token.state === 'discarded') return;

  const prevVol = before?.volume24hUsd ?? 0;
  const currVol = token.volume24hUsd ?? 0;
  const prevLiq = before?.liquidityUsd ?? 0;
  const currLiq = token.liquidityUsd ?? 0;

  const volSpike = prevVol > 1000 && detectSpikeBetween(before, token, { volumeRatio: VOLUME_SPIKE_MULT });
  const liqSpike = prevLiq > 500 && currLiq > prevLiq * LIQ_SPIKE_MULT;

  if (volSpike || liqSpike) {
    // Re-score traction with fresh data
    token.traction = computeTraction(token);

    // Re-activate dormant tokens — they just woke up
    if (token.state === 'dormant') {
      token.state = 'watching';
      token.passes = 0; // reset passes for fresh evaluation
      token.passBaseAt = Date.now(); // anchor pass scheduling to wake time
      token.nextPassAt = Date.now(); // immediate re-analysis
      log('info', `SPIKE WAKE ${token.symbol || token.mint.slice(0, 8)} — dormant token re-activated`);
      emit('token:spike', { token, volSpike, liqSpike, reactivated: true });
    }

    // If still watching and now shows life, re-enqueue for analysis
    if (token.state === 'watching' && token.nextPassAt == null) {
      token.nextPassAt = Date.now(); // immediate re-analysis
      log('info', `Spike detected on ${token.symbol || token.mint.slice(0, 8)} — re-analyzing`);
      emit('token:spike', { token, volSpike, liqSpike });
    }

  }
}
