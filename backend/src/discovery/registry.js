// Token registry with a staged lifecycle. Discovery feeds register raw
// launches here, but nothing reaches the curated feed (or the bots) until a
// token survives repeated observation:
//
//   watching --(passes quality gate)--> curated
//   watching --(rug / junk / timeout)--> discarded
//
// Each token is re-enriched and re-scored on a schedule after discovery, and
// every pass appends to token.history so traction can be measured over time.
import { emit, log } from '../bus.js';
import { enrichToken } from './enrich.js';
import { analyzeToken } from '../analysis/safety.js';
import { computeTraction } from '../analysis/traction.js';
import { evaluateToken as evaluateCustomLists } from '../analysis/customLists.js';
import { evaluatePromotion, getTrackedByMint } from '../analysis/tracked.js';
import { load, save } from '../store.js';

const MAX_TOKENS = 300;
const tokens = new Map(); // key -> token record

/**
 * Generate a unique key for a token. Solana uses mint directly,
 * EVM chains use chain:mint to avoid collisions.
 */
function tokenKey(mint, chain) {
  if (chain && chain !== 'solana') return `${chain}:${mint}`;
  return mint;
}

// --- Persistence (atomic writes + corrupt-file quarantine via store.js) ---
let dirty = false;
let saveTimer = null;

function loadTokens() {
  const arr = load('tokens', []);
  for (const t of arr) {
    // Re-key with the chain-aware key so EVM tokens don't reload under a
    // plain mint and get re-registered as a duplicate by the live feed.
    const key = t.key || tokenKey(t.mint, t.chain);
    tokens.set(key, { ...t, key, admission: t.admission ?? (t.state === 'curated' ? 'qualified' : t.state === 'discarded' ? 'rejected' : 'watching') });
  }
  if (tokens.size > 0) log('info', `Loaded ${tokens.size} tokens from disk`);
}

function scheduleSave() {
  if (dirty) return;
  dirty = true;
  saveTimer = setTimeout(() => {
    dirty = false;
    try {
      save('tokens', [...tokens.values()]);
    } catch (err) {
      log('warn', `Failed to persist tokens: ${err.message}`);
    }
  }, 5_000);
}

// Load on import
loadTokens();

// Re-analysis passes, in minutes after discovery. Pass 0 runs immediately.
// Extended schedule catches "sleeper" tokens that sleep for hours then pump.
const PASS_SCHEDULE_MIN = [0, 1, 3, 8, 15, 30, 60, 120, 240];

// Curation gate thresholds
const CURATE_MIN_SCORE = 55;
const CURATE_MIN_LIQUIDITY_USD = 5000;
const CURATE_MIN_PASSES = 2;
// Discard rules
const DISCARD_MAX_SCORE = 25;      // after >= 2 passes
const DISCARD_LIQ_DROP_PCT = 70;   // from peak = rug
const DISCARD_MAX_AGE_MIN = 360;   // 6 hours — only for tokens that NEVER showed life
// Dormant state: tokens that completed all passes but weren't curated.
// They stay in the system with lightweight monitoring — no full analysis,
// but spike detection can re-activate them days later.
const DORMANT_ACTIVITY_USD = 1000; // min volume/liquidity to qualify for dormant instead of discard

// Analysis runs sequentially with a gap between tokens: each pass makes
// several RPC calls, and public mainnet RPC rate-limits hard.
const analysisQueue = [];
let analysisRunning = false;
const ANALYSIS_GAP_MS = 1500;

