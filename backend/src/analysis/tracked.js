// Tracked tier: long-horizon watchlist for sleepers, day-2 runners, slow
// climbers. Separate from the 300-cap discovery registry — never touched by
// trim(). Capacity ~100, retention up to 14 days.
//
// Auto-promotion triggers (evaluated after each analysis pass):
//   - Survived 6h with liquidity > $10k
//   - Traction score >= 60 at any pass
//   - State = curated (auto-promotes on curation)
//   - Manual pin from UI ("Track" button)
//
// Cadence tiers (for the refresh loop):
//   curated + open positions: 45s
//   tracked: 5 min
//   tracked-but-quiet-48h: 30 min
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { emit, log } from '../bus.js';

const DATA_DIR = join(process.cwd(), 'data');
const TRACKED_FILE = join(DATA_DIR, 'tracked.json');
const CAPACITY = 100;
const RETENTION_MS = 14 * 24 * 3600_000; // 14 days
const MAX_AGE_MIN = 6 * 60; // 6 hours for auto-promotion survival check
const MIN_LIQ_FOR_PROMO = 10_000;
const TRACTION_FOR_PROMO = 60;
const QUIET_HOURS = 48; // tracked-but-quiet threshold
const SAMPLE_INTERVAL_MS = 5 * 60_000; // history windows are 5-min samples

let tracked = []; // array of tracked token records
let dirty = false;
let saveTimer = null;

// --- Persistence ---
function loadTracked() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const raw = readFileSync(TRACKED_FILE, 'utf8');
    tracked = JSON.parse(raw);
    log('info', `Loaded ${tracked.length} tracked tokens from disk`);
  } catch { tracked = []; }
}

function scheduleSave() {
  if (dirty) return;
  dirty = true;
  saveTimer = setTimeout(() => {
    dirty = false;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(TRACKED_FILE, JSON.stringify(tracked, null, 2));
    } catch (err) {
      log('warn', `Failed to persist tracked tokens: ${err.message}`);
    }
  }, 5_000);
}

loadTracked();

// --- Core API ---

export function getTracked() {
  return tracked;
}

export function getTrackedByMint(mint) {
  return tracked.find(t => t.mint === mint) || null;
}

/**
 * Add a token to the tracked list. Returns null if already tracked or at capacity.
 * reason: 'auto'|'manual'|'curated' — explains why it was promoted.
 */
export function promoteToTracked(token, reason = 'auto') {
  if (tracked.find(t => t.mint === token.mint)) return null;
  if (tracked.length >= CAPACITY) {
    // Evict oldest quiet token to make room
    const evictable = tracked
      .filter(t => !t.lastWakeAt && !t.manual)
      .sort((a, b) => (a.promotedAt ?? a.createdAt) - (b.promotedAt ?? b.createdAt));
    if (evictable.length > 0) {
      const victim = evictable[0];
      tracked = tracked.filter(t => t.mint !== victim.mint);
      log('info', `Tracked evicted ${victim.symbol || victim.mint.slice(0, 8)} to make room`);
    } else {
      log('warn', 'Tracked list full, cannot promote');
      return null;
    }
  }

  const entry = {
    mint: token.mint,
    symbol: token.symbol || null,
    name: token.name || null,
    chain: token.chain || 'solana',
    promotedAt: Date.now(),
    reason,
    // Snapshot of key metrics at promotion
    priceUsd: token.priceUsd ?? null,
    liquidityUsd: token.liquidityUsd ?? null,
    tractionScore: token.traction?.tractionScore ?? null,
    // Sleeper wake tracking
    lastWakeAt: null,
    wakeCount: 0,
    // Slow-climber tracking
    climber: false,
    climberDetectedAt: null,
    // History for h1-volume rolling window (samples every 5 min, keep 6h = 72 samples)
    volumeHistory: [],
    priceHistory30m: [], // [{ts, priceUsd}] for 30m price change detection
    // Manual pin flag
    manual: reason === 'manual',
    // Quiet detection
    lastActivityAt: Date.now(),
  };

  tracked.push(entry);
  scheduleSave();
  log('info', `PROMOTED ${token.symbol || token.mint.slice(0, 8)} to tracked (${reason})`);
  emit('token:tracked', { token: entry, reason });
  return entry;
}

/**
 * Remove a token from tracked (manual unpin or expiry).
 */
export function untrack(mint) {
  const idx = tracked.findIndex(t => t.mint === mint);
  if (idx === -1) return false;
  const removed = tracked.splice(idx, 1)[0];
  scheduleSave();
  emit('token:untracked', { mint, symbol: removed.symbol });
  return true;
}

