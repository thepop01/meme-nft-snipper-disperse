# Meme Finder — Phase 5: Monitoring Lifecycle + API & UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 4's pure scorer into a running decision system — compose features → score → admission into one versioned evaluation, manage the admission lifecycle (provisional TTL, expiry, invalidation) with score-prioritized monitoring that never evicts protected or control tokens, and expose it as a paginated backend API behind one **Qualified Memes** UI that renders the backend's `admission` instead of recomputing gates.

**Architecture:** A new `backend/src/monitoring/` module owns the evaluation pipeline and lifecycle: `evaluate.js` composes the Phase 2 extractor + Phase 4 scorer + `admit` into the complete §14 score contract (adding `admission`, `reasons`, `alert`) and records `score_evaluated` / `admission_changed` on the tape; `queue.js` ranks the hot set by `memeScore` while holding qualified, tracked, position-linked **and control-sample** tokens outside the cap; `lifecycle.js` enforces the provisional TTL and `expired` transition. A new `backend/src/memefinder/` module serves ranked, paginated reads. The frontend gains `QualifiedMemesView` + `TokenEvidencePanel` and **loses** its qualification predicates — the backend `admission` field becomes the single authority (§18.1), completing the defect-#8 remediation Phase 1 began.

**Tech Stack:** Node ESM, Express, Vitest, pg + pg-mem (from Phase 1). New devDeps: `supertest` (backend route tests), `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` (frontend component tests). No new runtime deps.

**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` — §10 capacity + control-sample rules, §11 lifecycle/regimes, §11.1 admission states, §14 score contract, §16.3 provisional TTL, §16.4 remaining transitions, §17 score-prioritized monitoring, §18 API & UI (§18.1 backend authority, §18.2 feeds, §18.3 token presentation), §24 observability. Section references below point there.

**Depends on:**
- Phase 1: `docs/superpowers/plans/2026-07-24-meme-finder-phase1-event-tape.md` — `Tape`, `assetKey`, `EVENT_TYPES`, `validateEnvelope`, `classifyScope`, `canEvict`/`selectEvictable` (interim), `isQualified` (frontend), paginated `/api/tokens`.
- Phase 2: `docs/superpowers/plans/2026-07-24-meme-finder-phase2-ingestion-snapshots.md` — `systemClock`/`manualClock`, `MonitorBudget` (`registerLaunch`/`recordBuy`/`isHot`/`isControl`), `config.collection`, `extractAllFeatures`/`causalFeatures`, `supplyAwareMcap`.
- Phase 3: `docs/superpowers/plans/2026-07-24-meme-finder-phase3-structural-features.md` — the six structural families in `extractAllFeatures`.
- Phase 4: `docs/superpowers/plans/2026-07-24-meme-finder-phase4-dynamic-scoring.md` — `CONFIG`, `computeMemeScore`, `evaluateBlockers`, `admit`.
- Shared context: `docs/superpowers/plans/2026-07-24-memefinder-00-shared-context.md` — §2 foundation contract map, §7 legacy pipeline + WS10 migration contract, §9.1 `prioritize` contract, §12 authoring rules.

---

## Scope and honest boundaries

**In scope (WS9 + WS10):** evaluation composition, admission lifecycle (provisional TTL, expiry, invalidation on new blocker), score-prioritized monitoring with protected + control sets, eviction retention (aggregates persist, tape untouched), queue/lifecycle observability counters, ranked paginated API, Qualified Memes UI + evidence panel, removal of frontend qualification gating.

**Explicitly deferred (named, not omitted):**
- **Replay, labels, shadow policy, calibration metrics, and the go/no-go verdict are Phase 6 (WS11+WS12).** This plan surfaces `admission` and evidence; it does **not** decide whether the system is profitable and enables **no** automation.
- **§13 Gap 2 (`MARKET_SNAPSHOT` never emitted)** is owned by WS7/Phase 4. Until an emitter exists, market-cap-derived UI fields (`mcap`, `gainVsAnchor`, ATH health, and therefore `alert.mcap`) will be `null`. Task 10 renders these as "unavailable" rather than `0` or a DexScreener substitute — substituting `marketCapUsd` is the hardcoded-supply value the Report bans (§7.2). This plan must not paper over the gap.
- **§13 Gap 3 (`SELL_ROUTE_CHECK` never emitted)** is WS8's. `sellRouteVerified` stays `undefined` (never `false`), so `HONEYPOT` cannot fire yet — Task 3's invalidation test asserts an unset route does **not** block.
- **Probability layer** does not exist; the UI must never label `memeScore` as a probability or success chance (§4, §14.1).

**Two upstream inconsistencies this plan resolves (Task 2):**
1. Phase 1's interim `canEvict` protects `lifecycle === 'curated'`. Report §17 and shared-context §9.1 specify `admission === 'qualified'`. WS9 replaces the lifecycle predicate with the admission predicate — `curated` was the legacy scorer's label and is not the new authority.
2. Neither version protects the **control sample**. `MonitorBudget.isControl` tokens must receive identical depth (§10); if `prioritize` can evict them, selection bias becomes unmeasurable by construction. WS9 adds control tokens to the protected set.

---

## File Structure

**Create — Workstream 9 (monitoring lifecycle):**
- `backend/src/monitoring/evaluate.js` — composes `extractAllFeatures` → `computeMemeScore` → `admit` into the complete §14 record (adds `admission`, `reasons`, `alert`); writes `score_evaluated` + `admission_changed` to the tape. One responsibility: produce one versioned evaluation.
- `backend/src/monitoring/queue.js` — `canEvictToken` + `prioritize` (§17): protected set (qualified/tracked/position/control) outside the cap; evictable ranked by `memeScore`.
- `backend/src/monitoring/lifecycle.js` — `applyLifecycle`: provisional TTL expiry, monitoring-horizon `expired`, blocker invalidation of a previously qualified token (§16.3, §16.4).
- `backend/src/monitoring/aggregates.js` — `aggregateRow`: the lightweight row persisted when a token is evicted so history survives (§10 capacity rule).
- `backend/src/monitoring/queueStats.js` — hot-queue utilization/evictions + provisional upgrade/expiry counters (§24).
- Tests: `backend/src/monitoring/__tests__/{evaluate,queue,lifecycle,aggregates,queueStats}.test.js`

**Create — Workstream 10 (API + UI):**
- `backend/src/memefinder/service.js` — `rankTokens` (memeScore desc, then recency) + `paginate` + `toEvidenceView` (§18.3).
- `backend/src/memefinder/routes.js` — `GET /api/memefinder/qualified`, `/api/memefinder/all`, `/api/memefinder/token/:assetKey`; all paginated.
- Tests: `backend/src/memefinder/__tests__/{service,routes}.test.js`
- `frontend/src/components/meme/QualifiedMemesView.jsx` — the one production list.
- `frontend/src/components/meme/TokenEvidencePanel.jsx` — §18.3 evidence view.
- Tests: `frontend/src/components/meme/__tests__/{QualifiedMemesView,TokenEvidencePanel}.test.jsx`

**Modify:**
- `backend/src/config.js` — add `monitoring` block (provisional TTL source, horizon, aggregate retention).
- `backend/server.js` — mount the memefinder router; construct monitoring collaborators.
- `frontend/vitest.config.js` — add `jsdom` environment + include `.test.jsx`.
- `frontend/package.json` — add jsdom/testing-library devDeps.
- `frontend/src/utils/sniperApi.js` — add memefinder client methods.
- `frontend/src/components/MemeFinderView.jsx` — route the Qualified feed to `QualifiedMemesView`; drop strategy-based qualification.
- `frontend/src/utils/memeStrategies.js` — delete `matches()`/`rules` qualification predicates (WS10 migration contract, shared-context §7).

---

## Task 1: Evaluation pipeline — compose features, score, and admission (§14, §16.5)

**Files:**
- Create: `backend/src/monitoring/evaluate.js`
- Test: `backend/src/monitoring/__tests__/evaluate.test.js`

> **Spec (§14):** the score contract carries `version`, `assetKey`, `asOf`, `profile`, `status`, `structural`, `dynamic`, `memeScore`, `evidenceCoverage`, `blockers`, **`admission`**, **`reasons`**, **`alert`**. Phase 4's `computeMemeScore` produces everything up to `blockers`; `admit` produces the state. Nothing yet composes them or records the decision. This task is that composition — the single place a versioned evaluation is produced, so the API, lifecycle, and (later) replay all read one shape.
>
> **`alert` semantics (§18.3, §20):** `alert` is stamped **once**, when a token first reaches `qualified`, and is never rebased — it is the reference price the UI measures decay against and the policy layer (WS11) reads. Because §13 Gap 2 means no `market_snapshot` exists yet, `alert.mcap` will be `null`; that is recorded honestly, not defaulted to `0`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/monitoring/__tests__/evaluate.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { evaluateToken } from '../evaluate.js';
import { CONFIG } from '../../scoring/config.js';

// A fake scorer/admitter pair keeps this test about COMPOSITION, not scoring maths
// (scoring is already covered by Phase 4's own suites).
function deps({ scoreOverride = {}, admission = 'qualified' } = {}) {
  return {
    extract: vi.fn(async () => ({ structural: { swapCount: 42 }, dynamic: { flowState: {} } })),
    score: vi.fn(() => ({
      version: 'meme-score-v2.0.0', status: 'scored', profile: 'pump-curve',
      structural: { score: 80, coverage: 0.9, breakdown: {} },
      dynamic: { score: 70, coverage: 0.8, breakdown: {} },
      memeScore: 76, evidenceCoverage: 86, blockers: [], ...scoreOverride,
    })),
    admitFn: vi.fn(() => admission),
  };
}

describe('evaluateToken (§14 composition)', () => {
  it('returns the full score contract including admission, reasons, and assetKey', async () => {
    const d = deps();
    const out = await evaluateToken(
      { assetKey: 'solana:pumpfun:M1', chain: 'solana', launchpad: 'pumpfun' },
      { asOf: 1_000, cfg: CONFIG, ...d });

    expect(out.assetKey).toBe('solana:pumpfun:M1');
    expect(out.asOf).toBe(1_000);
    expect(out.version).toBe('meme-score-v2.0.0');
    expect(out.memeScore).toBe(76);
    expect(out.evidenceCoverage).toBe(86);
    expect(out.admission).toBe('qualified');
    expect(Array.isArray(out.reasons)).toBe(true);
  });

  it('stamps alert once on first qualification and never rebases it', async () => {
    const d = deps();
    const token = { assetKey: 'solana:pumpfun:M1', chain: 'solana', launchpad: 'pumpfun' };
    const first = await evaluateToken(token, { asOf: 1_000, cfg: CONFIG, ...d });
    expect(first.alert).toEqual({ ts: 1_000, mcap: null, priceUsd: null });

    // Second evaluation, later, already-qualified: alert must be preserved verbatim.
    const second = await evaluateToken(token,
      { asOf: 9_999, cfg: CONFIG, prevAlert: first.alert, ...d });
    expect(second.alert).toEqual({ ts: 1_000, mcap: null, priceUsd: null });
  });

  it('does not stamp an alert while merely watching', async () => {
    const d = deps({ admission: 'watching' });
    const out = await evaluateToken({ assetKey: 'solana:pumpfun:M2', chain: 'solana', launchpad: 'pumpfun' },
      { asOf: 5, cfg: CONFIG, ...d });
    expect(out.admission).toBe('watching');
    expect(out.alert).toBeNull();
  });

  it('explains rejection in reasons when a blocker fired', async () => {
    const d = deps({ scoreOverride: { blockers: [{ code: 'FARM', evidence: { pct: 0.519 } }] },
                     admission: 'rejected' });
    const out = await evaluateToken({ assetKey: 'solana:pumpfun:M3', chain: 'solana', launchpad: 'pumpfun' },
      { asOf: 7, cfg: CONFIG, ...d });
    expect(out.admission).toBe('rejected');
    expect(out.reasons).toContain('blocker:FARM');
  });

  it('short-circuits unscored tokens without calling admit', async () => {
    const d = deps({ scoreOverride: { status: 'unscored' } });
    const out = await evaluateToken({ assetKey: 'ethereum:uniswap:0xabc', chain: 'ethereum', launchpad: 'uniswap' },
      { asOf: 3, cfg: CONFIG, ...d });
    expect(out.status).toBe('unscored');
    expect(out.admission).toBe('unscored');
    expect(d.admitFn).not.toHaveBeenCalled();
  });

  it('records score_evaluated and admission_changed on the tape when state changes', async () => {
    const d = deps();
    const tape = { append: vi.fn(async () => {}) };
    await evaluateToken({ assetKey: 'solana:pumpfun:M4', chain: 'solana', launchpad: 'pumpfun' },
      { asOf: 11, cfg: CONFIG, tape, prevAdmission: 'watching', ...d });

    const types = tape.append.mock.calls.map(([e]) => e.type);
    expect(types).toContain('score_evaluated');
    expect(types).toContain('admission_changed');
  });

  it('does not emit admission_changed when the state is unchanged', async () => {
    const d = deps();
    const tape = { append: vi.fn(async () => {}) };
    await evaluateToken({ assetKey: 'solana:pumpfun:M5', chain: 'solana', launchpad: 'pumpfun' },
      { asOf: 12, cfg: CONFIG, tape, prevAdmission: 'qualified', ...d });

    const types = tape.append.mock.calls.map(([e]) => e.type);
    expect(types).toContain('score_evaluated');
    expect(types).not.toContain('admission_changed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/monitoring/__tests__/evaluate.test.js`
