# Meme Finder — Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10 defects found in the 2026-07-25 code review of the Phase 1–6 Meme Finder implementation, and close the test-coverage gap that let them ship green.

**Architecture:** Each task fixes one defect using strict TDD — the failing test is written first, which simultaneously closes review finding #8 (Phase 5/6 modules have zero tests). Tasks are ordered by blast radius: the two defects that corrupt collected data come first, then the two that make the verdict untrustworthy, then correctness/wiring. No new modules are introduced; every fix edits an existing file.

**Tech Stack:** Node ESM, Vitest, Express, pg + pg-mem. One new devDep: `supertest` (route tests in Task 9).

**Source of findings:** code review 2026-07-25 (high effort, 8 angles, 10 findings). Spec references point at `docs/meme-finder-foundation-report-2026-07-24.md` (the Report).

---

## Why this order

| Order | Finding | Why it ranks here |
|---|---|---|
| 1 | Inverted entry-decay guard | Every shadow entry is recorded against the wrong population. Until fixed, all collected data is garbage. |
| 2 | Label field-name mismatch | EV is `NaN`, verdict is permanently `NO-GO`. Silently produces a false negative that looks real. |
| 3 | Verdict ignores bootstrap CI | Can declare GO on statistical noise. |
| 4 | Parity check is tautological | GO gate condition 5 passes vacuously. |
| 5 | Tape idempotency broken | Scorer events append unbounded or collapse to one row. |
| 6 | Alert re-stamping | Decay measured against a moving reference. |
| 7 | Cohort retention miscounts adders | Understates retention for the best wallets. |
| 8 | `y_rugged` mislabels | Wrong labels feed the verdict. |
| 9 | Router not mounted | UI has no data source. |
| 10 | Full regression | Confirms nothing regressed. |

Review finding #8 (no Phase 5/6 tests) has no task of its own — it is discharged by Tasks 1–9, each of which creates the missing test file for the module it touches.

---

## File Structure

**Create (test files — these are the missing Phase 5/6 tests):**
- `backend/src/policy/__tests__/stub.test.js` — shadow policy decisions (Task 1)
- `backend/src/calibration/__tests__/metrics.test.js` — EV/precision over the real label shape (Task 2)
- `backend/src/calibration/__tests__/verdict.test.js` — per-cohort GO/NO_GO/EXTEND (Task 3)
- `backend/src/calibration/__tests__/parityCheck.test.js` — genuine live-vs-tape comparison (Task 4)
- `backend/src/monitoring/__tests__/evaluate.test.js` — alert stamping (Task 6)
- `backend/src/memefinder/__tests__/routes.test.js` — mounted endpoints (Task 9)

**Modify:**
- `backend/src/policy/stub.js` — fix the inverted decay comparison (Task 1)
- `backend/src/calibration/metrics.js` — read the canonical label fields (Task 2)
- `backend/src/calibration/verdict.js` — rewrite against the §19.5 rule (Task 3)
- `backend/src/scoring/config.js` — add the `calibration` threshold block (Task 3)
- `backend/src/calibration/parityCheck.js` — compare live events against the tape round-trip (Task 4)
- `backend/src/tape/schema.sql`, `backend/src/tape/db.js`, `backend/src/tape/tape.js` — dedupe on `event_id` (Task 5)
- `backend/src/monitoring/evaluate.js` — never rebase an existing alert (Task 6)
- `backend/src/features/cohortRetention.js` — basis includes post-window buys (Task 7)
- `backend/src/calibration/labels.js` — `y_rugged` over full price history (Task 8)
- `backend/server.js` — mount the memefinder router (Task 9)
- `backend/package.json` — add `supertest` devDep (Task 9)

---

## Task 1: Fix the inverted entry-decay guard

**Files:**
- Modify: `backend/src/policy/stub.js`
- Test: `backend/src/policy/__tests__/stub.test.js` (create)

> **Defect:** the guard reads `token.mcap < alert.mcap * (1 - maxEntryDecayFrac)`, which skips tokens whose price **fell** and enters tokens that already pumped. Report §20 requires the opposite: skip when the achievable fill has decayed *above* the alert price by more than `maxEntryDecayFrac` ("the move already happened"). A `null` mcap currently enters, treating unknown as "no decay" — Report §5.2.7 says unknown must never become a favourable default.

- [ ] **Step 1: Write the failing test**

Create `backend/src/policy/__tests__/stub.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { policyDecision, recordShadowDecision } from '../stub.js';

const cfg = { policy: { maxEntryDecayFrac: 0.05 } };
const score = (over = {}) => ({
  admission: 'qualified', blockers: [], version: 'meme-score-v2.0.0',
  alert: { ts: 1_000, mcap: 100_000 }, ...over,
});
const token = (over = {}) => ({ assetKey: 'solana:pumpfun:M', mcap: 100_000, ...over });

describe('policyDecision entry decay (§20)', () => {
  it('skips when the price already ran above the alert by more than the limit', () => {
    // +20% vs a 5% limit: the move already happened.
    const d = policyDecision(score(), token({ mcap: 120_000 }), cfg);
    expect(d.action).toBe('shadow_skip');
    expect(d.reason).toBe('entry_decay');
  });

  it('enters when the price is flat', () => {
    expect(policyDecision(score(), token({ mcap: 100_000 }), cfg).action).toBe('shadow_enter');
  });

  it('enters when the price moved DOWN — the decay guard is one-sided', () => {
    const d = policyDecision(score(), token({ mcap: 80_000 }), cfg);
    expect(d.action).toBe('shadow_enter');
  });

  it('enters at exactly the limit boundary', () => {
    expect(policyDecision(score(), token({ mcap: 105_000 }), cfg).action).toBe('shadow_enter');
  });

  it('skips just past the limit boundary', () => {
    expect(policyDecision(score(), token({ mcap: 105_001 }), cfg).action).toBe('shadow_skip');
  });

  it('skips when mcap is unavailable rather than assuming no decay', () => {
    expect(policyDecision(score(), token({ mcap: null }), cfg).reason).toBe('mcap_unavailable');
    expect(policyDecision(score({ alert: { ts: 1, mcap: null } }), token(), cfg).reason)
      .toBe('mcap_unavailable');
  });
});

describe('policyDecision gating', () => {
  it('skips anything not qualified', () => {
    for (const a of ['watching', 'provisional', 'rejected', 'unscored', 'expired']) {
      const d = policyDecision(score({ admission: a }), token(), cfg);
      expect(d.action).toBe('shadow_skip');
      expect(d.reason).toBe('not_qualified');
    }
  });

  it('skips when a blocker is present', () => {
    const d = policyDecision(score({ blockers: [{ code: 'FARM' }] }), token(), cfg);
    expect(d.reason).toBe('blocker');
  });

  it('never returns a live trading action', () => {
    const d = policyDecision(score(), token(), cfg);
    expect(d.action).toBe('shadow_enter');
    expect(JSON.stringify(d)).not.toMatch(/buy|sell|execute|sendTransaction/i);
  });
});

describe('recordShadowDecision', () => {
  it('marks the row as shadow and returns the decision', async () => {
    const store = { append: vi.fn(async () => {}) };
    const d = await recordShadowDecision(store, { action: 'shadow_enter', assetKey: 'x' });
    expect(store.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shadow_enter', shadow: true }));
    expect(d.action).toBe('shadow_enter');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/policy/__tests__/stub.test.js`
