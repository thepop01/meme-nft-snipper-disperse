# Meme Finder — Phase 2: Staged Ingestion + Causal Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Phase 1 event tape *correctly* — an unbiased staged collection of every Pump.fun launch's creation/trade/migration events with explicit right-censoring — and build the causal read layer (fixed-window aggregation + immutable snapshots + one shared feature extractor) that every downstream feature and the replay harness will consume.

**Architecture:** Phase 1 delivered `Tape` (idempotent append + causal `eventsUntil`), `assetKey`/`EVENT_TYPES`/`validateEnvelope`, the chain-scope gate, and `handlePumpMessage`. Phase 2 covers **Workstream 3** (staged ingestion — Stage A unbiased baseline with `baseline_closed`, Stage B cheap allocation, Stage C hot monitoring with a mandatory control sample; reconnect/resume/observability) and **Workstream 4** (fixed-window `bucketize`, immutable `initSnapshot`/`reduceSnapshot`, supply-aware market cap, and the single `extractAllFeatures`/`causalFeatures` extractor shared by live and replay). No scoring, blockers, or admission yet — those are Phase 3 (WS5–WS8).

**Tech Stack:** Node ESM, `ws`, `pg` + `pg-mem` (from Phase 1), Vitest. All time comes from an **injected clock** (never `Date.now()` inside logic) so replay is deterministic; all randomness comes from an **injected RNG** so control-sampling is testable.

**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` — §10 collection strategy + §10.1 ingestion contract, §9.4 tape invariants, §24 observability (WS3); §12.3.1 windowing, §12.3.2 snapshots, §19.1–§19.2 causal extractor, §22 CI parity invariant, §7.2/§19.2 supply-aware mcap (WS4). Section references below point there.

**Depends on Phase 1:** `docs/superpowers/plans/2026-07-24-meme-finder-phase1-event-tape.md` must be complete (tape, identity, `handlePumpMessage`, `EVENT_TYPES` incl. `BASELINE_CLOSED`, `HOLDER_SNAPSHOT`, `MARKET_SNAPSHOT`).

---

## File Structure

**Create — Workstream 3 (staged ingestion):**
- `backend/src/discovery/clock.js` — injectable monotonic clock (`systemClock`) + a `manualClock` for tests. One responsibility: time, so nothing else calls `Date.now()`.
- `backend/src/discovery/baselineController.js` — Stage A per-asset baseline state machine: open on create, count swaps, decide close by `window` vs `min_swaps`, emit the `baseline_closed` censoring event.
- `backend/src/discovery/monitorBudget.js` — Stage B/C: promote after ≥5 buys, hot-set capacity, and the mandatory 5–10% random control sample (injected RNG, identical depth).
- `backend/src/discovery/ingestionStats.js` — observability counters (received/type, reconnects, duplicates, parse failures, lag).
- `backend/src/discovery/__tests__/baselineController.test.js`
- `backend/src/discovery/__tests__/monitorBudget.test.js`
- `backend/src/discovery/__tests__/ingestionStats.test.js`

**Create — Workstream 4 (causal read layer):**
- `backend/src/features/mcap.js` — supply-aware market cap (raw supply × price ÷ 10^decimals). Never `price × 1e9`.
- `backend/src/features/windows.js` — `bucketize` fixed-window aggregation with `partial` flag (§12.3.1).
- `backend/src/features/snapshots.js` — immutable `initSnapshot`/`reduceSnapshot` (§12.3.2).
- `backend/src/features/extract.js` — `extractAllFeatures(events)` + `causalFeatures(tape, assetKey, asOf)`; the one extractor shared by live and replay (§19.1, §22).
- `backend/src/features/__tests__/mcap.test.js`
- `backend/src/features/__tests__/windows.test.js`
- `backend/src/features/__tests__/snapshots.test.js`
- `backend/src/features/__tests__/extract.test.js`
- `backend/src/features/__tests__/parity.test.js` — CI invariant: live and replay call the identical function reference (§22).

**Modify:**
- `backend/src/discovery/pumpfun.js` — on `token_created` subscribe that mint's trades and open a baseline; count swaps into the controller; on close emit `baseline_closed` and unsubscribe unless hot-promoted; reconnect + resubscribe with checkpoint; feed `ingestionStats`.
- `backend/src/config.js` — add a `collection` config block (baseline window, min-swaps, hot limit, control-sample rate).
- `backend/server.js` — construct `baselineController`, `monitorBudget`, `ingestionStats` with the system clock/RNG and pass them into `startPumpFeed`.

**Scope note (honest):** Stage B's "cheap preliminary allocation" here computes only trade-derived preliminary evidence and decides hot-promotion. The *actual* holder/funding RPC work it allocates is Workstream 6 (Phase 3) — this plan wires the allocation decision and the promotion path, not the RPC calls. Called out at Task 5.

---

## Task 1: Injectable clock

**Files:**
- Create: `backend/src/discovery/clock.js`
- Test: covered via `baselineController` tests (Task 3); no standalone test needed for a 6-line module.

- [ ] **Step 1: Write the clock**

Create `backend/src/discovery/clock.js`:
```js
// The ONLY place time enters ingestion logic. Replay/tests inject manualClock so behavior
// is deterministic and no module calls Date.now() directly. (§10.1 injected clock)
export const systemClock = { now: () => Date.now() };

