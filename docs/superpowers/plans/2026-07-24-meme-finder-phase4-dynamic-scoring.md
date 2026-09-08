# Meme Finder — Phase 4: Dynamic Profiles + Scorer/Blockers/Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dynamic feature families (flow state, efficiency analogs, cohort retention, smoothed derivatives, dump detection) and the complete scoring engine (versioned CONFIG, `weightedScore`/`computeMemeScore`, hard blockers, and admission state machine) — the system can now evaluate, score, and admit tokens.

**Architecture:** Dynamic features live alongside Phase 3's structural features under `backend/src/features/` and plug into the shared `extractAllFeatures` extractor. The scoring engine lives in a new `backend/src/scoring/` module — a pure-function layer that consumes structural + dynamic feature outputs and produces a `ScoreResult` with version, breakdown, blockers, and an admission decision. Everything is deterministic and testable with plain fixtures — no RPC, no live data, no mocks for scoring. Blockers are hard vetoes that immediately change admission state. Admission is a pure function of the score result + token state, not a persistent state machine (the state machine is lifecycle management in WS9).

**Tech Stack:** Node ESM, Vitest, pg + pg-mem (from Phase 1). No new runtime deps. All scoring is pure functions.

**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` — §12.2 curve dynamic profile, §12.3.3 flow state, §12.3.4 efficiency analogs, §12.3.5 cohort retention, §12.3.6 derivatives, §13.3 dump detection, §14 score contract, §14.2 scorer, §15/§15.1 blockers, §16/§16.5 admission, §21 versioned config, §26.1 regression fixtures. Section references below point there.

**Depends on:**
- Phase 1: `docs/superpowers/plans/2026-07-24-meme-finder-phase1-event-tape.md` (tape, identity, chain-scope gate).
- Phase 2: `docs/superpowers/plans/2026-07-24-meme-finder-phase2-ingestion-snapshots.md` (`extractAllFeatures`/`causalFeatures`, `bucketize`, `initSnapshot`/`reduceSnapshot`).
- Phase 3: `docs/superpowers/plans/2026-07-24-meme-finder-phase3-structural-features.md` (all six structural feature families integrated into `extractAllFeatures`).
- Shared context: `docs/superpowers/plans/2026-07-24-memefinder-00-shared-context.md` (§8 scoring contracts, §10 regression fixtures).

---

## File Structure

**Create — Workstream 7 (dynamic profiles):**
- `backend/src/features/flowState.js` — buy/sell flow state machine with ATH freshness (§12.3.3, §13.2).
- `backend/src/features/efficiencyAnalogs.js` — post-migration volume/buyer efficiency (§12.3.4).
- `backend/src/features/cohortRetention.js` — token-unit net position retention (§12.3.5, §13.4).
- `backend/src/features/derivatives.js` — EMA-smoothed normalized velocity/acceleration (§12.3.6, §13.5).
- `backend/src/features/dumpDetect.js` — robust MAD-based lower-tail break detection (§13.3).
- `backend/src/features/__tests__/flowState.test.js`
- `backend/src/features/__tests__/efficiencyAnalogs.test.js`
- `backend/src/features/__tests__/cohortRetention.test.js`
- `backend/src/features/__tests__/derivatives.test.js`
- `backend/src/features/__tests__/dumpDetect.test.js`

**Create — Workstream 8 (scorer, blockers, admission):**
- `backend/src/scoring/config.js` — versioned CONFIG with per-regime dynamic registries (§21).
- `backend/src/scoring/computeMemeScore.js` — `weightedScore` + `computeMemeScore` (§14.2).
- `backend/src/scoring/blockers.js` — `evaluateBlockers` (§15.1).
- `backend/src/scoring/admission.js` — `admit` (§16.5).
- `backend/src/scoring/__tests__/weightedScore.test.js`
- `backend/src/scoring/__tests__/computeMemeScore.test.js`
- `backend/src/scoring/__tests__/blockers.test.js`
- `backend/src/scoring/__tests__/admission.test.js`

**Modify:**
- `backend/src/features/extract.js` — extend `extractAllFeatures` to include dynamic features (flow, efficiency, retention, derivatives, dump detection).
- `backend/src/features/__tests__/extract.test.js` — verify dynamic features appear in the output.

**Scope note (honest):** The `CONFIG` thresholds are **v1 placeholders** — they are not calibrated and the config `status` field says so. The admission paths and blocker thresholds must be versioned and calibrated before automation (Phase 6, WS12). The `flowState` function references `cfg.zeroSellDisplayCap` inside `flowSeriesFrom` — this plan includes that config. Smart-wallet lifecycle (§12.3, post-migration only) ships with zero weight and null value — the actual smart-wallet tracking infrastructure is a research deliverable deferred to WS10/later. Dump detection (§13.3) ships in this phase because blockers consume it directly.

---

## Task 1: Flow state machine (§12.3.3, §13.2)

**Files:**
- Create: `backend/src/features/flowState.js`
- Test: `backend/src/features/__tests__/flowState.test.js`

> **Spec (§12.3.3):** Labels: `INSUFFICIENT | SELL_PRESSURE | RECOVERING | STABLE_AT_HIGHS | STABLE | MIXED`. ATH freshness + minimum activity drive the machine. Zero-sell buckets capped for display but retain raw amounts. Near-empty buckets cannot become bullish.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/flowState.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { flowState, flowSeriesFrom } from '../flowState.js';

const cfg = {
  minTrades: 3, minVolLamports: 100, athNearBand: 0.05,
  zeroSellDisplayCap: 10,
};

function bucket({ buys = 5, sells = 5, buySol = 500, sellSol = 400, partial = false } = {}) {
  return { buys, sells, buySol, sellSol, partial, wallets: new Set() };
}

describe('flowSeriesFrom', () => {
  it('excludes partial buckets and computes buy/sell ratio', () => {
    const buckets = [
      bucket({ buySol: 200, sellSol: 100 }),
      bucket({ buySol: 300, sellSol: 100 }),
      bucket({ buySol: 100, sellSol: 200, partial: true }),
    ];
    const series = flowSeriesFrom(buckets, 3, cfg);
    expect(series).toHaveLength(2); // partial excluded
    expect(series[0]).toBeCloseTo(2.0); // 200/100
    expect(series[1]).toBeCloseTo(3.0); // 300/100
  });

  it('caps zero-sell buckets at configured display cap', () => {
    const buckets = [bucket({ buySol: 500, sellSol: 0 })];
    const series = flowSeriesFrom(buckets, 1, cfg);
    expect(series[0]).toBe(cfg.zeroSellDisplayCap);
  });

  it('returns 1 for zero-buy zero-sell buckets', () => {
    const buckets = [bucket({ buySol: 0, sellSol: 0 })];
    const series = flowSeriesFrom(buckets, 1, cfg);
    expect(series[0]).toBe(1);
  });
});

describe('flowState (§12.3.3)', () => {
  it('returns INSUFFICIENT with fewer than 2 active buckets', () => {
    const r = flowState({
      flowSeries: [2.0], athDistance: 0.1, athAgeMs: 5000,
      buckets: [bucket()],
    }, cfg);
    expect(r.label).toBe('INSUFFICIENT');
    expect(r.bullish).toBeNull();
  });

  it('returns SELL_PRESSURE when last two flow ratios are below 1', () => {
    const r = flowState({
      flowSeries: [1.2, 0.8, 0.7], athDistance: 0.3, athAgeMs: 10000,
      buckets: [bucket(), bucket(), bucket()],
    }, cfg);
    expect(r.label).toBe('SELL_PRESSURE');
    expect(r.bullish).toBe(false);
  });

  it('returns RECOVERING when away from ATH with improving positive flow', () => {
    const r = flowState({
      flowSeries: [0.5, 1.2, 1.5], athDistance: 0.20, athAgeMs: 60000,
      buckets: [bucket(), bucket(), bucket()],
    }, cfg);
    expect(r.label).toBe('RECOVERING');
    expect(r.bullish).toBe(true);
  });

  it('returns STABLE_AT_HIGHS when near ATH and all flows positive', () => {
    const r = flowState({
      flowSeries: [1.5, 2.0, 1.8], athDistance: 0.02, athAgeMs: 5000,
      buckets: [bucket(), bucket(), bucket()],
    }, cfg);
    expect(r.label).toBe('STABLE_AT_HIGHS');
    expect(r.bullish).toBe(true);
  });

  it('returns STABLE when all positive but not near ATH', () => {
    const r = flowState({
      flowSeries: [1.5, 2.0, 1.8], athDistance: 0.15, athAgeMs: 30000,
      buckets: [bucket(), bucket(), bucket()],
    }, cfg);
    expect(r.label).toBe('STABLE');
    expect(r.bullish).toBe(true);
  });

  it('returns MIXED when flow is inconsistent', () => {
    const r = flowState({
      flowSeries: [1.5, 0.8, 1.2], athDistance: 0.15, athAgeMs: 30000,
      buckets: [bucket(), bucket(), bucket()],
    }, cfg);
    expect(r.label).toBe('MIXED');
    expect(r.bullish).toBeNull();
  });

  it('filters out buckets with insufficient trades or volume', () => {
    const sparse = bucket({ buys: 1, sells: 0, buySol: 10, sellSol: 0 }); // below minimums
    const r = flowState({
      flowSeries: [2.0, 1.5, 1.2], athDistance: 0.1, athAgeMs: 5000,
      buckets: [sparse, bucket()], // only 1 active
    }, cfg);
    expect(r.label).toBe('INSUFFICIENT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/flowState.test.js`