Expected: FAIL — "skips when the price already ran above the alert" gets `shadow_enter`; "enters when the price moved DOWN" gets `shadow_skip`; `mcap_unavailable` cases return `shadow_enter`.

- [ ] **Step 3: Write the fix**

Replace the whole of `backend/src/policy/stub.js` with:

```js
// Shadow policy (§20). Records an executable decision WITHOUT sending a transaction.
// No executor, wallet, or signing path is imported here — that is the safety property.
export function policyDecision(score, token, cfg) {
  if (score.admission !== 'qualified' || score.blockers?.length) {
    return { action: 'shadow_skip', reason: score.blockers?.length ? 'blocker' : 'not_qualified' };
  }

  // Decay needs a supply-aware mcap on BOTH sides. Without one the test is unevaluable, so
  // skip rather than silently treating unknown as "no decay" (§5.2.7 unknown != favourable).
  const alertMcap = score.alert?.mcap ?? null;
  if (alertMcap == null || token.mcap == null) {
    return { action: 'shadow_skip', reason: 'mcap_unavailable' };
  }

  // One-sided: only an UPWARD move past the limit disqualifies the entry, because the
  // opportunity we alerted on has already been taken. A price that fell is still entrable.
  const decayFrac = token.mcap / alertMcap - 1;
  if (decayFrac > cfg.policy.maxEntryDecayFrac) {
    return { action: 'shadow_skip', reason: 'entry_decay' };
  }

  return { action: 'shadow_enter', assetKey: token.assetKey, version: score.version };
}

export async function recordShadowDecision(store, decision) {
  await store.append?.({ ...decision, shadow: true });
  return decision;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/policy/__tests__/stub.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/policy/stub.js backend/src/policy/__tests__/stub.test.js
git commit -m "fix(policy): entry-decay guard was inverted; skip pumped tokens not fallen ones (§20)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Align metrics with the actual label shape

**Files:**
- Modify: `backend/src/calibration/metrics.js`
- Test: `backend/src/calibration/__tests__/metrics.test.js` (create)

> **Defect:** `buildLabel` emits `{ y_policy_net_return, y_policy_net_positive, ... }`, but `evPerAlert` reads `row.netReturn` and `precisionAtK` reads `row.label` as a boolean. Both are `undefined` against real labels, so EV is `NaN` and precision is `0`. Canonical row shape is `{ assetKey, score, label }` where `label` is the `buildLabel` output (Report §19.4).

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/metrics.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { precisionAtK, evPerAlert, assertProbabilities, brier, calibrationTable }
  from '../metrics.js';

// Canonical row: { assetKey, score, label } where label is a buildLabel() result.
const row = (score, netReturn, over = {}) => ({
  assetKey: `k${score}`, score,
  label: { y_policy_net_return: netReturn, y_policy_net_positive: netReturn >= 0.5,
           y_rugged: false, y_dead: false, ...over },
});

describe('evPerAlert (§19.4 — THE metric)', () => {
  it('averages the policy net return, not a hit rate', () => {
    // 3 losers at -1, 1 winner at +9 -> hit rate 25% but EV is +1.5
    const rows = [row(90, 9), row(80, -1), row(70, -1), row(60, -1)];
    expect(evPerAlert(rows)).toBeCloseTo(1.5, 10);
  });

  it('never returns NaN for well-formed labels', () => {
    expect(Number.isNaN(evPerAlert([row(1, 0.2)]))).toBe(false);
  });

  it('ignores unlabeled rows instead of poisoning the mean', () => {
    expect(evPerAlert([row(90, 1), { assetKey: 'x', score: 50, label: null }]))
      .toBeCloseTo(1, 10);
  });

  it('returns null when nothing is labeled', () => {
    expect(evPerAlert([])).toBeNull();
    expect(evPerAlert([{ assetKey: 'x', score: 1, label: null }])).toBeNull();
  });
});

describe('precisionAtK (§19.4)', () => {
  it('is the profitable fraction of the top K by score', () => {
    const rows = [row(90, 1), row(80, -1), row(70, 2), row(60, -1)];
    expect(precisionAtK(rows, 2)).toBe(0.5);
    expect(precisionAtK(rows, 4)).toBe(0.5);
  });

  it('reads y_policy_net_positive, not a bare truthy label object', () => {
    // A label object is always truthy; only the flag decides success.
    expect(precisionAtK([row(90, -1)], 1)).toBe(0);
  });

  it('returns null for an empty set rather than NaN', () => {
    expect(precisionAtK([], 10)).toBeNull();
  });
});

describe('probability gate (§19.4)', () => {
  const calibrated = [
    { probability: 0, isProbability: true, label: false },
    { probability: 1, isProbability: true, label: true },
  ];

  it('rejects a raw 0-100 memeScore', () => {
    expect(() => brier([{ probability: 75, isProbability: true, label: true }])).toThrow();
  });

  it('rejects unmarked inputs', () => {
    expect(() => assertProbabilities([{ probability: 0.5, label: true }])).toThrow();
  });

  it('accepts calibrated probabilities', () => {
    expect(brier(calibrated)).toBeCloseTo(0, 10);
    expect(calibrationTable(calibrated, 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/metrics.test.js`
Expected: FAIL — `evPerAlert` returns `NaN` (reads `row.netReturn`); `precisionAtK([row(90,-1)],1)` returns `1` because the label object is truthy.

- [ ] **Step 3: Write the fix**

Replace `backend/src/calibration/metrics.js` with:

```js
// Evaluation metrics (§19.4).
// Canonical row shape: { assetKey, score, label } where `label` is a buildLabel() result.
// Reading anything other than the y_* fields silently yields NaN — that was the defect.
export function assertProbabilities(rows) {
  if (!rows.length) throw new Error('calibrated probabilities required: empty set');
  if (!rows.every(row => row.isProbability && Number.isFinite(row.probability) &&
                         row.probability >= 0 && row.probability <= 1)) {
    throw new Error('calibrated probabilities required: a raw memeScore is a ranking index, ' +
      'not a probability (§14.1)');
  }
}

const labeled = rows => rows.filter(row => row.label);

export function precisionAtK(rows, k) {
  const top = labeled([...rows].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)))
    .slice(0, k);
  if (!top.length) return null;
  return top.filter(row => row.label.y_policy_net_positive).length / top.length;
}

// THE metric: expected value net of costs, NOT hit rate.
export function evPerAlert(rows) {
  const withLabel = labeled(rows);
  if (!withLabel.length) return null;
  return withLabel.reduce((sum, row) => sum + row.label.y_policy_net_return, 0) / withLabel.length;
}

export function brier(rows) {
  assertProbabilities(rows);
  return rows.reduce((sum, row) =>
    sum + (row.probability - Number(Boolean(row.label))) ** 2, 0) / rows.length;
}

export function calibrationTable(rows, bins = 10) {
  assertProbabilities(rows);
  return Array.from({ length: bins }, (_, index) => {
    const values = rows.filter(row =>
      Math.min(bins - 1, Math.floor(row.probability * bins)) === index);
    return {
      bin: index,
      count: values.length,
      predicted: values.length
        ? values.reduce((sum, row) => sum + row.probability, 0) / values.length : null,
      observed: values.length ? values.filter(row => row.label).length / values.length : null,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/metrics.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/metrics.js backend/src/calibration/__tests__/metrics.test.js
git commit -m "fix(calibration): metrics read y_policy_net_* label fields; EV was always NaN (§19.4)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Rebuild the verdict on the bootstrap CI, per cohort

**Files:**
- Modify: `backend/src/scoring/config.js`
- Modify: `backend/src/calibration/verdict.js`
- Test: `backend/src/calibration/__tests__/verdict.test.js` (create)

> **Defect:** the verdict uses `mean EV > 0` and `precision >= 0.5`, never imports `bootstrapMeanCI`, has no `EXTEND` branch, and collapses all cohorts into one boolean. Report §19.5 requires five conditions, a bootstrap 95% CI lower bound above zero, a single `EXTEND` to 2N, and **independent per-cohort judgement** (a partial pass is legitimate). With heavy-tailed returns a positive sample mean is routinely noise.

- [ ] **Step 1: Add the calibration thresholds**

In `backend/src/scoring/config.js`, add a `calibration` block to the exported `CONFIG` object, immediately after the `policy` block:

```js
  calibration: {
    bootstrapSamples: 2000,
    confidence: 0.95,
    minQualifiedAlerts: 200,       // N per cohort, predeclared (§19.5)
    rugCeilingFrac: 0.30,
    maxMedianFillDecayFrac: 0.05,
  },