export function manualClock(startMs = 0) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; return t; } };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/discovery/clock.js
git commit -m "feat(ingestion): injectable clock (system + manual) — no Date.now() in logic"
```

---

## Task 2: Collection config

**Files:**
- Modify: `backend/src/config.js`

- [ ] **Step 1: Add the collection block**

In `backend/src/config.js`, add to the exported config object:
```js
collection: {
  baselineWindowMs: 5 * 60_000,   // Stage A: how long to keep an unbiased trade baseline open
  baselineMinSwaps: 30,           // ...or close early once this many swaps observed (right-censor)
  stageBMinBuys: 5,               // Stage B: preliminary allocation after >= 5 observed buys
  hotLimit: 200,                  // Stage C: evictable hot-monitoring capacity
  controlSampleRate: 0.07,        // 5-10% of launches monitored at identical depth (bias control)
},
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/config.js
git commit -m "feat(ingestion): collection config — baseline window, min-swaps, hot limit, control rate"
```

---

## Task 3: Stage A baseline controller + `baseline_closed` (right-censoring)

**Files:**
- Create: `backend/src/discovery/baselineController.js`
- Test: `backend/src/discovery/__tests__/baselineController.test.js`

> **Spec (§10 Stage A):** every launch's trades are collected until EITHER the window elapses OR a min-swap count is reached; when it closes, emit a `baseline_closed` event recording **which** condition fired. "Failed to reach 30 swaps in T seconds" is itself a causal signal — a token cut at 30 swaps is *right-censored*, not "missing data."

- [ ] **Step 1: Write the failing test**

Create `backend/src/discovery/__tests__/baselineController.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { manualClock } from '../clock.js';
import { BaselineController } from '../baselineController.js';

const cfg = { baselineWindowMs: 1000, baselineMinSwaps: 3 };

function make() {
  const clock = manualClock(0);
  const onClose = vi.fn();
  const c = new BaselineController({ cfg, clock, onClose });
  return { clock, onClose, c };
}