export function registerToken(partial) {
  const key = tokenKey(partial.mint, partial.chain);
  if (tokens.has(key)) return;

  const token = {
    ...partial,
    key,                       // chain-aware unique key
    state: 'watching',       // watching | curated | dormant | discarded
    admission: partial.admission ?? 'watching', // backend-owned qualification status
    passes: 0,
    nextPassAt: Date.now(),  // pass 0 due immediately
    passBaseAt: Date.now(),  // anchor for pass scheduling (reset on dormant wake)
    history: [],             // [{ts, priceUsd, liquidityUsd, marketCapUsd}]
    peakLiquidityUsd: null,
    discardReason: null,
    curatedAt: null,
    priceUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
    marketCapUsd: null,
    socials: {},
    safety: null,            // { score, checks }
    traction: null,          // { tractionScore, signals, ... }
    enrichedAt: null,
    analyzedAt: null,
  };

  tokens.set(key, token);
  trim();
  scheduleSave();
  // token:new is muted to prevent frontend firehose bloat. Tokens only surface
  // via token:curated or via the tracked/dormant lifecycle.
  
  analysisQueue.push(token);
  if (analysisQueue.length > 50) {
    // Drop oldest queued token that hasn't been claimed yet (nextPassAt still set)
    const idx = analysisQueue.findIndex(t => t.nextPassAt != null);
    if (idx >= 0) analysisQueue.splice(idx, 1);
  }
  pumpAnalysisQueue();
}

async function pumpAnalysisQueue() {
  if (analysisRunning) return;
  analysisRunning = true;
  while (analysisQueue.length > 0) {
    const token = analysisQueue.pop(); // LIFO: newest tokens are most relevant
    if (!tokens.has(token.key ?? token.mint) || token.state === 'discarded') continue;
    await runPass(token);
    await new Promise(r => setTimeout(r, ANALYSIS_GAP_MS));
  }
  analysisRunning = false;
}

async function runPass(token) {
  try {
    await enrichToken(token);
  } catch (err) {
    log('warn', `enrich failed for ${token.mint}: ${err.message}`);
  }
  try {
    token.safety = await analyzeToken(token);
    token.analyzedAt = Date.now();
  } catch (err) {
    log('warn', `safety analysis failed for ${token.mint}: ${err.message}`);
  }

  token.passes += 1;
  token.history.push({
    ts: Date.now(),
    priceUsd: token.priceUsd,
    liquidityUsd: token.liquidityUsd,
    marketCapUsd: token.marketCapUsd,
  });
  if (token.history.length > 20) token.history.shift();
  if (token.liquidityUsd != null) {
    token.peakLiquidityUsd = Math.max(token.peakLiquidityUsd ?? 0, token.liquidityUsd);
  }

  token.traction = computeTraction(token);

  // Schedule the next pass, if any remain (anchor to passBaseAt, not createdAt,
  // so dormant-wake passes don't burn back-to-back)
  const next = PASS_SCHEDULE_MIN[token.passes];
  token.nextPassAt = next != null ? token.passBaseAt + next * 60_000 : null;

  evaluateLifecycle(token);
  evaluateCustomLists(token);
  evaluatePromotion(token); // Phase 2: auto-promote to tracked tier
  scheduleSave();
  const isTracked = getTrackedByMint(token.mint) != null;
  if (token.state !== 'watching' || isTracked) {
    emit('token:update', { token });
  }
}

