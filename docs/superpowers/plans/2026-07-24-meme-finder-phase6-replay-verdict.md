# Meme Finder — Phase 6: Replay, Labels, Shadow Policy & Go/No-Go Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop — emit the missing market-snapshot events that every value-based measurement depends on, build causal replay labels with a realistic multiplicative execution model, run a shadow policy that logs decisions without trading, and evaluate the frozen per-cohort go/no-go rule so the system can return an honest verdict on its own edge.

**Architecture:** Phase 6 completes WS11 and WS12. A new `backend/src/calibration/` module owns offline evaluation: `syntheticTape.js` generates ground-truth event streams so the harness is provable before real data accumulates; `labels.js` builds decision-aligned labels from a causal execution simulation; `metrics.js` computes EV/precision and refuses to compute Brier against a non-probability; `bootstrap.js` + `verdict.js` implement the §19.5 rule with percentile CIs and per-cohort independence; `parityCheck.js` promotes the §22 CI invariant into an operational check. `backend/src/policy/stub.js` records shadow decisions. Everything reuses the **one** extractor from Phase 2 — replay never gets its own feature path.

**Tech Stack:** Node ESM, Vitest, pg + pg-mem (from Phase 1). No new runtime deps; `supertest` already added in Phase 5.

**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` — §7.1/§7.2 labels, §9.2 event types, §19 (all: §19.1 causal replay, §19.2 labels/extractor, §19.3 splits, §19.4 metrics, §19.5 verdict rule), §20 shadow policy, §22 versioning/CI invariants, §24 observability, §25 constraints, §26.0 synthetic-tape sequencing, §27 acceptance criteria. Section references below point there.

**Depends on:**
- Phase 1: `2026-07-24-meme-finder-phase1-event-tape.md` — `Tape` (`append`/`eventsUntil`), `assetKey`, `eventId`, `EVENT_TYPES`, `validateEnvelope`, `migrate`.
- Phase 2: `2026-07-24-meme-finder-phase2-ingestion-snapshots.md` — `manualClock`, `supplyAwareMcap({rawSupply, decimals, priceUsd})`, `bucketize`, `initSnapshot`/`reduceSnapshot`, **`extractAllFeatures`/`causalFeatures` in `features/extract.js`**, `MonitorBudget.isControl`.
- Phase 3: `2026-07-24-meme-finder-phase3-structural-features.md` — structural families; `capitalFormation(trades, curveTargetSol)`.
- Phase 4: `2026-07-24-meme-finder-phase4-dynamic-scoring.md` — `CONFIG` (incl. `CONFIG.policy`), `computeMemeScore`, `evaluateBlockers`, `admit`.
- Phase 5: `2026-07-24-meme-finder-phase5-monitoring-api-ui.md` — `evaluateToken`, `prioritize`/`canEvictToken`, `QueueStats`, `createMemeFinderRouter`.
- Shared context: `2026-07-24-memefinder-00-shared-context.md` — §2 contract map, §9.2–§9.5 label/metric/policy/verdict contracts, §11 synthetic-tape insight, §12 authoring rules, §13 tape gaps.

---

## Scope, and two upstream gaps this phase must close

**In scope (WS11 + WS12):** the `market_snapshot` emitter, `curveTargetSol` capture, synthetic tape generator, causal replay labels with multiplicative execution costs, shadow policy stub, calibration metrics with a hard probability gate, bootstrap percentile CI, the per-cohort go/no-go verdict, replay/live parity as an operational check, and the shadow-run operating procedure.

**Gap A — `market_snapshot` is declared but nothing emits it (must be fixed here).** Shared-context §13 Gap 2 assigned this emitter to "WS7 Task 1", but Phase 4 (WS7+WS8) does not mention `market_snapshot` at all — it was never written. Consequence if left alone: `supplyAwareMcap` returns `null` for every token, so `y_peak_opportunity` and `y_hit_market_cap` are permanently `null`/`false`, `policyDecision`'s decay check cannot evaluate, and **the go/no-go rule would run on empty data and mechanically return NO-GO** — a false verdict that looks like a real result. Phase 6 therefore owns the emitter (Task 1). It is a genuine prerequisite of this phase, not scope creep.

**Gap B — `curveTargetSol` was defaulted, not captured.** §13 Gap 1 required extending `token_created` to `schemaVersion: 2` with `curveTargetSol`, `rawSupply`, and `decimals`. Phase 3 instead hardcoded `curveTargetSol ?? 85_000_000_000` in `extractAllFeatures`. That silently assumes every token has pump.fun's default curve target and — worse — leaves `rawSupply`/`decimals` absent, which is *also* required by `supplyAwareMcap`. Task 2 closes it properly and keeps the hardcoded default only as an explicitly-labelled fallback for pre-existing v1 events.

**Explicitly deferred (named, not omitted):**
- **No probability layer.** `calibrationTable`/`brier` are implemented but **gated**: they throw unless handed calibrated probabilities in `[0,1]` carrying an explicit `isProbability` marker. Until a calibration model exists, `evPerAlert` and `precisionAtK` are the operative metrics (§19.4).
- **No automation, ever, in this plan.** `policyDecision` returns `shadow_enter` and writes a log row. No executor, wallet, or order path is touched. The verdict function *reports* GO; a human decides what to do with it (§20, §25).
- **Monthly refit / model fitting is out of scope.** §19.3's refit cadence is an operating procedure (Task 11), not code — no model is fitted here.
- **`sell_route_check` emitter** is WS8's per §13 Gap 3. Phase 4 references it (4 mentions); Phase 6 does not re-own it. Task 6 asserts an unset `sellRouteVerified` stays `undefined` so no shadow entry is blocked by absent evidence.

---

## File Structure

**Create:**
- `backend/src/discovery/marketSnapshot.js` — `emitMarketSnapshot`: writes `market_snapshot` events (price/liquidity/interval volume/source) for hot **and control** tokens at identical depth. Closes Gap A.
- `backend/src/calibration/syntheticTape.js` — `generateScenario`: ground-truth event streams (organic pump, farm, grind, dead, right-censored) for proving the harness pre-data (§26.0).
- `backend/src/calibration/execution.js` — `simulateEntry`/`simulateExitLadder`: causal, multiplicative-cost fill model.
- `backend/src/calibration/labels.js` — `buildLabel` (§19.2) + `buildReplayFeatures` delegating to Phase 2's `causalFeatures`.
- `backend/src/calibration/metrics.js` — `precisionAtK`, `evPerAlert`, `calibrationTable`, `brier` (probability-gated), `assertProbabilities`.
- `backend/src/calibration/bootstrap.js` — `bootstrapMeanCI` with injected RNG, percentile method.
- `backend/src/calibration/verdict.js` — `evaluateVerdict` (§19.5) per cohort.
- `backend/src/calibration/parityCheck.js` — `checkParity`: live vs replay features on the control sample (§22).
- `backend/src/policy/stub.js` — `policyDecision` + `recordShadowDecision`.
- Tests: `backend/src/calibration/__tests__/{syntheticTape,execution,labels,metrics,bootstrap,verdict,parityCheck}.test.js`, `backend/src/policy/__tests__/stub.test.js`, `backend/src/discovery/__tests__/marketSnapshot.test.js`

**Modify:**
- `backend/src/tape/identity.js` — `token_created` schemaVersion 2 payload contract (Gap B).
- `backend/src/discovery/pumpfun.js` — populate `curveTargetSol`/`rawSupply`/`decimals` on creation.
- `backend/src/features/extract.js` — read `curveTargetSol` from the tape; label the hardcoded value as a v1 fallback.
- `backend/src/discovery/refreshLoop.js` — emit market snapshots from the existing price tick.
- `backend/src/config.js` — add a `calibration` block.
- `backend/src/memefinder/routes.js` — expose `GET /api/memefinder/verdict`.

---

## Task 1: Market-snapshot emitter — close Gap A (§9.2, §7.2)

**Files:**
- Create: `backend/src/discovery/marketSnapshot.js`
- Modify: `backend/src/discovery/refreshLoop.js`
- Test: `backend/src/discovery/__tests__/marketSnapshot.test.js`

> **Spec (§9.2):** `market_snapshot` carries price, market cap, liquidity, interval volume, and data source. **(§7.2):** market cap must come from supply-aware observations and must **not** be computed with a hardcoded one-billion-token supply. **(§10):** control tokens receive identical monitoring depth.
>
> The emitter stores **`priceUsd`, not a market cap**. DexScreener's `marketCapUsd` is the banned fixed-supply value (§7.2), so it is never written; consumers derive mcap via `supplyAwareMcap` using `rawSupply`/`decimals` from `token_created`. `fetchPricesFromDexScreener` (existing, `refreshLoop.js:70`) already returns `priceUsd`/`liquidityUsd`/`volume24hUsd` — this task routes that into the tape.

- [ ] **Step 1: Write the failing test**

Create `backend/src/discovery/__tests__/marketSnapshot.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { emitMarketSnapshot, snapshotPayload } from '../marketSnapshot.js';

describe('snapshotPayload (§9.2, §7.2)', () => {
  it('stores priceUsd and never a fixed-supply market cap', () => {
    const p = snapshotPayload({
      priceUsd: 0.0004, liquidityUsd: 25_000, volume24hUsd: 90_000,
      marketCapUsd: 400_000, // DexScreener's fixed-supply value — must be DROPPED (§7.2)
    }, 'dexscreener');
    expect(p.priceUsd).toBe(0.0004);
    expect(p.liquidityUsd).toBe(25_000);
    expect(p.intervalVolumeUsd).toBe(90_000);
    expect(p.source).toBe('dexscreener');
    expect(p).not.toHaveProperty('marketCapUsd');
    expect(p).not.toHaveProperty('mcap');
  });

  it('keeps missing values null rather than zero', () => {
    const p = snapshotPayload({ priceUsd: null, liquidityUsd: undefined }, 'dexscreener');
    expect(p.priceUsd).toBeNull();
    expect(p.liquidityUsd).toBeNull();
    expect(p.intervalVolumeUsd).toBeNull();
  });
});