Expected: FAIL — `Cannot find module '../evaluate.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/monitoring/evaluate.js`:

```js
// ONE versioned evaluation. Composes the shared extractor (Phase 2), the pure scorer
// (Phase 4), and admission (Phase 4) into the complete §14 score contract, then records
// the decision on the tape. Every reader — API, lifecycle, replay — consumes this shape.
import { CONFIG } from '../scoring/config.js';
import { computeMemeScore } from '../scoring/computeMemeScore.js';
import { admit } from '../scoring/admission.js';
import { extractAllFeatures } from '../features/extract.js';

// Collaborators are injected so tests need no mocks and replay can swap the tape. (§1 conventions)
export async function evaluateToken(token, {
  asOf,
  cfg = CONFIG,
  tape = null,
  prevAdmission = null,
  prevAlert = null,
  extract = extractAllFeatures,
  score = computeMemeScore,
  admitFn = admit,
} = {}) {
  const features = await extract(token, { asOf });
  const structural = features.structural ?? {};
  const dynamic = features.dynamic ?? {};

  const scored = score({ ...token, asOf }, structural, dynamic, cfg);

  // Unsupported chain/launchpad: never run admission logic on an unscored token. (§14.2)
  if (scored.status === 'unscored') {
    const out = { ...scored, assetKey: token.assetKey, asOf, admission: 'unscored',
                  reasons: ['unsupported_scope'], alert: null };
    await record(tape, token, out, prevAdmission, asOf);
    return out;
  }

  const admission = admitFn(scored, { ...token, structural, dynamic }, cfg);

  // alert is stamped ONCE at first qualification and never rebased. (§18.3, §20)
  // mcap/priceUsd stay null until a market_snapshot emitter exists (§13 Gap 2) — recorded
  // honestly rather than defaulted to 0 or substituted from DexScreener (§7.2 forbids it).
  let alert = prevAlert ?? null;
  if (!alert && admission === 'qualified') {
    alert = { ts: asOf, mcap: token.mcap ?? null, priceUsd: token.priceUsd ?? null };
  }

  const out = {
    ...scored,
    assetKey: token.assetKey,
    asOf,
    admission,
    reasons: buildReasons(scored, admission),
    alert,
  };
  await record(tape, token, out, prevAdmission, asOf);
  return out;
}

function buildReasons(scored, admission) {
  const reasons = [];
  for (const b of scored.blockers ?? []) reasons.push(`blocker:${b.code}`);
  if (admission === 'watching') {
    if (scored.memeScore == null) reasons.push('insufficient_evidence');
    else reasons.push('below_admission_thresholds');
  }
  if (admission === 'provisional') reasons.push('single_strong_metric');
  if (admission === 'qualified') reasons.push('passed_admission_path');
  return reasons;
}

async function record(tape, token, out, prevAdmission, asOf) {
  if (!tape) return;
  const base = { assetKey: token.assetKey, chainTs: asOf, receivedAt: asOf,
                 source: 'scorer', schemaVersion: 1, slot: null,
                 signature: null, instructionIndex: 0 };
  await tape.append({ ...base, eventId: `score:${token.assetKey}:${asOf}`,
    type: 'score_evaluated',
    payload: { version: out.version, memeScore: out.memeScore,
               evidenceCoverage: out.evidenceCoverage, admission: out.admission } });

  // Only a real transition is an event. Re-evaluating into the same state is not. (§9.2)
  if (prevAdmission !== null && prevAdmission !== out.admission) {
    await tape.append({ ...base, eventId: `adm:${token.assetKey}:${asOf}`,
      type: 'admission_changed',
      payload: { from: prevAdmission, to: out.admission, reasons: out.reasons,
                 alert: out.alert } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/monitoring/__tests__/evaluate.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitoring/evaluate.js backend/src/monitoring/__tests__/evaluate.test.js
git commit -m "feat(monitoring): compose features+scorer+admission into one versioned evaluation (§14)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Score-prioritized queue — protected set includes the control sample (§17, §10)

**Files:**
- Create: `backend/src/monitoring/queue.js`
- Modify: `backend/src/discovery/registry.js` (retire the interim lifecycle-based `canEvict`)
- Test: `backend/src/monitoring/__tests__/queue.test.js`

> **Spec (§17):** capacity applies **only** to evictable records; qualified, tracked, and position-linked tokens sit outside the cap and may never be removed by a final array slice. Evictable records are ranked by `memeScore`.
>
> **Two corrections to upstream (see Scope section):** (a) Phase 1's interim `canEvict` protects `lifecycle === 'curated'` — the *legacy* scorer's label. The authority is now `admission === 'qualified'`. (b) Neither upstream version protects the **control sample**. §10 requires control tokens receive identical depth; if the queue can evict them their post-migration labels go incomplete and selection bias becomes unmeasurable *by construction* — the precise failure §10 forbids. Control membership comes from Phase 2's `MonitorBudget.isControl`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/monitoring/__tests__/queue.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { canEvictToken, prioritize } from '../queue.js';

const mk = (assetKey, over = {}) => ({
  assetKey, admission: 'watching', tracked: false, hasOpenPosition: false,
  score: { memeScore: 10 }, ...over,
});

describe('canEvictToken (§17 + §10 control protection)', () => {
  it('protects qualified tokens', () => {
    expect(canEvictToken(mk('a', { admission: 'qualified' }))).toBe(false);
  });
  it('protects tracked and position-linked tokens', () => {
    expect(canEvictToken(mk('b', { tracked: true }))).toBe(false);
    expect(canEvictToken(mk('c', { hasOpenPosition: true }))).toBe(false);
  });
  it('protects control-sample tokens', () => {
    expect(canEvictToken(mk('d', { isControl: true }))).toBe(false);
  });
  it('does NOT protect on the legacy lifecycle label alone', () => {
    // `curated` was the legacy scorer's label; admission is the authority now.
    expect(canEvictToken(mk('e', { lifecycle: 'curated' }))).toBe(true);
  });
  it('allows eviction of plain watching tokens', () => {
    expect(canEvictToken(mk('f'))).toBe(true);
    expect(canEvictToken(mk('g', { admission: 'provisional' }))).toBe(true);
  });
});

describe('prioritize (§17)', () => {
  const cfg = { hotLimit: 2 };

  it('keeps every protected token even when far over the cap', () => {
    const tokens = [
      mk('q', { admission: 'qualified' }), mk('t', { tracked: true }),
      mk('p', { hasOpenPosition: true }),  mk('ctl', { isControl: true }),
      mk('w1'), mk('w2'), mk('w3'), mk('w4'),
    ];
    const kept = prioritize(tokens, cfg).map(t => t.assetKey);
    expect(kept).toContain('q');
    expect(kept).toContain('t');
    expect(kept).toContain('p');
    expect(kept).toContain('ctl');
    // 4 protected + exactly hotLimit(2) evictable
    expect(kept).toHaveLength(6);
  });

  it('ranks evictable tokens by memeScore descending and truncates at hotLimit', () => {
    const tokens = [
      mk('low',  { score: { memeScore: 5 } }),
      mk('high', { score: { memeScore: 90 } }),
      mk('mid',  { score: { memeScore: 50 } }),
    ];
    const kept = prioritize(tokens, cfg).map(t => t.assetKey);
    expect(kept).toEqual(['high', 'mid']);
    expect(kept).not.toContain('low');
  });

  it('treats a missing memeScore as lowest priority, not highest', () => {
    const tokens = [
      mk('unscored', { score: null }),
      mk('scored1',  { score: { memeScore: 30 } }),
      mk('scored2',  { score: { memeScore: 20 } }),
    ];
    const kept = prioritize(tokens, cfg).map(t => t.assetKey);
    expect(kept).toEqual(['scored1', 'scored2']);
  });

  it('never drops a protected token to make room for a higher-scoring evictable one', () => {
    const tokens = [
      mk('protected', { admission: 'qualified', score: { memeScore: 1 } }),
      mk('hot1', { score: { memeScore: 99 } }),
      mk('hot2', { score: { memeScore: 98 } }),
      mk('hot3', { score: { memeScore: 97 } }),
    ];
    const kept = prioritize(tokens, cfg).map(t => t.assetKey);
    expect(kept).toContain('protected');
    expect(kept).toHaveLength(3); // 1 protected + hotLimit(2)
  });

  it('reports which tokens were evicted so history can be preserved', () => {
    const tokens = [mk('keep', { score: { memeScore: 80 } }),
                    mk('keep2', { score: { memeScore: 70 } }),
                    mk('drop', { score: { memeScore: 1 } })];
    const { kept, evicted } = prioritize(tokens, cfg, { withEvicted: true });
    expect(kept.map(t => t.assetKey)).toEqual(['keep', 'keep2']);
    expect(evicted.map(t => t.assetKey)).toEqual(['drop']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/monitoring/__tests__/queue.test.js`