function evaluateLifecycle(token) {
  if (token.state === 'discarded') return;
  const ageMin = (Date.now() - token.createdAt) / 60_000;
  const score = token.safety?.score ?? 0;

  if (token.isClone) {
    return discard(token, `clone of established token ${token.symbol}`);
  }

  // --- Discard rules (checked first: a rug disqualifies even a curated token) ---
  if (
    token.peakLiquidityUsd > 1000 && token.liquidityUsd != null &&
    token.liquidityUsd < token.peakLiquidityUsd * (1 - DISCARD_LIQ_DROP_PCT / 100)
  ) {
    return discard(token, `liquidity dropped >${DISCARD_LIQ_DROP_PCT}% from peak (rug signal)`);
  }
  // A missing score means the token hasn't been scored yet (out of scope for
  // safety analysis, or the analysis failed) — treat as UNKNOWN, not zero.
  // Discarding on score 0 would delete every non-pump.fun token (revivals,
  // graduations, EVM) and everything scored during an RPC outage.
  if (token.passes >= CURATE_MIN_PASSES && token.safety?.score != null && score < DISCARD_MAX_SCORE) {
    return discard(token, `safety score ${score} still below ${DISCARD_MAX_SCORE} after ${token.passes} passes`);
  }

  // --- Dormant state: token completed all passes, never curated, but showed some life ---
  // Dormant tokens stay in the system with lightweight monitoring — no full analysis,
  // but spike detection can re-activate them days later.
  if (token.state === 'watching' && token.nextPassAt == null && token.passes >= PASS_SCHEDULE_MIN.length) {
    const hasActivity = (token.volume24hUsd ?? 0) > DORMANT_ACTIVITY_USD
                     || (token.liquidityUsd ?? 0) > DORMANT_ACTIVITY_USD
                     || (token.peakLiquidityUsd ?? 0) > DORMANT_ACTIVITY_USD;
    if (hasActivity) {
      token.state = 'dormant';
      log('info', `DORMANT ${token.symbol || token.mint.slice(0, 8)} — completed passes, has activity, watching for spikes`);
      emit('token:dormant', { token });
      return; // stay in system for spike detection
    }
    // No meaningful activity — discard after timeout
    if (ageMin > DISCARD_MAX_AGE_MIN) {
      return discard(token, `no activity within ${DISCARD_MAX_AGE_MIN}min`);
    }
  }

  // --- Curation gate ---
  if (token.state === 'watching') {
    const hasLiquidity = (token.liquidityUsd ?? 0) >= CURATE_MIN_LIQUIDITY_USD;
    const notShrinking = (token.traction?.liquidityGrowthPct ?? 0) > -30 && (token.traction?.mcapGrowthPct ?? 0) > -30;

    if (score >= CURATE_MIN_SCORE && hasLiquidity && token.passes >= CURATE_MIN_PASSES && notShrinking) {
      token.state = 'curated';
      token.admission = 'qualified';
      token.curatedAt = Date.now();
      token.curatedPriceUsd = token.priceUsd ?? null;
      log('info', `CURATED ${token.symbol || token.mint.slice(0, 8)} — score ${score}, liq $${Math.round(token.liquidityUsd)}, traction ${token.traction?.tractionScore}`);
      emit('token:curated', { token });
    }
  }
}

function discard(token, reason) {
  token.state = 'discarded';
  token.admission = 'rejected';
  token.discardReason = reason;
  scheduleSave();
  emit('token:discarded', { token });
}

// Periodic tick: enqueue tokens whose next pass is due
setInterval(() => {
  const now = Date.now();
  for (const token of tokens.values()) {
    if (token.state === 'discarded') continue;
    if (token.nextPassAt != null && token.nextPassAt <= now && !analysisQueue.includes(token)) {
      token.nextPassAt = null; // claimed; runPass sets the next one
      analysisQueue.push(token);
    }
  }
  pumpAnalysisQueue();
}, 15_000).unref?.();

// Capacity applies only to records that are not protected by curation, tracking, or a position.
export function canEvict(token) {
  return !(token.state === 'curated' || token.lifecycle === 'curated' || token.tracked || token.hasOpenPosition);
}

export function selectEvictable(records, hotLimit) {
  const protectedRecords = records.filter(token => !canEvict(token));
  const evictable = records.filter(canEvict)
    .sort((a, b) => (b.safety?.score ?? b.score?.memeScore ?? -1) - (a.safety?.score ?? a.score?.memeScore ?? -1));
  return [...protectedRecords, ...evictable.slice(0, hotLimit)];
}

function trim() {
  if (tokens.size <= MAX_TOKENS) return;
  const records = [...tokens.values()].map(token => ({ ...token, tracked: token.tracked || Boolean(getTrackedByMint(token.mint)) }));
  const keep = new Set(selectEvictable(records, MAX_TOKENS).map(token => token.key));
  for (const key of tokens.keys()) if (!keep.has(key)) tokens.delete(key);
}