describe('BaselineController', () => {
  it('closes with reason "min_swaps" when the swap count is reached first', () => {
    const { c, onClose } = make();
    c.open('solana:pumpfun:A');
    c.recordSwap('solana:pumpfun:A');
    c.recordSwap('solana:pumpfun:A');
    c.recordSwap('solana:pumpfun:A'); // 3rd swap hits min
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toMatchObject({
      assetKey: 'solana:pumpfun:A', reason: 'min_swaps', swapsObserved: 3,
    });
  });

  it('closes with reason "window" when time elapses before min swaps', () => {
    const { c, clock, onClose } = make();
    c.open('solana:pumpfun:B');
    c.recordSwap('solana:pumpfun:B'); // only 1 swap
    clock.advance(1000);
    c.tick(); // window check
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toMatchObject({
      assetKey: 'solana:pumpfun:B', reason: 'window', swapsObserved: 1,
    });
  });

  it('records durationMs from open to close', () => {
    const { c, clock, onClose } = make();
    c.open('solana:pumpfun:C');
    clock.advance(400);
    c.recordSwap('solana:pumpfun:C');
    c.recordSwap('solana:pumpfun:C');
    c.recordSwap('solana:pumpfun:C');
    expect(onClose.mock.calls[0][0].durationMs).toBe(400);
  });

  it('never closes the same asset twice', () => {
    const { c, clock, onClose } = make();
    c.open('solana:pumpfun:D');
    c.recordSwap('solana:pumpfun:D');
    c.recordSwap('solana:pumpfun:D');
    c.recordSwap('solana:pumpfun:D'); // closes
    clock.advance(5000);
    c.tick();
    c.recordSwap('solana:pumpfun:D'); // post-close swaps ignored
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('isOpen reports whether a baseline is still collecting', () => {
    const { c } = make();
    c.open('solana:pumpfun:E');
    expect(c.isOpen('solana:pumpfun:E')).toBe(true);
    c.recordSwap('solana:pumpfun:E');
    c.recordSwap('solana:pumpfun:E');
    c.recordSwap('solana:pumpfun:E');
    expect(c.isOpen('solana:pumpfun:E')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/baselineController.test.js`
Expected: FAIL — cannot resolve `../baselineController.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/discovery/baselineController.js`:
```js
// Stage A: keep an UNBIASED trade baseline open for every launch until window OR min-swaps.
// Emits the censoring reason so replay can tell "slow token" from "missing data". (§10)
export class BaselineController {
  constructor({ cfg, clock, onClose }) {
    this.cfg = cfg; this.clock = clock; this.onClose = onClose;
    this.open_ = new Map();  // assetKey -> { openedTs, swaps }
  }

  open(assetKey) {
    if (this.open_.has(assetKey)) return;
    this.open_.set(assetKey, { openedTs: this.clock.now(), swaps: 0 });
  }

  isOpen(assetKey) { return this.open_.has(assetKey); }

  recordSwap(assetKey) {
    const st = this.open_.get(assetKey);
    if (!st) return;                       // not open (already closed or never opened)
    st.swaps++;
    if (st.swaps >= this.cfg.baselineMinSwaps) this._close(assetKey, 'min_swaps');
  }

  // Call periodically (e.g. every second) to close windows that elapsed with too few swaps.
  tick() {
    const now = this.clock.now();
    for (const [assetKey, st] of this.open_) {
      if (now - st.openedTs >= this.cfg.baselineWindowMs) this._close(assetKey, 'window');
    }
  }

  _close(assetKey, reason) {
    const st = this.open_.get(assetKey);
    if (!st) return;
    this.open_.delete(assetKey);           // delete BEFORE callback so re-entrancy can't double-close
    this.onClose({ assetKey, reason, swapsObserved: st.swaps,
                   durationMs: this.clock.now() - st.openedTs, ts: this.clock.now() });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/baselineController.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/discovery/baselineController.js backend/src/discovery/__tests__/baselineController.test.js
git commit -m "feat(ingestion): Stage A baseline controller with right-censoring reason (§10)"
```

---

## Task 4: Observability counters

**Files:**
- Create: `backend/src/discovery/ingestionStats.js`
- Test: `backend/src/discovery/__tests__/ingestionStats.test.js`

> **Spec (§9.4, §24):** lag, dropped events, duplicate rate, reconnects, and parse failures must be measured — provider failure must be visible, never silently turned into a positive signal.

- [ ] **Step 1: Write the failing test**

Create `backend/src/discovery/__tests__/ingestionStats.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { IngestionStats } from '../ingestionStats.js';

describe('IngestionStats', () => {
  it('counts events by type', () => {
    const s = new IngestionStats();
    s.received('token_created'); s.received('trade_observed'); s.received('trade_observed');
    expect(s.snapshot().byType).toEqual({ token_created: 1, trade_observed: 2 });
  });
  it('tracks reconnects, parse failures, and duplicates', () => {
    const s = new IngestionStats();
    s.reconnect(); s.reconnect(); s.parseFailure(); s.duplicate();
    const snap = s.snapshot();
    expect(snap.reconnects).toBe(2);
    expect(snap.parseFailures).toBe(1);
    expect(snap.duplicates).toBe(1);
  });
  it('records max lag between chainTs and receivedAt', () => {
    const s = new IngestionStats();
    s.lag(1200); s.lag(300); s.lag(800);
    expect(s.snapshot().maxLagMs).toBe(1200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/ingestionStats.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/discovery/ingestionStats.js`:
```js
// Provider failure must be VISIBLE, never silently converted to a positive signal. (§24)
export class IngestionStats {
  constructor() {
    this.byType = {}; this.reconnects = 0; this.parseFailures = 0;
    this.duplicates = 0; this.maxLagMs = 0;
  }
  received(type) { this.byType[type] = (this.byType[type] ?? 0) + 1; }
  reconnect() { this.reconnects++; }
  parseFailure() { this.parseFailures++; }
  duplicate() { this.duplicates++; }
  lag(ms) { if (ms > this.maxLagMs) this.maxLagMs = ms; }
  snapshot() {
    return { byType: { ...this.byType }, reconnects: this.reconnects,
             parseFailures: this.parseFailures, duplicates: this.duplicates, maxLagMs: this.maxLagMs };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/ingestionStats.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/discovery/ingestionStats.js backend/src/discovery/__tests__/ingestionStats.test.js
git commit -m "feat(ingestion): observability counters (§24)"
```

---

## Task 5: Stage B/C monitoring budget — promotion + control sample

**Files:**
- Create: `backend/src/discovery/monitorBudget.js`
- Test: `backend/src/discovery/__tests__/monitorBudget.test.js`

> **Spec (§10 Stage B/C):** after ≥ 5 observed buys, allocate hot monitoring; keep a **5–10% random control sample at identical depth** so selection bias is measurable. Control-sample tokens are NOT chosen by the gate. **Scope:** this task decides promotion + control membership; the holder/funding RPC work it "allocates" is Workstream 6.

- [ ] **Step 1: Write the failing test**

Create `backend/src/discovery/__tests__/monitorBudget.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { MonitorBudget } from '../monitorBudget.js';

const cfg = { stageBMinBuys: 5, hotLimit: 2, controlSampleRate: 0.5 };
// Deterministic RNG: returns a queued sequence.
function seededRng(seq) { let i = 0; return () => seq[i++ % seq.length]; }

describe('MonitorBudget', () => {
  it('does not promote before stageBMinBuys buys', () => {
    const b = new MonitorBudget({ cfg, rng: seededRng([0.9]) });
    for (let i = 0; i < 4; i++) b.recordBuy('A');
    expect(b.isHot('A')).toBe(false);
  });

  it('promotes to hot at stageBMinBuys buys when capacity remains', () => {
    const b = new MonitorBudget({ cfg, rng: seededRng([0.9]) });
    for (let i = 0; i < 5; i++) b.recordBuy('A');
    expect(b.isHot('A')).toBe(true);
  });

  it('respects hotLimit for evictable (non-control) tokens', () => {
    const b = new MonitorBudget({ cfg, rng: seededRng([0.9]) }); // rng>rate => never control
    ['A', 'B', 'C'].forEach(k => { for (let i = 0; i < 5; i++) b.recordBuy(k); });
    const hot = ['A', 'B', 'C'].filter(k => b.isHot(k));
    expect(hot.length).toBe(2); // hotLimit
  });

  it('admits a control-sample token at registration regardless of buys, and marks it control', () => {
    const b = new MonitorBudget({ cfg, rng: seededRng([0.1]) }); // 0.1 < 0.5 => control
    b.registerLaunch('Z');
    expect(b.isControl('Z')).toBe(true);
    expect(b.isHot('Z')).toBe(true); // control gets identical (hot) depth
  });

  it('control-sample tokens do NOT consume the evictable hotLimit', () => {
    const b = new MonitorBudget({ cfg, rng: seededRng([0.1, 0.9, 0.9, 0.9]) });
    b.registerLaunch('CTRL');                    // control (0.1)
    ['A', 'B', 'C'].forEach(k => { b.registerLaunch(k); for (let i = 0; i < 5; i++) b.recordBuy(k); });
    expect(b.isControl('CTRL')).toBe(true);
    expect(b.isHot('CTRL')).toBe(true);
    expect(['A', 'B', 'C'].filter(k => b.isHot(k)).length).toBe(2); // still 2 evictable slots
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/monitorBudget.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/discovery/monitorBudget.js`:
```js
// Stage B: promote after >= stageBMinBuys buys. Stage C: hot capacity + a mandatory
// random control sample monitored at IDENTICAL depth so selection bias stays measurable. (§10)
export class MonitorBudget {
  constructor({ cfg, rng }) {
    this.cfg = cfg; this.rng = rng;
    this.buys = new Map();       // assetKey -> buy count
    this.hot = new Set();        // evictable hot tokens (gate-selected)
    this.control = new Set();    // control-sample tokens (NOT gate-selected, identical depth)
  }

  // Called once per new launch. Rolls control-sample membership up front.
  registerLaunch(assetKey) {
    if (this.rng() < this.cfg.controlSampleRate) this.control.add(assetKey);
  }

  recordBuy(assetKey) {
    const n = (this.buys.get(assetKey) ?? 0) + 1;
    this.buys.set(assetKey, n);
    if (n >= this.cfg.stageBMinBuys && !this.control.has(assetKey)) this._tryPromote(assetKey);
  }

  _tryPromote(assetKey) {
    if (this.hot.has(assetKey)) return;
    if (this.hot.size >= this.cfg.hotLimit) return;   // capacity full — stays watching
    this.hot.add(assetKey);
  }

  // Control tokens get hot depth without consuming the evictable hotLimit.
  isHot(assetKey) { return this.hot.has(assetKey) || this.control.has(assetKey); }
  isControl(assetKey) { return this.control.has(assetKey); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/monitorBudget.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/discovery/monitorBudget.js backend/src/discovery/__tests__/monitorBudget.test.js
git commit -m "feat(ingestion): Stage B/C budget — promotion + control sample at identical depth (§10)"
```

---

## Task 6: Wire staged collection + reconnect into the pump feed

**Files:**
- Modify: `backend/src/discovery/pumpfun.js`
- Modify: `backend/server.js`
- Test: `backend/src/discovery/__tests__/tapeIngestion.test.js` (extend the Phase 1 file)

> **Spec (§10.1):** on `create`, subscribe that mint's trades and open a baseline; on `baseline_closed`, emit the event and unsubscribe unless hot-promoted; resubscribe after disconnects (idempotent append dedups reconnect duplicates). Trade envelopes already append via Phase 1 `handlePumpMessage`; this task adds the *control* around it.

- [ ] **Step 1: Write the failing test**

Extend `backend/src/discovery/__tests__/tapeIngestion.test.js` with a new describe block:
```js
import { manualClock } from '../clock.js';
import { BaselineController } from '../baselineController.js';
import { routePumpMessage } from '../pumpfun.js';

describe('routePumpMessage (staged control)', () => {
  function harness() {
    const appended = [];
    const tape = { append: async (e) => appended.push(e) };
    const clock = manualClock(0);
    const closed = [];
    const baseline = new BaselineController({
      cfg: { baselineWindowMs: 1000, baselineMinSwaps: 2 }, clock,
      onClose: (c) => closed.push(c),
    });
    const subs = { subscribed: new Set(), unsubscribed: new Set(),
      subscribeTrades: (m) => subs.subscribed.add(m), unsubscribeTrades: (m) => subs.unsubscribed.add(m) };
    return { appended, tape, baseline, subs, closed };
  }

  it('subscribes trades and opens a baseline on create', async () => {
    const h = harness();
    await routePumpMessage({ ...h, budget: { registerLaunch(){}, recordBuy(){}, isHot: () => false } },
      { txType: 'create', mint: 'A', signature: 's-c', blockTime: 1, slot: 1 });
    expect(h.subs.subscribed.has('A')).toBe(true);
    expect(h.baseline.isOpen('solana:pumpfun:A')).toBe(true);
  });

  it('counts buys into the baseline and emits baseline_closed at min swaps', async () => {
    const h = harness();
    const budget = { registerLaunch(){}, recordBuy(){}, isHot: () => false };
    await routePumpMessage({ ...h, budget }, { txType: 'create', mint: 'A', signature: 's-c', blockTime: 1, slot: 1 });
    await routePumpMessage({ ...h, budget }, { txType: 'buy', mint: 'A', solAmount: 0.1, signature: 's-b1', blockTime: 2, slot: 2 });
    await routePumpMessage({ ...h, budget }, { txType: 'buy', mint: 'A', solAmount: 0.1, signature: 's-b2', blockTime: 3, slot: 3 });
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0]).toMatchObject({ reason: 'min_swaps', swapsObserved: 2 });
    // baseline_closed event appended to the tape
    expect(h.appended.some(e => e.type === 'baseline_closed')).toBe(true);
    // not hot -> trades unsubscribed after close
    expect(h.subs.unsubscribed.has('A')).toBe(true);
  });

  it('keeps trades subscribed after baseline close when the token is hot', async () => {
    const h = harness();
    const budget = { registerLaunch(){}, recordBuy(){}, isHot: () => true };
    await routePumpMessage({ ...h, budget }, { txType: 'create', mint: 'A', signature: 's-c', blockTime: 1, slot: 1 });
    await routePumpMessage({ ...h, budget }, { txType: 'buy', mint: 'A', solAmount: 0.1, signature: 's-b1', blockTime: 2, slot: 2 });
    await routePumpMessage({ ...h, budget }, { txType: 'buy', mint: 'A', solAmount: 0.1, signature: 's-b2', blockTime: 3, slot: 3 });
    expect(h.subs.unsubscribed.has('A')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/tapeIngestion.test.js`
Expected: FAIL — `routePumpMessage` not exported.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/discovery/pumpfun.js`, add `routePumpMessage` (control layer) and route the raw message through Phase 1's `handlePumpMessage` for the tape append, plus the baseline/subscription/budget side effects. Import `assetKey`, `eventId`, `EVENT_TYPES`, `validateEnvelope` (already imported in Phase 1).
```js
import { manualClock } from './clock.js'; // only for types/tests; runtime uses injected clock

// Control layer around handlePumpMessage: subscriptions, baseline, budget, censoring event.
export async function routePumpMessage(ctx, m) {
  const { tape, baseline, subs, budget } = ctx;
  const key = assetKey('solana', 'pumpfun', m.mint);

  await handlePumpMessage(tape, m); // Phase 1: append token_created / trade_observed / migration_observed

  if (m.txType === 'create') {
    budget.registerLaunch(key);
    subs.subscribeTrades(m.mint);   // Stage A: collect THIS token's trades
    baseline.open(key);
  } else if (m.txType === 'buy' || m.txType === 'sell') {
    budget.recordBuy(key);
    baseline.recordSwap(key);
    if (!baseline.isOpen(key) && !budget.isHot(key)) subs.unsubscribeTrades(m.mint);
  }
}

// Emit baseline_closed to the tape and drop trade subscription unless the token is hot.
export function makeBaselineCloser(tape, subs, budget) {
  return async (close) => {
    const envelope = {
      assetKey: close.assetKey, source: 'pumpportal', schemaVersion: 1,
      type: EVENT_TYPES.BASELINE_CLOSED, chainTs: close.ts, receivedAt: close.ts,
      slot: null, signature: `baseline:${close.assetKey}`, instructionIndex: 0,
      payload: { reason: close.reason, swapsObserved: close.swapsObserved, durationMs: close.durationMs },
    };
    envelope.eventId = eventId(envelope);
    const v = validateEnvelope(envelope);
    if (v.ok) await tape.append(envelope);
    const mint = close.assetKey.split(':')[2];
    if (!budget.isHot(close.assetKey)) subs.unsubscribeTrades(mint);
  };
}
```
Update `startPumpFeed(tape, deps)` to accept `{ baseline, budget, subs, stats, clock }`, wire `subscribeTokenTrade`/`unsubscribeTokenTrade` PumpPortal methods as `subs`, route every message through `routePumpMessage`, run `baseline.tick()` on an interval, count `stats`, and on socket `close` increment `stats.reconnect()` and reconnect (resubscribe `subscribeNewToken` + `subscribeMigration`; idempotent append dedups replays):
```js
export function startPumpFeed(tape, deps) {
  const { baseline, budget, stats, clock } = deps;
  let ws;
  const subs = {
    subscribeTrades: (mint) => ws?.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] })),
    unsubscribeTrades: (mint) => ws?.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] })),
  };
  baseline.onClose = makeBaselineCloser(tape, subs, budget); // wire censoring emission

  const connect = () => {
    ws = new WebSocket('wss://pumpportal.fun/api/data');
    ws.on('open', () => {
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
    });
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { stats.parseFailure(); return; }
      if (!m.txType) return;
      stats.received(m.txType === 'create' ? 'token_created' : m.txType === 'migrate' ? 'migration_observed' : 'trade_observed');
      if (m.blockTime) stats.lag(clock.now() - m.blockTime * 1000);
      try { await routePumpMessage({ tape, baseline, subs, budget }, m); }
      catch (e) { console.warn('[ingest] route failed:', e.message); }
    });
    ws.on('close', () => { stats.reconnect(); setTimeout(connect, 1000); });
    ws.on('error', () => ws.close());
  };
  connect();
  const tickTimer = setInterval(() => baseline.tick(), 1000);
  return { stop: () => { clearInterval(tickTimer); ws?.close(); } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/tapeIngestion.test.js`
Expected: PASS (Phase 1 tests + 3 new staged-control tests).

- [ ] **Step 5: Wire the feed in server.js**

In `backend/server.js`, replace the Phase 1 `startPumpFeed(tape)` call with the staged wiring:
```js
import { systemClock } from './src/discovery/clock.js';
import { BaselineController } from './src/discovery/baselineController.js';
import { MonitorBudget } from './src/discovery/monitorBudget.js';
import { IngestionStats } from './src/discovery/ingestionStats.js';

const clock = systemClock;
const stats = new IngestionStats();
const budget = new MonitorBudget({ cfg: config.collection, rng: Math.random });
const baseline = new BaselineController({ cfg: config.collection, clock, onClose: () => {} }); // onClose set in startPumpFeed
startPumpFeed(tape, { baseline, budget, stats, clock });
```
Add a `/api/ingestion/stats` route returning `stats.snapshot()` for the observability dashboard (§24):
```js
app.get('/api/ingestion/stats', (req, res) => res.json(stats.snapshot()));
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/discovery/pumpfun.js backend/server.js backend/src/discovery/__tests__/tapeIngestion.test.js
git commit -m "feat(ingestion): staged collection — baseline subscribe, censoring, reconnect, stats (§10.1)"
```

---

## Task 7: Supply-aware market cap

**Files:**
- Create: `backend/src/features/mcap.js`
- Test: `backend/src/features/__tests__/mcap.test.js`

> **Spec (§7.2, §19.2):** market cap must be `rawSupply × price ÷ 10^decimals` — supply-aware, never `price × 1e9`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/mcap.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { supplyAwareMcap } from '../mcap.js';

describe('supplyAwareMcap', () => {
  it('computes rawSupply * price / 10^decimals', () => {
    // 1,000,000 tokens (6 decimals => rawSupply 1e12), price $0.002 => $2,000 mcap
    expect(supplyAwareMcap({ rawSupply: 1_000_000_000_000n, decimals: 6, priceUsd: 0.002 })).toBeCloseTo(2000);
  });
  it('returns null when supply or price is unavailable (never guesses 1e9)', () => {
    expect(supplyAwareMcap({ rawSupply: null, decimals: 6, priceUsd: 0.002 })).toBeNull();
    expect(supplyAwareMcap({ rawSupply: 1n, decimals: 6, priceUsd: null })).toBeNull();
  });
  it('accepts string raw supply', () => {
    expect(supplyAwareMcap({ rawSupply: '1000000000000', decimals: 6, priceUsd: 0.002 })).toBeCloseTo(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/mcap.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/mcap.js`:
```js
// Supply-aware market cap. NEVER price * 1e9 — the hardcoded-supply bug the report bans. (§7.2)
export function supplyAwareMcap({ rawSupply, decimals, priceUsd }) {
  if (rawSupply == null || priceUsd == null || decimals == null) return null; // unknown != guessed
  const supply = Number(BigInt(rawSupply)) / 10 ** decimals;
  return supply * priceUsd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/mcap.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/mcap.js backend/src/features/__tests__/mcap.test.js
git commit -m "feat(features): supply-aware market cap (§7.2)"
```

---

## Task 8: Fixed-window aggregation (`bucketize`)

**Files:**
- Create: `backend/src/features/windows.js`
- Test: `backend/src/features/__tests__/windows.test.js`

> **Spec (§12.3.1, §13.1):** one canonical window; each bucket sums buy/sell SOL, buy/sell counts, unique wallets; the current incomplete bucket is flagged `partial` so scoring never treats it as complete.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/windows.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { bucketize } from '../windows.js';

const W = 60_000;
const trade = (chainTs, side, solLamports, wallet) => ({ chainTs, side, solLamports, wallet });

describe('bucketize', () => {
  it('groups trades into fixed windows and sums buy/sell sol and counts', () => {
    const trades = [
      trade(0, 'buy', 100, 'w1'),
      trade(1000, 'buy', 200, 'w2'),
      trade(61_000, 'sell', 50, 'w1'),
    ];
    const buckets = bucketize(trades, W, 0, 120_000, 200_000);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ windowStart: 0, buySol: 300, sellSol: 0, buys: 2, sells: 0, wallets: 2 });
    expect(buckets[1]).toMatchObject({ windowStart: 60_000, sellSol: 50, sells: 1, wallets: 1 });
  });
  it('flags the current incomplete bucket as partial', () => {
    const trades = [trade(125_000, 'buy', 10, 'w1')];
    // nowTs falls inside the 120000..180000 bucket => partial
    const buckets = bucketize(trades, W, 0, 200_000, 130_000);
    expect(buckets.at(-1).partial).toBe(true);
  });
  it('marks completed buckets as not partial', () => {
    const trades = [trade(1000, 'buy', 10, 'w1')];
    const buckets = bucketize(trades, W, 0, 200_000, 500_000);
    expect(buckets[0].partial).toBe(false);
  });
  it('excludes trades outside [fromTs, toTs]', () => {
    const trades = [trade(-5, 'buy', 10, 'w1'), trade(999_999, 'buy', 10, 'w2')];
    expect(bucketize(trades, W, 0, 120_000, 200_000)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/windows.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/windows.js` (per §12.3.1):
```js
// One canonical window. Incomplete current bucket flagged `partial` so scoring never treats
// it as complete. A 24h volume may never be divided by a 5m/1h trade count. (§12.3.1, §13.1)
export function bucketize(trades, windowMs, fromTs, toTs, nowTs) {
  const buckets = new Map();
  for (const t of trades) {
    if (t.chainTs < fromTs || t.chainTs > toTs) continue;
    const w = Math.floor(t.chainTs / windowMs) * windowMs;
    if (!buckets.has(w)) buckets.set(w, { buySol: 0, sellSol: 0, buys: 0, sells: 0, wallets: new Set() });
    const b = buckets.get(w);
    if (t.side === 'buy') { b.buySol += t.solLamports; b.buys++; }
    else                  { b.sellSol += t.solLamports; b.sells++; }
    b.wallets.add(t.wallet);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([w, b]) => ({
    windowStart: w, buySol: b.buySol, sellSol: b.sellSol, buys: b.buys, sells: b.sells,
    wallets: b.wallets.size,
    partial: (w + windowMs) > nowTs,   // current bucket incomplete — do not score as full
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/windows.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/windows.js backend/src/features/__tests__/windows.test.js
git commit -m "feat(features): fixed-window bucketize with partial flag (§12.3.1)"
```

---

## Task 9: Immutable snapshots

**Files:**
- Create: `backend/src/features/snapshots.js`
- Test: `backend/src/features/__tests__/snapshots.test.js`

> **Spec (§12.3.2):** snapshots are immutable (new state = new object — fixes the mutate-then-compare bug); market cap is supply-aware; the migration anchor is set once and never rebased.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/snapshots.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { initSnapshot, reduceSnapshot } from '../snapshots.js';

describe('snapshots', () => {
  it('initializes the anchor and ath from the migration tick', () => {
    const s = initSnapshot({ mcap: 1000, ts: 100 });
    expect(s.anchorMcap).toBe(1000);
    expect(s.ath).toBe(1000);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('returns a NEW frozen object and never mutates prev (the dormant-spike bug)', () => {
    const prev = initSnapshot({ mcap: 1000, ts: 100 });
    const next = reduceSnapshot(prev, { mcap: 2000, ts: 200 });
    expect(next).not.toBe(prev);
    expect(prev.mcap).toBe(1000); // prev untouched
    expect(next.mcap).toBe(2000);
  });

  it('raises ATH on a new high and holds it otherwise', () => {
    let s = initSnapshot({ mcap: 1000, ts: 100 });
    s = reduceSnapshot(s, { mcap: 2500, ts: 200 });
    expect(s.ath).toBe(2500);
    expect(s.athTs).toBe(200);
    s = reduceSnapshot(s, { mcap: 1800, ts: 300 });
    expect(s.ath).toBe(2500);       // held
    expect(s.athTs).toBe(200);
  });

  it('never rebases the anchor and computes gainVsAnchor from it', () => {
    let s = initSnapshot({ mcap: 1000, ts: 100 });
    s = reduceSnapshot(s, { mcap: 3000, ts: 200 });
    expect(s.anchorMcap).toBe(1000);          // fixed
    expect(s.gainVsAnchor).toBeCloseTo(2);    // 3000/1000 - 1
  });

  it('computes athDistance as fraction below the running ATH', () => {
    let s = initSnapshot({ mcap: 1000, ts: 100 });
    s = reduceSnapshot(s, { mcap: 2000, ts: 200 }); // new ath, distance 0
    s = reduceSnapshot(s, { mcap: 1500, ts: 300 }); // 25% below ath
    expect(s.athDistance).toBeCloseTo(0.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/snapshots.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/snapshots.js` (per §12.3.2):
```js
// Immutable snapshots: new state = new frozen object. Never mutate prev — that mutation is
// exactly what killed dormant-spike detection. mcap MUST be supply-aware upstream. (§12.3.2)
export function initSnapshot(migrationTick) {
  return Object.freeze({
    anchorMcap: migrationTick.mcap,   // set ONCE at migration — never rebased
    ath: migrationTick.mcap, athTs: migrationTick.ts,
    ts: migrationTick.ts, mcap: migrationTick.mcap,
    athDistance: 0, athAgeMs: 0, gainVsAnchor: 0,
  });
}

export function reduceSnapshot(prev, tick) {
  const isNewAth = tick.mcap > prev.ath;
  return Object.freeze({
    ...prev, ts: tick.ts, mcap: tick.mcap,
    ath: isNewAth ? tick.mcap : prev.ath,
    athTs: isNewAth ? tick.ts : prev.athTs,
    athDistance: 1 - tick.mcap / (isNewAth ? tick.mcap : prev.ath),
    athAgeMs: tick.ts - (isNewAth ? tick.ts : prev.athTs),
    gainVsAnchor: tick.mcap / prev.anchorMcap - 1,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/snapshots.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/snapshots.js backend/src/features/__tests__/snapshots.test.js
git commit -m "feat(features): immutable supply-aware snapshots, fixed anchor (§12.3.2)"
```

---

## Task 10: Shared causal extractor (`extractAllFeatures` / `causalFeatures`)

**Files:**
- Create: `backend/src/features/extract.js`
- Test: `backend/src/features/__tests__/extract.test.js`

> **Spec (§19.1, §19.2):** live and replay call the SAME extractor. `causalFeatures(tape, assetKey, asOf)` reads `eventsUntil(assetKey, asOf)` (chain_ts ≤ asOf, nothing later) and passes the events to `extractAllFeatures`. Phase 2 assembles what exists now (creation facts, trade buckets, baseline censoring, migration snapshot); Phase 3 features register into the same function.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/extract.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { extractAllFeatures, causalFeatures } from '../extract.js';
import { EVENT_TYPES } from '../../tape/identity.js';

const row = (o) => ({ chain_ts: o.chainTs, type: o.type, payload: o.payload });

describe('extractAllFeatures', () => {
  it('assembles creation, trade buckets, and baseline censoring from tape rows', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: { creator: 'dev', rawSupply: '1000000000000', decimals: 6 } }),
      row({ chainTs: 1000, type: EVENT_TYPES.TRADE_OBSERVED, payload: { side: 'buy', wallet: 'w1', lamports: 100 } }),
      row({ chainTs: 2000, type: EVENT_TYPES.TRADE_OBSERVED, payload: { side: 'buy', wallet: 'w2', lamports: 200 } }),
      row({ chainTs: 3000, type: EVENT_TYPES.BASELINE_CLOSED, payload: { reason: 'window', swapsObserved: 2 } }),
    ];
    const f = extractAllFeatures(events, { nowTs: 300_000, windowMs: 60_000 });
    expect(f.created.creator).toBe('dev');
    expect(f.trades).toHaveLength(2);
    expect(f.buckets[0]).toMatchObject({ buys: 2, buySol: 300 });
    expect(f.baseline).toMatchObject({ reason: 'window', swapsObserved: 2 });
    expect(f.migrated).toBe(false);
  });

  it('marks migrated and builds a snapshot when a migration event is present', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: { rawSupply: '1000000000000', decimals: 6 } }),
      row({ chainTs: 5000, type: EVENT_TYPES.MIGRATION_OBSERVED, payload: { anchorMcap: 5000 } }),
    ];
    const f = extractAllFeatures(events, { nowTs: 300_000, windowMs: 60_000 });
    expect(f.migrated).toBe(true);
    expect(f.snapshot.anchorMcap).toBe(5000);
  });
});

describe('causalFeatures', () => {
  it('reads only events up to asOf via the tape and runs the SAME extractor', async () => {
    const seen = [];
    const fakeTape = { eventsUntil: async (key, asOf) => { seen.push([key, asOf]);
      return [row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: { rawSupply: '1', decimals: 0 } })]; } };
    const f = await causalFeatures(fakeTape, 'solana:pumpfun:A', 1234, { nowTs: 1234, windowMs: 60_000 });
    expect(seen).toEqual([['solana:pumpfun:A', 1234]]);
    expect(f.created).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/extract.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/extract.js`:
```js
import { EVENT_TYPES } from '../tape/identity.js';
import { bucketize } from './windows.js';
import { initSnapshot } from './snapshots.js';

// ONE extractor shared by live and replay (CI enforces the same reference — §22).
// Phase 2 assembles what the tape already holds; Phase 3 features plug into this function.
export function extractAllFeatures(events, opts) {
  const windowMs = opts?.windowMs ?? 60_000;
  const nowTs = opts?.nowTs ?? 0;

  const createdEvt = events.find(e => e.type === EVENT_TYPES.TOKEN_CREATED);
  const migrationEvt = events.find(e => e.type === EVENT_TYPES.MIGRATION_OBSERVED);
  const baselineEvt = events.find(e => e.type === EVENT_TYPES.BASELINE_CLOSED);

  const trades = events
    .filter(e => e.type === EVENT_TYPES.TRADE_OBSERVED)
    .map(e => ({ chainTs: e.chain_ts, side: e.payload.side, wallet: e.payload.wallet,
                 solLamports: e.payload.lamports, rawTokens: e.payload.rawTokens }));

  const fromTs = createdEvt?.chain_ts ?? (trades[0]?.chainTs ?? 0);
  const buckets = bucketize(trades, windowMs, fromTs, nowTs, nowTs);

  return {
    created: createdEvt?.payload ?? null,
    baseline: baselineEvt?.payload ?? null,   // right-censoring evidence (null = still open / unknown)
    trades, buckets,
    migrated: !!migrationEvt,
    snapshot: migrationEvt
      ? initSnapshot({ mcap: migrationEvt.payload.anchorMcap, ts: migrationEvt.chain_ts })
      : null,
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
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/extract.js backend/src/features/__tests__/extract.test.js
git commit -m "feat(features): shared causal extractor — extractAllFeatures + causalFeatures (§19.1)"
```

---

## Task 11: CI parity invariant — live and replay are the same function

**Files:**
- Create: `backend/src/features/__tests__/parity.test.js`

> **Spec (§22 CI invariant #1):** `causalFeatures` and the live extractor must be the same function so replay and production can never drift. This test is the guard.

- [ ] **Step 1: Write the test (it should pass immediately given Task 10's design)**

Create `backend/src/features/__tests__/parity.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import * as extract from '../extract.js';

describe('feature extractor parity (§22 CI invariant)', () => {
  it('causalFeatures delegates to the exact extractAllFeatures reference', async () => {
    const spy = vi.spyOn(extract, 'extractAllFeatures');
    const fakeTape = { eventsUntil: async () => [] };
    await extract.causalFeatures(fakeTape, 'solana:pumpfun:A', 100, { windowMs: 60_000 });
    // If a future refactor forks a second extractor for replay, this fails.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('exports exactly one feature-assembly entry point', () => {
    const assemblers = Object.keys(extract).filter(k => /extract.*Features/i.test(k));
    expect(assemblers).toEqual(['extractAllFeatures']);
  });
});
```

Note: for `vi.spyOn` to observe the internal call, `causalFeatures` must call the exported binding. If the first test fails because the internal call bypasses the spy, change the internal call site in `extract.js` from `extractAllFeatures(...)` to `mod.extractAllFeatures(...)` via `import * as mod from './extract.js'` — a small, intentional indirection that makes the parity guard enforceable. Prefer keeping the second test (export-count guard) as the always-valid backstop.

- [ ] **Step 2: Run the test**

Run: `cd backend && npx vitest run src/features/__tests__/parity.test.js`
Expected: PASS (2 tests). If test 1 fails on the spy, apply the indirection note above, then re-run — expect PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/features/__tests__/parity.test.js backend/src/features/extract.js
git commit -m "test(features): CI parity guard — one shared extractor for live+replay (§22)"
```

---

## Task 12: Full regression + phase close

**Files:**
- Modify: `doc/implementation-plan.md` (append a Phase 2 completion note) — optional, follow existing doc conventions.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: all suites PASS — Phase 1 tape/scope/ingestion tests plus the new baselineController, monitorBudget, ingestionStats, mcap, windows, snapshots, extract, and parity tests.

- [ ] **Step 2: Boot smoke test against local Postgres**

With a local Postgres running (`tradeforge` database):
Run: `cd backend && node server.js`
Expected: `[tape] Postgres event tape ready`, feeds start, no unhandled errors. Stop after confirming.

- [ ] **Step 3: Verify staged collection is filling the tape**

Run the server ~2 minutes, then:
```bash
psql "$DATABASE_URL" -c "SELECT type, count(*) FROM events GROUP BY type ORDER BY 2 DESC;"
```
Expected: `token_created`, `trade_observed`, and `baseline_closed` rows all present (Phase 1 had `trade_observed` only incidentally; Phase 2's Stage-A subscription should now produce many trades and matching baseline closes).

- [ ] **Step 4: Verify observability endpoint**

Run: `curl -s http://localhost:3000/api/ingestion/stats` (adjust port to `config.port`)
Expected: JSON with non-zero `byType`, and `reconnects`/`parseFailures`/`maxLagMs` fields present.

- [ ] **Step 5: Commit the phase close**

```bash
git add -A
git commit -m "chore: Phase 2 complete — staged ingestion + causal snapshots/extractor (WS3+WS4)"
```

---

## Self-Review (completed)

**Spec coverage vs Phase 2 scope (§26 WS3–WS4):**
- Staged collection (§10): Stage A baseline + `baseline_closed` censoring → Task 3; Stage B/C promotion + control sample at identical depth → Task 5; wiring + subscribe/unsubscribe → Task 6.
- Ingestion contract (§10.1): chain-time vs receivedAt already separated in Phase 1 `handlePumpMessage`; subscription/baseline/reconnect control → Task 6.
- Tape invariants — resumable/observable (§9.4, §24): reconnect + resubscribe and counters → Tasks 4, 6; `/api/ingestion/stats` → Task 6.
- Windowing (§12.3.1, §13.1) → Task 8. Immutable snapshots (§12.3.2) → Task 9. Supply-aware mcap (§7.2, §19.2) → Task 7.
- Shared causal extractor (§19.1) → Task 10. CI parity invariant (§22) → Task 11.
- Injected clock/RNG for determinism (§10.1) → Tasks 1, 5.

**Deferred-by-design (called out at their tasks, not gaps):** the holder/funding RPC work Stage B allocates → Workstream 6 (Phase 3); dynamic/structural feature families that plug into `extractAllFeatures` → Workstreams 5–7; scoring/blockers/admission → Workstream 8; replay labels + shadow policy → Workstream 11. Phase 2 stops at "correct tape + causal read layer."

**Placeholder scan:** none — every code step contains runnable code and exact commands. Task 11 includes an explicit fallback (export-count backstop) rather than a vague "make it work."

**Type consistency:** `manualClock`/`systemClock`, `BaselineController.{open,recordSwap,tick,isOpen,onClose}`, `MonitorBudget.{registerLaunch,recordBuy,isHot,isControl}`, `IngestionStats.{received,reconnect,parseFailure,duplicate,lag,snapshot}`, `routePumpMessage`/`makeBaselineCloser`/`startPumpFeed`, `supplyAwareMcap`, `bucketize`, `initSnapshot`/`reduceSnapshot`, `extractAllFeatures`/`causalFeatures` — each defined once and referenced consistently. Reuses Phase 1 `handlePumpMessage`, `assetKey`, `eventId`, `EVENT_TYPES`, `validateEnvelope`, `Tape.append`/`eventsUntil` unchanged.