Expected: FAIL — cannot resolve `../flowState.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/flowState.js`:
```js
// Flow state machine: buy/sell ratio + ATH freshness + minimum activity. (§12.3.3, §13.2)
// Labels: INSUFFICIENT | SELL_PRESSURE | RECOVERING | STABLE_AT_HIGHS | STABLE | MIXED

export function flowState({ flowSeries, athDistance, athAgeMs, buckets }, cfg) {
  const active = buckets.slice(-flowSeries.length).filter(b =>
    !b.partial && (b.buys + b.sells) >= cfg.minTrades && (b.buySol + b.sellSol) >= cfg.minVolLamports);
  if (active.length < 2) return { label: 'INSUFFICIENT', bullish: null };  // near-empty ≠ bullish

  const last = flowSeries.at(-1), prev = flowSeries.at(-2);
  const allPositive = flowSeries.every(f => f > 1);
  if (last < 1 && prev < 1)                                   return { label: 'SELL_PRESSURE', bullish: false };
  if (athDistance > cfg.athNearBand && last > 1 && last >= prev)
                                                               return { label: 'RECOVERING', bullish: true };
  if (athDistance <= cfg.athNearBand && allPositive)            return { label: 'STABLE_AT_HIGHS', bullish: true };
  if (allPositive)                                             return { label: 'STABLE', bullish: true };
  return { label: 'MIXED', bullish: null };
}

export function flowSeriesFrom(buckets, n, cfg) {
  return buckets.filter(b => !b.partial).slice(-n).map(b =>
    b.sellSol === 0 ? (b.buySol > 0 ? cfg.zeroSellDisplayCap : 1) : b.buySol / b.sellSol); // raw retained upstream
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/flowState.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/flowState.js backend/src/features/__tests__/flowState.test.js
git commit -m "feat(features): flowState — ATH-aware flow state machine (§12.3.3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Efficiency analogs — post-migration volume/buyer metrics (§12.3.4)

**Files:**
- Create: `backend/src/features/efficiencyAnalogs.js`
- Test: `backend/src/features/__tests__/efficiencyAnalogs.test.js`

> **Spec (§12.3.4):** Post-migration SOL-raised is ~constant across graduates → the paper's headline predictor collapses. These are its live equivalents; within-cohort predictive power is an open empirical question.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/efficiencyAnalogs.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { efficiencyAnalogs, mcapPerNewBuyer } from '../efficiencyAnalogs.js';

describe('efficiencyAnalogs (§12.3.4)', () => {
  it('computes volPerTrade and volPerBuyer from the last non-partial bucket', () => {
    const buckets = [
      { buySol: 200, sellSol: 100, buys: 4, sells: 2, wallets: 3, partial: false },
      { buySol: 500, sellSol: 300, buys: 10, sells: 5, wallets: 8, partial: false },
    ];
    const r = efficiencyAnalogs(buckets);
    // Last bucket: vol = 800, trades = 15 → 53.33; buySol = 500 / 8 wallets = 62.5
    expect(r.volPerTrade).toBeCloseTo(800 / 15);
    expect(r.volPerBuyer).toBeCloseTo(500 / 8);
  });

  it('returns null values when the last non-partial bucket has no activity', () => {
    const buckets = [
      { buySol: 0, sellSol: 0, buys: 0, sells: 0, wallets: 0, partial: false },
    ];
    const r = efficiencyAnalogs(buckets);
    expect(r.volPerTrade).toBeNull();
    expect(r.volPerBuyer).toBeNull();
  });

  it('skips partial buckets to find the last complete one', () => {
    const buckets = [
      { buySol: 100, sellSol: 50, buys: 5, sells: 3, wallets: 4, partial: false },
      { buySol: 200, sellSol: 100, buys: 2, sells: 1, wallets: 2, partial: true },
    ];
    const r = efficiencyAnalogs(buckets);
    // Uses first bucket (last non-partial): vol = 150, trades = 8
    expect(r.volPerTrade).toBeCloseTo(150 / 8);
    expect(r.volPerBuyer).toBeCloseTo(100 / 4);
  });

  it('returns null values when only partial buckets exist', () => {
    const buckets = [
      { buySol: 100, sellSol: 50, buys: 5, sells: 3, wallets: 4, partial: true },
    ];
    const r = efficiencyAnalogs(buckets);
    expect(r.volPerTrade).toBeNull();
  });
});

describe('mcapPerNewBuyer (§12.3.4)', () => {
  it('computes market cap change per new buyer', () => {
    const prevSnap = { mcap: 10000 };
    const tick = { mcap: 15000 };
    const r = mcapPerNewBuyer(prevSnap, tick, 10);
    expect(r).toBeCloseTo(500);
  });

  it('returns null when there are no new buyers', () => {
    expect(mcapPerNewBuyer({ mcap: 10000 }, { mcap: 15000 }, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/efficiencyAnalogs.test.js`
Expected: FAIL — cannot resolve `../efficiencyAnalogs.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/efficiencyAnalogs.js`:
```js
// Post-migration efficiency analogs. Within-cohort predictive power is an
// OPEN empirical question — do not transplant the paper's effect size. (§12.3.4)

export function efficiencyAnalogs(buckets) {
  const w = buckets.filter(b => !b.partial).at(-1);
  if (!w || (w.buys + w.sells) === 0) return { volPerTrade: null, volPerBuyer: null };
  return {
    volPerTrade: (w.buySol + w.sellSol) / (w.buys + w.sells),
    volPerBuyer: w.buySol / Math.max(1, w.wallets),
  };
}

export function mcapPerNewBuyer(prevSnap, tick, newBuyersThisWindow) {
  return newBuyersThisWindow ? (tick.mcap - prevSnap.mcap) / newBuyersThisWindow : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/efficiencyAnalogs.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/efficiencyAnalogs.js backend/src/features/__tests__/efficiencyAnalogs.test.js
git commit -m "feat(features): efficiencyAnalogs — post-migration volume/buyer metrics (§12.3.4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Cohort retention — token-unit net positions (§12.3.5, §13.4)

**Files:**
- Create: `backend/src/features/cohortRetention.js`
- Test: `backend/src/features/__tests__/cohortRetention.test.js`

> **Spec (§12.3.5):** A wallet that sells one token is NOT a full exit. Retention uses token-unit net positions with partial/full bands. Reports cohort size, wallets fully exited, wallets partially sold, remaining token percentage.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/cohortRetention.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { cohortRetention } from '../cohortRetention.js';

const t0 = 1000; const entryMs = 5000; const checkMs = 30000;

function trade(chainTs, side, wallet, rawTokens) {
  return { chainTs, side, wallet, rawTokens: BigInt(rawTokens) };
}

describe('cohortRetention (§12.3.5)', () => {
  it('returns null when cohort has fewer than 5 buyers', () => {
    const trades = [
      trade(1000, 'buy', 'w1', 100), trade(1000, 'buy', 'w2', 100),
      trade(1000, 'buy', 'w3', 100), trade(1000, 'buy', 'w4', 100),
    ];
    const bought = new Map([['w1', 100n], ['w2', 100n], ['w3', 100n], ['w4', 100n]]);
    expect(cohortRetention(trades, t0, entryMs, checkMs, bought)).toBeNull();
  });

  it('tracks fully exited wallets (sold everything)', () => {
    const trades = [
      trade(1000, 'buy', 'w1', 100), trade(1000, 'buy', 'w2', 200),
      trade(1000, 'buy', 'w3', 100), trade(1000, 'buy', 'w4', 100),
      trade(1000, 'buy', 'w5', 100),
      // w1 and w2 sell everything within checkMs
      trade(15000, 'sell', 'w1', 100), trade(15000, 'sell', 'w2', 200),
    ];
    const bought = new Map([['w1', 100n], ['w2', 200n], ['w3', 100n], ['w4', 100n], ['w5', 100n]]);
    const r = cohortRetention(trades, t0, entryMs, checkMs, bought);
    expect(r.cohortSize).toBe(5);
    expect(r.fullyExited).toBe(2);
    expect(r.partiallySold).toBe(0);
    // Remaining: w3+w4+w5 = 300 out of total 600
    expect(r.remainingTokenPct).toBeCloseTo(300 / 600);
  });

  it('tracks partially sold wallets', () => {
    const trades = [
      trade(1000, 'buy', 'w1', 100), trade(1000, 'buy', 'w2', 200),
      trade(1000, 'buy', 'w3', 100), trade(1000, 'buy', 'w4', 100),
      trade(1000, 'buy', 'w5', 100),
      // w1 sells 50 out of 100 (partial)
      trade(15000, 'sell', 'w1', 50),
    ];
    const bought = new Map([['w1', 100n], ['w2', 200n], ['w3', 100n], ['w4', 100n], ['w5', 100n]]);
    const r = cohortRetention(trades, t0, entryMs, checkMs, bought);
    expect(r.partiallySold).toBe(1);
    expect(r.fullyExited).toBe(0);
    // Remaining: 50 + 200 + 100 + 100 + 100 = 550 out of 600
    expect(r.remainingTokenPct).toBeCloseTo(550 / 600);
  });

  it('ignores sells after checkMs', () => {
    const trades = [
      trade(1000, 'buy', 'w1', 100), trade(1000, 'buy', 'w2', 100),
      trade(1000, 'buy', 'w3', 100), trade(1000, 'buy', 'w4', 100),
      trade(1000, 'buy', 'w5', 100),
      trade(t0 + checkMs + 1, 'sell', 'w1', 100), // after checkMs — ignored
    ];
    const bought = new Map([['w1', 100n], ['w2', 100n], ['w3', 100n], ['w4', 100n], ['w5', 100n]]);
    const r = cohortRetention(trades, t0, entryMs, checkMs, bought);
    expect(r.fullyExited).toBe(0);
    expect(r.remainingTokenPct).toBeCloseTo(1.0);
  });

  it('ignores sells from wallets not in the entry cohort', () => {
    const trades = [
      trade(1000, 'buy', 'w1', 100), trade(1000, 'buy', 'w2', 100),
      trade(1000, 'buy', 'w3', 100), trade(1000, 'buy', 'w4', 100),
      trade(1000, 'buy', 'w5', 100),
      trade(15000, 'sell', 'outsider', 500), // not in cohort
    ];
    const bought = new Map([['w1', 100n], ['w2', 100n], ['w3', 100n], ['w4', 100n], ['w5', 100n]]);
    const r = cohortRetention(trades, t0, entryMs, checkMs, bought);
    expect(r.fullyExited).toBe(0);
    expect(r.remainingTokenPct).toBeCloseTo(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/cohortRetention.test.js`