/**
 * Check if a token qualifies for auto-promotion based on registry data.
 * Called after each analysis pass in registry.js.
 */
export function evaluatePromotion(token) {
  // Already tracked or discarded? Skip.
  if (tracked.find(t => t.mint === token.mint)) return;
  if (token.state === 'discarded') return;

  // 1. Curated → auto-promote
  if (token.state === 'curated') {
    promoteToTracked(token, 'curated');
    return;
  }

  // 2. Traction score >= 60 at any pass
  if ((token.traction?.tractionScore ?? 0) >= TRACTION_FOR_PROMO) {
    promoteToTracked(token, 'traction');
    return;
  }

  // 3. Survived 6h with liquidity > $10k
  const ageMin = (Date.now() - token.createdAt) / 60_000;
  if (ageMin >= MAX_AGE_MIN && (token.liquidityUsd ?? 0) >= MIN_LIQ_FOR_PROMO) {
    promoteToTracked(token, 'survived');
    return;
  }
}

/**
 * Update tracked token with fresh market data. Returns wake event if triggered.
 * Called from the refresh loop for tracked tokens.
 */
export function updateTrackedMarket(mint, patch) {
  const entry = tracked.find(t => t.mint === mint);
  if (!entry) return null;

  // History windows are labeled in 5-min samples ("30m" = 6 samples, "6h" = 72),
  // but the refresh loop ticks every ~45s. Only record a history sample at the
  // real 5-min cadence or the windows shrink 4-8x and wake/climber detectors
  // fire on noise.
  const now = Date.now();
  const shouldSample = now - (entry.lastSampleAt ?? 0) >= SAMPLE_INTERVAL_MS;
  if (shouldSample) entry.lastSampleAt = now;

  // Update volume history (5-min samples, keep 72 = 6h)
  if (patch.volume24hUsd != null) {
    entry.volume24hUsd = patch.volume24hUsd;
    if (shouldSample) {
      entry.volumeHistory.push({ ts: now, v: patch.volume24hUsd });
      if (entry.volumeHistory.length > 72) entry.volumeHistory.shift();
    }
  }

  // Keep latest liquidity for pruning
  if (patch.liquidityUsd != null) {
    entry.currentLiquidityUsd = patch.liquidityUsd;
  }

  // Update price history for 30m change detection
  if (patch.priceUsd != null && shouldSample) {
    entry.priceHistory30m.push({ ts: now, priceUsd: patch.priceUsd });
    // Keep last 6 samples (30 min at 5-min intervals)
    if (entry.priceHistory30m.length > 6) entry.priceHistory30m.shift();
  }

  // Track activity for quiet detection
  if ((patch.volume24hUsd ?? 0) > 100 || (patch.liquidityUsd ?? 0) > 100) {
    entry.lastActivityAt = Date.now();
  }

  // --- Sleeper wake detection ---
  const wakeEvent = detectTrackedSleeperWake(entry, patch);

  // --- Slow-climber detection ---
  detectSlowClimber(entry, patch);

  scheduleSave();
  return wakeEvent;
}

/**
 * Detect sleeper wake conditions for tracked tokens:
 * - h1 volume > 3x trailing 6h average
 * - price +15% in 30 min
 * - liquidity +2x from last wake or promotion
 */