```

These are uncalibrated placeholders; changing them bumps `CONFIG.version` (§22).

- [ ] **Step 2: Write the failing test**

Create `backend/src/calibration/__tests__/verdict.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { evaluateCohort, evaluateVerdict } from '../verdict.js';

const cal = { bootstrapSamples: 400, confidence: 0.95, minQualifiedAlerts: 10,
              rugCeilingFrac: 0.30, maxMedianFillDecayFrac: 0.05 };
// Deterministic RNG so a verdict never changes between runs.
const rng = () => { let s = 7; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };
const rows = (n, net) => Array.from({ length: n }, () => ({
  label: { y_policy_net_return: net, y_policy_net_positive: net >= 0.5, y_rugged: false } }));

const cohort = (over = {}) => ({
  rows: rows(20, 0.8), medianFillDecay: 0.02,
  parity: { ok: true }, extended: false, ...over,
});

describe('evaluateCohort (§19.5)', () => {
  it('returns INSUFFICIENT below N and does not judge', () => {
    const r = evaluateCohort(cohort({ rows: rows(3, 0.8) }), { cal, rng: rng() });
    expect(r.verdict).toBe('INSUFFICIENT');
    expect(r.reasons).toContain('n_below_minimum');
  });

  it('returns GO when all five conditions hold', () => {
    const r = evaluateCohort(cohort(), { cal, rng: rng() });
    expect(r.verdict).toBe('GO');
    expect(r.ci.lower).toBeGreaterThan(0);
  });

  it('returns NO_GO when the CI is entirely below zero', () => {
    const r = evaluateCohort(cohort({ rows: rows(20, -0.6) }), { cal, rng: rng() });
    expect(r.verdict).toBe('NO_GO');
    expect(r.ci.upper).toBeLessThan(0);
  });

  it('returns EXTEND when the CI straddles zero on a heavy-tailed sample', () => {
    const heavy = [...rows(18, -1), ...rows(2, 12)];
    const r = evaluateCohort(cohort({ rows: heavy }), { cal, rng: rng() });
    expect(r.verdict).toBe('EXTEND');
    expect(r.targetN).toBe(cal.minQualifiedAlerts * 2);
  });

  it('extends only ONCE — a straddling CI after extension is NO_GO', () => {
    const heavy = [...rows(18, -1), ...rows(2, 12)];
    const r = evaluateCohort(cohort({ rows: heavy, extended: true }), { cal, rng: rng() });
    expect(r.verdict).toBe('NO_GO');
    expect(r.reasons).toContain('extension_exhausted');
  });

  it('blocks GO when the rug rate exceeds the ceiling', () => {
    const rugged = rows(20, 0.8).map(r => ({ label: { ...r.label, y_rugged: true } }));
    const r = evaluateCohort(cohort({ rows: rugged }), { cal, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('rug_rate_above_ceiling');
  });

  it('blocks GO when median fill decay exceeds the policy assumption', () => {
    const r = evaluateCohort(cohort({ medianFillDecay: 0.20 }), { cal, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('fill_decay_above_policy');
  });

  it('blocks GO on an unresolved parity failure', () => {
    const r = evaluateCohort(cohort({ parity: { ok: false } }), { cal, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('parity_failures_unresolved');
  });

  it('is reproducible across runs', () => {
    const a = evaluateCohort(cohort(), { cal, rng: rng() });
    const b = evaluateCohort(cohort(), { cal, rng: rng() });
    expect(a).toEqual(b);
  });
});

describe('evaluateVerdict (§19.5 per-cohort independence)', () => {
  it('judges cohorts independently and allows a partial pass', () => {
    const out = evaluateVerdict({
      'pump-curve': cohort(),
      'post-migration': cohort({ rows: rows(20, -0.6) }),
    }, { cal });
    expect(out.cohorts['pump-curve'].verdict).toBe('GO');
    expect(out.cohorts['post-migration'].verdict).toBe('NO_GO');
    expect(out.overall).toBe('PARTIAL');
  });

  it('reports GO overall only when every cohort is GO', () => {
    const out = evaluateVerdict(
      { 'pump-curve': cohort(), 'post-migration': cohort() }, { cal });
    expect(out.overall).toBe('GO');
  });

  it('never reports GO while a cohort is still INSUFFICIENT', () => {
    const out = evaluateVerdict({
      'pump-curve': cohort(),
      'post-migration': cohort({ rows: rows(2, 0.8) }),
    }, { cal });
    expect(out.overall).not.toBe('GO');
    expect(out.cohorts['post-migration'].verdict).toBe('INSUFFICIENT');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/verdict.test.js`
Expected: FAIL — `evaluateCohort` is not exported; `evaluateVerdict` returns `{verdict:'GO'|'NO-GO'}` with no per-cohort verdicts or CI.

- [ ] **Step 4: Write the fix**

Replace `backend/src/calibration/verdict.js` with:

```js
// The frozen go/no-go rule (§19.5). Cohorts are judged INDEPENDENTLY — a partial pass is
// legitimate: one regime can go live while the other stays watching-only.
//
// The interval is a percentile BOOTSTRAP, not a t-test: meme returns are heavy-tailed and
// bounded below at -1, so a positive sample mean is routinely noise.
import { bootstrapMeanCI } from './bootstrap.js';
import { evPerAlert } from './metrics.js';

const seeded = seed => { let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };

export function evaluateCohort(cohort, { cal, rng }) {
  const rows = (cohort.rows ?? []).filter(row => row.label);
  const n = rows.length;
  const requiredN = cohort.extended ? cal.minQualifiedAlerts * 2 : cal.minQualifiedAlerts;

  // Condition 1. Below N we do not judge at all — an early verdict on a thin sample is
  // exactly the mistake this rule exists to prevent.
  if (n < requiredN) {
    return { verdict: 'INSUFFICIENT', n, requiredN, ci: null, reasons: ['n_below_minimum'] };
  }

  const returns = rows.map(row => row.label.y_policy_net_return);
  const ci = bootstrapMeanCI(returns, {
    samples: cal.bootstrapSamples, confidence: cal.confidence, rng: rng ?? seeded(1) });

  // Conditions 3-5 are hard gates on GO regardless of the interval.
  const reasons = [];
  const rugRate = rows.filter(row => row.label.y_rugged).length / n;
  if (rugRate > cal.rugCeilingFrac) reasons.push('rug_rate_above_ceiling');
  if (cohort.medianFillDecay != null && cohort.medianFillDecay > cal.maxMedianFillDecayFrac) {
    reasons.push('fill_decay_above_policy');
  }
  if (!cohort.parity?.ok) reasons.push('parity_failures_unresolved');

  const base = { n, requiredN, ci, ev: evPerAlert(rows), rugRate };

  // Condition 2 drives the three-way decision.
  if (ci.upper < 0) return { ...base, verdict: 'NO_GO', reasons: [...reasons, 'ci_below_zero'] };
  if (ci.lower <= 0 && ci.upper >= 0) {
    if (cohort.extended) {
      return { ...base, verdict: 'NO_GO', reasons: [...reasons, 'extension_exhausted'] };
    }
    return { ...base, verdict: 'EXTEND', targetN: cal.minQualifiedAlerts * 2,
             reasons: [...reasons, 'ci_straddles_zero'] };
  }
  if (reasons.length) return { ...base, verdict: 'NO_GO', reasons };
  return { ...base, verdict: 'GO', reasons: [] };
}

export function evaluateVerdict(cohorts, { cal, rng } = {}) {
  const out = {};
  for (const [name, data] of Object.entries(cohorts)) {
    // Per-cohort seed derived from the name: stable, and independent of iteration order.
    const seed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    out[name] = evaluateCohort(data, { cal, rng: rng ?? seeded(seed) });
  }
  const verdicts = Object.values(out).map(v => v.verdict);
  const overall = verdicts.length && verdicts.every(v => v === 'GO') ? 'GO'
    : verdicts.includes('GO') ? 'PARTIAL'
    : verdicts.some(v => v === 'EXTEND' || v === 'INSUFFICIENT') ? 'PENDING'
    : 'NO_GO';
  return { cohorts: out, overall };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/verdict.test.js`
Expected: PASS — 12 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scoring/config.js backend/src/calibration/verdict.js backend/src/calibration/__tests__/verdict.test.js
git commit -m "fix(calibration): verdict uses bootstrap CI + per-cohort GO/NO_GO/EXTEND (§19.5)

Replaces a mean-EV>0 test that could declare GO on noise.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Make the parity check able to fail

**Files:**
- Modify: `backend/src/calibration/parityCheck.js`
- Test: `backend/src/calibration/__tests__/parityCheck.test.js` (create)

> **Defect:** `checkParity` computes `extractAllFeatures(events)` and then `causalFeatures(tape, ...)`, which internally calls that same function on the same events. It is self-comparison and always returns `ok: true`, so §19.5 condition 5 passes vacuously.
>
> **The fix:** compare features built from the **live in-memory event array** against features recomputed from the **tape round-trip**. That is a real invariant with a real failure mode: JSONB coerces `chain_ts` to a string, drops numeric precision, and reorders keys. It catches drift the tautological version cannot. `JSON.stringify` comparison is also replaced — it throws on `BigInt` and yields no diagnostics.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/parityCheck.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { compareFeatures, checkParity } from '../parityCheck.js';

describe('compareFeatures', () => {
  it('reports no differences for identical trees', () => {
    expect(compareFeatures({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  it('names the path of a changed leaf', () => {
    expect(compareFeatures({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }))
      .toEqual([{ path: 'b.c', live: 2, replay: 3 }]);
  });

  it('detects a key missing on either side', () => {
    expect(compareFeatures({ a: 1 }, {})).toEqual([{ path: 'a', live: 1, replay: undefined }]);
    expect(compareFeatures({}, { a: 1 })).toEqual([{ path: 'a', live: undefined, replay: 1 }]);
  });

  it('treats null and 0 as different — unknown is not zero', () => {
    expect(compareFeatures({ a: null }, { a: 0 }))
      .toEqual([{ path: 'a', live: null, replay: 0 }]);
  });

  it('catches a number that survived the tape as a string', () => {
    // The real JSONB failure mode the old check could not see.
    expect(compareFeatures({ ts: 1000 }, { ts: '1000' }))
      .toEqual([{ path: 'ts', live: 1000, replay: '1000' }]);
  });

  it('tolerates float noise within epsilon', () => {
    expect(compareFeatures({ a: 0.1 + 0.2 }, { a: 0.3 })).toEqual([]);
  });

  it('does not throw on BigInt values', () => {
    expect(() => compareFeatures({ a: 1n }, { a: 1n })).not.toThrow();
  });
});

describe('checkParity', () => {
  const features = { structural: { x: 1 }, dynamic: { y: 2 } };
  const tape = { eventsUntil: async () => [] };

  it('fails loudly when no live events are supplied — it cannot vacuously pass', async () => {
    const r = await checkParity(tape, 'a', 100, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_live_events');
  });

  it('passes when live and replay agree', async () => {
    const r = await checkParity(tape, 'a', 100, {
      liveEvents: [],
      extract: () => features,
      replay: async () => features,
    });
    expect(r.ok).toBe(true);
    expect(r.diffs).toEqual([]);
  });

  it('fails and reports the diverging path when they disagree', async () => {
    const r = await checkParity(tape, 'a', 100, {
      liveEvents: [],
      extract: () => ({ structural: { x: 1 } }),
      replay: async () => ({ structural: { x: 9 } }),
    });
    expect(r.ok).toBe(false);
    expect(r.diffs[0].path).toBe('structural.x');
  });

  it('treats a thrown extractor as a failure, not a silent pass', async () => {
    const r = await checkParity(tape, 'a', 100, {
      liveEvents: [],
      extract: () => { throw new Error('boom'); },
      replay: async () => features,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/parityCheck.test.js`
Expected: FAIL — `compareFeatures` is not exported, and `checkParity` has a different signature.

- [ ] **Step 3: Write the fix**

Replace `backend/src/calibration/parityCheck.js` with:

```js
// Operational replay/live parity (§22 invariant, §19.5 condition 5).
//
// The unit test in features/__tests__/parity.test.js proves live and replay are the SAME
// function. This check proves the tape ROUND-TRIP does not change the answer: JSONB coerces
// numbers to strings, drops precision, and reorders keys. Comparing extractAllFeatures against
// causalFeatures on the same in-memory array — as this module previously did — compares a
// value with itself and can never fail.
import { extractAllFeatures, causalFeatures } from '../features/extract.js';

const EPS = 1e-9;

export function compareFeatures(live, replay, path = '') {
  const diffs = [];
  const keys = new Set([...Object.keys(live ?? {}), ...Object.keys(replay ?? {})]);
  for (const key of keys) {
    const at = path ? `${path}.${key}` : key;
    const a = live?.[key];
    const b = replay?.[key];
    const bothPlainObjects = a && b && typeof a === 'object' && typeof b === 'object'
      && !Array.isArray(a) && !Array.isArray(b) && typeof a !== 'bigint' && typeof b !== 'bigint';
    if (bothPlainObjects) { diffs.push(...compareFeatures(a, b, at)); continue; }
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > EPS) diffs.push({ path: at, live: a, replay: b });
      continue;
    }
    // Strict elsewhere: null vs 0, and 1000 vs '1000', ARE differences.
    if (a !== b) diffs.push({ path: at, live: a, replay: b });
  }
  return diffs;
}

export async function checkParity(tape, assetKey, asOf, opts = {}) {
  const { liveEvents, extract = extractAllFeatures, replay = causalFeatures, ...rest } = opts;

  // Without an independently-captured live event array there is nothing to compare against.
  // Returning ok:true here is how the GO gate was being satisfied vacuously.
  if (!liveEvents) return { ok: false, reason: 'no_live_events', diffs: [] };

  try {
    const liveFeatures = extract(liveEvents, { ...rest, nowTs: asOf });
    const replayFeatures = await replay(tape, assetKey, asOf, rest);
    const diffs = compareFeatures(liveFeatures, replayFeatures);
    return { ok: diffs.length === 0, diffs, live: liveFeatures, replay: replayFeatures };
  } catch (error) {
    // A throw is a failure. Swallowing it would turn an outage into a green check.
    return { ok: false, error: String(error.message ?? error), diffs: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/parityCheck.test.js`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/parityCheck.js backend/src/calibration/__tests__/parityCheck.test.js
git commit -m "fix(calibration): parity check compared a value with itself and could never fail (§22)

Now compares live events against the tape round-trip and reports diff paths.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Dedupe tape events on `event_id`

**Files:**
- Modify: `backend/src/tape/schema.sql`
- Modify: `backend/src/tape/db.js`
- Modify: `backend/src/tape/tape.js`
- Test: `backend/src/tape/__tests__/tape.test.js` (extend)

> **Defect:** the unique constraint is `(source, signature, instruction_index)`, but scorer-emitted events pass `signature: null`. Postgres treats every `NULL` as distinct, so `score_evaluated` rows append without bound and the `ON CONFLICT` clause never fires. `event_id` — which every appender already sets uniquely (`eventId()` hashes a real signature for chain events; `evaluate.js` uses `score:<assetKey>:<asOf>`) — is the correct identity column.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/tape/__tests__/tape.test.js` (keep the existing tests):

```js
describe('idempotency on event_id', () => {
  const scorerEvent = (asOf) => ({
    eventId: `score:solana:pumpfun:M:${asOf}`, assetKey: 'solana:pumpfun:M',
    type: 'score_evaluated', chainTs: asOf, receivedAt: asOf, slot: null,
    signature: null, instructionIndex: 0, source: 'scorer', schemaVersion: 1,
    payload: { memeScore: 70 },
  });

  it('stores successive scorer events even though signature is null', async () => {
    expect(await tape.append(scorerEvent(1_000))).toBe(true);
    expect(await tape.append(scorerEvent(2_000))).toBe(true);
    const rows = await tape.eventsUntil('solana:pumpfun:M', 5_000, ['score_evaluated']);
    expect(rows).toHaveLength(2);
  });

  it('rejects a replayed scorer event with the same event_id', async () => {
    expect(await tape.append(scorerEvent(3_000))).toBe(true);
    expect(await tape.append(scorerEvent(3_000))).toBe(false);
    const rows = await tape.eventsUntil('solana:pumpfun:M', 5_000, ['score_evaluated']);
    expect(rows).toHaveLength(1);
  });

  it('still dedupes a replayed chain event', async () => {
    const trade = {
      eventId: 'abc123', assetKey: 'solana:pumpfun:M', type: 'trade_observed',
      chainTs: 10, receivedAt: 10, slot: 5, signature: 'SIG1', instructionIndex: 0,
      source: 'pumpportal', schemaVersion: 1, payload: { side: 'buy' },
    };
    expect(await tape.append(trade)).toBe(true);
    expect(await tape.append(trade)).toBe(false);
  });
});
```

If the existing file does not already create a fresh `tape` per test, wrap these in a `describe` with its own `beforeEach` that builds `new Tape(newDb().adapters.createPg())` and runs `migrate(db)` — matching the pattern already used at the top of that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/tape/__tests__/tape.test.js`
Expected: FAIL — "rejects a replayed scorer event" gets `true` on the second append (two rows), because the NULL signature makes the constraint inapplicable.

- [ ] **Step 3: Update the schema**

In `backend/src/tape/schema.sql`, replace the constraint line:

```sql
-- Append-only event tape. Store events, never derived conclusions.
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  type TEXT NOT NULL,
  chain_ts BIGINT,
  received_at BIGINT NOT NULL,
  slot BIGINT,
  signature TEXT,
  instruction_index INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  -- Identity is event_id. A NULL signature (scorer-emitted events) makes a
  -- (source, signature, instruction_index) constraint inapplicable in Postgres,
  -- because every NULL compares distinct.
  CONSTRAINT events_identity UNIQUE (event_id)
);
CREATE INDEX IF NOT EXISTS events_asset_chain_ts
  ON events (asset_key, chain_ts, slot, instruction_index);
-- Chain-event lookup by provider identity (non-unique: NULL signatures are permitted).
CREATE INDEX IF NOT EXISTS events_source_signature
  ON events (source, signature, instruction_index);

-- TimescaleDB-ready: create_hypertable('events', 'chain_ts', if_not_exists => TRUE)
```

- [ ] **Step 4: Migrate existing databases**

In `backend/src/tape/db.js`, inside `migrate`, run this **after** applying `schema.sql` so an already-created table is upgraded:

```js
  // Pre-existing databases carry the old (source, signature, instruction_index) constraint,
  // which cannot dedupe NULL-signature scorer events. Swap it for the event_id identity.
  await db.query(`ALTER TABLE events DROP CONSTRAINT IF EXISTS events_identity`);
  await db.query(`ALTER TABLE events ADD CONSTRAINT events_identity UNIQUE (event_id)`)
    .catch(() => {});   // already present on a freshly created table
```

- [ ] **Step 5: Point the conflict clause at event_id**

In `backend/src/tape/tape.js`, change the `ON CONFLICT` target:

```js
       ON CONFLICT (event_id) DO NOTHING`,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tape/__tests__/tape.test.js`
Expected: PASS — the existing tape tests plus 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tape/schema.sql backend/src/tape/db.js backend/src/tape/tape.js backend/src/tape/__tests__/tape.test.js
git commit -m "fix(tape): dedupe on event_id; NULL signatures defeated the old constraint (§9.4)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Never rebase an existing alert

**Files:**
- Modify: `backend/src/monitoring/evaluate.js`
- Test: `backend/src/monitoring/__tests__/evaluate.test.js` (create)

> **Defect:** the alert is preserved only when the caller threads `prevAlert` back in. Any caller that omits it re-stamps the alert on every evaluation, so a token that already ran 3× looks freshly alerted and the decay guard measures against a moving reference. Report §18.3/§20: the alert is stamped **once** at first qualification and never rebased. The fix makes it correct by default by also honouring an alert already carried on the token.

- [ ] **Step 1: Write the failing test**

Create `backend/src/monitoring/__tests__/evaluate.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { evaluateToken } from '../evaluate.js';
import { CONFIG } from '../../scoring/config.js';

const deps = ({ admission = 'qualified', status = 'scored' } = {}) => ({
  extract: vi.fn(async () => ({ structural: {}, dynamic: {}, snapshot: { mcap: 50_000 } })),
  score: vi.fn(() => ({ version: 'meme-score-v2.0.0', status, profile: 'pump-curve',
    structural: { score: 80, coverage: 0.9, breakdown: {} },
    dynamic: { score: 70, coverage: 0.8, breakdown: {} },
    memeScore: 76, evidenceCoverage: 86, blockers: [] })),
  admitFn: vi.fn(() => admission),
});
const token = (over = {}) => ({ assetKey: 'solana:pumpfun:M', events: [], ...over });

describe('evaluateToken alert stamping (§18.3, §20)', () => {
  it('stamps the alert on first qualification', async () => {
    const out = await evaluateToken(token(), { asOf: 1_000, cfg: CONFIG, ...deps() });
    expect(out.alert).toMatchObject({ ts: 1_000, mcap: 50_000 });
  });

  it('preserves an alert carried on the token when prevAlert is not passed', async () => {
    const existing = { ts: 1_000, mcap: 10_000, priceUsd: null };
    const out = await evaluateToken(token({ alert: existing }),
      { asOf: 9_999, cfg: CONFIG, ...deps() });
    expect(out.alert).toEqual(existing);   // NOT re-stamped at 9_999
  });

  it('still honours an explicit prevAlert', async () => {
    const existing = { ts: 500, mcap: 1, priceUsd: null };
    const out = await evaluateToken(token(),
      { asOf: 9_999, cfg: CONFIG, prevAlert: existing, ...deps() });
    expect(out.alert).toEqual(existing);
  });

  it('does not stamp an alert while merely watching', async () => {
    const out = await evaluateToken(token(),
      { asOf: 5, cfg: CONFIG, ...deps({ admission: 'watching' }) });
    expect(out.alert).toBeNull();
  });

  it('returns unscored without calling admit', async () => {
    const d = deps({ status: 'unscored' });
    const out = await evaluateToken(token(), { asOf: 3, cfg: CONFIG, ...d });
    expect(out.admission).toBe('unscored');
    expect(d.admitFn).not.toHaveBeenCalled();
  });

  it('emits admission_changed only on a real transition', async () => {
    const tape = { append: vi.fn(async () => {}) };
    await evaluateToken(token(), { asOf: 11, cfg: CONFIG, tape,
      prevAdmission: 'watching', ...deps() });
    expect(tape.append.mock.calls.map(([e]) => e.type))
      .toEqual(['score_evaluated', 'admission_changed']);

    const tape2 = { append: vi.fn(async () => {}) };
    await evaluateToken(token(), { asOf: 12, cfg: CONFIG, tape: tape2,
      prevAdmission: 'qualified', ...deps() });
    expect(tape2.append.mock.calls.map(([e]) => e.type)).toEqual(['score_evaluated']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/monitoring/__tests__/evaluate.test.js`
Expected: FAIL — "preserves an alert carried on the token" gets a re-stamped `{ ts: 9_999, mcap: 50_000 }`.

- [ ] **Step 3: Write the fix**

In `backend/src/monitoring/evaluate.js`, change the alert expression from:

```js
const alert = prevAlert ?? (admission === 'qualified' ? { ts: asOf, mcap: features.snapshot?.mcap ?? null, priceUsd: token.priceUsd ?? null } : null);
```

to:

```js
// Stamped ONCE at first qualification and never rebased (§18.3, §20). `token.alert` is
// honoured so a caller that does not thread prevAlert cannot silently reset the reference
// price — a re-stamped alert makes a token that already ran 3x look freshly alerted.
const alert = prevAlert ?? token.alert ?? (admission === 'qualified' ? { ts: asOf, mcap: features.snapshot?.mcap ?? null, priceUsd: token.priceUsd ?? null } : null);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/monitoring/__tests__/evaluate.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitoring/evaluate.js backend/src/monitoring/__tests__/evaluate.test.js
git commit -m "fix(monitoring): honour an existing alert so it is never rebased (§18.3,§20)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Count post-window buys in the cohort basis

**Files:**
- Modify: `backend/src/features/cohortRetention.js`
- Test: `backend/src/features/__tests__/cohortRetention.test.js` (extend)

> **Defect:** the position basis comes from `rawBoughtByWallet`, which `extract.js` fills only from buys inside `cohortEntryMs`. A wallet that enters in the window, **adds** later, then sells everything ends with `held < 0` and is counted as fully exited, while its later buy is missing from `remainingTokenPct`'s denominator. Retention is understated for exactly the wallets that added to their position (Report §12.3.5 requires token-unit net positions).

- [ ] **Step 1: Write the failing test**

Add to `backend/src/features/__tests__/cohortRetention.test.js`:

```js
describe('cohort basis includes post-window buys (§12.3.5)', () => {
  const t0 = 0, entryMs = 5 * 60_000, checkMs = 15 * 60_000;
  // Five wallets enter in-window so the cohort clears its minimum size.
  const entry = ['w1', 'w2', 'w3', 'w4', 'w5'].map(wallet => ({
    wallet, side: 'buy', chainTs: 60_000, rawTokens: '100' }));
  const basis = new Map(['w1', 'w2', 'w3', 'w4', 'w5'].map(w => [w, 100n]));

  it('counts a wallet that added then sold its ORIGINAL amount as still holding', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'buy', chainTs: 10 * 60_000, rawTokens: '100' },  // adds after window
      { wallet: 'w1', side: 'sell', chainTs: 12 * 60_000, rawTokens: '100' }, // sells half its stack
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    expect(r.fullyExited).toBe(0);        // still holds 100 of 200
    expect(r.partiallySold).toBe(1);
  });

  it('includes the added tokens in remainingTokenPct', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'buy', chainTs: 10 * 60_000, rawTokens: '100' },
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    // 600 held of 600 bought
    expect(r.remainingTokenPct).toBeCloseTo(1, 10);
  });

  it('still marks a genuine full exit', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'sell', chainTs: 12 * 60_000, rawTokens: '100' },
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    expect(r.fullyExited).toBe(1);
  });

  it('ignores buys after the check horizon', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'buy', chainTs: 60 * 60_000, rawTokens: '900' },
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    expect(r.remainingTokenPct).toBeCloseTo(1, 10);   // the late buy is out of scope
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/cohortRetention.test.js`
Expected: FAIL — the first test reports `fullyExited: 1` because the basis is 100 while sells total 100.

- [ ] **Step 3: Write the fix**

Replace `backend/src/features/cohortRetention.js` with:

```js
// Token-unit cohort retention (§12.3.5). A wallet that sells ONE token has not exited.
//
// The basis is every buy a cohort wallet makes up to the check horizon — not just its
// entry-window buy. Ignoring later buys makes a wallet that ADDS and then sells part of
// its stack look fully exited, understating retention for the most committed wallets.
export function cohortRetention(trades, t0, entryMs, checkMs, rawBoughtByWallet) {
  const cohort = new Set(trades.filter(trade => trade.side === 'buy' &&
    trade.chainTs >= t0 && trade.chainTs <= t0 + entryMs).map(trade => trade.wallet).filter(Boolean));
  if (cohort.size < 5) return null;

  const bought = new Map([...cohort].map(wallet => [wallet, 0n]));
  const net = new Map([...cohort].map(wallet => [wallet, 0n]));
  for (const trade of trades) {
    if (!cohort.has(trade.wallet) || trade.chainTs < t0 || trade.chainTs > t0 + checkMs) continue;
    const amount = BigInt(trade.rawTokens ?? 0);
    if (trade.side === 'buy') {
      bought.set(trade.wallet, bought.get(trade.wallet) + amount);
      net.set(trade.wallet, net.get(trade.wallet) + amount);
    } else if (trade.side === 'sell') {
      net.set(trade.wallet, net.get(trade.wallet) - amount);
    }
  }

  // Fall back to the caller-supplied basis only where the trade stream shows nothing,
  // so an out-of-band basis is still honoured but never overrides observed buys.
  for (const wallet of cohort) {
    if (bought.get(wallet) === 0n) {
      const seeded = rawBoughtByWallet?.get(wallet) ?? 0n;
      bought.set(wallet, seeded);
      net.set(wallet, net.get(wallet) + seeded);
    }
  }

  const positions = [...cohort].map(wallet => ({ bought: bought.get(wallet), held: net.get(wallet) }));
  const fullyExited = positions.filter(position => position.held <= 0n).length;
  const partiallySold = positions.filter(position =>
    position.held > 0n && position.held < position.bought).length;
  const remainingRaw = positions.reduce((sum, position) =>
    sum + (position.held > 0n ? position.held : 0n), 0n);
  const boughtRaw = positions.reduce((sum, position) => sum + position.bought, 0n);
  return { cohortSize: cohort.size, fullyExited, partiallySold,
    remainingTokenPct: boughtRaw === 0n ? null : Number(remainingRaw) / Number(boughtRaw) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/features/__tests__/cohortRetention.test.js src/features/__tests__/extract.test.js`
Expected: PASS — existing retention tests plus 4 new ones, and the extractor suite unaffected.

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/cohortRetention.js backend/src/features/__tests__/cohortRetention.test.js
git commit -m "fix(features): cohort basis counts post-window buys; adders were read as exits (§12.3.5)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Compute `y_rugged` over the full price history

**Files:**
- Modify: `backend/src/calibration/labels.js`
- Test: `backend/src/calibration/__tests__/labels.test.js` (create)

> **Defect:** `y_rugged` compares the last **post-alert** price to the post-alert peak. A rug that happened before the alert is invisible, and a single sparse late snapshot marks a recovered token as rugged. Report §7.2: rugged means market cap or executable price collapsed ≥ 90% from ATH inside the horizon — the ATH is the whole observed history, and the collapse must come after it.

- [ ] **Step 1: Write the failing test**

Create `backend/src/calibration/__tests__/labels.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildLabel } from '../labels.js';

const cfg = { policy: { evalHorizonMs: 6 * 3600_000, positiveReturn: 0.5, mcapTarget: 500_000,
  latencyMs: 0, entrySlippageFrac: 0.05, exitSlippageFrac: 0.05, feeFrac: 0.01,
  exitLadder: [[2, 0.5], [4, 0.25]], timeStopMs: 6 * 3600_000 } };

// Minimal fake tape: returns the events it was constructed with, filtered by type.
const fakeTape = (events) => ({
  eventsUntil: async (_key, asOf, types) => events.filter(e =>
    e.chainTs <= asOf && (!types || types.includes(e.type))),
});
const created = { type: 'token_created', chainTs: 0,
  payload: { rawSupply: '1000000000000000', decimals: 6 } };
const snap = (chainTs, priceUsd) => ({ type: 'market_snapshot', chainTs, payload: { priceUsd } });

describe('buildLabel y_rugged (§7.2)', () => {
  it('flags a collapse of 90%+ from the observed peak', async () => {
    const tape = fakeTape([created, snap(1_000, 0.001), snap(2_000, 0.010), snap(3_000, 0.0005)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(true);
  });

  it('does not flag a healthy rise that ends at its peak', async () => {
    const tape = fakeTape([created, snap(1_000, 0.001), snap(2_000, 0.005)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });

  it('sees a rug whose peak occurred BEFORE the alert', async () => {
    // Peak at t=500 (pre-alert), collapse at t=3000 (post-alert).
    const tape = fakeTape([created, snap(500, 0.010), snap(2_000, 0.002), snap(3_000, 0.0002)]);
    const label = await buildLabel(tape, 'k', { ts: 1_000, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(true);
  });

  it('does not flag when the low precedes the peak (recovery, not a rug)', async () => {
    const tape = fakeTape([created, snap(1_000, 0.0001), snap(2_000, 0.010)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });

  it('needs at least two price points before calling anything a rug', async () => {
    const tape = fakeTape([created, snap(2_000, 0.001)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });
});

describe('buildLabel dead-token guard (§19.2)', () => {
  it('returns an explicit failed label and never -Infinity', async () => {
    const tape = fakeTape([created, snap(500, 0.001)]);   // nothing at/after the alert
    const label = await buildLabel(tape, 'k', { ts: 1_000, mcap: 10_000 }, cfg);
    expect(label.y_dead).toBe(true);
    expect(label.y_policy_net_return).toBe(-1);
    expect(label.y_peak_opportunity).toBeNull();
    for (const value of Object.values(label)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/calibration/__tests__/labels.test.js`
Expected: FAIL — "sees a rug whose peak occurred BEFORE the alert" returns `false` (peak is taken from post-alert prices only), and "needs at least two price points" returns `true`.

- [ ] **Step 3: Write the fix**

In `backend/src/calibration/labels.js`, replace the two lines that compute the rug inputs and the `y_rugged` field. Change:

```js
const peakPrice = Math.max(...prices.map(point => point.priceUsd)); const last = prices.at(-1).priceUsd;
```

to:

```js
// Rug is measured against the FULL observed history (§7.2): an ATH set before the alert is
// still the ATH, and the collapse must come AFTER the peak or it is a recovery, not a rug.
const allPrices = snapshots.map(event => ({ ts: ts(event), priceUsd: event.payload?.priceUsd })).filter(point => point.priceUsd != null).sort((a, b) => a.ts - b.ts);
const peakIndex = allPrices.reduce((best, point, index) => point.priceUsd > allPrices[best].priceUsd ? index : best, 0);
const peakPrice = allPrices[peakIndex].priceUsd;
const last = allPrices.at(-1).priceUsd;
const rugged = allPrices.length >= 2 && peakIndex < allPrices.length - 1 && last <= peakPrice * 0.1;
```

and change the returned field from `y_rugged: last <= peakPrice * .1` to:

```js
y_rugged: rugged,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/calibration/__tests__/labels.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/calibration/labels.js backend/src/calibration/__tests__/labels.test.js
git commit -m "fix(calibration): y_rugged uses full price history and requires peak-then-collapse (§7.2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Mount the memefinder router

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/server.js`
- Test: `backend/src/memefinder/__tests__/routes.test.js` (create)

> **Defect:** `server.js` has no reference to `createMemeFinderRouter`, so `/api/memefinder/qualified`, `/all`, `/token/:assetKey` and `/verdict` all 404 and the UI has no data source. The router factory takes `{ getTokens, getVerdict }`; the registry already exports `getTokens({ view })`.

- [ ] **Step 1: Add the test dependency**

```bash
cd backend && npm install --save-dev supertest
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/memefinder/__tests__/routes.test.js`:

```js
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMemeFinderRouter } from '../routes.js';

const token = (assetKey, admission, memeScore) => ({
  assetKey, admission, score: { memeScore, version: 'v', evidenceCoverage: 80 },
});
const fixture = [
  token('solana:pumpfun:Q1', 'qualified', 90),
  token('solana:pumpfun:Q2', 'qualified', 80),
  token('solana:pumpfun:W1', 'watching', 40),
];
const app = (rows = fixture, getVerdict = () => null) => {
  const a = express();
  a.use('/api/memefinder', createMemeFinderRouter({ getTokens: () => rows, getVerdict }));
  return a;
};

describe('memefinder routes', () => {
  it('serves only qualified tokens, ranked by memeScore', async () => {
    const res = await request(app()).get('/api/memefinder/qualified');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.tokens.map(t => t.assetKey))
      .toEqual(['solana:pumpfun:Q1', 'solana:pumpfun:Q2']);
  });

  it('paginates and always reports the total', async () => {
    const res = await request(app()).get('/api/memefinder/qualified?page=2&pageSize=1');
    expect(res.body.page).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.tokens.map(t => t.assetKey)).toEqual(['solana:pumpfun:Q2']);
  });

  it('serves every token on the diagnostic feed', async () => {
    const res = await request(app()).get('/api/memefinder/all');
    expect(res.body.total).toBe(3);
  });

  it('serves a single token and 404s an unknown key', async () => {
    const ok = await request(app()).get('/api/memefinder/token/solana:pumpfun:Q1');
    expect(ok.status).toBe(200);
    expect(ok.body.assetKey).toBe('solana:pumpfun:Q1');
    const missing = await request(app()).get('/api/memefinder/token/solana:pumpfun:NOPE');
    expect(missing.status).toBe(404);
  });

  it('serves the verdict', async () => {
    const res = await request(app(fixture, () => ({ overall: 'PENDING' }))).get('/api/memefinder/verdict');
    expect(res.body.verdict).toEqual({ overall: 'PENDING' });
  });

  it('never labels coverage as confidence or probability', async () => {
    const res = await request(app()).get('/api/memefinder/qualified');
    expect(JSON.stringify(res.body)).not.toMatch(/confidence|probability/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/memefinder/__tests__/routes.test.js`
Expected: FAIL — `Cannot find module 'supertest'` before Step 1 completes, otherwise the suite runs and confirms the router shape.

- [ ] **Step 4: Mount the router**

In `backend/server.js`, add the import beside the other router imports (near line 36):

```js
import { createMemeFinderRouter } from './src/memefinder/routes.js';
```

and mount it beside the other `app.use` calls (near line 79):

```js
app.use('/api/memefinder', createMemeFinderRouter({
  // The backend is the sole qualification authority (§18.1); the router only shapes
  // what the scorer already decided.
  getTokens: () => getTokens({ view: 'all' }),
}));
```

`getTokens` is already imported in `server.js` from `./src/discovery/registry.js`. If it is not, add it to that existing import rather than creating a second one.

- [ ] **Step 5: Run tests and verify the server boots**

Run: `cd backend && npx vitest run src/memefinder/__tests__/routes.test.js`
Expected: PASS — 6 tests.

Run: `cd backend && node --check server.js`
Expected: no output (syntax OK).

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/server.js backend/src/memefinder/__tests__/routes.test.js
git commit -m "fix(server): mount the memefinder router; every endpoint was 404 (§18.2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Full regression and review close

**Files:**
- Modify: `docs/superpowers/plans/2026-07-25-meme-finder-review-fixes.md` (check off completed tasks)

- [x] **Step 1: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS. Baseline was 63 files / 235 tests. This plan adds 6 new test files and roughly 62 new tests; every pre-existing test must still pass.

- [x] **Step 2: Run the frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — unchanged by this plan (no frontend files were modified).

- [x] **Step 3: Verify each review finding is closed**

Confirm by inspection; fix rather than rationalise any failure:

- [x] `policyDecision` skips on a **rise** past `maxEntryDecayFrac` and enters on a fall (Finding 1).
- [x] `grep -n "row.netReturn" backend/src/calibration/*.js` returns nothing — metrics read `label.y_policy_net_return` (Finding 2).
- [x] `grep -n "bootstrapMeanCI" backend/src/calibration/verdict.js` shows the import in use, and `evaluateVerdict` returns per-cohort verdicts (Finding 3).
- [x] `checkParity` returns `ok:false` when `liveEvents` is absent, and `compareFeatures` reports diff paths (Finding 4).
- [x] `grep -n "ON CONFLICT" backend/src/tape/tape.js` shows `(event_id)` (Finding 5).
- [x] `evaluateToken` preserves `token.alert` without an explicit `prevAlert` (Finding 6).
- [x] `cohortRetention` counts a wallet that added then part-sold as `partiallySold`, not `fullyExited` (Finding 7).
- [x] `y_rugged` is computed from all snapshots and requires the peak to precede the collapse (Finding 8).
- [x] `curl -s localhost:4517/api/memefinder/qualified` returns JSON, not a 404 (Finding 9).
- [x] `ls backend/src/{monitoring,calibration,policy,memefinder}/__tests__` lists test files in all four directories (Finding 10 — the coverage gap).

- [x] **Step 4: Commit the close**

```bash
git add docs/superpowers/plans/2026-07-25-meme-finder-review-fixes.md
git commit -m "docs(plan): close review-fix plan — 10 findings resolved with tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**1. Finding coverage.** All 10 review findings map to a task: inverted decay → 1; metrics field mismatch → 2; verdict without CI → 3; tautological parity → 4; tape idempotency → 5; alert rebasing → 6; cohort retention → 7; `y_rugged` → 8; unmounted router → 9; missing Phase 5/6 tests → discharged across Tasks 1–9, verified in Task 10 Step 3.

**2. Placeholder scan.** No "TBD", "add error handling", "similar to Task N", or "write tests for the above". Every code step shows complete, runnable code; every test step shows full assertions.

**3. Type and name consistency.** Signatures match the code as it exists on disk, not the earlier plans: `policyDecision(score, token, cfg)`, `recordShadowDecision(store, decision)`, `bootstrapMeanCI(values, {samples, rng, confidence})` returning `{mean, lower, upper}`, `checkParity(tape, assetKey, asOf, opts)`, `createMemeFinderRouter({getTokens, getVerdict})`, `paginate` returning `{total, page, pageSize, tokens}`, `cohortRetention(trades, t0, entryMs, checkMs, rawBoughtByWallet)`, `getTokens({view})`. New exports introduced here and used consistently: `evaluateCohort`, `compareFeatures`.

**4. Scope discipline.** Each task changes only what its finding requires. Two adjacent cases are folded in where they are the same conditional and share the defect's root cause — the `null` mcap path in Task 1 (unknown must not become a favourable default) and the `bought`-basis fallback in Task 7 — and both are called out in comments. The `sell_route_check` emitter, market-snapshot backfill, and probability model remain out of scope; they were not review findings.

**5. Data-integrity ordering.** Tasks 1 and 2 come first because until both land, every shadow decision recorded and every EV computed is wrong. Running a shadow window before Task 1 would produce a dataset that has to be thrown away.