describe('emitMarketSnapshot (§9.2, §10)', () => {
  const tape = () => ({ append: vi.fn(async () => {}) });
  const clock = { now: () => 5_000 };

  it('appends a market_snapshot event with the canonical envelope', async () => {
    const t = tape();
    await emitMarketSnapshot({
      tape: t, clock,
      assetKey: 'solana:pumpfun:M1',
      price: { priceUsd: 0.001, liquidityUsd: 10_000, volume24hUsd: 5_000 },
      source: 'dexscreener',
    });
    expect(t.append).toHaveBeenCalledTimes(1);
    const [e] = t.append.mock.calls[0];
    expect(e.type).toBe('market_snapshot');
    expect(e.assetKey).toBe('solana:pumpfun:M1');
    expect(e.chainTs).toBe(5_000);
    expect(e.source).toBe('dexscreener');
    expect(e.payload.priceUsd).toBe(0.001);
  });

  it('emits for control tokens at identical depth (never skipped)', async () => {
    const t = tape();
    await emitMarketSnapshot({ tape: t, clock, assetKey: 'solana:pumpfun:CTRL',
      price: { priceUsd: 1 }, source: 'dexscreener', isControl: true });
    expect(t.append).toHaveBeenCalledTimes(1);
  });

  it('skips the append when there is no usable price rather than writing a null snapshot', async () => {
    const t = tape();
    await emitMarketSnapshot({ tape: t, clock, assetKey: 'solana:pumpfun:M2',
      price: { priceUsd: null }, source: 'dexscreener' });
    expect(t.append).not.toHaveBeenCalled();
  });

  it('is a no-op without a tape so the legacy loop cannot crash', async () => {
    await expect(emitMarketSnapshot({ tape: null, clock, assetKey: 'x',
      price: { priceUsd: 1 }, source: 'dexscreener' })).resolves.toBeUndefined();
  });

  it('emits one snapshot per descriptor in a batch', async () => {
    const t = tape();
    await emitMarketSnapshot({ tape: t, clock, assetKey: 'a', price: { priceUsd: 1 }, source: 's' });
    await emitMarketSnapshot({ tape: t, clock, assetKey: 'b', price: { priceUsd: 2 }, source: 's' });
    expect(t.append.mock.calls.map(([e]) => e.assetKey)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/marketSnapshot.test.js`
Expected: FAIL — `Cannot find module '../marketSnapshot.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/discovery/marketSnapshot.js`:

```js
// Emits `market_snapshot` events (§9.2). This closes the gap where the event type was
// declared but nothing ever wrote it — without these rows, supplyAwareMcap returns null
// forever and every value-based label/metric is unmeasurable.
//
// IMPORTANT (§7.2): we store priceUsd, NOT a market cap. DexScreener's `marketCapUsd`
// assumes a fixed supply, which the Report bans. Consumers derive mcap from priceUsd plus
// rawSupply/decimals captured on token_created (schemaVersion 2).
import { EVENT_TYPES, eventId } from '../tape/identity.js';

export function snapshotPayload(price, source) {
  const num = v => (v == null ? null : Number(v));
  return {
    priceUsd: num(price?.priceUsd),
    liquidityUsd: num(price?.liquidityUsd),
    intervalVolumeUsd: num(price?.volume24hUsd),
    source,
  };
}

export async function emitMarketSnapshot({ tape, clock, assetKey, price, source, isControl = false }) {
  if (!tape) return;                       // legacy loop may run without a tape
  const payload = snapshotPayload(price, source);
  if (payload.priceUsd == null) return;    // no usable price -> no snapshot (unknown != 0)

  const ts = clock.now();
  // Control tokens are emitted on exactly the same path as hot tokens (§10): identical depth
  // is what keeps selection bias measurable. `isControl` is recorded, never used to skip.
  await tape.append({
    eventId: eventId({ source, signature: `${assetKey}:${ts}`, instructionIndex: 0,
                       type: EVENT_TYPES.MARKET_SNAPSHOT }),
    assetKey,
    type: EVENT_TYPES.MARKET_SNAPSHOT,
    chainTs: ts,
    receivedAt: ts,
    slot: null,
    signature: null,
    instructionIndex: 0,
    source,
    schemaVersion: 1,
    payload: { ...payload, isControl },
  });
}
```

- [ ] **Step 4: Wire it into the existing price tick**

In `backend/src/discovery/refreshLoop.js`, inside `processPrices` (where each price `p` is already applied via `applyMarketPatch`), add the tape emission. Accept the tape and clock as injected options so tests stay deterministic:

```js
import { emitMarketSnapshot } from './marketSnapshot.js';
import { systemClock } from './clock.js';
import { assetKey } from '../tape/identity.js';

// inside processPrices(prices, { tape = null, clock = systemClock } = {}), per price p:
await emitMarketSnapshot({
  tape, clock,
  assetKey: assetKey(chain ?? 'solana', token.launchpad ?? 'pumpfun', p.mint),
  price: p,
  source: 'dexscreener',
  isControl: !!token.isControl,
});
```

Thread `{ tape, clock }` through `runRefreshTick` / `runSlowRefreshTick` (they already accept an options object with `fetchPrices`), and pass the shared `Tape` from `server.js` where `startRefreshLoop()` is called.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/discovery/__tests__/marketSnapshot.test.js src/discovery/__tests__/refreshLoop.test.js`
Expected: PASS — 8 new tests, and the existing `refreshLoop` tests still green (the new options are optional and default to no-tape).

- [ ] **Step 6: Commit**

```bash
git add backend/src/discovery/marketSnapshot.js backend/src/discovery/__tests__/marketSnapshot.test.js backend/src/discovery/refreshLoop.js
git commit -m "feat(tape): emit market_snapshot events; store priceUsd not fixed-supply mcap (§9.2,§7.2)

Closes the gap where MARKET_SNAPSHOT was declared but never written.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `token_created` schemaVersion 2 — capture curve target, supply, decimals (close Gap B)

**Files:**
- Modify: `backend/src/tape/identity.js`
- Modify: `backend/src/discovery/pumpfun.js`
- Modify: `backend/src/features/extract.js`
- Test: `backend/src/tape/__tests__/identity.test.js` (extend)

> **Spec (§13 Gap 1/Gap 2):** `token_created` must carry `curveTargetSol`, `rawSupply`, and `decimals` at `schemaVersion: 2`. Phase 3 instead defaulted `curveTargetSol` to `85_000_000_000` inside `extractAllFeatures`, which assumes every token uses pump.fun's default target and leaves `rawSupply`/`decimals` — required by `supplyAwareMcap` — absent entirely.
>
> **Backward compatibility:** events already on the tape at `schemaVersion: 1` lack these fields. Per §13, a v1 event must degrade honestly: `capitalFormation` returns `{primary: null, coverage: 0}` rather than silently scoring against an assumed target.

- [ ] **Step 1: Write the failing test**

Extend `backend/src/tape/__tests__/identity.test.js`:

```js
import { tokenCreatedPayload, TOKEN_CREATED_SCHEMA_VERSION } from '../identity.js';

describe('token_created schemaVersion 2 (§13 Gap 1/2)', () => {
  it('is version 2', () => {
    expect(TOKEN_CREATED_SCHEMA_VERSION).toBe(2);
  });

  it('carries curveTargetSol, rawSupply and decimals', () => {
    const p = tokenCreatedPayload({
      creator: 'C1', curve: 'CURVE1', initialBuyLamports: 1_000n,
      curveTargetSol: 85_000_000_000, rawSupply: '1000000000000000', decimals: 6,
    });
    expect(p.curveTargetSol).toBe(85_000_000_000);
    expect(p.rawSupply).toBe('1000000000000000');
    expect(p.decimals).toBe(6);
    expect(p.creator).toBe('C1');
  });

  it('keeps unknown curve/supply data null instead of inventing a default', () => {
    const p = tokenCreatedPayload({ creator: 'C2', curve: 'CURVE2' });
    expect(p.curveTargetSol).toBeNull();
    expect(p.rawSupply).toBeNull();
    expect(p.decimals).toBeNull();
  });

  it('serialises rawSupply as an exact decimal string, never a float', () => {
    const p = tokenCreatedPayload({ rawSupply: 10n ** 18n });
    expect(typeof p.rawSupply).toBe('string');
    expect(p.rawSupply).toBe('1000000000000000000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/tape/__tests__/identity.test.js`
Expected: FAIL — `tokenCreatedPayload` / `TOKEN_CREATED_SCHEMA_VERSION` not exported.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/tape/identity.js` add:

```js
// schemaVersion 2 adds curveTargetSol (capitalFormation's denominator) and
// rawSupply/decimals (supplyAwareMcap's inputs). v1 events lack them and must
// degrade to unavailable rather than assume pump.fun defaults. (§13 Gap 1/2)
export const TOKEN_CREATED_SCHEMA_VERSION = 2;

export function tokenCreatedPayload({
  creator = null, curve = null, initialBuyLamports = null,
  curveTargetSol = null, rawSupply = null, decimals = null,
} = {}) {
  return {
    creator, curve,
    // exact units: integers or decimal strings, never JS floats (§9.4)
    initialBuyLamports: initialBuyLamports == null ? null : String(initialBuyLamports),
    curveTargetSol: curveTargetSol == null ? null : Number(curveTargetSol),
    rawSupply: rawSupply == null ? null : String(rawSupply),
    decimals: decimals == null ? null : Number(decimals),
  };
}
```

- [ ] **Step 4: Populate the fields at ingestion**

In `backend/src/discovery/pumpfun.js`, where the `token_created` event is appended, replace the inline payload with:

```js
import { tokenCreatedPayload, TOKEN_CREATED_SCHEMA_VERSION } from '../tape/identity.js';

// ...
schemaVersion: TOKEN_CREATED_SCHEMA_VERSION,
payload: tokenCreatedPayload({
  creator: m.traderPublicKey,
  curve: m.bondingCurveKey,
  initialBuyLamports: toLamports(m.solAmount),
  // PumpPortal exposes the curve target/supply on the create frame when available.
  // Absent -> null, which makes capitalFormation report unavailable rather than guess.
  curveTargetSol: m.curveTargetSol ?? m.poolTargetLamports ?? null,
  rawSupply: m.rawSupply ?? m.totalSupply ?? null,
  decimals: m.decimals ?? null,
}),
```

- [ ] **Step 5: Make the extractor read the tape value**

In `backend/src/features/extract.js`, replace the hardcoded default:

```js
// BEFORE: const curveTargetSol = opts?.curveTargetSol ?? 85_000_000_000;
// The tape is the source of truth (schemaVersion 2). A v1 event has no target, so
// capitalFormation must report unavailable rather than score against an assumed curve. (§13)
const created = events.find(e => e.type === EVENT_TYPES.TOKEN_CREATED);
const curveTargetSol =
  opts?.curveTargetSol ??            // explicit override (tests)
  created?.payload?.curveTargetSol ?? // schemaVersion 2
  null;                               // v1 event -> unavailable, NOT a default
```

`capitalFormation(trades, null)` must already return `{primary: null, coverage: 0}`; if it does not, add that guard as its first line:

```js
if (curveTargetSol == null) return { primary: null, coverage: 0 };
```

Update the three Phase 3 `extract.test.js` cases that pass `curveTargetSol: 1000/2000` — they already pass it explicitly, so they keep working — and add one asserting a v1 creation event yields `coverage: 0` for capital formation.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tape/__tests__/identity.test.js src/features/__tests__/extract.test.js src/features/__tests__/capitalFormation.test.js`
Expected: PASS — 4 new identity tests plus the extractor/feature suites.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tape/identity.js backend/src/tape/__tests__/identity.test.js backend/src/discovery/pumpfun.js backend/src/features/extract.js backend/src/features/__tests__/extract.test.js
git commit -m "feat(tape): token_created schemaVersion 2 — curveTargetSol, rawSupply, decimals (§13)

Replaces the hardcoded 85 SOL curve-target default with tape-sourced truth; v1 events
now degrade to unavailable instead of scoring against an assumed curve.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Synthetic tape generator — prove the harness before real data (§26.0)

**Files:**
- Modify: `backend/src/config.js`
- Create: `backend/src/calibration/syntheticTape.js`
- Test: `backend/src/calibration/__tests__/syntheticTape.test.js`

> **Spec (§26.0):** build a generator emitting fake event streams with **known ground truth** — farms, grinds, organic pumps, dead tokens, right-censored baselines — and use it to test causality guards, label construction, and calibration metrics while the real tape is still filling. This parallelises the two longest-lead items.
>
> All timestamps come from an injected `manualClock` so scenarios are byte-identical across runs (§1 determinism).

- [ ] **Step 1: Add the calibration config block**

In `backend/src/config.js`:

```js
calibration: {
  bootstrapIters: 2000,       // percentile-CI resamples (heavy-tailed returns; not a t-test)
  bootstrapAlpha: 0.05,       // 95% CI
  minQualifiedAlerts: 200,    // N per cohort before any verdict (§19.5) — predeclared
  rugCeilingFrac: 0.30,       // max acceptable rug-after-alert rate (placeholder, uncalibrated)
  maxMedianFillDecayFrac: 0.05, // median decay must stay inside policy slippage
},
```

These are **placeholders** pending validation replay; changing them is a versioned decision (§22).

- [ ] **Step 2: Write the failing test**

Create `backend/src/calibration/__tests__/syntheticTape.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { generateScenario, SCENARIOS } from '../syntheticTape.js';
import { EVENT_TYPES } from '../../tape/identity.js';

describe('generateScenario (§26.0)', () => {
  it('exposes the five ground-truth scenarios', () => {
    expect(Object.keys(SCENARIOS).sort())
      .toEqual(['censored', 'dead', 'farm', 'grind', 'organicPump']);
  });

  it('always begins with a schemaVersion 2 token_created carrying supply and curve target', () => {
    const { events } = generateScenario('organicPump', { assetKey: 'solana:pumpfun:S1' });
    expect(events[0].type).toBe(EVENT_TYPES.TOKEN_CREATED);
    expect(events[0].schemaVersion).toBe(2);
    expect(events[0].payload.rawSupply).toBeTruthy();
    expect(events[0].payload.decimals).toBe(6);
    expect(events[0].payload.curveTargetSol).toBeGreaterThan(0);
  });

  it('emits monotonically non-decreasing chainTs so causal reads are well defined', () => {
    const { events } = generateScenario('organicPump', { assetKey: 'a' });
    const ts = events.map(e => e.chainTs);
    expect(ts).toEqual([...ts].sort((x, y) => x - y));
  });

  it('is deterministic — the same seed yields identical events', () => {
    const a = generateScenario('farm', { assetKey: 'a', seed: 7 });
    const b = generateScenario('farm', { assetKey: 'a', seed: 7 });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('organicPump has rising market snapshots and a profitable ground truth', () => {
    const { events, truth } = generateScenario('organicPump', { assetKey: 'a' });
    const prices = events.filter(e => e.type === EVENT_TYPES.MARKET_SNAPSHOT)
      .map(e => e.payload.priceUsd);
    expect(prices.length).toBeGreaterThan(2);
    expect(prices.at(-1)).toBeGreaterThan(prices[0]);
    expect(truth.profitable).toBe(true);
  });

  it('farm concentrates buys among few funded wallets and is flagged unprofitable', () => {
    const { events, truth } = generateScenario('farm', { assetKey: 'a' });
    const buyers = new Set(events.filter(e => e.type === EVENT_TYPES.TRADE_OBSERVED)
      .map(e => e.payload.wallet));
    expect(buyers.size).toBeLessThanOrEqual(5);
    expect(events.some(e => e.type === EVENT_TYPES.FUNDING_LINK)).toBe(true);
    expect(truth.profitable).toBe(false);
    expect(truth.expectBlocker).toBe('FARM');
  });

  it('grind produces many tiny buys — low capital efficiency', () => {
    const { events, truth } = generateScenario('grind', { assetKey: 'a' });
    const trades = events.filter(e => e.type === EVENT_TYPES.TRADE_OBSERVED);
    expect(trades.length).toBeGreaterThan(50);
    expect(truth.profitable).toBe(false);
  });

  it('dead emits no trades or snapshots after the alert timestamp', () => {
    const { events, truth } = generateScenario('dead', { assetKey: 'a', alertTs: 60_000 });
    const after = events.filter(e => e.chainTs >= 60_000 &&
      (e.type === EVENT_TYPES.TRADE_OBSERVED || e.type === EVENT_TYPES.MARKET_SNAPSHOT));
    expect(after).toHaveLength(0);
    expect(truth.dead).toBe(true);
  });

  it('censored closes its baseline by window with fewer than the min swaps', () => {
    const { events, truth } = generateScenario('censored', { assetKey: 'a' });
    const closed = events.find(e => e.type === EVENT_TYPES.BASELINE_CLOSED);
    expect(closed).toBeTruthy();
    expect(closed.payload.reason).toBe('window');
    expect(truth.rightCensored).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/syntheticTape.test.js`
Expected: FAIL — `Cannot find module '../syntheticTape.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `backend/src/calibration/syntheticTape.js`:

```js
// Synthetic tapes with KNOWN ground truth (§26.0). This lets the label/metric/verdict
// harness be proven before the real tape has accumulated data — parallelising the two
// longest-lead items instead of serialising them.
//
// Fully deterministic: no Date.now(), no Math.random(). A seeded LCG drives all variation.
import { EVENT_TYPES, eventId } from '../tape/identity.js';

export const SCENARIOS = {
  organicPump: { profitable: true,  dead: false, rightCensored: false, expectBlocker: null },
  farm:        { profitable: false, dead: false, rightCensored: false, expectBlocker: 'FARM' },
  grind:       { profitable: false, dead: false, rightCensored: false, expectBlocker: null },
  dead:        { profitable: false, dead: true,  rightCensored: false, expectBlocker: null },
  censored:    { profitable: false, dead: false, rightCensored: true,  expectBlocker: null },
};

function lcg(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

const RAW_SUPPLY = '1000000000000000'; // 1e9 tokens at 6 decimals, as an exact string
const DECIMALS = 6;
const CURVE_TARGET = 85_000_000_000;   // lamports

export function generateScenario(name, { assetKey, seed = 1, alertTs = 60_000 } = {}) {
  const spec = SCENARIOS[name];
  if (!spec) throw new Error(`unknown scenario: ${name}`);
  const rnd = lcg(seed);
  const events = [];
  let ts = 0;

  const push = (type, payload, source = 'synthetic') => {
    events.push({
      eventId: eventId({ source, signature: `${assetKey}:${type}:${events.length}`,
                         instructionIndex: 0, type }),
      assetKey, type, chainTs: ts, receivedAt: ts, slot: null, signature: null,
      instructionIndex: 0, source, schemaVersion: type === EVENT_TYPES.TOKEN_CREATED ? 2 : 1,
      payload,
    });
  };

  push(EVENT_TYPES.TOKEN_CREATED, {
    creator: 'DEV1', curve: 'CURVE1', initialBuyLamports: '1000000000',
    curveTargetSol: CURVE_TARGET, rawSupply: RAW_SUPPLY, decimals: DECIMALS,
  });

  const trade = (wallet, side, lamports) => {
    ts += 1_000;
    push(EVENT_TYPES.TRADE_OBSERVED, {
      side, wallet, lamports: String(lamports), rawTokens: String(lamports * 1_000),
    });
  };
  const snap = priceUsd => {
    ts += 1_000;
    push(EVENT_TYPES.MARKET_SNAPSHOT, { priceUsd, liquidityUsd: 20_000,
      intervalVolumeUsd: 5_000, source: 'synthetic' });
  };

  if (name === 'organicPump') {
    // Few large buys from many distinct wallets = high capital efficiency, real distribution.
    for (let i = 0; i < 12; i++) trade(`W${i}`, 'buy', 2_000_000_000 + Math.floor(rnd() * 1e9));
    snap(0.0001);
    for (let i = 0; i < 6; i++) snap(0.0001 * (1.6 + i));   // strong, rising
  }

  if (name === 'farm') {
    // A handful of wallets, all funded by one source: coordinated supply control.
    for (let i = 0; i < 4; i++) {
      push(EVENT_TYPES.FUNDING_LINK, { wallet: `F${i}`, funder: 'FUNDER1',
        lamports: '5000000000', confidence: 'high' });
    }
    for (let r = 0; r < 6; r++) for (let i = 0; i < 4; i++) trade(`F${i}`, 'buy', 3_000_000_000);
    snap(0.0002); snap(0.00021);
    for (let i = 0; i < 4; i++) trade(`F${i}`, 'sell', 3_000_000_000); // dump
    snap(0.00002);
  }

  if (name === 'grind') {
    // Many tiny buys to the same level = low efficiency / wash-like.
    for (let i = 0; i < 60; i++) trade(`G${i % 20}`, 'buy', 20_000_000);
    snap(0.00005); snap(0.000051); snap(0.000049);
  }

  if (name === 'dead') {
    for (let i = 0; i < 6; i++) trade(`D${i}`, 'buy', 500_000_000);
    snap(0.00003);
    ts = alertTs;                 // alert fires, then nothing further is ever observed
  }

  if (name === 'censored') {
    for (let i = 0; i < 8; i++) trade(`C${i}`, 'buy', 400_000_000);
    ts += 1_000;
    push(EVENT_TYPES.BASELINE_CLOSED, { reason: 'window', swapsObserved: 8, durationMs: ts });
    snap(0.00004);
  }

  return { events, truth: { ...spec, alertTs, assetKey } };
}

// Convenience: load a scenario into a real (pg-mem backed) Tape.
export async function loadScenario(tape, name, opts) {
  const { events, truth } = generateScenario(name, opts);
  for (const e of events) await tape.append(e);
  return truth;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/syntheticTape.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config.js backend/src/calibration/syntheticTape.js backend/src/calibration/__tests__/syntheticTape.test.js
git commit -m "feat(calibration): deterministic synthetic tapes with known ground truth (§26.0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Execution model — multiplicative costs, causal fills (§19.2, §20)

**Files:**
- Create: `backend/src/calibration/execution.js`
- Test: `backend/src/calibration/__tests__/execution.test.js`

> **Spec (§20):** "Entry and exit costs must be applied **multiplicatively** to simulated fills. Subtracting a single percentage from ideal peak return is not a sufficient execution model." **(§19.2):** the fill must be causal — entry uses the first executable price *after* the alert plus configured latency, never a price from before it.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/execution.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { simulateEntry, simulateExitLadder, applyCost } from '../execution.js';

const policy = {
  latencyMs: 2_000,
  entrySlippageFrac: 0.05,
  exitSlippageFrac: 0.05,
  feeFrac: 0.01,
  exitLadder: [[2.0, 0.5], [4.0, 0.25]],
  timeStopMs: 6 * 3600_000,
};
// price series as {ts, priceUsd}
const series = (...pairs) => pairs.map(([ts, priceUsd]) => ({ ts, priceUsd }));

describe('applyCost (§20 multiplicative)', () => {
  it('compounds costs instead of summing them', () => {
    // two 5% costs must give 0.9025, NOT 0.90
    expect(applyCost(1, [0.05, 0.05])).toBeCloseTo(0.9025, 10);
  });
  it('is order independent', () => {
    expect(applyCost(1, [0.05, 0.01])).toBeCloseTo(applyCost(1, [0.01, 0.05]), 12);
  });
});

describe('simulateEntry (§19.2 causal)', () => {
  it('fills at the first price at or after alert + latency', () => {
    const e = simulateEntry(series([0, 1], [1_000, 2], [3_000, 3], [4_000, 4]),
      { ts: 1_000 }, policy);
    expect(e.fillTs).toBe(3_000);          // 1000 + 2000 latency
    expect(e.rawPrice).toBe(3);
  });

  it('applies entry slippage and fees multiplicatively to the effective cost basis', () => {
    const e = simulateEntry(series([0, 1], [3_000, 10]), { ts: 0 }, policy);
    // paying up: basis = 10 * (1+0.05) * (1+0.01)
    expect(e.effectivePrice).toBeCloseTo(10 * 1.05 * 1.01, 10);
  });

  it('returns null when no price exists after alert + latency', () => {
    expect(simulateEntry(series([0, 1], [500, 2]), { ts: 1_000 }, policy)).toBeNull();
  });

  it('never fills at a pre-alert price', () => {
    const e = simulateEntry(series([0, 99], [5_000, 1]), { ts: 1_000 }, policy);
    expect(e.rawPrice).toBe(1);
  });
});

describe('simulateExitLadder (§20)', () => {
  const entry = { fillTs: 0, rawPrice: 1, effectivePrice: 1 };

  it('sells ladder rungs as multiples are reached and nets costs multiplicatively', () => {
    const r = simulateExitLadder(series([1_000, 2], [2_000, 4]), entry, policy);
    // 50% at 2x, 25% at 4x, 25% remaining at final price 4
    const net = m => m * (1 - policy.exitSlippageFrac) * (1 - policy.feeFrac);
    const expected = 0.5 * net(2) + 0.25 * net(4) + 0.25 * net(4);
    expect(r.proceedsMultiple).toBeCloseTo(expected, 8);
    expect(r.rungsHit).toEqual([2.0, 4.0]);
  });

  it('exits the remainder at the last observed price when no rung is reached', () => {
    const r = simulateExitLadder(series([1_000, 1.2]), entry, policy);
    const net = m => m * (1 - policy.exitSlippageFrac) * (1 - policy.feeFrac);
    expect(r.proceedsMultiple).toBeCloseTo(net(1.2), 8);
    expect(r.rungsHit).toEqual([]);
  });

  it('produces a loss multiple below 1 for a collapsing price', () => {
    const r = simulateExitLadder(series([1_000, 0.1]), entry, policy);
    expect(r.proceedsMultiple).toBeLessThan(0.2);
  });

  it('honours the time stop and ignores prices past it', () => {
    const r = simulateExitLadder(
      series([1_000, 1.5], [policy.timeStopMs + 1, 100]), entry, policy);
    expect(r.rungsHit).toEqual([]);        // the 100x came after the stop
    expect(r.proceedsMultiple).toBeLessThan(2);
  });

  it('returns a zero multiple when there is no price at all', () => {
    const r = simulateExitLadder([], entry, policy);
    expect(r.proceedsMultiple).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/execution.test.js`
Expected: FAIL — `Cannot find module '../execution.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/calibration/execution.js`:

```js
// Causal, multiplicative execution model (§19.2, §20).
// Costs COMPOUND: two 5% frictions cost 9.75%, not 10%. Subtracting a single percentage
// from an ideal peak is explicitly rejected by the Report as an insufficient model.
export function applyCost(value, fracs) {
  return fracs.reduce((v, f) => v * (1 - f), value);
}
function addCost(value, fracs) {
  return fracs.reduce((v, f) => v * (1 + f), value);
}

// Entry fills at the first price at or after alert + latency. A pre-alert price is
// never reachable — that would be lookahead in the one place it actually costs money.
export function simulateEntry(prices, alert, policy) {
  const earliest = alert.ts + (policy.latencyMs ?? 0);
  const fill = prices.filter(p => p.ts >= earliest && p.priceUsd != null)
    .sort((a, b) => a.ts - b.ts)[0];
  if (!fill) return null;
  return {
    fillTs: fill.ts,
    rawPrice: fill.priceUsd,
    // Buying pays UP through slippage and fees.
    effectivePrice: addCost(fill.priceUsd,
      [policy.entrySlippageFrac ?? 0, policy.feeFrac ?? 0]),
  };
}

// Ladder exit: sell configured fractions as multiples are reached, remainder at the last
// in-window price. Every rung nets slippage + fees multiplicatively.
export function simulateExitLadder(prices, entry, policy) {
  const stop = entry.fillTs + (policy.timeStopMs ?? Infinity);
  const window = prices
    .filter(p => p.ts >= entry.fillTs && p.ts <= stop && p.priceUsd != null)
    .sort((a, b) => a.ts - b.ts);
  if (!window.length) return { proceedsMultiple: 0, rungsHit: [], remainder: 1 };

  const net = m => applyCost(m, [policy.exitSlippageFrac ?? 0, policy.feeFrac ?? 0]);
  let remainder = 1, proceeds = 0;
  const rungsHit = [];

  for (const [multiple, fraction] of policy.exitLadder ?? []) {
    const target = entry.effectivePrice * multiple;
    const hit = window.find(p => p.priceUsd >= target);
    if (!hit || remainder <= 0) continue;
    const sell = Math.min(fraction, remainder);
    proceeds += sell * net(hit.priceUsd / entry.effectivePrice);
    remainder -= sell;
    rungsHit.push(multiple);
  }

  if (remainder > 0) {
    const last = window.at(-1).priceUsd;
    proceeds += remainder * net(last / entry.effectivePrice);
  }
  return { proceedsMultiple: proceeds, rungsHit, remainder };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/execution.test.js`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/execution.js backend/src/calibration/__tests__/execution.test.js
git commit -m "feat(calibration): causal entry + ladder exit with multiplicative costs (§19.2,§20)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Replay labels — decision-aligned, dead-token safe (§7.1, §7.2, §19.2)

**Files:**
- Create: `backend/src/calibration/labels.js`
- Test: `backend/src/calibration/__tests__/labels.test.js`

> **Spec (§7.1):** the primary label `y_policy_net_positive` is the net return of a fixed causal policy simulation, including latency, slippage, fees, invalidation/exit rules, and the full horizon. **(§7.2):** secondary labels are `y_peak_opportunity` (labeled optimistic), `y_hit_market_cap`, `y_graduated`, `y_rugged`, `y_dead`; market cap must be **supply-aware**. **(§19.2):** tape reads are awaited; the dead-token guard returns an explicit failed label so `Math.max(...[])` can never leak `-Infinity`; features stay causal while labels intentionally see the future.
>
> **Peak mcap requires two event types.** Trades carry no supply or USD price. Supply comes from `token_created` (schemaVersion 2, Task 2); price comes from `market_snapshot` (Task 1). Reading `payload.rawSupply` off a trade yields `undefined` and `supplyAwareMcap` returns `null` — the tests below pin that.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/labels.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { migrate } from '../../tape/db.js';
import { Tape } from '../../tape/tape.js';
import { loadScenario } from '../syntheticTape.js';
import { buildLabel } from '../labels.js';
import { CONFIG } from '../../scoring/config.js';

const policy = {
  ...CONFIG.policy,
  latencyMs: 0, entrySlippageFrac: 0.05, exitSlippageFrac: 0.05, feeFrac: 0.01,
  timeStopMs: 6 * 3600_000,
};
const cfg = { ...CONFIG, policy };

let tape;
beforeEach(async () => {
  const db = newDb().adapters.createPg();
  await migrate(db);
  tape = new Tape(db);
});

describe('buildLabel (§19.2 dead-token guard)', () => {
  it('returns an explicit failed label with y_dead when nothing trades after the alert', async () => {
    const truth = await loadScenario(tape, 'dead',
      { assetKey: 'solana:pumpfun:DEAD', alertTs: 60_000 });
    const label = await buildLabel(tape, truth.assetKey,
      { ts: 60_000, mcap: 10_000 }, cfg);

    expect(label.y_dead).toBe(true);
    expect(label.y_policy_net_positive).toBe(false);
    expect(label.y_policy_net_return).toBe(-1);
    expect(label.y_peak_opportunity).toBeNull();
    expect(label.y_hit_market_cap).toBe(false);
  });

  it('never leaks -Infinity into any numeric field', async () => {
    const truth = await loadScenario(tape, 'dead',
      { assetKey: 'solana:pumpfun:DEAD2', alertTs: 60_000 });
    const label = await buildLabel(tape, truth.assetKey, { ts: 60_000, mcap: 1 }, cfg);
    for (const v of Object.values(label)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('buildLabel (§7.1 policy-aligned outcome)', () => {
  it('labels the organic pump profitable with a finite net return', async () => {
    const truth = await loadScenario(tape, 'organicPump', { assetKey: 'solana:pumpfun:UP' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_dead).toBeFalsy();
    expect(Number.isFinite(label.y_policy_net_return)).toBe(true);
    expect(label.y_policy_net_return).toBeGreaterThan(0);
    expect(label.y_policy_net_positive).toBe(true);
  });

  it('labels the farm dump unprofitable', async () => {
    const truth = await loadScenario(tape, 'farm', { assetKey: 'solana:pumpfun:FARM' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_policy_net_return).toBeLessThan(0);
    expect(label.y_policy_net_positive).toBe(false);
  });

  it('never reports a net return worse than total loss', async () => {
    const truth = await loadScenario(tape, 'farm', { assetKey: 'solana:pumpfun:FARM2' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_policy_net_return).toBeGreaterThanOrEqual(-1);
  });
});

describe('buildLabel (§7.2 supply-aware mcap)', () => {
  it('derives peak mcap from token_created supply and market_snapshot price', async () => {
    const truth = await loadScenario(tape, 'organicPump', { assetKey: 'solana:pumpfun:MC' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 100_000 }, cfg);
    // 1e9 tokens * final price; peak must be a real positive number, not null
    expect(label.y_peak_opportunity).toBeGreaterThan(0);
    expect(typeof label.y_hit_market_cap).toBe('boolean');
  });

  it('reports peak as null when no market_snapshot exists, never as 0 or -Infinity', async () => {
    // grind emits snapshots; strip them by using a scenario then querying a bogus key
    const label = await buildLabel(tape, 'solana:pumpfun:NOPE', { ts: 0, mcap: 1 }, cfg);
    expect(label.y_peak_opportunity).toBeNull();
    expect(label.y_hit_market_cap).toBe(false);
  });

  it('marks y_rugged when the price collapses ≥90% from its peak', async () => {
    const truth = await loadScenario(tape, 'farm', { assetKey: 'solana:pumpfun:RUG' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(true);
  });

  it('does not mark y_rugged for a healthy rise', async () => {
    const truth = await loadScenario(tape, 'organicPump', { assetKey: 'solana:pumpfun:OK' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });

  it('labels y_graduated from the presence of a migration event', async () => {
    const truth = await loadScenario(tape, 'organicPump', { assetKey: 'solana:pumpfun:G' });
    const label = await buildLabel(tape, truth.assetKey, { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_graduated).toBe(false); // the scenario never migrates
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/labels.test.js`
Expected: FAIL — `Cannot find module '../labels.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/calibration/labels.js`:

```js
// Decision-aligned outcome labels (§7.1, §7.2, §19.2).
//
// The causal asymmetry is deliberate and is the whole point:
//   FEATURES are strictly causal (events <= asOf) — see causalFeatures.
//   LABELS intentionally see the future; they are built offline after the horizon closes.
import { EVENT_TYPES } from '../tape/identity.js';
import { supplyAwareMcap } from '../features/mcap.js';
import { causalFeatures } from '../features/extract.js';   // THE one extractor (§22)
import { simulateEntry, simulateExitLadder } from './execution.js';

export async function buildLabel(tape, assetKey, alert, cfg) {
  const horizon = alert.ts + cfg.policy.evalHorizonMs;
  const [created] = await tape.eventsUntil(assetKey, horizon, [EVENT_TYPES.TOKEN_CREATED]);
  const snaps = await tape.eventsUntil(assetKey, horizon, [EVENT_TYPES.MARKET_SNAPSHOT]);
  const trades = await tape.eventsUntil(assetKey, horizon, [EVENT_TYPES.TRADE_OBSERVED]);
  const migrations = await tape.eventsUntil(assetKey, horizon, [EVENT_TYPES.MIGRATION_OBSERVED]);

  const chainTs = e => Number(e.chain_ts ?? e.chainTs);
  const futureSnaps = snaps.filter(e => chainTs(e) >= alert.ts);
  const futureTrades = trades.filter(e => chainTs(e) >= alert.ts);

  // Dead-token guard (§19.2): with nothing observed after the alert there is no fill and
  // no peak. Math.max(...[]) is -Infinity, which would poison every downstream aggregate,
  // so return an explicit total-loss label instead of a computed one.
  if (!futureSnaps.length && !futureTrades.length) {
    return {
      y_policy_net_positive: false, y_policy_net_return: -1,
      y_peak_opportunity: null, y_hit_market_cap: false,
      y_graduated: migrations.length > 0, y_rugged: false, y_dead: true,
    };
  }

  const prices = futureSnaps
    .map(e => ({ ts: chainTs(e), priceUsd: e.payload?.priceUsd ?? null }))
    .filter(p => p.priceUsd != null);

  // Fixed causal policy simulation with multiplicative costs (§7.1, §20).
  const entry = simulateEntry(prices, alert, cfg.policy);
  const exit = entry ? simulateExitLadder(prices, entry, cfg.policy) : null;
  // Bounded below by -1: you cannot lose more than the position.
  const netReturn = exit ? Math.max(-1, exit.proceedsMultiple - 1) : -1;

  // Supply-aware market cap (§7.2). Supply/decimals come from token_created (schemaVersion 2);
  // price from market_snapshot. NEVER price x 1e9, and never DexScreener's marketCapUsd.
  const mcapOf = priceUsd => supplyAwareMcap({
    rawSupply: created?.payload?.rawSupply,
    decimals: created?.payload?.decimals,
    priceUsd,
  });
  const mcaps = prices.map(p => mcapOf(p.priceUsd)).filter(v => v != null);
  const peak = mcaps.length ? Math.max(...mcaps) : null;   // null = unavailable, never -Infinity

  // Rug: >= 90% collapse from the observed peak inside the horizon (§7.2).
  const peakPrice = prices.length ? Math.max(...prices.map(p => p.priceUsd)) : null;
  const lastPrice = prices.length ? prices.at(-1).priceUsd : null;
  const rugged = peakPrice != null && lastPrice != null && peakPrice > 0
    && lastPrice <= peakPrice * 0.10;

  return {
    y_policy_net_positive: netReturn >= cfg.policy.positiveReturn,
    y_policy_net_return: netReturn,
    // Optimistic opportunity measure — explicitly NOT an achievable return (§7.2).
    y_peak_opportunity: peak == null || !alert.mcap ? null : peak / alert.mcap - 1,
    y_hit_market_cap: peak == null ? false : peak >= cfg.policy.mcapTarget,
    y_graduated: migrations.length > 0,
    y_rugged: rugged,
    y_dead: false,
  };
}

// Replay features delegate to the ONE extractor. Re-implementing extraction here is exactly
// what the §22 CI invariant forbids — replay and production must never drift.
export async function buildReplayFeatures(tape, assetKey, asOf) {
  return causalFeatures(tape, assetKey, asOf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/labels.test.js`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/labels.js backend/src/calibration/__tests__/labels.test.js
git commit -m "feat(calibration): causal policy-aligned labels with dead-token guard (§7.1,§7.2,§19.2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Shadow policy stub — logs decisions, trades nothing (§20)

**Files:**
- Create: `backend/src/policy/stub.js`
- Test: `backend/src/policy/__tests__/stub.test.js`

> **Spec (§20):** shadow mode records an executable decision **without sending a transaction**. Policy fields: maximum entry decay from alert price, simulated latency, maximum slippage and position size, invalidation on dev sell / new blocker / sustained sell pressure, versioned exit ladder, time stop and trailing remainder.
>
> **§13 Gap 3:** `sellRouteVerified` is `undefined` until WS8 emits `sell_route_check`. An unset route must **not** block a shadow entry — absence of evidence is not evidence of a honeypot.

- [ ] **Step 1: Write the failing test**

Create `backend/src/policy/__tests__/stub.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { policyDecision, recordShadowDecision } from '../stub.js';
import { CONFIG } from '../../scoring/config.js';

const score = (over = {}) => ({
  alert: { ts: 1_000, mcap: 100_000 }, blockers: [], ...over,
});
const token = (over = {}) => ({
  admission: 'qualified', mcap: 100_000, ...over,
});

describe('policyDecision (§20)', () => {
  it('takes no action on a token that is not qualified', () => {
    for (const a of ['watching', 'provisional', 'rejected', 'unscored', 'expired']) {
      expect(policyDecision(token({ admission: a }), score(), CONFIG).action).toBe('none');
    }
  });

  it('enters in SHADOW mode only, never a live action', () => {
    const d = policyDecision(token(), score(), CONFIG);
    expect(d.action).toBe('shadow_enter');
    expect(d.mode).toMatch(/SHADOW/);
    expect(d.mode).toMatch(/log only/i);
    expect(d.action).not.toMatch(/buy|sell|execute|live/i);
  });

  it('skips when the entry opportunity has already decayed past the limit', () => {
    // mcap rose 20% vs a 5% max decay
    const d = policyDecision(token({ mcap: 120_000 }), score(), CONFIG);
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('alert_decay');
  });

  it('still enters when the price moved down (decay guard is one-sided)', () => {
    const d = policyDecision(token({ mcap: 80_000 }), score(), CONFIG);
    expect(d.action).toBe('shadow_enter');
  });

  it('carries the versioned exit ladder and invalidation rules', () => {
    const d = policyDecision(token(), score(), CONFIG);
    expect(d.exitLadder).toEqual(CONFIG.policy.exitLadder);
    expect(d.invalidation).toEqual(
      ['dev_sell_fired', 'blocker_added', 'flow_below_1_two_windows']);
  });

  it('skips when mcap is unavailable rather than assuming no decay', () => {
    // §13 Gap 2 territory: without a supply-aware mcap the decay test is unevaluable.
    const d = policyDecision(token({ mcap: null }), score(), CONFIG);
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('mcap_unavailable');
  });

  it('does NOT skip on an unset sell route (§13 Gap 3 — undefined is not false)', () => {
    const d = policyDecision(token({ sellRouteVerified: undefined }), score(), CONFIG);
    expect(d.action).toBe('shadow_enter');
  });

  it('skips a confirmed honeypot', () => {
    const d = policyDecision(token({ sellRouteVerified: false }), score(), CONFIG);
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('sell_route_failed');
  });
});

describe('recordShadowDecision (§20)', () => {
  it('appends a log row and sends no transaction', async () => {
    const store = { appendShadow: vi.fn(async () => {}) };
    const executor = { buy: vi.fn(), sell: vi.fn() };
    await recordShadowDecision({
      store, executor, assetKey: 'solana:pumpfun:M',
      decision: { action: 'shadow_enter', mode: 'SHADOW' }, now: 42,
    });
    expect(store.appendShadow).toHaveBeenCalledTimes(1);
    expect(store.appendShadow.mock.calls[0][0]).toMatchObject({
      assetKey: 'solana:pumpfun:M', action: 'shadow_enter', ts: 42,
    });
    expect(executor.buy).not.toHaveBeenCalled();
    expect(executor.sell).not.toHaveBeenCalled();
  });

  it('does not log a no-action decision', async () => {
    const store = { appendShadow: vi.fn(async () => {}) };
    await recordShadowDecision({ store, assetKey: 'x',
      decision: { action: 'none' }, now: 1 });
    expect(store.appendShadow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/policy/__tests__/stub.test.js`
Expected: FAIL — `Cannot find module '../stub.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/policy/stub.js`:

```js
// Shadow policy (§20). Records an executable decision WITHOUT sending a transaction.
// No executor, wallet, or order path is imported here — that is the safety property.
export function policyDecision(token, score, cfg) {
  if (token.admission !== 'qualified') return { action: 'none' };

  // A CONFIRMED sell-route failure skips. An UNSET route (undefined) does not —
  // absence of evidence is not evidence of a honeypot (§13 Gap 3, §15 unknown != blocker).
  if (token.sellRouteVerified === false) {
    return { action: 'skip', reason: 'sell_route_failed' };
  }

  // Decay needs a supply-aware mcap on both sides. Without one the test is unevaluable,
  // so skip rather than silently treating "unknown" as "no decay" (§5.2.7).
  const alertMcap = score.alert?.mcap ?? null;
  if (token.mcap == null || alertMcap == null) {
    return { action: 'skip', reason: 'mcap_unavailable' };
  }

  const decayFrac = token.mcap / alertMcap - 1;
  if (decayFrac > cfg.policy.maxEntryDecayFrac) {
    return { action: 'skip', reason: 'alert_decay' };   // the move already happened
  }

  return {
    action: 'shadow_enter',
    invalidation: ['dev_sell_fired', 'blocker_added', 'flow_below_1_two_windows'],
    exitLadder: cfg.policy.exitLadder,      // costs applied multiplicatively at fill
    maxEntryDecayFrac: cfg.policy.maxEntryDecayFrac,
    mode: 'SHADOW — log only. No automation until the go/no-go verdict.',
  };
}

export async function recordShadowDecision({ store, assetKey, decision, now }) {
  if (!decision || decision.action === 'none') return;
  await store.appendShadow({
    assetKey, ts: now, action: decision.action,
    reason: decision.reason ?? null, mode: decision.mode ?? null,
  });
  // Deliberately no execution call of any kind.
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/policy/__tests__/stub.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/policy/stub.js backend/src/policy/__tests__/stub.test.js
git commit -m "feat(policy): shadow-only decision stub; unset sell route never blocks (§20,§13)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Metrics with a hard probability gate (§19.4)

**Files:**
- Create: `backend/src/calibration/metrics.js`
- Test: `backend/src/calibration/__tests__/metrics.test.js`

> **Spec (§19.4):** before a probability model exists, the metrics are net return per alert, precision@10/50, alert volume, rug rate, time-to-alert, fill decay, and coverage. After one exists: calibration table, Brier, log loss, PR-AUC, monotonicity. **"Brier score must never be calculated against the raw Meme Score as though `75` meant a 75% success probability."**
>
> A comment cannot enforce that. `assertProbabilities` makes it a runtime error: inputs must be numbers in `[0,1]` **and** carry `isProbability: true`, so passing a 0–100 `memeScore` throws rather than silently producing a meaningless number.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/metrics.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { precisionAtK, evPerAlert, alertVolumePerDay, rugRateAfterAlert,
         medianFillDecay, assertProbabilities, calibrationTable, brier } from '../metrics.js';

const alert = (net, over = {}) => ({
  label: { y_policy_net_positive: net > 0, y_policy_net_return: net,
           y_rugged: false, y_dead: false, ...over.label },
  ...over,
});

describe('precisionAtK (§19.4)', () => {
  it('is the profitable fraction of the top K', () => {
    const ranked = [alert(1), alert(-0.5), alert(2), alert(-1)];
    expect(precisionAtK(ranked, 2)).toBe(0.5);
    expect(precisionAtK(ranked, 4)).toBe(0.5);
  });
  it('returns null for an empty set instead of NaN', () => {
    expect(precisionAtK([], 10)).toBeNull();
  });
  it('ignores alerts with no label rather than counting them as failures', () => {
    expect(precisionAtK([alert(1), { label: null }], 2)).toBe(1);
  });
});

describe('evPerAlert (§19.4 — THE metric)', () => {
  it('is the mean net return, not the hit rate', () => {
    // 3 losers at -1 and 1 winner at +9 -> hit rate 25% but EV is positive
    const ranked = [alert(9), alert(-1), alert(-1), alert(-1)];
    expect(evPerAlert(ranked, 4)).toBeCloseTo(1.5, 10);
    expect(precisionAtK(ranked, 4)).toBe(0.25);
  });
  it('returns null with no labeled alerts', () => {
    expect(evPerAlert([], 10)).toBeNull();
  });
});

describe('operational metrics (§19.4)', () => {
  it('computes alert volume per day', () => {
    expect(alertVolumePerDay(60, 3 * 86_400_000)).toBeCloseTo(20, 10);
  });
  it('returns null for a zero-length window instead of dividing by zero', () => {
    expect(alertVolumePerDay(5, 0)).toBeNull();
  });
  it('computes the rug-after-alert rate', () => {
    const ranked = [alert(-1, { label: { y_rugged: true } }), alert(1)];
    expect(rugRateAfterAlert(ranked)).toBe(0.5);
  });
  it('computes median fill decay', () => {
    expect(medianFillDecay([0.01, 0.09, 0.05])).toBeCloseTo(0.05, 10);
    expect(medianFillDecay([])).toBeNull();
  });
});

describe('assertProbabilities (§19.4 gate)', () => {
  const ok = [{ p: 0.7, outcome: true, isProbability: true }];
  it('accepts marked probabilities in [0,1]', () => {
    expect(() => assertProbabilities(ok)).not.toThrow();
  });
  it('rejects a raw memeScore on the 0-100 scale', () => {
    expect(() => assertProbabilities([{ p: 75, outcome: true, isProbability: true }]))
      .toThrow(/\[0,1\]/);
  });
  it('rejects values that are not marked as calibrated probabilities', () => {
    expect(() => assertProbabilities([{ p: 0.75, outcome: true }]))
      .toThrow(/isProbability/);
  });
  it('rejects an empty set', () => {
    expect(() => assertProbabilities([])).toThrow(/no predictions/i);
  });
});

describe('brier / calibrationTable are gated (§19.4)', () => {
  const calibrated = [
    { p: 0.0, outcome: false, isProbability: true },
    { p: 1.0, outcome: true,  isProbability: true },
  ];
  it('brier throws on a raw memeScore', () => {
    expect(() => brier([{ p: 75, outcome: true, isProbability: true }])).toThrow();
  });
  it('brier computes for calibrated probabilities', () => {
    expect(brier(calibrated)).toBeCloseTo(0, 10);
  });
  it('calibrationTable throws on unmarked inputs', () => {
    expect(() => calibrationTable([{ p: 0.5, outcome: true }])).toThrow(/isProbability/);
  });
  it('calibrationTable bins calibrated probabilities with observed rates', () => {
    const t = calibrationTable(calibrated, 2);
    expect(t).toHaveLength(2);
    expect(t[0].rate).toBe(0);
    expect(t[1].rate).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/metrics.test.js`
Expected: FAIL — `Cannot find module '../metrics.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/calibration/metrics.js`:

```js
// Evaluation metrics (§19.4).
//
// The probability gate is a RUNTIME error, not a comment. The Report is explicit that Brier
// must never be computed against the raw Meme Score as though 75 meant 75% — so anything
// that is not an explicitly-marked probability in [0,1] throws.
export function assertProbabilities(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new Error('assertProbabilities: no predictions supplied');
  }
  for (const pr of predictions) {
    if (pr?.isProbability !== true) {
      throw new Error('assertProbabilities: input must be marked isProbability:true — ' +
        'a raw memeScore is a ranking index, not a probability (§14.1)');
    }
    if (typeof pr.p !== 'number' || !(pr.p >= 0 && pr.p <= 1)) {
      throw new Error(`assertProbabilities: p must be within [0,1], received ${pr?.p}`);
    }
  }
}

// ---- Pre-probability metrics: these are the operative ones today. ----

export function precisionAtK(ranked, k) {
  const labeled = ranked.slice(0, k).filter(t => t.label);
  if (!labeled.length) return null;                    // null, never NaN
  return labeled.filter(t => t.label.y_policy_net_positive).length / labeled.length;
}

// THE metric (§19.4): expected value net of costs, NOT hit rate. A 25% hit rate with one
// large winner can beat a 60% hit rate of small ones — which is why hit rate is not the gate.
export function evPerAlert(ranked, k) {
  const labeled = ranked.slice(0, k).filter(t => t.label);
  if (!labeled.length) return null;
  return labeled.reduce((s, t) => s + t.label.y_policy_net_return, 0) / labeled.length;
}

export function alertVolumePerDay(alertCount, windowMs) {
  if (!windowMs) return null;
  return alertCount / (windowMs / 86_400_000);
}

export function rugRateAfterAlert(ranked) {
  const labeled = ranked.filter(t => t.label);
  if (!labeled.length) return null;
  return labeled.filter(t => t.label.y_rugged).length / labeled.length;
}

export function medianFillDecay(decayFracs) {
  const xs = decayFracs.filter(v => typeof v === 'number').sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// ---- Post-probability metrics: gated until a calibration layer exists. ----

export function calibrationTable(predictions, bins = 10) {
  assertProbabilities(predictions);
  const table = Array.from({ length: bins }, (_, i) => ({
    binMid: (i + 0.5) / bins, n: 0, observed: 0 }));
  for (const { p, outcome } of predictions) {
    const b = Math.min(bins - 1, Math.floor(p * bins));
    table[b].n++; table[b].observed += outcome ? 1 : 0;
  }
  // Perfect calibration: rate ~= binMid. If the "0.75" bucket resolves at 0.40,
  // the thresholds are decoration.
  return table.map(r => ({ ...r, rate: r.n ? r.observed / r.n : null }));
}

export function brier(predictions) {
  assertProbabilities(predictions);
  return predictions.reduce((s, { p, outcome }) => s + (p - (outcome ? 1 : 0)) ** 2, 0)
    / predictions.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/metrics.test.js`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/metrics.js backend/src/calibration/__tests__/metrics.test.js
git commit -m "feat(calibration): EV/precision metrics + runtime probability gate on Brier (§19.4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Bootstrap percentile CI (§19.5)

**Files:**
- Create: `backend/src/calibration/bootstrap.js`
- Test: `backend/src/calibration/__tests__/bootstrap.test.js`

> **Spec (§19.5):** N is predeclared from a bootstrap simulation on validation replay — **"heavy-tailed returns — size N by bootstrap power, NOT a t-test."** Meme returns are extremely heavy-tailed (a few 50x winners among many −100% losers), so the CLT-based t-interval understates uncertainty badly. The percentile bootstrap makes no distributional assumption.
>
> The RNG is injected so every CI is reproducible — a verdict that changes between runs is not a verdict.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/bootstrap.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { bootstrapMeanCI, seededRng } from '../bootstrap.js';

describe('seededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = seededRng(42), b = seededRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('produces values within [0,1)', () => {
    const r = seededRng(7);
    for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('bootstrapMeanCI (§19.5)', () => {
  it('brackets the sample mean of a tight positive sample', () => {
    const samples = Array.from({ length: 200 }, () => 0.5);
    const ci = bootstrapMeanCI(samples, { iters: 500, alpha: 0.05, rng: seededRng(1) });
    expect(ci.mean).toBeCloseTo(0.5, 10);
    expect(ci.lower).toBeCloseTo(0.5, 6);
    expect(ci.upper).toBeCloseTo(0.5, 6);
  });

  it('is reproducible for the same seed', () => {
    const s = [1, -1, 2, -1, -1, 5, -1, -1];
    const a = bootstrapMeanCI(s, { iters: 300, alpha: 0.05, rng: seededRng(9) });
    const b = bootstrapMeanCI(s, { iters: 300, alpha: 0.05, rng: seededRng(9) });
    expect(a).toEqual(b);
  });

  it('returns a lower bound above zero for a clearly profitable sample', () => {
    const samples = Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? -1 : 0.8));
    const ci = bootstrapMeanCI(samples, { iters: 800, alpha: 0.05, rng: seededRng(3) });
    expect(ci.lower).toBeGreaterThan(0);
  });

  it('returns a lower bound below zero for a clearly losing sample', () => {
    const samples = Array.from({ length: 300 }, () => -0.6);
    const ci = bootstrapMeanCI(samples, { iters: 500, alpha: 0.05, rng: seededRng(4) });
    expect(ci.upper).toBeLessThan(0);
  });

  it('straddles zero for a heavy-tailed sample with a few big winners', () => {
    // 96 total losses, 4 twenty-baggers: mean is slightly positive, CI must straddle 0
    const samples = [...Array(96).fill(-1), ...Array(4).fill(20)];
    const ci = bootstrapMeanCI(samples, { iters: 2000, alpha: 0.05, rng: seededRng(11) });
    expect(ci.lower).toBeLessThan(0);
    expect(ci.upper).toBeGreaterThan(0);
  });

  it('reports n and returns nulls for an empty sample rather than NaN', () => {
    const ci = bootstrapMeanCI([], { iters: 10, alpha: 0.05, rng: seededRng(1) });
    expect(ci.n).toBe(0);
    expect(ci.mean).toBeNull();
    expect(ci.lower).toBeNull();
    expect(ci.upper).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/bootstrap.test.js`
Expected: FAIL — `Cannot find module '../bootstrap.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/calibration/bootstrap.js`:

```js
// Percentile bootstrap for the mean (§19.5).
//
// Why not a t-test: meme-token returns are severely heavy-tailed and bounded below at -1,
// so the normal approximation understates uncertainty exactly where it matters. The
// percentile bootstrap assumes no distribution. The RNG is injected so a verdict is
// reproducible — a confidence interval that moves between runs is not evidence.
export function seededRng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

export function bootstrapMeanCI(samples, { iters = 2000, alpha = 0.05, rng } = {}) {
  const xs = samples.filter(v => typeof v === 'number' && Number.isFinite(v));
  const n = xs.length;
  if (!n) return { n: 0, mean: null, lower: null, upper: null, iters, alpha };

  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const draw = rng ?? seededRng(1);
  const means = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += xs[Math.floor(draw() * n)];  // resample WITH replacement
    means[i] = sum / n;
  }
  means.sort((a, b) => a - b);
  const at = q => means[Math.min(iters - 1, Math.max(0, Math.floor(q * iters)))];
  return { n, mean, lower: at(alpha / 2), upper: at(1 - alpha / 2), iters, alpha };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/bootstrap.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/bootstrap.js backend/src/calibration/__tests__/bootstrap.test.js
git commit -m "feat(calibration): reproducible percentile bootstrap CI, not a t-test (§19.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Replay/live parity check (§22 CI invariant → operational check)

**Files:**
- Create: `backend/src/calibration/parityCheck.js`
- Test: `backend/src/calibration/__tests__/parityCheck.test.js`

> **Spec (§22):** CI invariant #1 — `causalFeatures` and the live extractor are the same function; replay and production can never drift. **(§19.5 condition 5):** GO requires **zero unresolved replay/live parity failures on the control sample**. So parity must be measurable at runtime over real assets, not only asserted once in a unit test.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/parityCheck.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { compareFeatures, checkParity } from '../parityCheck.js';

describe('compareFeatures (§22)', () => {
  it('reports no differences for identical objects', () => {
    expect(compareFeatures({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });
  it('detects a changed leaf value with its path', () => {
    const d = compareFeatures({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } });
    expect(d).toEqual([{ path: 'b.c', live: 2, replay: 3 }]);
  });
  it('detects a missing key on either side', () => {
    expect(compareFeatures({ a: 1 }, {})).toEqual([{ path: 'a', live: 1, replay: undefined }]);
    expect(compareFeatures({}, { a: 1 })).toEqual([{ path: 'a', live: undefined, replay: 1 }]);
  });
  it('treats null and 0 as different — unknown is not zero', () => {
    expect(compareFeatures({ a: null }, { a: 0 }))
      .toEqual([{ path: 'a', live: null, replay: 0 }]);
  });
  it('tolerates float noise within epsilon', () => {
    expect(compareFeatures({ a: 0.1 + 0.2 }, { a: 0.3 })).toEqual([]);
  });
});

describe('checkParity (§19.5 condition 5)', () => {
  const same = { structural: { x: 1 }, dynamic: { y: 2 } };

  it('passes when every control asset matches', async () => {
    const r = await checkParity({
      assetKeys: ['a', 'b'],
      liveFeaturesFor: vi.fn(async () => same),
      replayFeaturesFor: vi.fn(async () => same),
    });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(2);
  });

  it('fails and names the diverging asset and path', async () => {
    const r = await checkParity({
      assetKeys: ['ok', 'bad'],
      liveFeaturesFor: async k => (k === 'bad' ? { structural: { x: 1 } } : same),
      replayFeaturesFor: async k => (k === 'bad' ? { structural: { x: 9 } } : same),
    });
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].assetKey).toBe('bad');
    expect(r.failures[0].diffs[0].path).toBe('structural.x');
  });

  it('treats an extractor throw as a parity failure, not a silent pass', async () => {
    const r = await checkParity({
      assetKeys: ['boom'],
      liveFeaturesFor: async () => { throw new Error('rpc down'); },
      replayFeaturesFor: async () => same,
    });
    expect(r.pass).toBe(false);
    expect(r.failures[0].error).toMatch(/rpc down/);
  });

  it('does not vacuously pass on an empty control sample', async () => {
    const r = await checkParity({ assetKeys: [],
      liveFeaturesFor: async () => same, replayFeaturesFor: async () => same });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('empty_control_sample');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/parityCheck.test.js`
Expected: FAIL — `Cannot find module '../parityCheck.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/calibration/parityCheck.js`:

```js
// Replay/live feature parity as an OPERATIONAL check (§22 invariant, §19.5 condition 5).
// The unit test proves the two paths are the same function; this proves they produce the
// same values on real control-sample assets, which is what the GO gate actually requires.
const EPS = 1e-9;

export function compareFeatures(live, replay, path = '') {
  const diffs = [];
  const keys = new Set([...Object.keys(live ?? {}), ...Object.keys(replay ?? {})]);
  for (const k of keys) {
    const p = path ? `${path}.${k}` : k;
    const a = live?.[k], b = replay?.[k];
    const bothObjects = a && b && typeof a === 'object' && typeof b === 'object'
      && !Array.isArray(a) && !Array.isArray(b);
    if (bothObjects) { diffs.push(...compareFeatures(a, b, p)); continue; }
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > EPS) diffs.push({ path: p, live: a, replay: b });
      continue;
    }
    // Strict inequality elsewhere: null vs 0 IS a difference (unknown != zero, §5.2.7).
    if (a !== b) diffs.push({ path: p, live: a, replay: b });
  }
  return diffs;
}

export async function checkParity({ assetKeys, liveFeaturesFor, replayFeaturesFor }) {
  // An empty control sample must never read as a pass — that is how a broken
  // control sample would silently satisfy the GO gate.
  if (!assetKeys?.length) {
    return { pass: false, reason: 'empty_control_sample', checked: 0, failures: [] };
  }

  const failures = [];
  for (const assetKey of assetKeys) {
    try {
      const [live, replay] = await Promise.all([
        liveFeaturesFor(assetKey), replayFeaturesFor(assetKey),
      ]);
      const diffs = compareFeatures(live, replay);
      if (diffs.length) failures.push({ assetKey, diffs });
    } catch (err) {
      // A throw is a failure. Swallowing it would turn an outage into a green check.
      failures.push({ assetKey, error: String(err.message ?? err), diffs: [] });
    }
  }
  return { pass: failures.length === 0, checked: assetKeys.length, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/parityCheck.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/parityCheck.js backend/src/calibration/__tests__/parityCheck.test.js
git commit -m "feat(calibration): operational replay/live parity check on the control sample (§22,§19.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: The go/no-go verdict — frozen, per cohort (§19.5)

**Files:**
- Create: `backend/src/calibration/verdict.js`
- Modify: `backend/src/memefinder/routes.js`
- Test: `backend/src/calibration/__tests__/verdict.test.js`

> **Spec (§19.5):** GO requires **all five** conditions; NO-GO when the CI is entirely below 0 after N; EXTEND when it straddles 0 (continue to 2N **once**, then verdict). Evaluated **independently per cohort** (`pump-curve` vs `post-migration`) — a partial pass is a legitimate outcome where one regime goes live and the other stays watching-only.
>
> This rule must be **frozen before shadow mode starts**. Implementing it as code, tested, is what "frozen" means in practice — the thresholds live in `config.calibration` and changing them is a versioned decision (§22).

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/verdict.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { evaluateVerdict, evaluateCohort } from '../verdict.js';
import { seededRng } from '../bootstrap.js';

const cfg = {
  calibration: { bootstrapIters: 500, bootstrapAlpha: 0.05, minQualifiedAlerts: 10,
                 rugCeilingFrac: 0.30, maxMedianFillDecayFrac: 0.05 },
};
// helper: n alerts each returning `net`
const returns = (n, net) => Array.from({ length: n }, () => net);

const cohort = (over = {}) => ({
  netReturns: returns(20, 0.8),
  rugRate: 0.1,
  medianFillDecay: 0.02,
  parity: { pass: true, failures: [] },
  extended: false,
  ...over,
});

describe('evaluateCohort (§19.5)', () => {
  const rng = () => seededRng(5);

  it('returns INSUFFICIENT below N and does not judge', () => {
    const r = evaluateCohort(cohort({ netReturns: returns(3, 0.8) }), { cfg, rng: rng() });
    expect(r.verdict).toBe('INSUFFICIENT');
    expect(r.reasons).toContain('n_below_minimum');
  });

  it('returns GO when all five conditions hold', () => {
    const r = evaluateCohort(cohort(), { cfg, rng: rng() });
    expect(r.verdict).toBe('GO');
    expect(r.ci.lower).toBeGreaterThan(0);
  });

  it('returns NO_GO when the CI is entirely below zero', () => {
    const r = evaluateCohort(cohort({ netReturns: returns(20, -0.6) }), { cfg, rng: rng() });
    expect(r.verdict).toBe('NO_GO');
    expect(r.ci.upper).toBeLessThan(0);
  });

  it('returns EXTEND when the CI straddles zero and the cohort has not been extended', () => {
    const heavy = [...Array(18).fill(-1), ...Array(2).fill(12)];
    const r = evaluateCohort(cohort({ netReturns: heavy }), { cfg, rng: rng() });
    expect(r.verdict).toBe('EXTEND');
    expect(r.targetN).toBe(cfg.calibration.minQualifiedAlerts * 2);
  });

  it('extends only ONCE — a straddling CI after extension is NO_GO', () => {
    const heavy = [...Array(18).fill(-1), ...Array(2).fill(12)];
    const r = evaluateCohort(cohort({ netReturns: heavy, extended: true }), { cfg, rng: rng() });
    expect(r.verdict).toBe('NO_GO');
    expect(r.reasons).toContain('extension_exhausted');
  });

  it('blocks GO when the rug rate exceeds the ceiling', () => {
    const r = evaluateCohort(cohort({ rugRate: 0.9 }), { cfg, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('rug_rate_above_ceiling');
  });

  it('blocks GO when median fill decay exceeds the policy assumption', () => {
    const r = evaluateCohort(cohort({ medianFillDecay: 0.20 }), { cfg, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('fill_decay_above_policy');
  });

  it('blocks GO on any unresolved parity failure', () => {
    const r = evaluateCohort(
      cohort({ parity: { pass: false, failures: [{ assetKey: 'x' }] } }), { cfg, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('parity_failures_unresolved');
  });

  it('blocks GO when the parity check had an empty control sample', () => {
    const r = evaluateCohort(
      cohort({ parity: { pass: false, reason: 'empty_control_sample', failures: [] } }),
      { cfg, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('parity_failures_unresolved');
  });
});

describe('evaluateVerdict (§19.5 per-cohort independence)', () => {
  it('judges each cohort independently and allows a partial pass', () => {
    const out = evaluateVerdict({
      'pump-curve': cohort(),
      'post-migration': cohort({ netReturns: returns(20, -0.6) }),
    }, { cfg, rng: seededRng(5) });

    expect(out.cohorts['pump-curve'].verdict).toBe('GO');
    expect(out.cohorts['post-migration'].verdict).toBe('NO_GO');
    expect(out.overall).toBe('PARTIAL');
  });

  it('reports GO overall only when every cohort is GO', () => {
    const out = evaluateVerdict(
      { 'pump-curve': cohort(), 'post-migration': cohort() }, { cfg, rng: seededRng(5) });
    expect(out.overall).toBe('GO');
  });

  it('reports NO_GO overall when no cohort passes', () => {
    const bad = cohort({ netReturns: returns(20, -0.6) });
    const out = evaluateVerdict(
      { 'pump-curve': bad, 'post-migration': bad }, { cfg, rng: seededRng(5) });
    expect(out.overall).toBe('NO_GO');
  });

  it('never reports GO while any cohort is still INSUFFICIENT', () => {
    const out = evaluateVerdict({
      'pump-curve': cohort(),
      'post-migration': cohort({ netReturns: returns(2, 0.8) }),
    }, { cfg, rng: seededRng(5) });
    expect(out.overall).not.toBe('GO');
    expect(out.cohorts['post-migration'].verdict).toBe('INSUFFICIENT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/verdict.test.js`
Expected: FAIL — `Cannot find module '../verdict.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/calibration/verdict.js`:

```js
// The frozen go/no-go rule (§19.5). Implemented as tested code because "frozen before
// shadow mode starts" only means something if the rule cannot be renegotiated after
// seeing the results. Thresholds live in config.calibration; changing them is versioned (§22).
//
// Cohorts are judged INDEPENDENTLY: a partial pass is legitimate — one regime can go live
// while the other stays watching-only.
import { bootstrapMeanCI, seededRng } from './bootstrap.js';

export function evaluateCohort(cohort, { cfg, rng }) {
  const C = cfg.calibration;
  const n = cohort.netReturns?.length ?? 0;
  const minN = cohort.extended ? C.minQualifiedAlerts * 2 : C.minQualifiedAlerts;
  const reasons = [];

  // Condition 1: N closed-horizon qualified alerts. Below it we do not judge at all —
  // an early verdict on a thin sample is the mistake the rule exists to prevent.
  if (n < minN) {
    return { verdict: 'INSUFFICIENT', n, requiredN: minN,
             reasons: ['n_below_minimum'], ci: null };
  }

  const ci = bootstrapMeanCI(cohort.netReturns, {
    iters: C.bootstrapIters, alpha: C.bootstrapAlpha, rng: rng ?? seededRng(1) });

  // Conditions 3-5 are hard gates on GO regardless of the interval.
  if (cohort.rugRate != null && cohort.rugRate > C.rugCeilingFrac) reasons.push('rug_rate_above_ceiling');
  if (cohort.medianFillDecay != null && cohort.medianFillDecay > C.maxMedianFillDecayFrac) {
    reasons.push('fill_decay_above_policy');
  }
  if (!cohort.parity?.pass) reasons.push('parity_failures_unresolved');

  // Condition 2 drives the three-way decision.
  if (ci.upper != null && ci.upper < 0) {
    return { verdict: 'NO_GO', n, ci, reasons: [...reasons, 'ci_entirely_below_zero'] };
  }
  const straddles = ci.lower != null && ci.lower <= 0 && ci.upper != null && ci.upper >= 0;
  if (straddles) {
    if (cohort.extended) {
      return { verdict: 'NO_GO', n, ci, reasons: [...reasons, 'extension_exhausted'] };
    }
    return { verdict: 'EXTEND', n, ci, targetN: C.minQualifiedAlerts * 2,
             reasons: [...reasons, 'ci_straddles_zero'] };
  }

  // CI lower bound above zero: GO only if nothing else objected.
  if (reasons.length) return { verdict: 'NO_GO', n, ci, reasons };
  return { verdict: 'GO', n, ci, reasons: [] };
}

export function evaluateVerdict(cohorts, { cfg, rng }) {
  const out = {};
  for (const [name, data] of Object.entries(cohorts)) {
    // Each cohort gets its own RNG stream derived from the name so results are stable
    // and independent of iteration order.
    const seed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    out[name] = evaluateCohort(data, { cfg, rng: rng ? seededRng(seed) : seededRng(seed) });
  }
  const verdicts = Object.values(out).map(v => v.verdict);
  const overall = verdicts.every(v => v === 'GO') ? 'GO'
    : verdicts.some(v => v === 'GO') ? 'PARTIAL'
    : verdicts.some(v => v === 'EXTEND' || v === 'INSUFFICIENT') ? 'PENDING'
    : 'NO_GO';
  return { cohorts: out, overall };
}
```

- [ ] **Step 4: Expose the verdict read-only**

In `backend/src/memefinder/routes.js`, accept an optional `verdictProvider` in the factory options and add **above** the `/token/:assetKey` route:

```js
  // Read-only. Reporting GO does not act on it — a human decides (§20, §25).
  router.get('/verdict', (req, res) => {
    if (!verdictProvider) return res.json({ overall: 'PENDING', cohorts: {},
      note: 'shadow run not started' });
    res.json(verdictProvider());
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/calibration/__tests__/verdict.test.js src/memefinder/__tests__/routes.test.js`
Expected: PASS — 13 verdict tests plus the Phase 5 route tests still green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/calibration/verdict.js backend/src/calibration/__tests__/verdict.test.js backend/src/memefinder/routes.js
git commit -m "feat(calibration): frozen per-cohort go/no-go verdict rule (§19.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Shadow-run operating procedure (documentation, §19.3, §19.5, §27)

**Files:**
- Create: `docs/meme-finder-shadow-run-procedure.md`

> This is the human procedure the code serves. It is deliberately a document, not code: §19.3's refit cadence and §27's acceptance checklist are process obligations. Writing it down before the run starts is what stops the thresholds from being renegotiated after seeing results.

- [ ] **Step 1: Write the procedure**

Create `docs/meme-finder-shadow-run-procedure.md`:

```markdown
# Meme Finder — Shadow Run Operating Procedure

_Frozen before shadow mode begins. Changing anything here after the run starts invalidates the verdict._

## 0. Preconditions

- [ ] Phases 1–6 implemented; `cd backend && npm test` and `cd frontend && npm test` green.
- [ ] `CONFIG.status` still reads `v1-placeholder — thresholds NOT calibrated. Do not automate.`
- [ ] Postgres reachable via `DATABASE_URL`; `migrate()` applied.
- [ ] `market_snapshot` events confirmed flowing (Task 1) — verify a non-zero count, because
      without them every value label is null and the verdict is meaningless.
- [ ] `token_created` events at `schemaVersion: 2` carrying `rawSupply`/`decimals`/`curveTargetSol`.
- [ ] Control sample active at 5–10% of launches, receiving identical monitoring depth.

## 1. Predeclare N (before any alert is judged)

Run the bootstrap on **validation replay** (not the live run) to size N per cohort:

1. Replay the validation period; build labels with `buildLabel`.
2. For candidate N in {100, 200, 400, 800}, bootstrap the mean net return.
3. Choose the smallest N whose CI half-width is small enough to separate "positive" from
   "zero" at the effect size you would actually trade.
4. **Write the chosen N into `config.calibration.minQualifiedAlerts` and do not change it.**

Default placeholder is 200 per cohort. Sizing is by bootstrap power, never a t-test — returns
are heavy-tailed and bounded below at −1.

## 2. Data splits (§19.3)

- Time-based train / validation / **untouched** test periods. Never random-split — the base
  rate drifts.
- Report `pump-curve` and `post-migration` separately, always.
- Keep the control sample outside the hot gate to measure selection bias.
- Refit only on the scheduled monthly cadence, and only after a new version is approved.
  **Never continuously tune from the system's own selected alerts** — the gate would shape
  the data that tunes the gate.

## 3. Run the shadow window

- Minimum operational burn-in: **7 days** (ingestion, scoring, reconnect, alert correctness).
  This proves the plumbing; it does **not** establish an edge.
- Continue until N closed 6-hour horizons per cohort — likely **30–90 days**. The calendar is
  a consequence of reaching N, never the gate itself.
- Every qualified alert records a `policyDecision` via `recordShadowDecision`. No transaction
  is ever sent.
- Daily: check `GET /api/memefinder/health` for ingestion lag, duplicate rate, coverage by
  family, blocker counts, and hot-queue evictions. A provider outage must show as lowered
  coverage or `BAD_DATA` — never as a positive score.

## 4. Weekly parity check (§19.5 condition 5)

Run `checkParity` over the control sample. Any failure must be **resolved**, not waived —
an unresolved parity failure blocks GO. An empty control sample also blocks GO, by design.

## 5. The verdict (§19.5)

Run `evaluateVerdict` per cohort. The rule, verbatim:

- **GO** requires ALL of: N reached; bootstrap 95% CI lower bound on mean policy net return
  > 0; rug-after-alert rate ≤ ceiling; median fill decay within policy slippage; zero
  unresolved parity failures.
- **NO-GO**: CI entirely below 0 after N.
- **EXTEND**: CI straddles 0 → continue to 2N, **once**, then verdict.

Cohorts are independent. A partial pass is a legitimate outcome: one regime goes live,
the other stays watching-only.

## 6. After the verdict

- A GO does **not** enable automation. It authorises writing an execution plan, which is a
  separate reviewed change with its own risk controls and `DRY_RUN` discipline.
- A NO-GO is a **successful outcome**: it replaces unverifiable channel signals with numbers
  you own. Record it and stop, rather than retuning until the answer changes (§25).
- The most likely honest result is thin-to-negative EV after costs. This was built as a
  measurement instrument first and a trading tool second.

## 7. §27 acceptance checklist mapping

| §27 requirement | Artifact |
|---|---|
| exact files/modules | Phase 1–6 plan File Structure sections |
| persistent schema + migration | `tape/schema.sql`, `tape/migrate.js` (Phase 1) |
| provider contracts + reconnect | `discovery/pumpfun.js`, `IngestionStats` (Phase 2) |
| concurrency/batching/RPC budgets | shared-context §14; WS6 resolver caps (Phase 3) |
| feature formulas/units/min samples | Phases 3–4 feature modules + tests |
| score + config versioning | `scoring/config.js` `version`; §22 CI check |
| blocker + admission transitions | `scoring/blockers.js`, `admission.js`, `monitoring/lifecycle.js` |
| API + WS contracts | `memefinder/routes.js` (Phase 5) |
| removal of frontend strategies | Phase 5 Task 12 |
| bootstrap + replay procedure | this document, §1–§4 |
| tests for every boundary/defect | Phase 1 Tasks 4–12; all phase suites |
| dashboards + alerts | `QueueStats`, `/api/memefinder/health` |
| shadow start / min sample / verdict | this document, §3–§5 |
| rollback with no tape loss | tape is append-only; eviction writes aggregates only |
```

- [ ] **Step 2: Commit**

```bash
git add docs/meme-finder-shadow-run-procedure.md
git commit -m "docs: shadow-run operating procedure + §27 acceptance mapping (§19.3,§19.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Full regression + phase close

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-meme-finder-phase6-replay-verdict.md` (check off completed tasks)

- [ ] **Step 1: Run the entire backend suite**

Run: `cd backend && npm test`
Expected: PASS. New in this phase: 8 (marketSnapshot) + 4 (identity v2) + 9 (syntheticTape) + 12 (execution) + 11 (labels) + 10 (policy stub) + 16 (metrics) + 8 (bootstrap) + 9 (parityCheck) + 13 (verdict) = **100 new backend tests**, with all Phase 1–5 suites still green.

- [ ] **Step 2: Run the frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — unchanged by this phase (no frontend files modified).

- [ ] **Step 3: Confirm the phase invariants by inspection**

Verify each; fix rather than rationalise any failure:

- [ ] `market_snapshot` events are written and contain `priceUsd` but **no** `marketCapUsd` (§7.2).
- [ ] `grep -rn "1e9\|1_000_000_000" backend/src/calibration backend/src/features/mcap.js` shows no supply assumption — supply always comes from `token_created`.
- [ ] `grep -rn "extractAllFeatures\|causalFeatures" backend/src/calibration` shows labels **delegating** to `features/extract.js`, with no second extraction path (§22).
- [ ] `brier` and `calibrationTable` throw when handed a 0–100 score; no caller passes `memeScore` (§19.4).
- [ ] `buildLabel` returns finite numbers or `null` in every field for every scenario — no `-Infinity` anywhere (§19.2).
- [ ] Costs compound: `applyCost(1,[0.05,0.05]) === 0.9025`, not `0.90` (§20).
- [ ] `grep -rn "executor\|sendTransaction\|signTransaction" backend/src/policy backend/src/calibration` returns nothing — no execution path exists in this phase (§20, §25).
- [ ] `evaluateVerdict` judges cohorts independently and never reports GO while any cohort is `INSUFFICIENT` or on any unresolved parity failure (§19.5).
- [ ] `checkParity` on an empty control sample returns `pass: false`, so a broken control sample cannot satisfy the GO gate.
- [ ] `CONFIG.status` still warns that thresholds are uncalibrated, and no code claims calibration.

- [ ] **Step 4: Commit the phase close**

```bash
git add docs/superpowers/plans/2026-07-24-meme-finder-phase6-replay-verdict.md
git commit -m "docs(plan): close Phase 6 — replay, labels, shadow policy, go/no-go verdict

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**1. Spec coverage.** Every WS11/WS12 requirement maps to a task:

| Report requirement | Task |
|---|---|
| §9.2 `market_snapshot` emitted (Gap A) | 1 |
| §7.2 supply-aware mcap, no fixed-supply value | 1, 2, 5 |
| §13 Gap 1/2 `curveTargetSol`/`rawSupply`/`decimals` at schemaVersion 2 | 2 |
| §26.0 synthetic tapes with known ground truth | 3 |
| §20 multiplicative entry/exit costs | 4 |
| §19.2 causal fill, dead-token guard, no `-Infinity` | 4, 5 |
| §7.1 primary policy-net label | 5 |
| §7.2 secondary labels (`peak`, `hit_mcap`, `graduated`, `rugged`, `dead`) | 5 |
| §19.2 one shared extractor for replay | 5 |
| §20 shadow policy fields, log-only | 6 |
| §13 Gap 3 unset sell route never blocks | 6 |
| §19.4 EV/precision/volume/rug/decay metrics | 7 |
| §19.4 Brier gated on calibrated probabilities | 7 |
| §19.5 bootstrap sizing, not a t-test | 8 |
| §22 replay/live parity as an operational check | 9 |
| §19.5 five GO conditions, NO-GO, single EXTEND | 10 |
| §19.5 per-cohort independence, partial pass | 10 |
| §19.3 splits + monthly refit cadence | 11 |
| §19.5 predeclared N procedure | 11 |
| §24 daily health monitoring | 11 |
| §25 negative result is a success | 11 |
| §27 acceptance checklist mapping | 11 |

**2. Placeholder scan.** No "TBD", "add error handling", "similar to Task N", or "write tests for the above". Every code step shows complete runnable code; every test step shows full assertions.

**3. Type/name consistency.** Consumes upstream symbols exactly as defined: `Tape.append`/`eventsUntil`, `EVENT_TYPES` (with real string values `token_created`, `trade_observed`, `market_snapshot`, `baseline_closed`, `migration_observed`, `funding_link`), `eventId`, `migrate`, `supplyAwareMcap({rawSupply, decimals, priceUsd})`, `causalFeatures`, `CONFIG.policy`, `seededRng`. New symbols used consistently throughout: `emitMarketSnapshot`/`snapshotPayload`, `tokenCreatedPayload`/`TOKEN_CREATED_SCHEMA_VERSION`, `generateScenario`/`loadScenario`/`SCENARIOS`, `applyCost`/`simulateEntry`/`simulateExitLadder`, `buildLabel`/`buildReplayFeatures`, `policyDecision`/`recordShadowDecision`, `assertProbabilities`/`precisionAtK`/`evPerAlert`/`alertVolumePerDay`/`rugRateAfterAlert`/`medianFillDecay`/`calibrationTable`/`brier`, `bootstrapMeanCI`, `compareFeatures`/`checkParity`, `evaluateCohort`/`evaluateVerdict`.

**4. Two upstream gaps closed explicitly, not silently.** Task 1 owns the `market_snapshot` emitter that shared-context §13 assigned to WS7 but Phase 4 never wrote — with the consequence stated (every value label null → a mechanical, false NO-GO). Task 2 replaces Phase 3's hardcoded `85_000_000_000` curve-target default with tape-sourced truth and adds the `rawSupply`/`decimals` that `supplyAwareMcap` needs. Both are flagged as intentional supersessions so an executing agent does not read the changed Phase 3 default as its own regression.

**5. Deferred work is named.** No probability model is fitted (metrics are gated, not fabricated); monthly refit is procedure not code; the `sell_route_check` emitter remains WS8's, with Task 6 asserting the safe `undefined` behaviour in the meantime.

**6. No automation is enabled anywhere.** `policyDecision` returns `shadow_enter` and writes a log row; Task 12 greps to prove no executor or transaction-signing path exists in `policy/` or `calibration/`. A GO verdict authorises writing an execution plan later — it does not itself trade.