function detectTrackedSleeperWake(entry, patch) {
  if (!entry || entry.lastWakeAt && Date.now() - entry.lastWakeAt < 30 * 60_000) {
    return null; // cooldown: don't wake more than once per 30 min
  }

  const reasons = [];

  // 1. Volume spike: current h1 vol > 3x trailing 6h average
  if (entry.volumeHistory.length >= 6 && patch.volume24hUsd != null) {
    const trailing = entry.volumeHistory.slice(0, -1); // exclude current
    const avgVol = trailing.reduce((s, h) => s + h.v, 0) / trailing.length;
    if (avgVol > 0 && patch.volume24hUsd > avgVol * 3) {
      reasons.push(`volume ${(patch.volume24hUsd / avgVol).toFixed(1)}x trailing avg`);
    }
  }

  // 2. Price spike: +15% in 30 min
  if (entry.priceHistory30m.length >= 2) {
    const oldest = entry.priceHistory30m[0];
    if (oldest.priceUsd > 0 && patch.priceUsd != null) {
      const change30m = ((patch.priceUsd - oldest.priceUsd) / oldest.priceUsd) * 100;
      if (change30m >= 15) {
        reasons.push(`price +${change30m.toFixed(0)}% in 30m`);
      }
    }
  }

  // 3. Liquidity spike: 2x from promotion price
  if (entry.priceUsd > 0 && patch.liquidityUsd != null && entry.liquidityUsd != null) {
    if (patch.liquidityUsd > entry.liquidityUsd * 2) {
      reasons.push(`liquidity 2x from entry`);
      // Re-anchor the baseline so this wake fires once per doubling, not every
      // cooldown forever against a stale promotion-time snapshot.
      entry.liquidityUsd = patch.liquidityUsd;
    }
  }

  if (reasons.length === 0) return null;

  entry.lastWakeAt = Date.now();
  entry.wakeCount = (entry.wakeCount ?? 0) + 1;

  log('info', `TRACKED WAKE ${entry.symbol || entry.mint.slice(0, 8)} — ${reasons.join('; ')}`);
  emit('token:tracked:wake', { mint: entry.mint, symbol: entry.symbol, reasons, wakeCount: entry.wakeCount });

  return { reasons, wakeCount: entry.wakeCount };
}

/**
 * Detect slow-climber pattern: higher-low streak + positive mcap slope.
 * 6h of higher lows + positive slope → climber badge.
 */
function detectSlowClimber(entry, patch) {
  if (!entry || entry.climber) return; // already detected
  if (entry.priceHistory30m.length < 6) return; // need at least 30 min of data

  // Check for higher lows: each sample's price > previous sample's price
  const prices = entry.priceHistory30m.map(p => p.priceUsd).filter(p => p != null);
  if (prices.length < 6) return;

  let higherLows = true;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= prices[i - 1]) { higherLows = false; break; }
  }

  // Positive slope: last price > first price
  const slope = (prices[prices.length - 1] - prices[0]) / prices[0];
  const positiveSlope = slope > 0.05; // at least 5% gain over the window

  if (higherLows && positiveSlope) {
    entry.climber = true;
    entry.climberDetectedAt = Date.now();
    log('info', `CLIMBER ${entry.symbol || entry.mint.slice(0, 8)} — higher lows + positive slope`);
    emit('token:climber', { mint: entry.mint, symbol: entry.symbol });
  }
}

/**
 * Get tracked tokens that need refresh, grouped by cadence tier.
 * Returns { fast: string[], normal: string[], slow: string[] }
 */
export function getTrackedCadence() {
  const now = Date.now();
  const fast = []; // curated + positions: 45s (handled by existing refresh loop)
  const normal = []; // tracked: 5 min
  const slow = []; // tracked-but-quiet-48h: 30 min

  for (const entry of tracked) {
    const quietMs = now - (entry.lastActivityAt ?? entry.promotedAt);
    if (quietMs > QUIET_HOURS * 3600_000) {
      slow.push(entry.mint);
    } else {
      normal.push(entry.mint);
    }
  }

  return { fast, normal, slow };
}

/**
 * Prune tracked tokens older than 14 days, and evict dead tokens.
 * Dead tokens: older than 48 hours with < $1,000 volume or < $5,000 liquidity.
 */
export function pruneTracked() {
  const now = Date.now();
  const absoluteCutoff = now - RETENTION_MS;
  const deadCutoff = now - 48 * 3600_000;

  const before = tracked.length;
  tracked = tracked.filter(t => {
    // 1. Absolute expiry (except manuals)
    if (t.promotedAt <= absoluteCutoff && !t.manual) return false;
    
    // 2. Dead token eviction
    if (t.promotedAt <= deadCutoff) {
      const vol = t.volume24hUsd ?? t.volumeHistory[t.volumeHistory.length - 1]?.v ?? 0;
      const liq = t.currentLiquidityUsd ?? t.liquidityUsd ?? 0;
      if (vol < 1000 || liq < 5000) {
        return false;
      }
    }
    return true;
  });

  if (tracked.length < before) {
    log('info', `Pruned ${before - tracked.length} expired/dead tracked tokens`);
    scheduleSave();
  }
}

// Prune on import and every hour
pruneTracked();
setInterval(pruneTracked, 3600_000).unref?.();

/**
 * Manually pin a token to tracked from the UI.
 */
export function manualTrack(token) {
  const existing = tracked.find(t => t.mint === token.mint);
  if (existing) {
    existing.manual = true;
    scheduleSave();
    return existing;
  }
  return promoteToTracked(token, 'manual');
}