Expected: FAIL — cannot resolve `../cohortRetention.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/cohortRetention.js`:
```js
// Cohort retention: token-unit net positions with partial/full bands. (§12.3.5, §13.4)
// A wallet that sells ONE token is NOT a full exit.

export function cohortRetention(trades, t0, entryMs, checkMs, rawBoughtByWallet) {
  const cohort = new Set(trades.filter(t =>
    t.side === 'buy' && t.chainTs >= t0 && t.chainTs <= t0 + entryMs).map(t => t.wallet));
  if (cohort.size < 5) return null;

  const net = new Map();  // wallet -> raw token net position at checkMs
  for (const w of cohort) net.set(w, rawBoughtByWallet.get(w) ?? 0n);
  for (const t of trades) {
    if (t.chainTs > t0 + checkMs || !cohort.has(t.wallet)) continue;
    if (t.side === 'sell') net.set(t.wallet, net.get(t.wallet) - t.rawTokens);
  }
  const positions = [...cohort].map(w => ({ w, bought: rawBoughtByWallet.get(w) ?? 0n, held: net.get(w) }));
  const fullyExited  = positions.filter(p => p.held <= 0n).length;
  const partiallySold = positions.filter(p => p.held > 0n && p.held < p.bought).length;
  const remainingRaw  = positions.reduce((s, p) => s + (p.held > 0n ? p.held : 0n), 0n);
  const boughtRaw     = positions.reduce((s, p) => s + p.bought, 0n);
  return {
    cohortSize: cohort.size, fullyExited, partiallySold,
    remainingTokenPct: boughtRaw ? Number(remainingRaw) / Number(boughtRaw) : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/cohortRetention.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/cohortRetention.js backend/src/features/__tests__/cohortRetention.test.js
git commit -m "feat(features): cohortRetention — token-unit net positions, partial/full bands (§12.3.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Smoothed derivatives — EMA velocity/acceleration (§12.3.6, §13.5)

**Files:**
- Create: `backend/src/features/derivatives.js`
- Test: `backend/src/features/__tests__/derivatives.test.js`

> **Spec (§12.3.6):** Velocity/acceleration are normalized percentage change per MINUTE, not raw units per millisecond. EMA parameters are versioned config. No jerk (third derivative out of scope).

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/derivatives.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { DerivativeTracker } from '../derivatives.js';

describe('DerivativeTracker (§12.3.6)', () => {
  it('initializes level on first update, velocity and acceleration are 0', () => {
    const d = new DerivativeTracker(0.3);
    const s = d.update(1000, 60_000);
    expect(s.level).toBe(1000);
    expect(s.velocity).toBe(0);
    expect(s.acceleration).toBe(0);
  });

  it('computes normalized percentage change per minute', () => {
    const d = new DerivativeTracker(1.0); // alpha=1 → no smoothing (raw)
    d.update(1000, 60_000);
    const s = d.update(1100, 60_000); // +10% in 1 minute
    expect(s.velocity).toBeCloseTo(0.1); // 10% per minute
  });

  it('EMA smooths velocity over multiple updates', () => {
    const d = new DerivativeTracker(0.5);
    d.update(1000, 60_000);
    d.update(1100, 60_000); // +10%
    const s = d.update(1100, 60_000); // 0% change
    // Velocity should have decayed toward 0 due to EMA
    expect(s.velocity).toBeLessThan(0.1);
    expect(s.velocity).toBeGreaterThan(0);
  });

  it('handles zero dtMs gracefully (returns current state unchanged)', () => {
    const d = new DerivativeTracker(0.3);
    d.update(100, 60_000);
    const before = d.state();
    const after = d.update(200, 0);
    expect(after).toEqual(before); // no update
  });

  it('handles null value gracefully', () => {
    const d = new DerivativeTracker(0.3);
    d.update(100, 60_000);
    const before = d.state();
    const after = d.update(null, 60_000);
    expect(after).toEqual(before);
  });

  it('computes acceleration as change in velocity per minute', () => {
    const d = new DerivativeTracker(1.0); // no smoothing
    d.update(1000, 60_000);
    d.update(1100, 60_000); // vel = 0.1
    const s = d.update(1250, 60_000); // vel = ~0.136 (150/1100 per min), acc = vel change
    expect(s.acceleration).not.toBe(0);
  });

  it('level follows EMA of the input', () => {
    const d = new DerivativeTracker(0.5);
    d.update(100, 60_000);
    d.update(200, 60_000);
    // Level should be EMA: 0.5 * 200 + 0.5 * 100 = 150
    expect(d.state().level).toBeCloseTo(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/derivatives.test.js`
Expected: FAIL — cannot resolve `../derivatives.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/derivatives.js`:
```js
// EMA-smoothed normalized percentage velocity and acceleration per MINUTE. (§12.3.6, §13.5)
// No jerk (third derivatives are out of scope). Parameters live in versioned config.

export class DerivativeTracker {
  constructor(alpha) { this.a = alpha; this.level = null; this.vel = 0; this.acc = 0; }

  update(x, dtMs) {                                   // x is a level (mcap, flow, unique buyers)
    if (dtMs <= 0 || x == null) return this.state();
    const dtMin = dtMs / 60_000;
    if (this.level === null || this.level === 0) { this.level = x; return this.state(); }
    const rawVel = ((x - this.level) / this.level) / dtMin;   // % change per MINUTE, normalized
    const vel = this.a * rawVel + (1 - this.a) * this.vel;
    const rawAcc = (vel - this.vel) / dtMin;
    this.acc = this.a * rawAcc + (1 - this.a) * this.acc;
    this.vel = vel; this.level = this.a * x + (1 - this.a) * this.level;
    return this.state();
  }

  state() { return { level: this.level, velocity: this.vel, acceleration: this.acc }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/derivatives.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/derivatives.js backend/src/features/__tests__/derivatives.test.js
git commit -m "feat(features): DerivativeTracker — EMA velocity/acceleration per minute (§12.3.6)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Dump detection — robust MAD lower-tail break (§13.3)

**Files:**
- Create: `backend/src/features/dumpDetect.js`
- Test: `backend/src/features/__tests__/dumpDetect.test.js`

> **Spec (§13.3):** Operates causally on trade-level log returns. Baseline from 30–200 swaps. Median + MAD → robust sigma. Flag when return falls below `median − k·sigma`. Zero-MAD and sparse-price cases require **explicit fallback** and cannot silently produce a block. The 4σ rule (paper) vs 6σ are both preserved as versioned candidates.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/dumpDetect.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { detectDump } from '../dumpDetect.js';

const cfg = { minBaseline: 30, maxBaseline: 200, madK: 4, madScale: 1.4826 };

function pricesOf(values) {
  // Convert prices to sequential trade-like objects
  return values.map((p, i) => ({ chainTs: i * 1000, price: p }));
}

describe('detectDump (§13.3)', () => {
  it('returns null when fewer than minBaseline prices exist', () => {
    const prices = pricesOf(Array.from({ length: 20 }, () => 100));
    expect(detectDump(prices, cfg)).toBeNull();
  });

  it('detects a large dump (4-sigma lower-tail break)', () => {
    // 50 stable prices around 100, then a massive drop
    const stable = Array.from({ length: 50 }, () => 100 + Math.sin(0) * 0.01);
    const prices = pricesOf([...stable, 20]); // 80% drop
    const r = detectDump(prices, cfg);
    expect(r).not.toBeNull();
    expect(r.confirmed).toBe(true);
    expect(r.triggerIndex).toBe(50);
    expect(r.baselineSize).toBe(50);
  });

  it('does NOT flag normal price variations', () => {
    // Gentle upward trend with small noise
    const prices = pricesOf(Array.from({ length: 60 }, (_, i) => 100 + i * 0.5));
    const r = detectDump(prices, cfg);
    expect(r === null || r.confirmed === false).toBe(true);
  });

  it('handles zero-MAD case gracefully (all identical prices)', () => {
    // 50 identical prices then a 5% dip — should NOT silently block
    const prices = pricesOf([...Array.from({ length: 50 }, () => 100), 95]);
    const r = detectDump(prices, cfg);
    // Zero MAD → fallback: not a confirmed dump unless the drop exceeds the floor
    expect(r === null || r.zeroMadFallback === true).toBe(true);
  });

  it('attaches evidence to the result', () => {
    const stable = Array.from({ length: 50 }, () => 100);
    const prices = pricesOf([...stable, 10]); // massive dump
    const r = detectDump(prices, cfg);
    expect(r.confirmed).toBe(true);
    expect(r.baselineSize).toBeGreaterThanOrEqual(cfg.minBaseline);
    expect(r.median).toBeDefined();
    expect(r.mad).toBeDefined();
    expect(r.threshold).toBeDefined();
    expect(r.triggerReturn).toBeDefined();
  });

  it('uses at most maxBaseline recent prices for the baseline', () => {
    const prices = pricesOf([
      ...Array.from({ length: 250 }, () => 100),
      10, // dump
    ]);
    const r = detectDump(prices, cfg);
    expect(r.baselineSize).toBeLessThanOrEqual(cfg.maxBaseline);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/dumpDetect.test.js`