export function getTokens({ view = 'curated', minScore, minLiquidity, source, maxAgeMin, chain } = {}) {
  let list = [...tokens.values()];
  if (view === 'curated') list = list.filter(t => t.state === 'curated');
  else if (view !== 'discovered') list = list.filter(t => t.state !== 'discarded'); // 'all' = watching + curated + dormant
  if (source) list = list.filter(t => t.source === source);
  if (chain) list = list.filter(t => (t.chain || 'solana') === chain);
  if (minScore != null) list = list.filter(t => (t.safety?.score ?? 0) >= minScore);
  if (minLiquidity != null) list = list.filter(t => (t.liquidityUsd ?? 0) >= minLiquidity);
  if (maxAgeMin != null) {
    const cutoff = Date.now() - maxAgeMin * 60_000;
    list = list.filter(t => t.createdAt >= cutoff);
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export function getToken(mint, chain) {
  // Try chain-aware key first, then fall back to plain mint (back-compat Solana)
  const key = chain ? tokenKey(mint, chain) : mint;
  return tokens.get(key) || tokens.get(mint) || null;
}

// --- v2 hooks: refresh loop + custom lists ---

// Curated + dormant + tracked tokens (for the live-price refresh loop).
// Dormant tokens need price updates so spike detection can re-activate them.
// Tracked tokens need price updates for sleeper wake detection.
export function getCuratedTokens() {
  return [...tokens.values()].filter(t =>
    t.state === 'curated' || t.state === 'dormant' || getTrackedByMint(t.mint));
}

export function getTokenByMint(mint) {
  return tokens.get(mint) || null;
}

// Get token by chain-aware key
export function getTokenByKey(key) {
  if (String(key).startsWith('solana:')) return tokens.get(String(key).slice(7)) || null;
  return tokens.get(key) || null;
}

// Applies live market data to a token and emits token:update.
// patch: { priceUsd, liquidityUsd, marketCapUsd, volume24hUsd }
// mint can be a plain address or a chain-aware key (chain:address)
export function applyMarketPatch(mint, patch) {
  const token = tokens.get(mint) || tokens.get(tokenKey(mint, patch.chain)) || null;
  if (!token) return null;
  Object.assign(token, patch);
  token.history = token.history || [];
  token.history.push({ ts: Date.now(), priceUsd: patch.priceUsd ?? token.priceUsd,
    liquidityUsd: patch.liquidityUsd ?? token.liquidityUsd,
    marketCapUsd: patch.marketCapUsd ?? token.marketCapUsd });
  // Ring buffer: keep last 200 samples; downsample older entries (keep every 5th)
  if (token.history.length > 200) {
    const old = token.history.splice(0, token.history.length - 200);
    // Preserve early baseline by keeping every 5th old entry
    const downsampled = old.filter((_, i) => i % 5 === 0);
    token.history = [...downsampled, ...token.history];
  }
  if (patch.liquidityUsd != null) {
    token.peakLiquidityUsd = Math.max(token.peakLiquidityUsd ?? 0, patch.liquidityUsd);
  }
  scheduleSave();
  emit('token:update', { token });
  return token;
}

// Marks a curated token as rugged (liquidity collapse). Keeps it visible.
export function flagRugged(mint, reason) {
  const token = tokens.get(mint) || tokens.get(tokenKey(mint)) || null;
  if (!token || token.rugged) return null;
  token.rugged = true;
  token.ruggedReason = reason;
  scheduleSave();
  emit('token:update', { token });
  return token;
}

// Replaces a metadata-JSON uri with the resolved image URL (async resolvers).
export function setTokenImage(mint, imageUrl) {
  if (!imageUrl) return null;
  const token = tokens.get(mint) || [...tokens.values()].find(t => t.mint === mint) || null;
  if (!token || token.imageUrl === imageUrl) return token || null;
  token.imageUrl = imageUrl;
  scheduleSave();
  emit('token:update', { token });
  return token;
}