Expected: FAIL — `Cannot find module '../queue.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/monitoring/queue.js`:

```js
// Score-prioritized monitoring. Capacity applies ONLY to evictable records; protected
// records sit outside the cap entirely and are never reachable by a final slice. (§17)
//
// Protected = qualified (the admission authority, NOT the legacy `curated` lifecycle label)
//           | manually tracked | open position | CONTROL SAMPLE.
// Control tokens must get identical depth (§10): evicting them would make selection bias
// unmeasurable by construction, which is the exact failure §10 forbids.
export function canEvictToken(t) {
  return !(t.admission === 'qualified' || t.tracked || t.hasOpenPosition || t.isControl);
}

export function prioritize(tokens, cfg, { withEvicted = false } = {}) {
  const protectedT = tokens.filter(t => !canEvictToken(t));
  const ranked = tokens.filter(canEvictToken)
    // Missing score ranks LAST (-1), never first — an unscored token must not outrank evidence.
    .sort((a, b) => (b.score?.memeScore ?? -1) - (a.score?.memeScore ?? -1));

  const keptEvictable = ranked.slice(0, cfg.hotLimit);
  const kept = [...protectedT, ...keptEvictable];
  if (!withEvicted) return kept;
  return { kept, evicted: ranked.slice(cfg.hotLimit) };
}
```

- [ ] **Step 4: Retire the interim predicate in the registry**

In `backend/src/discovery/registry.js`, replace the Phase 1 interim `canEvict`/`selectEvictable` bodies so there is exactly **one** eviction authority (DRY — do not keep two):

```js
import { canEvictToken, prioritize } from '../monitoring/queue.js';

// Retained as thin re-exports so Phase 1 call sites keep working, but the authority
// now lives in monitoring/queue.js and is admission- and control-aware. (§17, §10)
export const canEvict = canEvictToken;
export function selectEvictable(tokens, hotLimit) {
  return prioritize(tokens, { hotLimit });
}
```

Then update `backend/src/discovery/__tests__/registry.test.js`: the Phase 1 test asserts `lifecycle: 'curated'` is protected. That expectation is now **wrong by design** — change that fixture to `admission: 'qualified'` and add a line asserting `isControl: true` is protected too. Leave the rest of the Phase 1 test intact.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/monitoring/__tests__/queue.test.js src/discovery/__tests__/registry.test.js`
Expected: PASS — 10 queue tests + the updated registry tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/monitoring/queue.js backend/src/monitoring/__tests__/queue.test.js backend/src/discovery/registry.js backend/src/discovery/__tests__/registry.test.js
git commit -m "feat(monitoring): score-ranked queue; protect qualified/tracked/position/control from the cap (§17,§10)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Admission lifecycle — provisional TTL, expiry, and invalidation (§16.3, §16.4)

**Files:**
- Modify: `backend/src/config.js`
- Create: `backend/src/monitoring/lifecycle.js`
- Test: `backend/src/monitoring/__tests__/lifecycle.test.js`

> **Spec (§16.3):** provisional expires after ten minutes unless the token qualifies, is renewed by a new versioned evaluation, or is rejected. **(§16.4):** a blocker produces `rejected`; tokens leaving the monitoring horizon without qualifying become `expired` while their tape remains available. **(§15):** a later blocker immediately removes a qualified token from the main list and emits an invalidation event.
>
> Time is injected (never `Date.now()` in logic) so these transitions are deterministic in tests and identical in replay.

- [ ] **Step 1: Add the monitoring config block**

In `backend/src/config.js`, add to the exported config object:

```js
monitoring: {
  horizonMs: 6 * 3600_000,      // leave the monitoring window without qualifying -> expired (§16.4)
  aggregateRetentionMs: 30 * 24 * 3600_000, // keep lightweight rows for evicted tokens (§10)
},
```

The provisional TTL is **not** duplicated here — it already lives in `CONFIG.admission.provisional.ttlMs` (`scoring/config.js`, Phase 4) and any change to it bumps `CONFIG.version` (§22). Reading it from two places would let them drift.

- [ ] **Step 2: Write the failing test**

Create `backend/src/monitoring/__tests__/lifecycle.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { applyLifecycle } from '../lifecycle.js';
import { CONFIG } from '../../scoring/config.js';

const mon = { horizonMs: 6 * 3600_000 };
const at = (admission, over = {}) => ({
  assetKey: 'solana:pumpfun:M', admission, admissionSince: 0,
  firstSeenTs: 0, blockers: [], ...over,
});