Expected: FAIL — cannot resolve `../dumpDetect.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/dumpDetect.js`:
```js
// Robust MAD-based lower-tail break detection on trade-level log returns. (§13.3)
// Zero-MAD and sparse-price cases have explicit fallbacks — never silently block.
// 4σ (paper) vs 6σ decided in replay — both preserved as versioned config candidates.

export function detectDump(prices, cfg) {
  if (prices.length < cfg.minBaseline + 1) return null;

  // Build baseline from preceding swaps (capped at maxBaseline)
  const baseEnd = prices.length - 1; // last price is the candidate
  const baseStart = Math.max(0, baseEnd - cfg.maxBaseline);
  const baseline = prices.slice(baseStart, baseEnd);

  // Compute log returns
  const returns = [];
  for (let i = 1; i < baseline.length; i++) {
    if (baseline[i].price > 0 && baseline[i - 1].price > 0) {
      returns.push(Math.log(baseline[i].price / baseline[i - 1].price));
    }
  }
  if (returns.length < cfg.minBaseline - 1) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(sorted.map(r => Math.abs(r - med)));

  // Current trade's log return
  const last = prices[baseEnd];
  const prev = prices[baseEnd - 1];
  if (!last.price || !prev.price) return null;
  const triggerReturn = Math.log(last.price / prev.price);

  // Zero-MAD fallback: all prices identical → any change is unusual, but we need
  // a floor to avoid blocking on trivial noise. Use a minimum 10% log-return threshold.
  if (mad === 0) {
    const zeroMadFloor = Math.log(0.5); // -0.693 → 50% drop needed to flag
    return {
      confirmed: triggerReturn < zeroMadFloor,
      zeroMadFallback: true,
      triggerReturn, median: med, mad: 0, threshold: zeroMadFloor,
      baselineSize: returns.length, triggerIndex: baseEnd,
    };
  }

  const sigma = mad * cfg.madScale; // MAD → robust sigma (1.4826 for normal)
  const threshold = med - cfg.madK * sigma;

  return {
    confirmed: triggerReturn < threshold,
    triggerReturn, median: med, mad, sigma, threshold,
    baselineSize: returns.length, triggerIndex: baseEnd, k: cfg.madK,
    zeroMadFallback: false,
  };
}

function median(arr) {
  if (!arr.length) return 0;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/dumpDetect.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/dumpDetect.js backend/src/features/__tests__/dumpDetect.test.js
git commit -m "feat(features): dumpDetect — robust MAD lower-tail break detection (§13.3)

4σ (paper) and 6σ preserved as versioned candidates. Zero-MAD fallback
prevents silent blocking on identical prices.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Integrate dynamic features into `extractAllFeatures` (§22)

**Files:**
- Modify: `backend/src/features/extract.js`
- Modify: `backend/src/features/__tests__/extract.test.js`

> **Spec (§22):** Every feature family plugs into `extractAllFeatures` — the one function called by both live and replay. Phase 4 extends it to include the dynamic block alongside the Phase 3 structural block.

- [ ] **Step 1: Write the failing test**

Update `backend/src/features/__tests__/extract.test.js` — add a new describe block:
```js
// Add to existing imports at top:
import { flowSeriesFrom } from '../flowState.js';

// Add after the structural feature tests:
describe('extractAllFeatures — dynamic features (Phase 4)', () => {
  it('includes flowState in the output', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: {
        rawSupply: '1000000000', decimals: 6, creator: 'dev' } }),
      ...Array.from({ length: 20 }, (_, i) => row({
        chainTs: (i + 1) * 60_000, type: EVENT_TYPES.TRADE_OBSERVED,
        payload: { side: i % 3 === 0 ? 'sell' : 'buy', wallet: `w${i}`,
                   lamports: 500, rawTokens: '1000' },
      })),
    ];
    const f = extractAllFeatures(events, { nowTs: 25 * 60_000, windowMs: 60_000 });
    expect(f.dynamic).toBeDefined();
    expect(f.dynamic.flowState).toBeDefined();
    expect(f.dynamic.flowState.label).toBeDefined();
  });

  it('includes efficiency analogs from the last complete bucket', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: {
        rawSupply: '1000000000', decimals: 6 } }),
      ...Array.from({ length: 10 }, (_, i) => row({
        chainTs: (i + 1) * 10_000, type: EVENT_TYPES.TRADE_OBSERVED,
        payload: { side: 'buy', wallet: `w${i}`, lamports: 200, rawTokens: '100' },
      })),
    ];
    const f = extractAllFeatures(events, { nowTs: 300_000, windowMs: 60_000 });
    expect(f.dynamic.efficiency).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/extract.test.js`
Expected: FAIL — `f.dynamic` is undefined.

- [ ] **Step 3: Update extract.js to include dynamic features**

Modify `backend/src/features/extract.js` — add dynamic feature imports and assemble the dynamic block:
```js
import { EVENT_TYPES } from '../tape/identity.js';
import { bucketize } from './windows.js';
import { initSnapshot, reduceSnapshot } from './snapshots.js';
import { capitalFormation } from './capitalFormation.js';
import { nonBotShare } from './nonBotShare.js';
import { flowState, flowSeriesFrom } from './flowState.js';
import { efficiencyAnalogs } from './efficiencyAnalogs.js';
import { cohortRetention } from './cohortRetention.js';
import { DerivativeTracker } from './derivatives.js';

// The default experimental classifier — zero weight, no blocking.
const EXPERIMENTAL_CLASSIFIER = {
  version: 'v0-experimental', status: 'experimental',
  precision: null, recall: null, isFrontendRouted: () => false,
};

// Default flow config — overridden from CONFIG in production.
const DEFAULT_FLOW_CFG = {
  minTrades: 3, minVolLamports: 100, athNearBand: 0.05,
  zeroSellDisplayCap: 10, flowSeriesLen: 4,
  cohortEntryMs: 5 * 60_000, cohortCheckMs: 15 * 60_000,
  emaAlpha: 0.3,
};

// ONE extractor shared by live and replay (CI enforces the same reference — §22).
export function extractAllFeatures(events, opts) {
  const windowMs = opts?.windowMs ?? 60_000;
  const nowTs = opts?.nowTs ?? 0;
  const curveTargetSol = opts?.curveTargetSol ?? 85_000_000_000;
  const flowCfg = opts?.flowCfg ?? DEFAULT_FLOW_CFG;

  const createdEvt = events.find(e => e.type === EVENT_TYPES.TOKEN_CREATED);
  const migrationEvt = events.find(e => e.type === EVENT_TYPES.MIGRATION_OBSERVED);
  const baselineEvt = events.find(e => e.type === EVENT_TYPES.BASELINE_CLOSED);

  const trades = events
    .filter(e => e.type === EVENT_TYPES.TRADE_OBSERVED)
    .map(e => ({ chainTs: e.chain_ts, side: e.payload.side, wallet: e.payload.wallet,
                 solLamports: e.payload.lamports, rawTokens: BigInt(e.payload.rawTokens ?? 0) }));

  const fromTs = createdEvt?.chain_ts ?? (trades[0]?.chainTs ?? 0);
  const buckets = bucketize(trades, windowMs, fromTs, nowTs, nowTs);

  // --- Structural features (Phase 3) ---
  const capForm = capitalFormation(trades, curveTargetSol);
  const botShare = nonBotShare(trades, opts?.classifier ?? EXPERIMENTAL_CLASSIFIER);
  const structural = {
    capitalFormation: capForm,
    nonBotShare: botShare,
    funderGraph: opts?.funderGraph ?? null,
    topHolders: opts?.topHolders ?? null,
    freshWallets: opts?.freshWallets ?? null,
    devFingerprint: opts?.devFingerprint ?? null,
  };

  // --- Dynamic features (Phase 4) ---
  // Flow state
  const flowSeries = flowSeriesFrom(buckets, flowCfg.flowSeriesLen ?? 4, flowCfg);
  const snapshot = migrationEvt
    ? initSnapshot({ mcap: migrationEvt.payload.anchorMcap, ts: migrationEvt.chain_ts })
    : null;
  const flow = flowState({
    flowSeries,
    athDistance: snapshot?.athDistance ?? 0,
    athAgeMs: snapshot ? nowTs - snapshot.athTs : 0,
    buckets,
  }, flowCfg);

  // Efficiency analogs
  const efficiency = efficiencyAnalogs(buckets);

  // Cohort retention — build rawBoughtByWallet from buy trades
  const rawBought = new Map();
  for (const t of trades) {
    if (t.side === 'buy') rawBought.set(t.wallet, (rawBought.get(t.wallet) ?? 0n) + t.rawTokens);
  }
  const retention = cohortRetention(
    trades, fromTs, flowCfg.cohortEntryMs ?? 5 * 60_000,
    flowCfg.cohortCheckMs ?? 15 * 60_000, rawBought);

  // Derivatives — track mcap velocity if snapshot exists
  const derivativesState = opts?.derivativesState ?? null;

  const dynamic = {
    flowState: flow,
    flowSeries,
    efficiency,
    retention,
    snapshot,
    derivatives: derivativesState,        // caller provides stateful tracker result
    smartLifecycleScore: null,             // deferred — zero weight until infrastructure exists
  };

  return {
    created: createdEvt?.payload ?? null,
    baseline: baselineEvt?.payload ?? null,
    trades, buckets,
    migrated: !!migrationEvt,
    snapshot,
    structural,
    dynamic,
  };
}

// Causal read: chain_ts <= asOf, nothing later. Same extractor as production. (§19.1)
export async function causalFeatures(tape, assetKey, asOf, opts) {
  const events = await tape.eventsUntil(assetKey, asOf);
  return extractAllFeatures(events, { nowTs: asOf, ...opts });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/extract.test.js`
Expected: PASS — all Phase 2, Phase 3, and Phase 4 tests.

- [ ] **Step 5: Run parity invariant**

Run: `cd backend && npx vitest run src/features/__tests__/parity.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/features/extract.js backend/src/features/__tests__/extract.test.js
git commit -m "feat(features): integrate dynamic features into extractAllFeatures (§22)

flowState, efficiencyAnalogs, cohortRetention added to the shared extractor.
Derivatives and smartLifecycle provided via opts (stateful/deferred).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Versioned scoring config (§21)

**Files:**
- Create: `backend/src/scoring/config.js`
- Test: `backend/src/scoring/__tests__/config.test.js`

> **Spec (§21):** Everything tunable lives in one versioned config. Separate curve vs post-migration dynamic registries. Fractions in `[0,1]`. MAD candidates preserved. Status string forbids automation.

- [ ] **Step 1: Write the failing test**

Create `backend/src/scoring/__tests__/config.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../config.js';

describe('CONFIG (§21)', () => {
  it('has a version string matching the meme-score pattern', () => {
    expect(CONFIG.version).toMatch(/^meme-score-v\d+\.\d+\.\d+$/);
  });

  it('status declares thresholds are NOT calibrated', () => {
    expect(CONFIG.status).toMatch(/NOT calibrated/i);
  });

  it('has separate dynamic weight registries for pump-curve and post-migration', () => {
    expect(CONFIG.dynamic['pump-curve']).toBeDefined();
    expect(CONFIG.dynamic['post-migration']).toBeDefined();
    expect(CONFIG.dynamic['pump-curve'].weights).not.toEqual(CONFIG.dynamic['post-migration'].weights);
  });

  it('disabled structural features have weight 0', () => {
    expect(CONFIG.structural.weights.creatorInitialBuy).toBe(0);
    expect(CONFIG.structural.weights.rawFreshCount).toBe(0);
    expect(CONFIG.structural.weights.smartPresence).toBe(0);
  });

  it('enabled structural weights sum to ~0.90', () => {
    const w = CONFIG.structural.weights;
    const enabled = Object.entries(w).filter(([, v]) => v > 0);
    const sum = enabled.reduce((s, [, v]) => s + v, 0);
    expect(sum).toBeCloseTo(0.90, 1);
  });

  it('blocker thresholds are fractions in [0,1]', () => {
    const B = CONFIG.blockers;
    expect(B.liquidityCollapseFrac).toBeGreaterThan(0);
    expect(B.liquidityCollapseFrac).toBeLessThanOrEqual(1);
    expect(B.farmFrac).toBeGreaterThan(0);
    expect(B.farmFrac).toBeLessThanOrEqual(1);
    expect(B.devConcentrationFrac).toBeGreaterThan(0);
    expect(B.devConcentrationFrac).toBeLessThanOrEqual(1);
    expect(B.nonBotMinShare).toBeGreaterThan(0);
    expect(B.nonBotMinShare).toBeLessThanOrEqual(1);
  });

  it('preserves both MAD-k candidates for replay comparison', () => {
    expect(CONFIG.blockers.madKCandidates).toEqual(expect.arrayContaining([4, 6]));
  });

  it('admission thresholds are defined for combined, momentum, and provisional', () => {
    expect(CONFIG.admission.combined).toBeDefined();
    expect(CONFIG.admission.momentum).toBeDefined();
    expect(CONFIG.admission.provisional).toBeDefined();
    expect(CONFIG.admission.provisional.ttlMs).toBeGreaterThan(0);
  });

  it('policy has evalHorizonMs and positiveReturn', () => {
    expect(CONFIG.policy.evalHorizonMs).toBe(6 * 3600_000);
    expect(CONFIG.policy.positiveReturn).toBe(0.50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/scoring/__tests__/config.test.js`
Expected: FAIL — cannot resolve `../config.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/scoring/config.js`:
```js
// Versioned scoring configuration (§21). Everything tunable lives here.
// Separate curve vs post-migration dynamic registries. Fractions in [0,1].
// STATUS: v1-placeholder — thresholds NOT calibrated. Do not automate.
//
// SCORE-VERSION DISCIPLINE (§22): any change to feature definition/unit,
// enable/disable, normalizer, weight, blocker threshold, admission threshold,
// classifier version, schema interpretation, or label policy MUST bump CONFIG.version.

export const CONFIG = {
  version: 'meme-score-v2.0.0',
  status: 'v1-placeholder — thresholds NOT calibrated. Do not automate.',

  windows: { canonicalMs: 60_000, flowSeriesLen: 4,
             cohortEntryMs: 5 * 60_000, cohortCheckMs: [15, 30].map(m => m * 60_000) },

  structural: {
    weights: { capitalEfficiency: 0.25, milestoneSpeed: 0.10, nonBotShare: 0.20,
               bundleCluster: 0.20, top10ExLp: 0.10, devPrior: 0.05,
               // DISABLED (weight 0 → excluded from denominator):
               creatorInitialBuy: 0, rawFreshCount: 0, smartPresence: 0 },
    freshAgeMs: 72 * 3600_000, freshBoundary: [20, 60], funderLookbackMs: 24 * 3600_000,
    devConfidentN: 8, shrinkStrength: 5,
  },

  // SEPARATE registries per regime — one table cannot serve both.
  dynamic: {
    'pump-curve':     { weights: { flowState: 0.30, cohortRetention: 0.25, drawdownHealth: 0.20,
                                   uniqueParticipation: 0.15, derivatives: 0.10 }, emaAlpha: 0.3 },
    'post-migration': { weights: { flowState: 0.25, efficiencyAnalogs: 0.25, cohortRetention: 0.20,
                                   athHealth: 0.15, derivatives: 0.10, smartLifecycle: 0.05 }, emaAlpha: 0.3 },
  },

  norm: { /* placeholder ranges — replaced by time-fitted empirical bins */
    capEff: [0.05, 0.5], milestone: [30, 800], volPerTrade: [0.02, 0.4], velocity: [0, 0.01] },

  admission: {
    combined:    { meme: 75, structural: 70, dynamic: 60, coverage: 75 },
    momentum:    { meme: 70, structural: 70, dynamic: 50, coverage: 70 },
    provisional: { minSwaps: 10, ttlMs: 10 * 60_000 },
  },

  blockers: { liquidityCollapseFrac: 0.70, farmFrac: 0.50, devConcentrationFrac: 0.20,
              nonBotMinShare: 0.30,
              honeypotMaxChecks: 5, honeypotStaleMs: 10 * 60_000, // bound recheck livelock → BAD_DATA
              madK: 4, madKCandidates: [4, 6] },   // 4σ (paper) vs 6σ decided in replay

  policy: { maxEntryDecayFrac: 0.05, exitLadder: [[2.0, 0.5], [4.0, 0.25]],
            evalHorizonMs: 6 * 3600_000, positiveReturn: 0.50, mcapTarget: 500_000 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/scoring/__tests__/config.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scoring/config.js backend/src/scoring/__tests__/config.test.js
git commit -m "feat(scoring): versioned CONFIG — per-regime weights, placeholder thresholds (§21)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `weightedScore` + `computeMemeScore` (§14.2)

**Files:**
- Create: `backend/src/scoring/computeMemeScore.js`
- Test: `backend/src/scoring/__tests__/weightedScore.test.js`
- Test: `backend/src/scoring/__tests__/computeMemeScore.test.js`

> **Spec (§14.2):** `weightedScore` returns breakdown (per-family value + contribution). Disabled features excluded from denominator. Missing data → `null` (unknown ≠ zero). EVM/non-Pump.fun returns `unscored`. `memeScore = 0.60·structural + 0.40·dynamic`. Uses `evaluateBlockers` (Task 9), so import it. **Shared context §10** has the regression fixtures.

- [ ] **Step 1: Write the `weightedScore` test**

Create `backend/src/scoring/__tests__/weightedScore.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { weightedScore, norm, normInv, inv } from '../computeMemeScore.js';

describe('weightedScore (§14.2)', () => {
  it('computes weighted mean over available, enabled inputs', () => {
    const r = weightedScore([
      { key: 'a', value: 0.8, weight: 0.5 },
      { key: 'b', value: 0.6, weight: 0.5 },
    ]);
    expect(r.score).toBe(Math.round(100 * (0.8 * 0.5 + 0.6 * 0.5)));
    expect(r.coverage).toBe(1);
  });

  it('excludes disabled features (weight 0) from both score and denominator', () => {
    const r = weightedScore([
      { key: 'a', value: 0.8, weight: 0.5 },
      { key: 'disabled', value: 0.1, weight: 0 }, // DISABLED → ignored entirely
    ]);
    expect(r.score).toBe(Math.round(100 * 0.8)); // only 'a' contributes
    expect(r.coverage).toBe(1); // 'disabled' not in denominator
    expect(r.breakdown.disabled).toBeUndefined();
  });

  it('missing values (null) lower coverage, not score', () => {
    const withAll = weightedScore([
      { key: 'a', value: 0.8, weight: 0.5 },
      { key: 'b', value: 0.6, weight: 0.5 },
    ]);
    const withMissing = weightedScore([
      { key: 'a', value: 0.8, weight: 0.5 },
      { key: 'b', value: null, weight: 0.5 },
    ]);
    expect(withMissing.coverage).toBeLessThan(withAll.coverage);
    expect(withMissing.score).toBe(Math.round(100 * 0.8)); // only 'a'
  });

  it('returns { score: null, coverage: 0, breakdown: {} } when all inputs are null', () => {
    const r = weightedScore([
      { key: 'a', value: null, weight: 0.5 },
      { key: 'b', value: null, weight: 0.5 },
    ]);
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.breakdown).toEqual({});
  });

  it('returns breakdown with per-family value and contribution', () => {
    const r = weightedScore([
      { key: 'a', value: 0.8, weight: 0.6 },
      { key: 'b', value: 0.4, weight: 0.4 },
    ]);
    expect(r.breakdown.a.value).toBe(0.8);
    expect(r.breakdown.a.weight).toBe(0.6);
    expect(r.breakdown.a.contribution).toBeCloseTo(0.8 * 0.6);
    expect(r.breakdown.b.value).toBe(0.4);
  });
});