describe('applyLifecycle (§16.3, §16.4)', () => {
  it('keeps provisional inside its TTL', () => {
    const ttl = CONFIG.admission.provisional.ttlMs;
    const out = applyLifecycle(at('provisional'), { now: ttl - 1, cfg: CONFIG, mon });
    expect(out.admission).toBe('provisional');
    expect(out.changed).toBe(false);
  });

  it('expires provisional once the TTL elapses', () => {
    const ttl = CONFIG.admission.provisional.ttlMs;
    const out = applyLifecycle(at('provisional'), { now: ttl + 1, cfg: CONFIG, mon });
    expect(out.admission).toBe('expired');
    expect(out.changed).toBe(true);
    expect(out.reason).toBe('provisional_ttl_elapsed');
  });

  it('renews provisional when a fresh evaluation re-provisions it', () => {
    const ttl = CONFIG.admission.provisional.ttlMs;
    // admissionSince advanced by a new versioned evaluation
    const out = applyLifecycle(at('provisional', { admissionSince: ttl }), 
      { now: ttl + 10, cfg: CONFIG, mon });
    expect(out.admission).toBe('provisional');
    expect(out.changed).toBe(false);
  });

  it('invalidates a qualified token the moment a blocker appears', () => {
    const out = applyLifecycle(at('qualified', { blockers: [{ code: 'DEV_SELL' }] }),
      { now: 500, cfg: CONFIG, mon });
    expect(out.admission).toBe('rejected');
    expect(out.changed).toBe(true);
    expect(out.reason).toBe('invalidated:DEV_SELL');
  });

  it('does not invalidate on an unset sell route (§13 Gap 3 — undefined is not false)', () => {
    // sellRouteVerified is undefined until WS8 emits SELL_ROUTE_CHECK; it must not block.
    const out = applyLifecycle(at('qualified', { sellRouteVerified: undefined }),
      { now: 500, cfg: CONFIG, mon });
    expect(out.admission).toBe('qualified');
    expect(out.changed).toBe(false);
  });

  it('expires a watching token that leaves the monitoring horizon', () => {
    const out = applyLifecycle(at('watching', { firstSeenTs: 0 }),
      { now: mon.horizonMs + 1, cfg: CONFIG, mon });
    expect(out.admission).toBe('expired');
    expect(out.reason).toBe('horizon_elapsed');
  });

  it('never expires a qualified token merely for age', () => {
    const out = applyLifecycle(at('qualified', { firstSeenTs: 0 }),
      { now: mon.horizonMs * 10, cfg: CONFIG, mon });
    expect(out.admission).toBe('qualified');
    expect(out.changed).toBe(false);
  });

  it('leaves rejected and unscored terminal states alone', () => {
    for (const s of ['rejected', 'unscored', 'expired']) {
      const out = applyLifecycle(at(s, { firstSeenTs: 0 }),
        { now: mon.horizonMs * 5, cfg: CONFIG, mon });
      expect(out.admission).toBe(s);
      expect(out.changed).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/monitoring/__tests__/lifecycle.test.js`
Expected: FAIL — `Cannot find module '../lifecycle.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `backend/src/monitoring/lifecycle.js`:

```js
// Admission lifecycle transitions that TIME (not a new score) causes: provisional TTL,
// monitoring-horizon expiry, and invalidation of a qualified token by a new blocker.
// Pure function of (token, now) — `now` is injected so replay is deterministic. (§16.3, §16.4)
const TERMINAL = new Set(['rejected', 'unscored', 'expired']);

export function applyLifecycle(token, { now, cfg, mon }) {
  const keep = { admission: token.admission, changed: false, reason: null };
  if (TERMINAL.has(token.admission)) return keep;

  // A later blocker immediately removes a qualified token from the main list. (§15)
  // NOTE: only ACTUAL blockers count. An unset sellRouteVerified is `undefined`, not
  // `false`, so no HONEYPOT exists yet (§13 Gap 3) — absence of evidence never blocks.
  const blocker = (token.blockers ?? [])[0];
  if (blocker) {
    return { admission: 'rejected', changed: true, reason: `invalidated:${blocker.code}` };
  }

  // Provisional is short-lived; a fresh evaluation renews it by advancing admissionSince. (§16.3)
  if (token.admission === 'provisional') {
    const age = now - (token.admissionSince ?? 0);
    if (age > cfg.admission.provisional.ttlMs) {
      return { admission: 'expired', changed: true, reason: 'provisional_ttl_elapsed' };
    }
    return keep;
  }

  // Leaving the monitoring horizon without qualifying -> expired. Qualified never ages out. (§16.4)
  if (token.admission === 'watching' && (now - (token.firstSeenTs ?? 0)) > mon.horizonMs) {
    return { admission: 'expired', changed: true, reason: 'horizon_elapsed' };
  }

  return keep;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/monitoring/__tests__/lifecycle.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config.js backend/src/monitoring/lifecycle.js backend/src/monitoring/__tests__/lifecycle.test.js
git commit -m "feat(monitoring): provisional TTL, horizon expiry, blocker invalidation (§16.3,§16.4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Eviction retention — aggregates persist, the tape is never touched (§10)

**Files:**
- Create: `backend/src/monitoring/aggregates.js`
- Test: `backend/src/monitoring/__tests__/aggregates.test.js`

> **Spec (§10 capacity rule):** "Eviction stops expensive monitoring but does not delete the token's persisted events or aggregates." So eviction must write a lightweight summary row and must **not** issue any tape deletion. This task makes that a tested guarantee rather than a comment.

- [ ] **Step 1: Write the failing test**

Create `backend/src/monitoring/__tests__/aggregates.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { aggregateRow, persistEviction } from '../aggregates.js';

const token = {
  assetKey: 'solana:pumpfun:M9', firstSeenTs: 100, admission: 'watching',
  score: { memeScore: 42, evidenceCoverage: 70, version: 'meme-score-v2.0.0',
           structural: { score: 50 }, dynamic: { score: 30 } },
  blockers: [{ code: 'BAD_DATA' }],
};

describe('aggregateRow (§10)', () => {
  it('captures the final decision snapshot in a compact row', () => {
    const row = aggregateRow(token, { now: 999 });
    expect(row).toEqual({
      assetKey: 'solana:pumpfun:M9', evictedAt: 999, firstSeenTs: 100,
      lastAdmission: 'watching', scoreVersion: 'meme-score-v2.0.0',
      memeScore: 42, structuralScore: 50, dynamicScore: 30,
      evidenceCoverage: 70, blockerCodes: ['BAD_DATA'],
    });
  });

  it('records nulls rather than zeros when a token was never scored', () => {
    const row = aggregateRow({ assetKey: 'solana:pumpfun:X', firstSeenTs: 1, admission: 'watching' },
      { now: 5 });
    expect(row.memeScore).toBeNull();
    expect(row.evidenceCoverage).toBeNull();
    expect(row.blockerCodes).toEqual([]);
  });
});

describe('persistEviction (§10)', () => {
  it('writes one aggregate row per evicted token', async () => {
    const store = { saveAggregate: vi.fn(async () => {}) };
    await persistEviction([token], { store, now: 7 });
    expect(store.saveAggregate).toHaveBeenCalledTimes(1);
    expect(store.saveAggregate.mock.calls[0][0].assetKey).toBe('solana:pumpfun:M9');
  });

  it('never deletes tape events — eviction loses monitoring, not history', async () => {
    const store = { saveAggregate: vi.fn(async () => {}) };
    const tape = { append: vi.fn(), delete: vi.fn(), deleteEvents: vi.fn() };
    await persistEviction([token], { store, tape, now: 7 });
    expect(tape.delete).not.toHaveBeenCalled();
    expect(tape.deleteEvents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/monitoring/__tests__/aggregates.test.js`
Expected: FAIL — `Cannot find module '../aggregates.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/monitoring/aggregates.js`:

```js
// Eviction stops expensive monitoring; it must NOT lose history. (§10 capacity rule)
// A compact row records the final decision so an evicted token remains explainable,
// while the raw event tape is left completely untouched.
export function aggregateRow(token, { now }) {
  const s = token.score ?? null;
  return {
    assetKey: token.assetKey,
    evictedAt: now,
    firstSeenTs: token.firstSeenTs ?? null,
    lastAdmission: token.admission ?? null,
    scoreVersion: s?.version ?? null,
    // unknown stays null — never coerced to 0 (§5.2.7)
    memeScore: s?.memeScore ?? null,
    structuralScore: s?.structural?.score ?? null,
    dynamicScore: s?.dynamic?.score ?? null,
    evidenceCoverage: s?.evidenceCoverage ?? null,
    blockerCodes: (token.blockers ?? []).map(b => b.code),
  };
}

export async function persistEviction(evicted, { store, now }) {
  for (const t of evicted) await store.saveAggregate(aggregateRow(t, { now }));
  // Deliberately no tape mutation of any kind. The tape is append-only (§9.4).
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/monitoring/__tests__/aggregates.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitoring/aggregates.js backend/src/monitoring/__tests__/aggregates.test.js
git commit -m "feat(monitoring): persist aggregate rows on eviction; never delete tape events (§10)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Queue and lifecycle observability counters (§24)

**Files:**
- Create: `backend/src/monitoring/queueStats.js`
- Test: `backend/src/monitoring/__tests__/queueStats.test.js`

> **Spec (§24):** the required dashboard fields include state counts (`unscored`/`watching`/`provisional`/`qualified`/`rejected`/`expired`), blocker counts by code, provisional upgrade and expiry rates, and hot-queue utilization and evictions. **Provider failure must lower coverage or raise `BAD_DATA`; it must never silently turn missing evidence into a positive score** — so the snapshot reports coverage and `BAD_DATA` explicitly.

- [ ] **Step 1: Write the failing test**

Create `backend/src/monitoring/__tests__/queueStats.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { QueueStats } from '../queueStats.js';

describe('QueueStats (§24)', () => {
  it('counts admission states from a token set', () => {
    const s = new QueueStats();
    s.observeStates([
      { admission: 'qualified' }, { admission: 'qualified' },
      { admission: 'watching' }, { admission: 'provisional' },
      { admission: 'rejected' }, { admission: 'unscored' }, { admission: 'expired' },
    ]);
    const snap = s.snapshot();
    expect(snap.states).toEqual({
      qualified: 2, watching: 1, provisional: 1, rejected: 1, unscored: 1, expired: 1,
    });
  });

  it('counts blockers by code', () => {
    const s = new QueueStats();
    s.observeStates([
      { admission: 'rejected', blockers: [{ code: 'FARM' }] },
      { admission: 'rejected', blockers: [{ code: 'FARM' }, { code: 'BAD_DATA' }] },
    ]);
    expect(s.snapshot().blockers).toEqual({ FARM: 2, BAD_DATA: 1 });
  });

  it('tracks hot-queue utilization and cumulative evictions', () => {
    const s = new QueueStats();
    s.observeQueue({ kept: 8, protectedCount: 3, hotLimit: 5, evicted: 2 });
    s.observeQueue({ kept: 8, protectedCount: 3, hotLimit: 5, evicted: 1 });
    const snap = s.snapshot();
    expect(snap.queue.hotLimit).toBe(5);
    expect(snap.queue.protectedCount).toBe(3);
    expect(snap.queue.utilization).toBe(1); // 5 evictable slots of 5 used
    expect(snap.queue.evictions).toBe(3);   // cumulative
  });

  it('tracks provisional upgrade and expiry rates', () => {
    const s = new QueueStats();
    s.observeTransition('provisional', 'qualified');
    s.observeTransition('provisional', 'expired');
    s.observeTransition('provisional', 'expired');
    s.observeTransition('watching', 'qualified'); // not a provisional outcome
    const p = s.snapshot().provisional;
    expect(p.upgraded).toBe(1);
    expect(p.expired).toBe(2);
    expect(p.upgradeRate).toBeCloseTo(1 / 3);
  });

  it('reports zero rates without dividing by zero when nothing was provisional', () => {
    expect(new QueueStats().snapshot().provisional.upgradeRate).toBe(0);
  });

  it('surfaces BAD_DATA separately so provider failure is never read as a good score', () => {
    const s = new QueueStats();
    s.observeStates([{ admission: 'rejected', blockers: [{ code: 'BAD_DATA' }] }]);
    expect(s.snapshot().dataQuality.badData).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/monitoring/__tests__/queueStats.test.js`
Expected: FAIL — `Cannot find module '../queueStats.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/monitoring/queueStats.js`:

```js
// Operational counters for the monitoring layer. (§24)
// Provider failure must show up as BAD_DATA / lowered coverage — never as a positive score.
const STATES = ['unscored', 'watching', 'provisional', 'qualified', 'rejected', 'expired'];

export class QueueStats {
  constructor() {
    this.states = Object.fromEntries(STATES.map(s => [s, 0]));
    this.blockers = {};
    this.queue = { kept: 0, protectedCount: 0, hotLimit: 0, evictions: 0 };
    this.provisional = { upgraded: 0, expired: 0 };
  }

  observeStates(tokens) {
    this.states = Object.fromEntries(STATES.map(s => [s, 0]));
    this.blockers = {};
    for (const t of tokens) {
      if (t.admission in this.states) this.states[t.admission]++;
      for (const b of t.blockers ?? []) {
        this.blockers[b.code] = (this.blockers[b.code] ?? 0) + 1;
      }
    }
  }

  observeQueue({ kept, protectedCount, hotLimit, evicted = 0 }) {
    this.queue.kept = kept;
    this.queue.protectedCount = protectedCount;
    this.queue.hotLimit = hotLimit;
    this.queue.evictions += evicted;
  }

  observeTransition(from, to) {
    if (from !== 'provisional') return;
    if (to === 'qualified') this.provisional.upgraded++;
    if (to === 'expired') this.provisional.expired++;
  }

  snapshot() {
    const { upgraded, expired } = this.provisional;
    const total = upgraded + expired;
    const evictableSlots = Math.max(0, this.queue.kept - this.queue.protectedCount);
    return {
      states: { ...this.states },
      blockers: { ...this.blockers },
      queue: {
        ...this.queue,
        utilization: this.queue.hotLimit ? evictableSlots / this.queue.hotLimit : 0,
      },
      provisional: { upgraded, expired, upgradeRate: total ? upgraded / total : 0 },
      dataQuality: { badData: this.blockers.BAD_DATA ?? 0 },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/monitoring/__tests__/queueStats.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitoring/queueStats.js backend/src/monitoring/__tests__/queueStats.test.js
git commit -m "feat(monitoring): queue/lifecycle observability counters (§24)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Read service — ranked, paginated, evidence view (§18.2, §18.3)

**Files:**
- Create: `backend/src/memefinder/service.js`
- Test: `backend/src/memefinder/__tests__/service.test.js`

> **Spec (§18.2):** Qualified Memes ranked by score then recency. **(§18.3):** each row/detail shows meme/structural/dynamic scores, evidence coverage **labeled as coverage, not confidence of profit**, regime and score version, admission reason and alert age, blocker/invalidation state, top positive and negative evidence, unavailable/experimental features, and last chain-event/market-update timestamps. **The API must be paginated; the main list cannot be silently truncated.**
>
> "Top positive and negative evidence" comes from the `breakdown` that Phase 4's `weightedScore` returns (`{value, weight, contribution}` per family) — ranked by contribution. This is exactly why the Report required `breakdown` in the score contract.

- [ ] **Step 1: Write the failing test**

Create `backend/src/memefinder/__tests__/service.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { rankTokens, paginate, toEvidenceView } from '../service.js';

const mk = (assetKey, memeScore, firstSeenTs, over = {}) => ({
  assetKey, admission: 'qualified', firstSeenTs,
  score: { memeScore, version: 'meme-score-v2.0.0', profile: 'pump-curve',
           structural: { score: 80, coverage: 0.9, breakdown: {} },
           dynamic: { score: 60, coverage: 0.8, breakdown: {} },
           evidenceCoverage: 86, blockers: [] },
  ...over,
});

describe('rankTokens (§18.2)', () => {
  it('sorts by memeScore descending, then by recency', () => {
    const out = rankTokens([
      mk('a', 70, 100), mk('b', 90, 100), mk('c', 70, 500),
    ]);
    expect(out.map(t => t.assetKey)).toEqual(['b', 'c', 'a']);
  });

  it('ranks a null memeScore last instead of first', () => {
    const out = rankTokens([mk('nul', null, 900), mk('low', 1, 100)]);
    expect(out.map(t => t.assetKey)).toEqual(['low', 'nul']);
  });
});

describe('paginate (§18 — no silent truncation)', () => {
  const rows = Array.from({ length: 250 }, (_, i) => mk(`m${i}`, 100 - i, i));

  it('returns the requested page plus a total so nothing is silently dropped', () => {
    const p = paginate(rows, { page: 1, pageSize: 100 });
    expect(p.total).toBe(250);
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(100);
    expect(p.items).toHaveLength(100);
    expect(p.hasMore).toBe(true);
  });

  it('serves the last partial page and reports hasMore false', () => {
    const p = paginate(rows, { page: 3, pageSize: 100 });
    expect(p.items).toHaveLength(50);
    expect(p.hasMore).toBe(false);
  });

  it('clamps an absurd pageSize instead of returning everything', () => {
    const p = paginate(rows, { page: 1, pageSize: 99999 });
    expect(p.pageSize).toBe(500);
    expect(p.items).toHaveLength(250);
  });

  it('defaults to page 1 / pageSize 100 on garbage input', () => {
    const p = paginate(rows, { page: 0, pageSize: -5 });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(100);
  });
});

describe('toEvidenceView (§18.3)', () => {
  const token = mk('solana:pumpfun:M', 76, 1_000, {
    admission: 'qualified',
    reasons: ['passed_admission_path'],
    alert: { ts: 1_000, mcap: null, priceUsd: null },
    lastChainEventTs: 4_000, lastMarketUpdateTs: null,
    score: {
      memeScore: 76, version: 'meme-score-v2.0.0', profile: 'pump-curve',
      evidenceCoverage: 86, blockers: [],
      structural: { score: 80, coverage: 0.9, breakdown: {
        capitalEfficiency: { value: 0.9, weight: 0.25, contribution: 0.30 },
        top10ExLp:         { value: 0.2, weight: 0.10, contribution: 0.02 },
      } },
      dynamic: { score: 60, coverage: 0.8, breakdown: {
        flowState: { value: 1, weight: 0.30, contribution: 0.25 },
      } },
    },
  });

  it('labels coverage as coverage — never as confidence or probability', () => {
    const v = toEvidenceView(token, { now: 5_000 });
    expect(v.evidenceCoverage).toBe(86);
    expect(v.coverageLabel).toBe('evidence coverage');
    expect(JSON.stringify(v)).not.toMatch(/confidence|probability/i);
  });

  it('exposes regime, score version, admission reason, and alert age', () => {
    const v = toEvidenceView(token, { now: 5_000 });
    expect(v.profile).toBe('pump-curve');
    expect(v.scoreVersion).toBe('meme-score-v2.0.0');
    expect(v.reasons).toEqual(['passed_admission_path']);
    expect(v.alertAgeMs).toBe(4_000);
  });

  it('ranks top positive and negative evidence by contribution', () => {
    const v = toEvidenceView(token, { now: 5_000 });
    expect(v.topPositive[0].key).toBe('capitalEfficiency');
    expect(v.topNegative[0].key).toBe('top10ExLp');
  });

  it('lists unavailable market fields instead of showing zero (§13 Gap 2)', () => {
    const v = toEvidenceView(token, { now: 5_000 });
    expect(v.unavailable).toContain('marketCap');
    expect(v.mcap).toBeNull();
    expect(v.lastMarketUpdateTs).toBeNull();
  });

  it('reports blocker state for an invalidated token', () => {
    const rejected = { ...token, admission: 'rejected',
      score: { ...token.score, blockers: [{ code: 'DEV_SELL', reversible: false }] } };
    const v = toEvidenceView(rejected, { now: 5_000 });
    expect(v.blockers.map(b => b.code)).toEqual(['DEV_SELL']);
    expect(v.admission).toBe('rejected');
  });

  it('returns a null alertAgeMs when no alert was ever stamped', () => {
    const watching = { ...token, admission: 'watching', alert: null };
    expect(toEvidenceView(watching, { now: 5_000 }).alertAgeMs).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/memefinder/__tests__/service.test.js`
Expected: FAIL — `Cannot find module '../service.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/memefinder/service.js`:

```js
// Read layer for the Meme Finder. Ranking + pagination + the §18.3 evidence view.
// The backend is the only authority for scores and admission (§18.1); this module
// shapes them for display and never re-decides qualification.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

// Ranked by score, then recency. A null score ranks LAST — absence of evidence is not merit.
export function rankTokens(tokens) {
  return [...tokens].sort((a, b) => {
    const d = (b.score?.memeScore ?? -1) - (a.score?.memeScore ?? -1);
    return d !== 0 ? d : (b.firstSeenTs ?? 0) - (a.firstSeenTs ?? 0);
  });
}

// Always returns `total` so a client can tell truncation from exhaustion. (§18.3)
export function paginate(rows, { page, pageSize } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
  const start = (p - 1) * size;
  const items = rows.slice(start, start + size);
  return { total: rows.length, page: p, pageSize: size, items,
           hasMore: start + items.length < rows.length };
}

export function toEvidenceView(token, { now }) {
  const s = token.score ?? {};
  const families = [
    ...Object.entries(s.structural?.breakdown ?? {}).map(([key, v]) => ({ key, block: 'structural', ...v })),
    ...Object.entries(s.dynamic?.breakdown ?? {}).map(([key, v]) => ({ key, block: 'dynamic', ...v })),
  ];
  const byContribution = [...families].sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));

  // Market-cap fields depend on a market_snapshot emitter that does not exist yet (§13 Gap 2).
  // Report them as UNAVAILABLE. Never 0, and never DexScreener's fixed-supply marketCapUsd (§7.2).
  const unavailable = [];
  if (token.mcap == null) unavailable.push('marketCap');
  if (token.lastMarketUpdateTs == null) unavailable.push('marketUpdate');

  return {
    assetKey: token.assetKey,
    admission: token.admission ?? null,
    reasons: token.reasons ?? [],
    memeScore: s.memeScore ?? null,
    structuralScore: s.structural?.score ?? null,
    dynamicScore: s.dynamic?.score ?? null,
    // Coverage is EVIDENCE COVERAGE. It is not a probability and not a confidence of profit. (§18.3)
    evidenceCoverage: s.evidenceCoverage ?? null,
    coverageLabel: 'evidence coverage',
    profile: s.profile ?? null,
    scoreVersion: s.version ?? null,
    blockers: s.blockers ?? [],
    topPositive: byContribution.slice(0, 3),
    topNegative: byContribution.slice(-3).reverse().filter(f => !byContribution.slice(0, 3).includes(f)),
    unavailable,
    mcap: token.mcap ?? null,
    alertAgeMs: token.alert ? now - token.alert.ts : null,
    lastChainEventTs: token.lastChainEventTs ?? null,
    lastMarketUpdateTs: token.lastMarketUpdateTs ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/memefinder/__tests__/service.test.js`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/memefinder/service.js backend/src/memefinder/__tests__/service.test.js
git commit -m "feat(memefinder): ranked pagination + evidence view; coverage never labeled confidence (§18)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: HTTP routes for the Meme Finder feeds (§18.2)

**Files:**
- Modify: `backend/package.json` (add `supertest` devDep)
- Create: `backend/src/memefinder/routes.js`
- Test: `backend/src/memefinder/__tests__/routes.test.js`

> **Spec (§18.2):** the default navigation is **Qualified Memes** (admitted, ranked), **Provisional/Watching** (optional research view), and **All Discovered** (optional diagnostic). All feeds paginated (§18.3).

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

function app(tokens) {
  const a = express();
  a.use('/api/memefinder', createMemeFinderRouter({
    listTokens: () => tokens,
    clock: { now: () => 10_000 },
  }));
  return a;
}

const mk = (assetKey, admission, memeScore) => ({
  assetKey, admission, firstSeenTs: 0,
  score: { memeScore, version: 'v', profile: 'pump-curve', evidenceCoverage: 80,
           structural: { score: 70, breakdown: {} }, dynamic: { score: 60, breakdown: {} },
           blockers: [] },
});

const fixture = [
  mk('solana:pumpfun:Q1', 'qualified', 90),
  mk('solana:pumpfun:Q2', 'qualified', 80),
  mk('solana:pumpfun:P1', 'provisional', 70),
  mk('solana:pumpfun:W1', 'watching', 40),
  mk('ethereum:uniswap:E1', 'unscored', null),
];

describe('GET /api/memefinder/qualified', () => {
  it('returns only qualified tokens, ranked, with pagination metadata', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/qualified');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map(t => t.assetKey)).toEqual(['solana:pumpfun:Q1', 'solana:pumpfun:Q2']);
    expect(res.body.pageSize).toBe(100);
    expect(res.body.hasMore).toBe(false);
  });

  it('honours page and pageSize', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/qualified?page=2&pageSize=1');
    expect(res.body.page).toBe(2);
    expect(res.body.items.map(t => t.assetKey)).toEqual(['solana:pumpfun:Q2']);
    expect(res.body.hasMore).toBe(false);
  });

  it('never labels coverage as confidence', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/qualified');
    expect(JSON.stringify(res.body)).not.toMatch(/confidence|probability/i);
  });
});

describe('GET /api/memefinder/all', () => {
  it('returns every token including unscored, as a diagnostic feed', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/all');
    expect(res.body.total).toBe(5);
    expect(res.body.items.some(t => t.admission === 'unscored')).toBe(true);
  });

  it('filters by admission when asked', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/all?admission=provisional,watching');
    expect(res.body.items.map(t => t.assetKey))
      .toEqual(['solana:pumpfun:P1', 'solana:pumpfun:W1']);
  });
});

describe('GET /api/memefinder/token/:assetKey', () => {
  it('returns the evidence view for one token', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/token/solana:pumpfun:Q1');
    expect(res.status).toBe(200);
    expect(res.body.assetKey).toBe('solana:pumpfun:Q1');
    expect(res.body.coverageLabel).toBe('evidence coverage');
    expect(res.body.scoreVersion).toBe('v');
  });

  it('404s an unknown assetKey', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/token/solana:pumpfun:NOPE');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('surfaces an unsupported-scope token as unscored rather than hiding it', async () => {
    const res = await request(app(fixture)).get('/api/memefinder/token/ethereum:uniswap:E1');
    expect(res.status).toBe(200);
    expect(res.body.admission).toBe('unscored');
    expect(res.body.memeScore).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/memefinder/__tests__/routes.test.js`
Expected: FAIL — `Cannot find module '../routes.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `backend/src/memefinder/routes.js`:

```js
// Meme Finder feeds (§18.2). Three surfaces: Qualified (production), All (diagnostic,
// filterable to Provisional/Watching), and a single-token evidence view. All paginated.
import express from 'express';
import { rankTokens, paginate, toEvidenceView } from './service.js';

export function createMemeFinderRouter({ listTokens, clock }) {
  const router = express.Router();

  const send = (res, rows, req, now) => {
    const page = paginate(rankTokens(rows), req.query);
    res.json({ ...page, items: page.items.map(t => toEvidenceView(t, { now })) });
  };

  // 1. Qualified Memes — the one production list. (§18.2)
  router.get('/qualified', (req, res) => {
    const now = clock.now();
    send(res, listTokens().filter(t => t.admission === 'qualified'), req, now);
  });

  // 2/3. All Discovered — diagnostic feed; ?admission=provisional,watching gives the research view.
  router.get('/all', (req, res) => {
    const now = clock.now();
    let rows = listTokens();
    if (req.query.admission) {
      const want = new Set(String(req.query.admission).split(',').map(s => s.trim()));
      rows = rows.filter(t => want.has(t.admission));
    }
    send(res, rows, req, now);
  });

  // Single-token evidence panel. (§18.3)
  router.get('/token/:assetKey', (req, res) => {
    const token = listTokens().find(t => t.assetKey === req.params.assetKey);
    if (!token) return res.status(404).json({ error: 'not_found' });
    res.json(toEvidenceView(token, { now: clock.now() }));
  });

  return router;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/memefinder/__tests__/routes.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/memefinder/routes.js backend/src/memefinder/__tests__/routes.test.js
git commit -m "feat(memefinder): paginated qualified/all/token routes (§18.2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire monitoring + routes into the server

**Files:**
- Modify: `backend/server.js`

> The router and monitoring collaborators must be constructed with the **system** clock and the shared `Tape` (Phase 1 Task 5 already creates one). No new tests here — Tasks 1–7 cover the logic; this is composition. Verified by the full suite in Task 13.

- [ ] **Step 1: Mount the router and construct collaborators**

In `backend/server.js`, near the existing router mounts (`/api/lists`, etc.), add:

```js
import { createMemeFinderRouter } from './src/memefinder/routes.js';
import { QueueStats } from './src/monitoring/queueStats.js';
import { systemClock } from './src/discovery/clock.js';
import { getTokens } from './src/discovery/registry.js';

export const queueStats = new QueueStats();

app.use('/api/memefinder', createMemeFinderRouter({
  // Reads the registry's scored records. The backend is the sole qualification
  // authority (§18.1) — the router only shapes what the scorer already decided.
  listTokens: () => getTokens({ view: 'all' }),
  clock: systemClock,
}));
```

- [ ] **Step 2: Expose the monitoring health snapshot**

Still in `backend/server.js`, alongside the existing status route:

```js
app.get('/api/memefinder/health', (req, res) => {
  const tokens = getTokens({ view: 'all' });
  queueStats.observeStates(tokens);
  res.json(queueStats.snapshot());
});
```

Register this **before** `app.use('/api/memefinder', ...)` is consulted for `/token/:assetKey`, or Express will match `health` as an `assetKey`. Simplest correct ordering: mount the router first and place `/health` **inside** `createMemeFinderRouter` instead. Do that — add to `routes.js`:

```js
  router.get('/health', (req, res) => res.json(stats ? stats.snapshot() : {}));
```

…declared **above** the `/token/:assetKey` route, and accept `stats` in the factory options (`createMemeFinderRouter({ listTokens, clock, stats })`). Then `server.js` passes `stats: queueStats` and does **not** register a separate `/health` route.

- [ ] **Step 3: Verify the server still boots**

Run: `cd backend && node --check server.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add backend/server.js backend/src/memefinder/routes.js
git commit -m "feat(server): mount memefinder router + health snapshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Frontend component-test infrastructure

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vitest.config.js`
- Create: `frontend/src/test/setup.js`

> The current frontend Vitest config uses `environment: 'node'` and `include: ['src/**/__tests__/**/*.test.js']` — it cannot render components and would not even collect a `.test.jsx` file. Tasks 10–11 need both fixed. (Shared context §1 flags that component tests are not yet established.)

- [ ] **Step 1: Install the dependencies**

```bash
cd frontend && npm install --save-dev jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Create the setup file**

Create `frontend/src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Update the Vitest config**

Replace `frontend/vitest.config.js` with:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom so components can render; existing pure-function tests are unaffected.
    environment: 'jsdom',
    // .test.jsx added — component tests live beside their components.
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    setupFiles: ['src/test/setup.js'],
  },
});
```

- [ ] **Step 4: Verify the existing suite still passes under jsdom**

Run: `cd frontend && npm test`
Expected: PASS — the pre-existing frontend tests (39 at last count) still pass; environment change is backwards-compatible for pure-function tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.js frontend/src/test/setup.js
git commit -m "test(frontend): add jsdom + testing-library for component tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `QualifiedMemesView` — renders backend admission, never recomputes it (§18.1)

**Files:**
- Create: `frontend/src/components/meme/QualifiedMemesView.jsx`
- Test: `frontend/src/components/meme/__tests__/QualifiedMemesView.test.jsx`

> **Spec (§18.1):** the frontend must not duplicate `matches(token)` predicates or independently decide whether a token qualifies. **(§18.3):** coverage is labeled coverage, not confidence of profit. **(§16.3):** provisional must be visually distinguished from Qualified.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/meme/__tests__/QualifiedMemesView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import QualifiedMemesView from '../QualifiedMemesView.jsx';

const rows = [
  { assetKey: 'solana:pumpfun:Q1', admission: 'qualified', memeScore: 90,
    structuralScore: 85, dynamicScore: 70, evidenceCoverage: 88,
    coverageLabel: 'evidence coverage', profile: 'pump-curve',
    scoreVersion: 'meme-score-v2.0.0', blockers: [], unavailable: [],
    mcap: null, alertAgeMs: 60_000, reasons: ['passed_admission_path'] },
  { assetKey: 'solana:pumpfun:P1', admission: 'provisional', memeScore: 72,
    structuralScore: 74, dynamicScore: 50, evidenceCoverage: 70,
    coverageLabel: 'evidence coverage', profile: 'pump-curve',
    scoreVersion: 'meme-score-v2.0.0', blockers: [], unavailable: ['marketCap'],
    mcap: null, alertAgeMs: null, reasons: ['single_strong_metric'] },
];

describe('QualifiedMemesView (§18.1, §18.3)', () => {
  it('renders a row per token with its scores', () => {
    render(<QualifiedMemesView items={rows} total={2} />);
    expect(screen.getByTestId('meme-row-solana:pumpfun:Q1')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('labels coverage as coverage and never as confidence or probability', () => {
    render(<QualifiedMemesView items={rows} total={2} />);
    expect(screen.getAllByText(/evidence coverage/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/confidence/i)).toBeNull();
    expect(screen.queryByText(/probability/i)).toBeNull();
  });

  it('visually distinguishes provisional from qualified', () => {
    render(<QualifiedMemesView items={rows} total={2} />);
    expect(screen.getByTestId('meme-row-solana:pumpfun:Q1').dataset.admission).toBe('qualified');
    const prov = screen.getByTestId('meme-row-solana:pumpfun:P1');
    expect(prov.dataset.admission).toBe('provisional');
    expect(prov.className).toMatch(/provisional/);
  });

  it('shows the regime and score version for each row', () => {
    render(<QualifiedMemesView items={rows} total={2} />);
    expect(screen.getAllByText('pump-curve').length).toBe(2);
    expect(screen.getAllByText('meme-score-v2.0.0').length).toBe(2);
  });

  it('renders unavailable fields as unavailable rather than zero', () => {
    render(<QualifiedMemesView items={rows} total={2} />);
    const prov = screen.getByTestId('meme-row-solana:pumpfun:P1');
    expect(prov.textContent).toMatch(/unavailable/i);
    expect(prov.textContent).not.toMatch(/\$0\b/);
  });

  it('shows the total so the list is not implied to be exhaustive', () => {
    render(<QualifiedMemesView items={rows} total={137} />);
    expect(screen.getByTestId('meme-total').textContent).toMatch(/137/);
  });

  it('renders an empty state instead of crashing on no items', () => {
    render(<QualifiedMemesView items={[]} total={0} />);
    expect(screen.getByTestId('meme-empty')).toBeInTheDocument();
  });

  it('does not compute qualification itself — it renders the admission it was given', () => {
    // A token whose scores are far below every threshold but which the BACKEND admitted
    // must still render as qualified. The frontend has no gate of its own. (§18.1)
    render(<QualifiedMemesView items={[{
      ...rows[0], memeScore: 1, structuralScore: 1, dynamicScore: 1, evidenceCoverage: 1,
      admission: 'qualified',
    }]} total={1} />);
    expect(screen.getByTestId('meme-row-solana:pumpfun:Q1').dataset.admission).toBe('qualified');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/QualifiedMemesView.test.jsx`
Expected: FAIL — cannot resolve `../QualifiedMemesView.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/meme/QualifiedMemesView.jsx`:

```jsx
// The one production Meme Finder list. It RENDERS the backend's admission decision.
// It contains no qualification predicate of its own — the backend is the sole authority (§18.1).
export default function QualifiedMemesView({ items = [], total = 0, onSelect }) {
  if (!items.length) {
    return (
      <div className="meme-empty" data-testid="meme-empty">
        No tokens currently meet the admission criteria.
      </div>
    );
  }

  return (
    <div className="meme-qualified">
      <div className="meme-total" data-testid="meme-total">
        Showing {items.length} of {total}
      </div>
      <table className="meme-table">
        <thead>
          <tr>
            <th>Token</th><th>Meme</th><th>Structural</th><th>Dynamic</th>
            {/* Coverage is EVIDENCE coverage — not a probability, not confidence of profit (§18.3) */}
            <th>Evidence coverage</th><th>Regime</th><th>Version</th><th>Alert age</th>
          </tr>
        </thead>
        <tbody>
          {items.map(t => (
            <tr
              key={t.assetKey}
              data-testid={`meme-row-${t.assetKey}`}
              data-admission={t.admission}
              className={`meme-row meme-row--${t.admission}`}
              onClick={() => onSelect?.(t.assetKey)}
            >
              <td>{t.assetKey.split(':').pop()}</td>
              <td>{fmt(t.memeScore)}</td>
              <td>{fmt(t.structuralScore)}</td>
              <td>{fmt(t.dynamicScore)}</td>
              <td>
                {fmt(t.evidenceCoverage)}
                <span className="meme-coverage-label"> {t.coverageLabel ?? 'evidence coverage'}</span>
              </td>
              <td>{t.profile ?? 'unavailable'}</td>
              <td>{t.scoreVersion ?? 'unavailable'}</td>
              <td>{t.alertAgeMs == null ? 'unavailable' : `${Math.round(t.alertAgeMs / 1000)}s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Missing evidence renders as "unavailable" — never as 0, which would read as a real measurement.
function fmt(v) { return v == null ? 'unavailable' : String(v); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/QualifiedMemesView.test.jsx`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meme/QualifiedMemesView.jsx frontend/src/components/meme/__tests__/QualifiedMemesView.test.jsx
git commit -m "feat(ui): QualifiedMemesView renders backend admission; coverage never called confidence (§18.1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `TokenEvidencePanel` — the §18.3 explanation surface

**Files:**
- Create: `frontend/src/components/meme/TokenEvidencePanel.jsx`
- Test: `frontend/src/components/meme/__tests__/TokenEvidencePanel.test.jsx`

> **Spec (§18.3):** show admission reason and alert age, blocker/invalidation state, top positive and negative evidence, unavailable or experimental features, and last chain-event/market-update timestamps. **(§5.1 of the Report):** the system must explain *why the token is present* and *which evidence is missing*.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/meme/__tests__/TokenEvidencePanel.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TokenEvidencePanel from '../TokenEvidencePanel.jsx';

const view = {
  assetKey: 'solana:pumpfun:M', admission: 'qualified',
  reasons: ['passed_admission_path'], memeScore: 76,
  structuralScore: 80, dynamicScore: 60, evidenceCoverage: 86,
  coverageLabel: 'evidence coverage', profile: 'pump-curve',
  scoreVersion: 'meme-score-v2.0.0', blockers: [],
  topPositive: [{ key: 'capitalEfficiency', block: 'structural', value: 0.9, contribution: 0.30 }],
  topNegative: [{ key: 'top10ExLp', block: 'structural', value: 0.2, contribution: 0.02 }],
  unavailable: ['marketCap'], mcap: null,
  alertAgeMs: 120_000, lastChainEventTs: 4_000, lastMarketUpdateTs: null,
};

describe('TokenEvidencePanel (§18.3)', () => {
  it('explains why the token is present', () => {
    render(<TokenEvidencePanel view={view} />);
    expect(screen.getByTestId('evidence-reasons').textContent).toMatch(/passed_admission_path/);
  });

  it('lists top positive and negative evidence', () => {
    render(<TokenEvidencePanel view={view} />);
    expect(screen.getByTestId('evidence-positive').textContent).toMatch(/capitalEfficiency/);
    expect(screen.getByTestId('evidence-negative').textContent).toMatch(/top10ExLp/);
  });

  it('names which evidence is missing', () => {
    render(<TokenEvidencePanel view={view} />);
    expect(screen.getByTestId('evidence-unavailable').textContent).toMatch(/marketCap/);
  });

  it('labels coverage as coverage, not confidence of profit', () => {
    render(<TokenEvidencePanel view={view} />);
    expect(screen.getByTestId('evidence-coverage').textContent).toMatch(/evidence coverage/i);
    expect(screen.queryByText(/confidence of profit|probability/i)).toBeNull();
  });

  it('shows blocker state for an invalidated token', () => {
    const blocked = { ...view, admission: 'rejected',
      blockers: [{ code: 'DEV_SELL', reversible: false }] };
    render(<TokenEvidencePanel view={blocked} />);
    expect(screen.getByTestId('evidence-blockers').textContent).toMatch(/DEV_SELL/);
  });

  it('renders no blocker section when nothing fired', () => {
    render(<TokenEvidencePanel view={view} />);
    expect(screen.queryByTestId('evidence-blockers')).toBeNull();
  });

  it('shows last chain event and marks an absent market update as unavailable', () => {
    render(<TokenEvidencePanel view={view} />);
    const ts = screen.getByTestId('evidence-timestamps').textContent;
    expect(ts).toMatch(/4000/);
    expect(ts).toMatch(/unavailable/i);
  });

  it('renders a placeholder rather than crashing when no view is supplied', () => {
    render(<TokenEvidencePanel view={null} />);
    expect(screen.getByTestId('evidence-none')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/TokenEvidencePanel.test.jsx`
Expected: FAIL — cannot resolve `../TokenEvidencePanel.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/meme/TokenEvidencePanel.jsx`:

```jsx
// The explanation surface (§18.3): why this token is here, what helped, what hurt,
// what is missing, and when the evidence was last refreshed.
export default function TokenEvidencePanel({ view }) {
  if (!view) {
    return <div className="evidence-none" data-testid="evidence-none">Select a token to see its evidence.</div>;
  }

  return (
    <div className="evidence-panel" data-admission={view.admission}>
      <header className="evidence-head">
        <span className="evidence-key">{view.assetKey}</span>
        <span className={`evidence-admission evidence-admission--${view.admission}`}>
          {view.admission}
        </span>
        <span className="evidence-regime">{view.profile ?? 'unavailable'}</span>
        <span className="evidence-version">{view.scoreVersion ?? 'unavailable'}</span>
      </header>

      <div className="evidence-scores">
        <Stat label="Meme" value={view.memeScore} />
        <Stat label="Structural" value={view.structuralScore} />
        <Stat label="Dynamic" value={view.dynamicScore} />
        {/* Coverage measures how much EVIDENCE exists — not the chance of profit (§18.3) */}
        <div className="evidence-coverage" data-testid="evidence-coverage">
          {fmt(view.evidenceCoverage)} <small>{view.coverageLabel ?? 'evidence coverage'}</small>
        </div>
      </div>

      <section data-testid="evidence-reasons">
        <h4>Why it is here</h4>
        <ul>{(view.reasons ?? []).map(r => <li key={r}>{r}</li>)}</ul>
        <div className="evidence-alert-age">
          Alert age: {view.alertAgeMs == null ? 'unavailable' : `${Math.round(view.alertAgeMs / 1000)}s`}
        </div>
      </section>

      {view.blockers?.length > 0 && (
        <section data-testid="evidence-blockers" className="evidence-blockers">
          <h4>Blockers</h4>
          <ul>
            {view.blockers.map(b => (
              <li key={b.code}>{b.code}{b.reversible ? ' (reversible)' : ''}</li>
            ))}
          </ul>
        </section>
      )}

      <section data-testid="evidence-positive">
        <h4>Top positive evidence</h4>
        <ul>{(view.topPositive ?? []).map(f => <li key={f.key}>{f.key} ({f.block})</li>)}</ul>
      </section>

      <section data-testid="evidence-negative">
        <h4>Top negative evidence</h4>
        <ul>{(view.topNegative ?? []).map(f => <li key={f.key}>{f.key} ({f.block})</li>)}</ul>
      </section>

      <section data-testid="evidence-unavailable">
        <h4>Unavailable / experimental evidence</h4>
        {view.unavailable?.length
          ? <ul>{view.unavailable.map(u => <li key={u}>{u}</li>)}</ul>
          : <span>none</span>}
      </section>

      <footer data-testid="evidence-timestamps">
        Last chain event: {view.lastChainEventTs ?? 'unavailable'} ·
        Last market update: {view.lastMarketUpdateTs ?? 'unavailable'}
      </footer>
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="evidence-stat"><small>{label}</small><strong>{fmt(value)}</strong></div>;
}
function fmt(v) { return v == null ? 'unavailable' : String(v); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/TokenEvidencePanel.test.jsx`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meme/TokenEvidencePanel.jsx frontend/src/components/meme/__tests__/TokenEvidencePanel.test.jsx
git commit -m "feat(ui): TokenEvidencePanel explains presence, evidence, gaps (§18.3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: API client + remove frontend qualification gating (WS10 migration contract)

**Files:**
- Modify: `frontend/src/utils/sniperApi.js`
- Modify: `frontend/src/utils/memeStrategies.js`
- Modify: `frontend/src/components/MemeFinderView.jsx`
- Test: `frontend/src/utils/__tests__/memeStrategies.test.js` (extend)

> **Migration contract (shared context §7):** when WS10 ships `QualifiedMemesView` + `TokenEvidencePanel`, these legacy surfaces are **removed**: `memeStrategies.js` `matches()`/`rules` predicates, the strategy-tab routing in `MemeFinderView.jsx`, and the frontend `minSafetyScore`/`minMemeScore` threshold constants. Phase 1 Task 12 demoted them to debug-only; this task deletes them. That completes defect #8 (§5.2.8) — the drift (frontend `minSafetyScore: 40` vs backend `CURATE_MIN_SCORE = 55`) becomes structurally impossible because only one side has thresholds.

- [ ] **Step 1: Write the failing test**

Extend `frontend/src/utils/__tests__/memeStrategies.test.js` with:

```js
import * as strategies from '../memeStrategies.js';

describe('WS10 migration — frontend holds no qualification thresholds', () => {
  it('still exposes isQualified reading the backend admission', () => {
    expect(strategies.isQualified({ admission: 'qualified' })).toBe(true);
    expect(strategies.isQualified({ admission: 'watching' })).toBe(false);
  });

  it('no longer exports client-side qualification predicates', () => {
    expect(strategies.DEFAULT_STRATEGIES).toBeUndefined();
    expect(strategies.getDefaultStrategy).toBeUndefined();
    expect(strategies.strategyMatchReasons).toBeUndefined();
  });

  it('exports no numeric threshold constants', () => {
    const numeric = Object.entries(strategies)
      .filter(([, v]) => typeof v === 'number');
    expect(numeric).toEqual([]);
  });

  it('exposes no object carrying a matches() predicate', () => {
    const withMatches = Object.values(strategies)
      .filter(v => v && typeof v === 'object')
      .flatMap(v => Array.isArray(v) ? v : [v])
      .filter(v => v && typeof v.matches === 'function');
    expect(withMatches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/utils/__tests__/memeStrategies.test.js`
Expected: FAIL — `DEFAULT_STRATEGIES` is still exported and numeric thresholds still exist.

- [ ] **Step 3: Reduce `memeStrategies.js` to the admission reader**

Replace the entire contents of `frontend/src/utils/memeStrategies.js` with:

```js
// The backend is the single authority for scores and admission (§18.1).
// This module deliberately contains NO thresholds and NO matches() predicates —
// keeping any here is what let the frontend drift from the backend gate (defect #8).
export function isQualified(token) {
  return token?.admission === 'qualified';
}

// Lifecycle states the UI may need to distinguish visually (§11.1). Labels only — not gates.
export const ADMISSION_LABELS = {
  unscored: 'Unscored',
  watching: 'Watching',
  provisional: 'Provisional',
  qualified: 'Qualified',
  rejected: 'Rejected',
  expired: 'Expired',
};

// Buy/sell ratio is a display helper, not an admission input.
export function tokenBuySellRatio(token) {
  const buys = token?.txns?.m5?.buys ?? 0;
  const sells = token?.txns?.m5?.sells ?? 0;
  if (!sells) return buys ? null : null; // unknown stays unknown — never a fabricated ratio
  return buys / sells;
}
```

- [ ] **Step 4: Add the memefinder API client methods**

In `frontend/src/utils/sniperApi.js`, add to the exported `api` object (beside `tokens`):

```js
  memeQualified: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/memefinder/qualified${q ? '?' + q : ''}`);
  },
  memeAll: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/memefinder/all${q ? '?' + q : ''}`);
  },
  memeToken: (assetKey) =>
    request('GET', `/api/memefinder/token/${encodeURIComponent(assetKey)}`),
  memeHealth: () => request('GET', '/api/memefinder/health'),
```

- [ ] **Step 5: Point `MemeFinderView` at the new surfaces**

In `frontend/src/components/MemeFinderView.jsx`:

1. Import the new components and client methods:
   ```jsx
   import QualifiedMemesView from './meme/QualifiedMemesView.jsx';
   import TokenEvidencePanel from './meme/TokenEvidencePanel.jsx';
   import { api } from '../utils/sniperApi.js';
   ```
2. Replace the strategy-rail-driven feed selection with three fixed feeds (§18.2): **Qualified Memes** (default, `api.memeQualified`), **Provisional / Watching** (`api.memeAll({ admission: 'provisional,watching' })`), and **All Discovered** (`api.memeAll()`).
3. Delete every remaining import of `DEFAULT_STRATEGIES` / `getDefaultStrategy` / `strategyMatchReasons` and the `matches(token)` filtering, along with the `StrategyRail` usage for qualification. Render `<QualifiedMemesView items={feed.items} total={feed.total} onSelect={setSelected} />` and `<TokenEvidencePanel view={selectedView} />`.
4. Keep the existing `ErrorBoundary` wrapper and the paginated response shape (`{ total, page, pageSize, items, hasMore }`).

- [ ] **Step 6: Run the frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — the new migration tests pass; any legacy test asserting `DEFAULT_STRATEGIES` or a strategy `matches()` must be **deleted** (those behaviours are intentionally gone, per the migration contract). Do not weaken the new assertions to keep an obsolete test alive.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/memeStrategies.js frontend/src/utils/sniperApi.js frontend/src/components/MemeFinderView.jsx frontend/src/utils/__tests__/memeStrategies.test.js
git commit -m "refactor(ui): remove frontend qualification gating; backend admission is sole authority (§18.1, defect #8)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Full regression + phase close

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-meme-finder-phase5-monitoring-api-ui.md` (check off completed tasks)

- [ ] **Step 1: Run the entire backend suite**

Run: `cd backend && npm test`
Expected: PASS. New in this phase: 7 (evaluate) + 10 (queue) + 8 (lifecycle) + 4 (aggregates) + 6 (queueStats) + 13 (service) + 8 (routes) = **56 new backend tests**, plus all Phase 1–4 tests still green. The Phase 1 `registry.test.js` fixture was intentionally updated in Task 2 — confirm it passes with the admission-based predicate.

- [ ] **Step 2: Run the entire frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — 8 (QualifiedMemesView) + 8 (TokenEvidencePanel) + 4 (migration) new tests, plus surviving pre-existing tests under jsdom.

- [ ] **Step 3: Verify the production build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no unresolved imports (catches any leftover `DEFAULT_STRATEGIES` import missed in Task 12 Step 5).

- [ ] **Step 4: Confirm the phase invariants by inspection**

Verify each, and fix rather than rationalise any failure:

- [ ] `prioritize` protects qualified, tracked, position-linked, **and control** tokens; the slice touches only the evictable array (§17, §10).
- [ ] No module outside `scoring/config.js` defines an admission threshold; `CONFIG.admission.provisional.ttlMs` is read, not duplicated (§22).
- [ ] `evaluateToken` is the only place a `score_evaluated` / `admission_changed` event is written, and `admission_changed` fires only on a real transition.
- [ ] Eviction writes an aggregate row and issues **no** tape deletion (§9.4 append-only).
- [ ] Every API list response carries `total`; nothing is silently truncated (§18.3).
- [ ] `grep -rin "confidence\|probability" backend/src/memefinder frontend/src/components/meme` returns no user-facing label applied to a score (§4, §18.3).
- [ ] The frontend exports no numeric threshold and no `matches()` predicate (§18.1).
- [ ] Market-cap-dependent fields render as `unavailable`, and DexScreener `marketCapUsd` is **not** substituted anywhere (§7.2, §13 Gap 2).
- [ ] `sellRouteVerified` remains `undefined` when unchecked, so no token blocks as `HONEYPOT` (§13 Gap 3).

- [ ] **Step 5: Commit the phase close**

```bash
git add docs/superpowers/plans/2026-07-24-meme-finder-phase5-monitoring-api-ui.md
git commit -m "docs(plan): close Phase 5 — monitoring lifecycle + Meme Finder API/UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**1. Spec coverage.** Every WS9/WS10 requirement maps to a task:

| Report requirement | Task |
|---|---|
| §14 score contract incl. `admission`/`reasons`/`alert` | 1 |
| §16.5 admission applied to live tokens | 1 |
| §9.2 `score_evaluated` / `admission_changed` events | 1 |
| §17 score-prioritized monitoring, evictable-only cap | 2 |
| §10 control sample at identical depth (never evicted) | 2 |
| §16.3 provisional TTL + visual distinction | 3, 10 |
| §16.4 `expired` / `rejected` transitions | 3 |
| §15 later blocker invalidates a qualified token | 3 |
| §10 eviction keeps history (aggregates, tape intact) | 4 |
| §24 state/blocker/queue/provisional counters | 5, 8 |
| §18.2 Qualified / Provisional-Watching / All feeds | 6, 7, 12 |
| §18.3 evidence view, coverage labeling, pagination | 6, 7, 10, 11 |
| §18.1 backend sole authority; frontend recomputes nothing | 10, 12 |
| §5.2.8 defect #8 completion (threshold drift impossible) | 12 |
| §22 version discipline (no duplicated thresholds) | 3, 13 |

**2. Placeholder scan.** No "TBD", "add error handling", "similar to Task N", or "write tests for the above". Every code step contains complete, runnable code and every test step contains full assertions.

**3. Type/name consistency.** Symbols match the Report, shared-context §2 map, and Phases 1–4: `Tape.append`, `assetKey`, `classifyScope`, `extractAllFeatures`, `computeMemeScore`, `admit`, `CONFIG`, `MonitorBudget.isControl`, `isQualified`, `canEvictToken`/`prioritize`, `evaluateToken`, `applyLifecycle`, `aggregateRow`, `rankTokens`/`paginate`/`toEvidenceView`, `createMemeFinderRouter`. New names introduced here and used consistently: `canEvictToken`, `evaluateToken`, `applyLifecycle`, `persistEviction`, `QueueStats`, `toEvidenceView`, `QualifiedMemesView`, `TokenEvidencePanel`, `ADMISSION_LABELS`.

**4. Deferred work is named, not omitted.** Phase 6 (WS11 replay/labels/shadow policy/metrics, WS12 shadow run/calibration/go-no-go) is called out in the Scope section. §13 Gaps 2 and 3 are named at their point of impact (Tasks 1, 3, 6, 10, 13) with the specific consequence stated — the UI shows `unavailable` rather than inventing a value, and no token blocks on absent sell-route evidence.

**5. Upstream corrections are explicit, not silent.** Task 2 changes Phase 1's `canEvict` semantics (`lifecycle === 'curated'` → `admission === 'qualified'`) and adds control-sample protection, including the required edit to Phase 1's own test fixture. Task 12 deletes surfaces Phase 1 deliberately left in place. Both are stated as intentional supersessions with the reason, so an executing agent does not treat the failing legacy expectation as a bug in its own work.

**6. No automation is enabled.** This phase surfaces decisions and evidence only. No trading path, no policy execution, and no claim of calibration — `CONFIG.status` still reads `v1-placeholder — thresholds NOT calibrated. Do not automate.`