describe('normalizers (§14.2)', () => {
  it('norm clamps to [0,1]', () => {
    expect(norm(0.3, [0.1, 0.5])).toBeCloseTo(0.5);
    expect(norm(0.0, [0.1, 0.5])).toBe(0);
    expect(norm(1.0, [0.1, 0.5])).toBe(1);
    expect(norm(null, [0, 1])).toBeNull();
  });
  it('inv flips: 1 - v', () => {
    expect(inv(0.3)).toBeCloseTo(0.7);
    expect(inv(null)).toBeNull();
  });
  it('normInv inverts after normalizing', () => {
    expect(normInv(100, [50, 400])).toBeCloseTo(1 - (100 - 50) / (400 - 50));
    expect(normInv(null, [0, 1])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/scoring/__tests__/weightedScore.test.js`
Expected: FAIL — cannot resolve `../computeMemeScore.js`.

- [ ] **Step 3: Write the `computeMemeScore` test with §26.1 regression fixtures**

Create `backend/src/scoring/__tests__/computeMemeScore.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { computeMemeScore } from '../computeMemeScore.js';
import { CONFIG } from '../config.js';

const token = { assetKey: 'solana:pumpfun:MINT', chain: 'solana', launchpad: 'pumpfun',
  asOf: Date.now(), migrated: false };
const goodStructural = {
  capitalEfficiency: 0.3, milestones: { swaps_to_100pct: 200 },
  nonBotShare: 0.80, nonBotClassifierStatus: 'validated', nonBotEvidence: 'sufficient',
  maxSuspiciousComponentPct: 0.05, top10ExLpPct: 0.12,
  devFingerprint: { known: true, rugRate: 0.10, coverage: 1 },
  devHoldFrac: 0.05,
};
const goodDynamic = {
  flowState: { bullish: true }, efficiency: { volPerTrade: 0.15 },
  retention: { remainingTokenPct: 0.75 }, snapshot: { athDistance: 0.05 },
  derivatives: { velocity: 0.005 }, smartLifecycleScore: null,
  dumpConfirmed: false, liquidityDropFrac: 0.1, devSellBeforeSafeState: false,
  staleData: false, inconsistentData: false,
};

describe('computeMemeScore (§14.2)', () => {
  it('scores a supported Pump.fun token', () => {
    const r = computeMemeScore(token, goodStructural, goodDynamic);
    expect(r.status).toBe('scored');
    expect(r.version).toBe(CONFIG.version);
    expect(r.profile).toBe('pump-curve');
    expect(r.memeScore).toBeTypeOf('number');
    expect(r.structural.score).toBeTypeOf('number');
    expect(r.dynamic.score).toBeTypeOf('number');
  });

  it('returns unscored for EVM tokens', () => {
    const evm = { ...token, chain: 'ethereum', launchpad: 'uniswap' };
    const r = computeMemeScore(evm, goodStructural, goodDynamic);
    expect(r.status).toBe('unscored');
  });

  it('uses post-migration dynamic weights when token is migrated', () => {
    const migrated = { ...token, migrated: true };
    const r = computeMemeScore(migrated, goodStructural, goodDynamic);
    expect(r.profile).toBe('post-migration');
  });

  // --- §26.1 regression fixtures (shared context §10) ---
  it('REGRESSION: 51.9% farm case fires FARM blocker', () => {
    const farm = { ...goodStructural, maxSuspiciousComponentPct: 0.519 };
    const r = computeMemeScore(token, farm, goodDynamic);
    expect(r.blockers.some(b => b.code === 'FARM')).toBe(true);
  });

  it('REGRESSION: unknown ≠ zero — missing bot-share lowers coverage, not score, no BOT_FLOW', () => {
    const noBot = { ...goodStructural, nonBotShare: null, nonBotClassifierStatus: 'experimental' };
    const withBot = computeMemeScore(token, goodStructural, goodDynamic);
    const without = computeMemeScore(token, noBot, goodDynamic);
    expect(without.evidenceCoverage).toBeLessThan(withBot.evidenceCoverage);
    expect(without.blockers.some(b => b.code === 'BOT_FLOW')).toBe(false);
  });

  it('REGRESSION: disabled feature (creatorInitialBuy, weight 0) excluded from denominator', () => {
    const r = computeMemeScore(token, goodStructural, goodDynamic);
    expect(r.structural.breakdown.creatorInitialBuy).toBeUndefined();
  });

  it('REGRESSION: validated BOT_FLOW fires with nonBotShare=0.10 and 35 trades', () => {
    const botted = { ...goodStructural, nonBotShare: 0.10, nonBotClassifierStatus: 'validated',
                     nonBotEvidence: 'sufficient', classifiedTrades: 35 };
    const r = computeMemeScore(token, botted, goodDynamic);
    expect(r.blockers.some(b => b.code === 'BOT_FLOW')).toBe(true);
  });

  it('REGRESSION: experimental non-bot with 15 trades does NOT fire BOT_FLOW', () => {
    const exp = { ...goodStructural, nonBotShare: 0.05, nonBotClassifierStatus: 'experimental',
                  nonBotEvidence: 'insufficient', classifiedTrades: 15 };
    const r = computeMemeScore(token, exp, goodDynamic);
    expect(r.blockers.some(b => b.code === 'BOT_FLOW')).toBe(false);
  });
});
```

- [ ] **Step 4: Write minimal implementation**

Create `backend/src/scoring/computeMemeScore.js`:
```js
// Versioned pure scorer + weightedScore utility. (§14.2)
// SCORE-VERSION DISCIPLINE: bump CONFIG.version on any change (§22).
import { CONFIG } from './config.js';
import { evaluateBlockers } from './blockers.js';

export function computeMemeScore(token, structural, dynamic, cfg = CONFIG) {
  if (token.chain !== 'solana' || token.launchpad !== 'pumpfun')
    return { version: cfg.version, status: 'unscored', assetKey: token.assetKey,
             reason: 'no calibrated profile' };

  const profile = token.migrated ? 'post-migration' : 'pump-curve';
  const dw = cfg.dynamic[profile].weights;
  const blockers = evaluateBlockers(token, structural, dynamic, cfg);

  const structuralResult = weightedScore([
    { key: 'capitalEfficiency', value: norm(structural.capitalEfficiency, cfg.norm.capEff),       weight: cfg.structural.weights.capitalEfficiency },
    { key: 'milestoneSpeed',    value: normInv(structural.milestones?.swaps_to_100pct, cfg.norm.milestone), weight: cfg.structural.weights.milestoneSpeed },
    { key: 'nonBotShare',       value: structural.nonBotShare /* null unless validated */,         weight: cfg.structural.weights.nonBotShare },
    { key: 'bundleCluster',     value: inv(structural.maxSuspiciousComponentPct),                  weight: cfg.structural.weights.bundleCluster },
    { key: 'top10ExLp',         value: inv(structural.top10ExLpPct),                               weight: cfg.structural.weights.top10ExLp },
    { key: 'devPrior',          value: structural.devFingerprint?.known ? 1 - structural.devFingerprint.rugRate : null, weight: cfg.structural.weights.devPrior },
    // creatorInitialBuy, rawFreshCount, smartPresence: DISABLED (weight 0) → excluded from denominator.
  ]);

  const dynamicResult = weightedScore([
    { key: 'flowState',         value: dynamic.flowState?.bullish == null ? null : (dynamic.flowState.bullish ? 1 : 0), weight: dw.flowState },
    { key: 'efficiencyAnalogs', value: norm(dynamic.efficiency?.volPerTrade, cfg.norm.volPerTrade), weight: dw.efficiencyAnalogs },
    { key: 'cohortRetention',   value: dynamic.retention?.remainingTokenPct ?? null,                weight: dw.cohortRetention },
    { key: 'athHealth',         value: inv(dynamic.snapshot?.athDistance),                          weight: dw.athHealth },
    { key: 'derivatives',       value: norm(dynamic.derivatives?.velocity, cfg.norm.velocity),      weight: dw.derivatives },
    { key: 'smartLifecycle',    value: dynamic.smartLifecycleScore ?? null,                         weight: dw.smartLifecycle },
  ]);

  const memeScore = (structuralResult.score != null && dynamicResult.score != null)
    ? Math.round(0.60 * structuralResult.score + 0.40 * dynamicResult.score) : null;
  const evidenceCoverage = Math.round(
    (structuralResult.coverage * 0.60 + dynamicResult.coverage * 0.40) * 100);

  return { version: cfg.version, assetKey: token.assetKey, asOf: token.asOf, profile,
           status: 'scored', structural: structuralResult, dynamic: dynamicResult,
           memeScore, evidenceCoverage, blockers };
}

// Weighted mean over AVAILABLE, ENABLED inputs only. Missing data lowers coverage; NEVER becomes zero.
// Returns per-family breakdown so nothing downstream reads a field this function never produced.
export function weightedScore(inputs) {
  const enabled = inputs.filter(i => i.weight > 0);                 // disabled → out of denominator
  const avail = enabled.filter(i => i.value != null);
  const totalW = enabled.reduce((s, i) => s + i.weight, 0);
  if (!avail.length || totalW === 0) return { score: null, coverage: 0, breakdown: {} };
  const wSum = avail.reduce((s, i) => s + i.weight, 0);
  const score = Math.round(100 * avail.reduce((s, i) => s + i.value * i.weight, 0) / wSum);
  const breakdown = Object.fromEntries(avail.map(i =>
    [i.key, { value: i.value, weight: i.weight, contribution: i.value * i.weight / wSum }]));
  return { score, coverage: wSum / totalW, breakdown };
}

export const norm    = (v, [lo, hi]) => v == null ? null : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
export const normInv = (v, r) => v == null ? null : 1 - norm(v, r);
export const inv     = v => v == null ? null : 1 - v;
```

- [ ] **Step 5: Run both tests — expected to fail on blockers import**

Run: `cd backend && npx vitest run src/scoring/__tests__/weightedScore.test.js`
Expected: FAIL — `../blockers.js` not yet created (imported by `computeMemeScore.js`). Proceed to Task 9.

---

## Task 9: Hard blockers — `evaluateBlockers` (§15.1)

**Files:**
- Create: `backend/src/scoring/blockers.js`
- Test: `backend/src/scoring/__tests__/blockers.test.js`

> **Spec (§15.1):** Fractions standardized `[0,1]`. `BOT_FLOW` only on validated classifier with sufficient sample. `HONEYPOT` bounded — after N checks → `BAD_DATA`. Unknown evidence never creates a blocker. `DEV_SELL` present.

- [ ] **Step 1: Write the failing test**

Create `backend/src/scoring/__tests__/blockers.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { evaluateBlockers } from '../blockers.js';
import { CONFIG } from '../config.js';

const token = { asOf: Date.now(), sellRouteVerified: true };
const clean = { maxSuspiciousComponentPct: 0.05, devHoldFrac: 0.05,
                nonBotClassifierStatus: 'experimental', nonBotEvidence: 'insufficient', nonBotShare: null };
const cleanDyn = { dumpConfirmed: false, liquidityDropFrac: 0.1,
                   devSellBeforeSafeState: false, staleData: false, inconsistentData: false };

describe('evaluateBlockers (§15.1)', () => {
  it('returns empty array when no blockers fire', () => {
    const b = evaluateBlockers(token, clean, cleanDyn, CONFIG);
    expect(b).toEqual([]);
  });

  it('fires DUMP on confirmed dump', () => {
    const dyn = { ...cleanDyn, dumpConfirmed: true, dumpSigma: -5 };
    const b = evaluateBlockers(token, clean, dyn, CONFIG);
    expect(b.some(x => x.code === 'DUMP')).toBe(true);
    expect(b.find(x => x.code === 'DUMP').reversible).toBe(false);
  });

  it('fires HONEYPOT when sell route fails within bounds', () => {
    const t = { ...token, sellRouteVerified: false, sellRouteChecks: 2,
                sellRouteFirstCheckTs: token.asOf - 60_000, sellRouteVenue: 'raydium' };
    const b = evaluateBlockers(t, clean, cleanDyn, CONFIG);
    expect(b.some(x => x.code === 'HONEYPOT')).toBe(true);
    expect(b.find(x => x.code === 'HONEYPOT').reversible).toBe(true);
  });

  it('converts HONEYPOT to BAD_DATA after max checks', () => {
    const t = { ...token, sellRouteVerified: false,
                sellRouteChecks: CONFIG.blockers.honeypotMaxChecks + 1,
                sellRouteFirstCheckTs: token.asOf - 60_000, sellRouteVenue: 'raydium' };
    const b = evaluateBlockers(t, clean, cleanDyn, CONFIG);
    expect(b.some(x => x.code === 'HONEYPOT')).toBe(false);
    expect(b.some(x => x.code === 'BAD_DATA')).toBe(true);
  });

  it('fires LIQ_COLLAPSE when drop exceeds threshold', () => {
    const dyn = { ...cleanDyn, liquidityDropFrac: 0.80 };
    const b = evaluateBlockers(token, clean, dyn, CONFIG);
    expect(b.some(x => x.code === 'LIQ_COLLAPSE')).toBe(true);
  });

  it('fires BOT_FLOW only with validated classifier + sufficient evidence', () => {
    const botted = { ...clean, nonBotClassifierStatus: 'validated',
                     nonBotEvidence: 'sufficient', nonBotShare: 0.10 };
    const b = evaluateBlockers(token, botted, cleanDyn, CONFIG);
    expect(b.some(x => x.code === 'BOT_FLOW')).toBe(true);
  });

  it('does NOT fire BOT_FLOW with experimental classifier', () => {
    const exp = { ...clean, nonBotShare: 0.05 }; // experimental by default
    const b = evaluateBlockers(token, exp, cleanDyn, CONFIG);
    expect(b.some(x => x.code === 'BOT_FLOW')).toBe(false);
  });

  it('fires FARM when maxSuspiciousComponentPct exceeds threshold', () => {
    const farm = { ...clean, maxSuspiciousComponentPct: 0.55 };
    const b = evaluateBlockers(token, farm, cleanDyn, CONFIG);
    expect(b.some(x => x.code === 'FARM')).toBe(true);
  });

  it('fires DEV_CONCENTRATION when devHoldFrac exceeds threshold', () => {
    const dev = { ...clean, devHoldFrac: 0.30 };
    const b = evaluateBlockers(token, dev, cleanDyn, CONFIG);
    expect(b.some(x => x.code === 'DEV_CONCENTRATION')).toBe(true);
  });

  it('fires DEV_SELL when dev sells before safe state', () => {
    const dyn = { ...cleanDyn, devSellBeforeSafeState: true, devFirstSellMs: 5000 };
    const b = evaluateBlockers(token, clean, dyn, CONFIG);
    expect(b.some(x => x.code === 'DEV_SELL')).toBe(true);
  });

  it('fires BAD_DATA on stale or inconsistent data', () => {
    const dyn = { ...cleanDyn, staleData: true, dataIssue: 'price_stale_10m' };
    const b = evaluateBlockers(token, clean, dyn, CONFIG);
    expect(b.some(x => x.code === 'BAD_DATA')).toBe(true);
  });

  it('every blocker carries version, ts, reversible, and evidence', () => {
    const dyn = { ...cleanDyn, dumpConfirmed: true, dumpSigma: -5 };
    const b = evaluateBlockers(token, clean, dyn, CONFIG);
    const d = b.find(x => x.code === 'DUMP');
    expect(d.version).toBe(CONFIG.version);
    expect(d.ts).toBeDefined();
    expect(d.reversible).toBeDefined();
    expect(d.evidence).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/scoring/__tests__/blockers.test.js`
Expected: FAIL — cannot resolve `../blockers.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/scoring/blockers.js`:
```js
// Hard blockers: immediate vetoes with evidence. (§15.1)
// All proportions are fractions [0,1]. Unknown evidence NEVER creates a blocker.
// HONEYPOT bounded: after maxChecks → BAD_DATA (prevents livelock).
// BOT_FLOW: ONLY with validated classifier + sufficient sample.

export function evaluateBlockers(token, s, d, cfg) {
  const b = []; const B = cfg.blockers;
  const push = (code, reversible, evidence) =>
    b.push({ code, reversible, evidence, ts: token.asOf, version: cfg.version });

  if (d.dumpConfirmed) push('DUMP', false, { sigma: d.dumpSigma, k: B.madK });

  // HONEYPOT bounded: cap probes to prevent blocked/eligible livelock.
  if (token.sellRouteVerified === false) {
    if (token.sellRouteChecks < B.honeypotMaxChecks &&
        (token.asOf - token.sellRouteFirstCheckTs) < B.honeypotStaleMs)
      push('HONEYPOT', true, { venue: token.sellRouteVenue, checks: token.sellRouteChecks });
    else
      push('BAD_DATA', true, { reason: 'honeypot_unverifiable', checks: token.sellRouteChecks });
  }

  if (d.liquidityDropFrac > B.liquidityCollapseFrac) push('LIQ_COLLAPSE', false, { drop: d.liquidityDropFrac });

  // ONLY with a validated classifier AND sufficient sample. Experimental is not a block.
  if (s.nonBotClassifierStatus === 'validated' && s.nonBotEvidence === 'sufficient' &&
      s.nonBotShare < B.nonBotMinShare) push('BOT_FLOW', false, { share: s.nonBotShare });

  if (s.maxSuspiciousComponentPct > B.farmFrac) push('FARM', false, { pct: s.maxSuspiciousComponentPct });
  if (s.devHoldFrac > B.devConcentrationFrac)   push('DEV_CONCENTRATION', false, { pct: s.devHoldFrac });
  if (d.devSellBeforeSafeState)                 push('DEV_SELL', false, { ms: d.devFirstSellMs });
  if (d.staleData || d.inconsistentData)        push('BAD_DATA', true, { reason: d.dataIssue });
  return b;
}
```

- [ ] **Step 4: Run ALL scoring tests**

Run: `cd backend && npx vitest run src/scoring/__tests__/`
Expected: PASS — all `config`, `weightedScore`, `computeMemeScore`, and `blockers` tests pass now that the import chain is complete.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scoring/blockers.js backend/src/scoring/computeMemeScore.js backend/src/scoring/__tests__/
git commit -m "feat(scoring): computeMemeScore + evaluateBlockers + regression fixtures (§14.2, §15.1, §26.1)

Pure scorer with per-family breakdown, disabled-feature exclusion, and
per-regime dynamic weights. Blockers: DUMP, HONEYPOT (bounded), LIQ_COLLAPSE,
BOT_FLOW (validated-only), FARM, DEV_CONCENTRATION, DEV_SELL, BAD_DATA.
Includes all §26.1 regression fixtures verbatim.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Admission — `admit` (§16.5)

**Files:**
- Create: `backend/src/scoring/admission.js`
- Test: `backend/src/scoring/__tests__/admission.test.js`

> **Spec (§16.5):** Three paths: combined qualification, exceptional momentum (requires validated non-bot), provisional (capital efficiency + TTL). Missing classifier never enables momentum. Blockers → rejected. Unsupported → unscored. Insufficient → watching.

- [ ] **Step 1: Write the failing test**

Create `backend/src/scoring/__tests__/admission.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { admit } from '../admission.js';
import { CONFIG } from '../config.js';

function score({ status = 'scored', memeScore = 80, structural = 75, dynamic = 65,
                 coverage = 80, blockers = [], capitalEfficiency = 0.5 } = {}) {
  return {
    status, memeScore, evidenceCoverage: coverage, blockers,
    structural: { score: structural, breakdown: {
      capitalEfficiency: capitalEfficiency != null ? { value: capitalEfficiency } : undefined } },
    dynamic: { score: dynamic },
  };
}

function token({ nonBotClassifierStatus = 'experimental', nonBotShare = null,
                 classifiedTrades = 0, swapCount = 20 } = {}) {
  return { structural: { nonBotClassifierStatus, nonBotShare, classifiedTrades, swapCount } };
}

describe('admit (§16.5)', () => {
  it('returns unscored for unsupported tokens', () => {
    expect(admit(score({ status: 'unscored' }), token(), CONFIG)).toBe('unscored');
  });

  it('returns rejected when blockers are present', () => {
    expect(admit(score({ blockers: [{ code: 'DUMP' }] }), token(), CONFIG)).toBe('rejected');
  });

  it('returns watching when scores are null', () => {
    expect(admit(score({ memeScore: null }), token(), CONFIG)).toBe('watching');
  });

  it('qualifies via combined path when all thresholds are met', () => {
    expect(admit(score({ memeScore: 80, structural: 75, dynamic: 65, coverage: 80 }),
                 token(), CONFIG)).toBe('qualified');
  });

  it('returns watching when combined thresholds are not met', () => {
    expect(admit(score({ memeScore: 60, structural: 50, dynamic: 40, coverage: 50 }),
                 token(), CONFIG)).toBe('watching');
  });

  it('qualifies via momentum path with validated non-bot + high capEff', () => {
    const s = score({ memeScore: 72, structural: 72, dynamic: 55, coverage: 72,
                      capitalEfficiency: 0.95 });
    const t = token({ nonBotClassifierStatus: 'validated', nonBotShare: 0.60, classifiedTrades: 35 });
    expect(admit(s, t, CONFIG)).toBe('qualified');
  });

  it('does NOT qualify via momentum without validated classifier', () => {
    const s = score({ memeScore: 72, structural: 72, dynamic: 55, coverage: 72,
                      capitalEfficiency: 0.95 });
    const t = token({ nonBotClassifierStatus: 'experimental' });
    expect(admit(s, t, CONFIG)).not.toBe('qualified');
  });

  it('returns provisional with high capEff and sufficient swaps', () => {
    const s = score({ memeScore: 50, structural: 50, dynamic: 30, coverage: 40,
                      capitalEfficiency: 0.95 });
    const t = token({ swapCount: 15 });
    expect(admit(s, t, CONFIG)).toBe('provisional');
  });

  it('does NOT return provisional with low capEff', () => {
    const s = score({ memeScore: 50, structural: 50, dynamic: 30, coverage: 40,
                      capitalEfficiency: 0.50 });
    expect(admit(s, token(), CONFIG)).toBe('watching');
  });

  it('does NOT return provisional with insufficient swaps', () => {
    const s = score({ memeScore: 50, structural: 50, dynamic: 30, coverage: 40,
                      capitalEfficiency: 0.95 });
    const t = token({ swapCount: 5 }); // below minSwaps (10)
    expect(admit(s, t, CONFIG)).toBe('watching');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/scoring/__tests__/admission.test.js`
Expected: FAIL — cannot resolve `../admission.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/scoring/admission.js`:
```js
// Admission decision: three paths. (§16.5)
// Path 1: combined qualification (all thresholds met, no blockers)
// Path 2: exceptional momentum (high capEff + validated non-bot + classifier gate)
// Path 3: provisional (capEff only, 10-minute TTL enforced by lifecycle loop)
//
// Missing classifier never enables the momentum path.
// Provisional TTL is enforced by the caller (lifecycle/monitoring), not here.

export function admit(score, token, cfg) {
  if (score.status === 'unscored') return 'unscored';
  if (score.blockers.length) return 'rejected';
  const A = cfg.admission;
  const s = score.structural.score, d = score.dynamic.score, m = score.memeScore;
  if (s == null || d == null || m == null) return 'watching';
  const capEff = score.structural.breakdown?.capitalEfficiency?.value ?? null; // real field now

  // Path 1: combined
  if (m >= A.combined.meme && s >= A.combined.structural && d >= A.combined.dynamic &&
      score.evidenceCoverage >= A.combined.coverage) return 'qualified';

  // Path 2: exceptional momentum — requires VALIDATED bot share + min classified sample
  if (capEff != null && capEff >= 0.90 &&
      token.structural.nonBotClassifierStatus === 'validated' &&
      token.structural.nonBotShare >= 0.50 && token.structural.classifiedTrades >= 30 &&
      s >= A.momentum.structural && d >= A.momentum.dynamic &&
      m >= A.momentum.meme && score.evidenceCoverage >= A.momentum.coverage) return 'qualified';

  // Single strong metric → provisional only (short-lived; TTL enforced by lifecycle loop)
  if (capEff != null && capEff >= 0.90 && token.structural.swapCount >= A.provisional.minSwaps)
    return 'provisional';

  return 'watching';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/scoring/__tests__/admission.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scoring/admission.js backend/src/scoring/__tests__/admission.test.js
git commit -m "feat(scoring): admit — three admission paths + provisional TTL (§16.5)

Combined, momentum (classifier-gated), and provisional paths. Missing
classifier never enables momentum. Blockers immediately reject.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full regression + phase close

**Files:**
- No new files.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: all suites PASS — Phase 1 through Phase 4 tests. This includes:
- Phase 1: tape, scope, ingestion
- Phase 2: baseline, monitor, ingestionStats, mcap, windows, snapshots, extract, parity
- Phase 3: capitalFormation, nonBotShare, funderGraph, topHolders, freshWallets, devFingerprint
- Phase 4: flowState, efficiencyAnalogs, cohortRetention, derivatives, dumpDetect, config, weightedScore, computeMemeScore, blockers, admission

- [ ] **Step 2: Verify the extract.js integration**

Run: `cd backend && npx vitest run src/features/__tests__/extract.test.js`
Expected: PASS — all Phase 2 + Phase 3 + Phase 4 extractor tests.

- [ ] **Step 3: Verify the parity invariant**

Run: `cd backend && npx vitest run src/features/__tests__/parity.test.js`
Expected: PASS (2 tests) — single-extractor invariant preserved across four phases.

- [ ] **Step 4: Verify the §26.1 regression fixtures**

Run: `cd backend && npx vitest run src/scoring/__tests__/computeMemeScore.test.js`
Expected: PASS — all regression fixtures from shared context §10 pass.

- [ ] **Step 5: Commit the phase close**

```bash
git add -A
git commit -m "chore: Phase 4 complete — dynamic profiles + scorer/blockers/admission (WS7+WS8)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed)

**Spec coverage vs Phase 4 scope (§26 WS7–WS8):**
- Flow state (§12.3.3, §13.2): ATH-aware state machine, 6 labels, minimum activity guard → Task 1.
- Flow series (§12.3.3): `flowSeriesFrom` with zero-sell cap and partial exclusion → Task 1.
- Efficiency analogs (§12.3.4): vol/trade, vol/buyer, mcapPerNewBuyer → Task 2.
- Cohort retention (§12.3.5, §13.4): token-unit net positions, partial/full bands, 5-buyer minimum → Task 3.
- Smoothed derivatives (§12.3.6, §13.5): EMA velocity/acceleration per minute, no jerk → Task 4.
- Dump detection (§13.3): robust MAD lower-tail, zero-MAD fallback, k=4/6 candidates → Task 5.
- Integration into extractAllFeatures (§22 CI invariant): dynamic block added → Task 6.
- Versioned CONFIG (§21): per-regime registries, fractions, disabled features, MAD candidates → Task 7.
- `computeMemeScore` (§14.2): `weightedScore` breakdown, disabled exclusion, regime-aware → Task 8.
- `evaluateBlockers` (§15.1): all 8 blocker codes, HONEYPOT bounded, BOT_FLOW gated → Task 9.
- `admit` (§16.5): 3 paths, classifier gate, provisional TTL → Task 10.
- Regression fixtures (§26.1, shared context §10): included verbatim → Task 8.

**Deferred-by-design (called out at their tasks, not gaps):**
- Smart-wallet lifecycle (§12.3 post-migration): zero weight, null value — tracking infrastructure deferred.
- Unique participation and drawdown health (§12.2 curve-only): these pump-curve dynamic families are partially captured by flow state and retention; explicit implementations deferred to WS9/later based on replay data availability. CONFIG has placeholder weights for them.
- Score-evaluated event emission (tape.append of score results): deferred to WS9 lifecycle integration.
- Provisional TTL enforcement: the `admit` function returns `'provisional'`; the 10-minute expiry timer is lifecycle management → WS9.
- Score-prioritized monitoring queue → WS9 (Phase 5).
- UI/API → WS10 (Phase 5).
- Replay, calibration, shadow policy → WS11–WS12 (Phase 6).

**Placeholder scan:** none — every code step contains runnable code and exact commands.

**Type consistency:** `flowState`/`flowSeriesFrom`, `efficiencyAnalogs`/`mcapPerNewBuyer`, `cohortRetention`, `DerivativeTracker`, `detectDump`, `CONFIG`, `computeMemeScore`/`weightedScore`/`norm`/`normInv`/`inv`, `evaluateBlockers`, `admit` — each defined once and referenced consistently. Reuses Phase 1–3 symbols unchanged.

**Score-version note:** Phase 4 creates `CONFIG.version = 'meme-score-v2.0.0'`. Any future change to weights, thresholds, feature definitions, normalizers, or blocker rules requires a version bump per §22.
