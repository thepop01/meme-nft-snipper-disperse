# Meme Finder Rebuild — Shared Context for the Remaining Workstreams (WS5–WS12)

> **Scope of this file (read first).** Workstreams 1–4 are now fully specified in two written
> plans and are the source of truth for everything they cover — do **not** duplicate them here:
> - **Phase 1 (WS1–WS2):** `docs/superpowers/plans/2026-07-24-meme-finder-phase1-event-tape.md`
>   — Postgres event tape, canonical identity/envelope, chain-scope gate, and all 8 defect fixes.
> - **Phase 2 (WS3–WS4):** `docs/superpowers/plans/2026-07-24-meme-finder-phase2-ingestion-snapshots.md`
>   — staged collection (Stage A/B/C + `baseline_closed`), windowing, immutable snapshots,
>     supply-aware market cap, and the one shared `extractAllFeatures`/`causalFeatures` extractor.
>
> This document holds **only the cross-cutting facts those two plans do not state** and that the
> remaining workstream plans (WS5–WS12) still need: conventions the plans silently assume, the
> foundation contract map they build on, the frozen layout for the unbuilt modules, the
> WS5–WS12 contract rows, the exact defect locations (verification aid), legacy-pipeline
> orientation, corrected code contracts for WS8/WS9/WS11/WS12, regression fixtures, a sequencing
> insight for WS11, and the authoring rules for the remaining plans. Every plan is written against
> the finalized spec `docs/meme-finder-foundation-report-2026-07-24.md` (the **Report**) and cites
> its sections — never a sibling plan — so the plans cannot drift.

---

## 1. Conventions the plans assume but do not restate (verified 2026-07-24)

- **Language / modules:** Node.js, **ESM** (`backend/package.json` has `"type": "module"`). All imports use explicit `.js` extensions (e.g. `import { emit } from '../bus.js'`). Node 18+ (global `fetch`, `AbortSignal.timeout()`, `node:` imports).
- **Test framework:** **Vitest** (`backend/vitest.config.js`, `environment: 'node'`, includes `src/**/__tests__/**/*.test.js`).
  - Run all: `cd backend && npm test` (→ `vitest run`).
  - Run one file: `cd backend && npx vitest run src/<path>/__tests__/<file>.test.js`.
  - Watch: `cd backend && npm run test:watch`.
  - Import style in tests: `import { describe, it, expect, vi, beforeEach } from 'vitest';`
  - **Testability pattern already in the codebase — dependency injection.** Functions accept their side-effecting collaborators as parameters (e.g. `runRefreshTick({ fetchPrices })`, and the Phase 2 `BaselineController({ cfg, clock, onClose })` / `MonitorBudget({ cfg, rng })`), and tests pass fakes. Prefer this over module mocking where practical; `vi.mock('../x.js', () => ({...}))` + `vi.resetModules()` + dynamic `await import()` in `beforeEach` is the established fallback for module-level state.
  - **Postgres in tests:** the plans use **`pg-mem`** (dev dep, added in Phase 1) to run real SQL against an in-memory Postgres — no running server. Construct with `newDb().adapters.createPg()`; migrate with `migrate(db)` from `backend/src/tape/db.js`. WS5–WS12 tests that touch the tape follow this same pattern (not a hand-rolled `{ query: vi.fn() }` fake, and not a live-DB `skipIf`).
- **Determinism:** no logic calls `Date.now()` or `Math.random()` directly. Time comes from the injected clock (`backend/src/discovery/clock.js` — `systemClock` in prod, `manualClock` in tests); randomness comes from an injected RNG (`Math.random` in prod, a seeded sequence in tests). WS5–WS12 logic that needs time/randomness takes them as parameters.
- **Frontend:** React (JSX) under `frontend/src`, Vite. Component tests are not yet established; the UI workstream (WS10) adds minimal component tests with Vitest + `@testing-library/react` (add as devDeps in that plan). Phase 1 only added a pure-function test to the existing frontend Vitest setup.
- **Event bus:** `backend/src/bus.js` exports `emit(type, payload)`, `onEvent(fn)`, `log()`. Discovery modules emit; `server.js` broadcasts every frame over the `/ws` WebSocket.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (repo convention).

## 2. Foundation contract map — what WS5–WS12 import (built in Phase 1 & 2)

Later workstreams consume these exact symbols. Cite this map (and the Report section) instead of re-deriving signatures. Paths are the **actual** built locations — note they differ from earlier draft names (`discovery/`, not `ingest/`; the single extractor is `features/extract.js`, not `features/extractAllFeatures.js`; `causalFeatures` lives in `features/extract.js`, not `calibration/`).

| Module | Exports | Built in | Report |
|---|---|---|---|
| `backend/src/tape/identity.js` | `assetKey`, `eventId`, `EVENT_TYPES`, `validateEnvelope` | Phase 1 | §9.1–§9.3 |
| `backend/src/tape/tape.js` | `Tape` (`append` idempotent, `eventsUntil` causal) | Phase 1 | §9.5 |
| `backend/src/tape/db.js` | `createPool`, `migrate` | Phase 1 | §9.4 |
| `backend/src/scope/chainScope.js` | `classifyScope` → `supported \| unscored` | Phase 1 | §14.2 |
| `backend/src/discovery/pumpfun.js` | `handlePumpMessage`, `routePumpMessage`, `startPumpFeed`, `makeBaselineCloser` | Phase 1+2 | §10.1 |
| `backend/src/discovery/clock.js` | `systemClock`, `manualClock` | Phase 2 | §10.1 |
| `backend/src/discovery/baselineController.js` | `BaselineController` (`open`/`recordSwap`/`tick`/`isOpen`/`onClose`) | Phase 2 | §10 |
| `backend/src/discovery/monitorBudget.js` | `MonitorBudget` (`registerLaunch`/`recordBuy`/`isHot`/`isControl`) | Phase 2 | §10 |
| `backend/src/discovery/ingestionStats.js` | `IngestionStats` (`received`/`reconnect`/`parseFailure`/`duplicate`/`lag`/`snapshot`) | Phase 2 | §24 |
| `backend/src/features/mcap.js` | `supplyAwareMcap` | Phase 2 | §7.2, §19.2 |
| `backend/src/features/windows.js` | `bucketize` (with `partial` flag) | Phase 2 | §12.3.1 |
| `backend/src/features/snapshots.js` | `initSnapshot`, `reduceSnapshot` (immutable, fixed anchor) | Phase 2 | §12.3.2 |
| **`backend/src/features/extract.js`** | **`extractAllFeatures`, `causalFeatures` — THE one extractor** | Phase 2 | §19.1, §22 |
| `backend/src/analysis/missingData.js` | `isPresent`, `valueOrUnavailable` (unknown ≠ 0) | Phase 1 | §5.2.7 |
| `backend/src/analysis/traction.js` | `breadthFromWindow` (same-window vol÷count) | Phase 1 | §5.2.2 |
| `backend/src/discovery/refreshLoop.js` | `detectSpikeBetween` (immutable before/after) | Phase 1 | §5.2.3 |
| `backend/src/analysis/safety.js` | `isAnalyzable`, `top10ExcludingKnown` | Phase 1 | §5.2.4–.5 |
| `backend/src/discovery/registry.js` | `canEvict`, `selectEvictable` | Phase 1 | §17 |
| `frontend/src/utils/memeStrategies.js` | `isQualified` (renders backend admission) | Phase 1 | §18.1 |

**The single extractor is `features/extract.js`.** Every feature family below (WS5–WS7) plugs into `extractAllFeatures` there — it must stay the one function called by both live and replay (Report §22 CI invariant #1; guarded by `features/__tests__/parity.test.js`).

## 3. Persistence — legacy surface only (the tape decision is in the plans)

The Postgres event-tape decision and schema are fully specified in Phase 1; do not re-decide them. What the plans do **not** cover, and WS9/WS10 still touch:

- **Legacy JSON stores remain during transition.** `registry.js` writes `data/tokens.json` (debounced 5s, full-array rewrite, `MAX_TOKENS = 300`). Generic `backend/src/store.js` `load/save` writes `data/<name>.json` (atomic temp-rename + Windows `EPERM` retry). `tracked.json` and custom lists likewise. `backend/data/` is gitignored.
- The new system reads/writes the **tape + derived aggregate rows**, not `tokens.json`. Legacy JSON stays only for the untouched legacy surface until WS10 migrates the UI. Eviction (Phase 1 `selectEvictable`) stops *monitoring* a token but never deletes its persisted events.

## 4. Directory layout for the unbuilt modules (frozen — WS5–WS12 only)

Phase 1 & 2 already created `tape/`, `scope/`, `discovery/{clock,baselineController,monitorBudget,ingestionStats}.js`, and `features/{mcap,windows,snapshots,extract}.js`. The remaining modules:

```
backend/src/
  features/capitalFormation.js  features/nonBotShare.js                      (WS5)
  features/funderGraph.js       features/topHolders.js  features/freshWallets.js
  features/devFingerprint.js                                                 (WS6)
  features/flowState.js  features/efficiencyAnalogs.js
  features/cohortRetention.js   features/derivatives.js                      (WS7)
  scoring/config.js      scoring/weightedScore.js  scoring/computeMemeScore.js
  scoring/blockers.js    scoring/admission.js                               (WS8)
  monitoring/queue.js                                                        (WS9)
  calibration/labels.js  calibration/metrics.js                             (WS11)
  policy/stub.js                                                             (WS11)
  memefinder/routes.js   memefinder/service.js  memefinder/dumpDetect.js    (WS10/WS12 API)
frontend/src/components/meme/  (QualifiedMemesView, TokenEvidencePanel, ...)  (WS10)
```

Each file has one responsibility (Report contracts). **All WS5–WS7 feature modules register into `features/extract.js`** — they are functions the one extractor calls, not a parallel extraction path. `causalFeatures` already exists (Phase 2) in `features/extract.js`; WS11 consumes it for labels rather than re-implementing it.

## 5. Cross-workstream contracts for WS5–WS12 (cite these Report sections; do not re-invent)

WS2–WS4 contracts (identity/tape/envelope, staged collection, windowing, snapshots) are settled in the two phase plans — cite those plans' files for them. The contracts still to be built:

| Contract | Report section | Owner |
|---|---|---|
| `capitalFormation` (single-pass milestones) | §12.1.1 | WS5 |
| `nonBotShare` (experimental-until-validated; label sources) | §12.1.2 | WS5 |
| `bundleClusters` (raw supply, max suspicious component) | §12.1.3 | WS6 |
| `top10ExLp` (resolved authorities — extends Phase 1 `top10ExcludingKnown`) | §12.1.4 | WS6 |
| `freshWalletFeature` (freshness ≠ low-history) | §12.1.5 | WS6 |
| `devFingerprint` (shrinkage) | §12.1.6 | WS6 |
| `flowState`, `efficiencyAnalogs`, `cohortRetention`, `DerivativeTracker` | §12.3.3–.6 | WS7 |
| `CONFIG` (versioned, per-regime dynamic registries) | §21 | WS8 |
| `weightedScore` (returns breakdown; disabled → excluded), `computeMemeScore` | §14.2 | WS8 |
| `evaluateBlockers` (fractions, HONEYPOT bounded rechecks, DEV_SELL) | §15.1 | WS8 |
| `admit` (memeScore paths, provisional TTL) | §16.5 | WS8 |
| Score contract object shape | §14 | WS8 |
| `prioritize` (evictable-only slice — builds on Phase 1 `selectEvictable`) | §17 | WS9 |
| `buildLabel` (dead-token guard, multiplicative costs, supply-aware) over Phase 2 `causalFeatures` | §19.2 | WS11 |
| Calibration metrics (Brier gated on probabilities) | §19.4 | WS11 |
| `policyDecision` (multiplicative costs) | §20 | WS11 |
| Go/no-go verdict rule (per cohort) | §19.5 | WS12 |
| Score-version bump triggers + CI invariants | §22 | all |

**Score-version discipline:** any change to a feature definition/unit, enable/disable, normalizer, weight, blocker/admission threshold, classifier version, schema interpretation, or label policy **must bump `CONFIG.version`** (Report §22). State this in every plan that touches config.

## 6. The 8 defects — exact locations (verification aid; all fixed in Phase 1)

Every defect below is remediated in Phase 1 at the noted task; the plan does **not** record these line numbers, so keep them here to verify the fixes landed at the right sites (line numbers are pre-fix positions as of 2026-07-24).

1. **Chain-scope / EVM-through-Solana** — `registry.js:156` `token.safety = await analyzeToken(token)` runs for **every** token, no chain guard. `analysis/safety.js` is Solana-only (`new Connection` :7; `new PublicKey(token.mint)` :27; `getTokenLargestAccounts` :59; `getTokenSupply` :61). EVM addresses (`evm.js:106,112` `mint: address.toLowerCase()`, chains `robinhood`/`monad`) throw in `new PublicKey`. *Fixed: Phase 1 Tasks 4 + 9 (`classifyScope`, `isAnalyzable` → `unscored`, not score 0).*
2. **Mixed time windows** — `analysis/traction.js:99-105` `avgTradeSize = vol24h / (h1+m5 txns)`; 24h numerator over 1h+5m denominator, m5 double-counted inside h1; same value returned at `:150`. *Fixed: Phase 1 Task 7 (`breadthFromWindow`).*
3. **Mutate-before-compare** — `refreshLoop.js:93-99` `before = getTokenByKey(...)`; `applyMarketPatch` (`registry.js:328-331`) does `Object.assign(token, patch)` and returns the **same** object; `detectSpike(token, before)` (`:133`) then compares two refs to one mutated object (`refreshLoop.js:202-208`), so `currVol > prevVol*3` can never fire. *Fixed: Phase 1 Task 8 (`detectSpikeBetween` + snapshot before patch).*
4. **(same analyzer as #1)** — the Solana-specific `analyzeToken` entry at `safety.js:21`. *Fixed: Phase 1 Tasks 4 + 9.*
5. **Skip-largest-holder** — `analysis/safety.js:63-68` `accounts.slice(1, 11)` unconditionally drops `accounts[0]`. *Fixed (interim): Phase 1 Task 9 (`top10ExcludingKnown` — exclude by known identity, not by size); full authority resolver is WS6.*
6. **Truncation caps** — `registry.js:19` `MAX_TOKENS = 300`; `server.js:125` `limit = Math.min(300, ... || 100)` + `server.js:134` `.slice(0, limit)`; duplicate `adapters/localAdapters.js:28` `.slice(0, Math.min(300, ...))`. *Fixed (interim): Phase 1 Task 11 (`selectEvictable` protects non-evictable + real pagination); full prioritization is WS9.*
7. **Missing-field-as-zero** — `frontend/src/utils/memeStrategies.js` (`top10HolderPct` pass at :21, fail at :122-123, 0 at :170; `marketCapUsd` → Infinity at :134-135). Backend `registry.js:191,200` `score = token.safety?.score ?? 0` then discards on `< DISCARD_MAX_SCORE` — a failed/unknown analysis discarded as if it scored 0. *Fixed: Phase 1 Task 10 (`missingData` helper; unknown ≠ 0).*
8. **Score/gate drift** — backend gate `registry.js:79-81,224-234` (`CURATE_MIN_SCORE=55` etc.) vs frontend `memeStrategies.js` `matches()`/`rules` (`curated` states `minSafetyScore:40` — already drifted from 55). *Fixed (interim): Phase 1 Task 12 (backend is sole authority per §18.1; frontend renders `admission`); full strategy-tab removal is WS10.*

**PumpPortal trade-stream gap:** `discovery/pumpfun.js:28` originally sent only `{ method: 'subscribeNewToken' }` — no `subscribeTokenTrade`, so the full trade stream was never collected. *Fixed: Phase 1 Task 6 (subscribe migrations) + Phase 2 Task 6 (per-mint `subscribeTokenTrade`/`unsubscribeTokenTrade`, staged collection).*

## 7. Legacy pipeline orientation (context for WS9, WS10)

The new system runs **alongside** this legacy flow during the transition; WS9 (prioritization) and WS10 (UI) interact with it, so:

- Ingestion → `registerToken(partial)` in `registry.js:97` (sources: `discovery/pumpfun.js`, `raydium.js`, `evm.js`, `movers.js`).
- `runPass(token)` `registry.js:149`: `enrichToken` (DexScreener) → `analyzeToken` (safety) → history → `computeTraction` → schedule next pass (`PASS_SCHEDULE_MIN`) → `evaluateLifecycle` (`registry.js:188`, curate/discard) → custom lists → promotion → save/emit.
- `refreshLoop.js:189` `startRefreshLoop()`: fast tick 45s + slow tick 30m; `processPrices` applies patches, rug detection, `detectSpike`.
- API: `server.js:123` `GET /api/tokens` (`view=curated|all|discovered`, filters, `limit` capped 300 — now paginated, Phase 1 Task 11); custom-lists router `listRoutes.js`; tracked routes; `/ws` firehose (`server.js:260`).
- Scoring today: `analysis/safety.js` `analyzeToken` (0-100), `analysis/traction.js` `computeTraction` (0-100), user rule engine `analysis/listRules.js` + `customLists.js`; frontend `memeStrategies.js` presentational predicates. WS8 replaces these authorities; the legacy scorers stay only until the corresponding UI cut-over (WS10).

**WS10 migration contract:** when WS10 ships the new `QualifiedMemesView` and `TokenEvidencePanel`, the following legacy surfaces are deprecated and removed: `frontend/src/utils/memeStrategies.js` `matches()`/`rules` predicates, the strategy-tab routing in `MemeFinderView.jsx`, and the frontend `minSafetyScore`/`minMemeScore` threshold constants. The backend `admission` field is the single qualification authority after that point.

---

## 8. Corrected code contracts for WS8 — scorer, blockers, admission (Report §14.2, §15.1, §16.5, §21)

**Do not re-derive these.** WS8 implements them verbatim; cite the Report section, not this file, as the spec source. The contracts below are the corrected versions from the Report with §23 fixes already applied.

### 8.1 Versioned configuration (`scoring/config.js` — Report §21)

Everything tunable lives here and nowhere else. Two separate dynamic registries (one per regime). All proportional thresholds are fractions `[0,1]`.

```js
// backend/src/scoring/config.js
export const CONFIG = {
  version: "meme-score-v2.0.0",
  status: "v1-placeholder — thresholds NOT calibrated. Do not automate.",

  windows: { canonicalMs: 60_000, flowSeriesLen: 4,
             cohortEntryMs: 5 * 60_000, cohortCheckMs: [15, 30].map(m => m * 60_000) },

  structural: {
    weights: { capitalEfficiency: 0.25, milestoneSpeed: 0.10, nonBotShare: 0.20,
               bundleCluster: 0.20, top10ExLp: 0.10, devPrior: 0.05,
               // DISABLED (weight 0 → excluded from denominator)
               creatorInitialBuy: 0, rawFreshCount: 0, smartPresence: 0 },
    freshAgeMs: 72 * 3600_000, freshBoundary: [20, 60], funderLookbackMs: 24 * 3600_000,
    devConfidentN: 8, shrinkStrength: 5,
  },

  // SEPARATE registries per regime — one table cannot serve both. (§21 fix)
  dynamic: {
    "pump-curve":     { weights: { flowState: 0.30, cohortRetention: 0.25, drawdownHealth: 0.20,
                                   uniqueParticipation: 0.15, derivatives: 0.10 }, emaAlpha: 0.3 },
    "post-migration": { weights: { flowState: 0.25, efficiencyAnalogs: 0.25, cohortRetention: 0.20,
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
              honeypotMaxChecks: 5, honeypotStaleMs: 10 * 60_000,
              madK: 4, madKCandidates: [4, 6] },

  policy: { maxEntryDecayFrac: 0.05, exitLadder: [[2.0, 0.5], [4.0, 0.25]],
            evalHorizonMs: 6 * 3600_000, positiveReturn: 0.50, mcapTarget: 500_000 },
};
```

### 8.2 Scorer (`scoring/computeMemeScore.js` — Report §14.2)

`weightedScore` is the only function that aggregates feature values; disabled features (`weight: 0`) are excluded from the denominator so they lower coverage, not score. Missing data returns `null` (unknown ≠ 0).

```js
// backend/src/scoring/computeMemeScore.js
import { CONFIG } from './config.js';
import { classifyScope } from '../scope/chainScope.js';

export function computeMemeScore(token, structural, dynamic, cfg = CONFIG) {
  if (classifyScope(token) !== 'supported') return { status: 'unscored', assetKey: token.assetKey };
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
function weightedScore(inputs) {
  const enabled = inputs.filter(i => i.weight > 0);
  const avail = enabled.filter(i => i.value != null);
  const totalW = enabled.reduce((s, i) => s + i.weight, 0);
  if (!avail.length || totalW === 0) return { score: null, coverage: 0, breakdown: {} };
  const wSum = avail.reduce((s, i) => s + i.weight, 0);
  const score = Math.round(100 * avail.reduce((s, i) => s + i.value * i.weight, 0) / wSum);
  const breakdown = Object.fromEntries(avail.map(i =>
    [i.key, { value: i.value, weight: i.weight, contribution: i.value * i.weight / wSum }]));
  return { score, coverage: wSum / totalW, breakdown };
}

const norm    = (v, [lo, hi]) => v == null ? null : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
const normInv = (v, r) => v == null ? null : 1 - norm(v, r);
const inv     = v => v == null ? null : 1 - v;
```

### 8.3 Blockers (`scoring/blockers.js` — Report §15.1)

All proportions are fractions `[0,1]`. `BOT_FLOW` fires **only** on a validated classifier with sufficient sample. `HONEYPOT` is bounded — after N checks it becomes `BAD_DATA` to prevent infinite rechecking. Unknown evidence never creates a blocker.

```js
// backend/src/scoring/blockers.js
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

### 8.4 Admission (`scoring/admission.js` — Report §16.5)

Three paths: combined qualification, exceptional momentum (requires validated non-bot classifier), and provisional (capital efficiency only, 10-minute TTL). A missing classifier never enables the momentum path.

```js
// backend/src/scoring/admission.js
export function admit(score, token, cfg) {
  if (score.status === 'unscored') return 'unscored';
  if (score.blockers.length) return 'rejected';
  const A = cfg.admission;
  const s = score.structural.score, d = score.dynamic.score, m = score.memeScore;
  if (s == null || d == null || m == null) return 'watching';
  const capEff = score.structural.breakdown?.capitalEfficiency?.value ?? null;

  // Path 1: combined
  if (m >= A.combined.meme && s >= A.combined.structural && d >= A.combined.dynamic &&
      score.evidenceCoverage >= A.combined.coverage) return 'qualified';

  // Path 2: exceptional momentum — requires VALIDATED non-bot share + min classified sample
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

---

## 9. Corrected code contracts for WS9, WS11, WS12 — prioritize, labels, policy, go/no-go

### 9.1 Score-prioritized monitoring queue (`monitoring/queue.js` — Report §17)

Capacity applies **only** to evictable records. Qualified, tracked, and open-position tokens are outside the cap entirely. Eviction stops monitoring, not history.

```js
// backend/src/monitoring/queue.js
export function prioritize(tokens, cfg) {
  const protectedT = tokens.filter(t => !canEvict(t));
  const evictable = tokens.filter(canEvict)
    .sort((a, b) => (b.score?.memeScore ?? -1) - (a.score?.memeScore ?? -1));
  return [...protectedT, ...evictable.slice(0, cfg.hotLimit)]; // slice ONLY the evictable set
}
function canEvict(t) {
  return !(t.admission === 'qualified' || t.tracked || t.hasOpenPosition);
}
// Evicted tokens: monitoring stops, but their tape rows persist. Raw events are never deleted.
```

**Note:** `prioritize` in WS9 builds on `selectEvictable` from Phase 1 (`registry.js`), which already guards qualified/tracked tokens. WS9 adds the score-ranked sort within the evictable set.

### 9.2 Labels (`calibration/labels.js` — Report §19.2)

Features are strictly causal (`asOf`). Labels may see the future on purpose — built offline after the horizon closes. **The single extractor `causalFeatures` from Phase 2 `features/extract.js` is called here; do not re-implement feature extraction.**

```js
// backend/src/calibration/labels.js
import { causalFeatures } from '../features/extract.js';  // THE one extractor — Phase 2
import { supplyAwareMcap } from '../features/mcap.js';

export async function buildLabel(tape, assetKey, alert, cfg) {
  const horizon = alert.ts + cfg.policy.evalHorizonMs;
  const trades = await tape.eventsUntil(assetKey, horizon, ['trade_observed']);  // awaited

  // Dead-token guard: no trades after the alert → explicit failed label, not garbage.
  // Math.max(...[]) is -Infinity and poisons y_peak_opportunity.
  const futureTrades = trades.filter(t => t.chainTs >= alert.ts);
  if (!futureTrades.length) return {
    y_policy_net_positive: false, y_policy_net_return: -1,
    y_peak_opportunity: null, y_hit_market_cap: false, y_dead: true,
  };

  const entry = simulateEntry(futureTrades, alert, cfg.policy);  // latency + entry slippage, multiplicative
  if (!entry) return null;
  const exit = simulateExitLadder(futureTrades, entry, cfg.policy);
  const netReturn = exit.proceedsMultiple - 1;  // costs applied multiplicatively

  // Peak mcap: `trade_observed` payloads do NOT carry supply or USD price (see §13 gap 2) —
  // supply comes from `token_created`, USD price from `market_snapshot`. Never read
  // t.payload.rawSupply/priceUsd off a trade: they are undefined and supplyAwareMcap returns null.
  const created = (await tape.eventsUntil(assetKey, horizon, ['token_created']))[0];
  const snaps = (await tape.eventsUntil(assetKey, horizon, ['market_snapshot']))
    .filter(e => e.chain_ts >= alert.ts);
  const mcapOf = snap => supplyAwareMcap({
    rawSupply: created?.payload?.rawSupply, decimals: created?.payload?.decimals,
    priceUsd: snap.payload.priceUsd });
  const mcaps = snaps.map(mcapOf).filter(v => v != null);
  const peak = mcaps.length ? Math.max(...mcaps) : null;   // null = unavailable, never -Infinity
  return {
    y_policy_net_positive: netReturn >= cfg.policy.positiveReturn,
    y_policy_net_return: netReturn,
    y_peak_opportunity: peak == null ? null : peak / alert.mcap - 1,  // optimistic, labeled as such
    y_hit_market_cap: peak == null ? false : peak >= cfg.policy.mcapTarget,
  };
}

// Replay features: ONE extractor shared with production. (§22 CI invariant)
export async function buildReplayFeatures(tape, assetKey, asOf) {
  return causalFeatures(tape, assetKey, asOf);   // delegates — never re-implements
}
```

### 9.3 Calibration metrics (`calibration/metrics.js` — Report §19.4)

Brier is **only** for calibrated probabilities. Never compute Brier against the raw `memeScore`. `evPerAlert` is the primary metric before a probability layer exists.

```js
// backend/src/calibration/metrics.js
export function calibrationTable(predictions, bins = 10) { /* rate ≈ binMid or thresholds are decoration */ }
export function brier(predictions) { /* ONLY for calibrated probabilities — never the raw memeScore */ }
export function precisionAtK(ranked, k) {
  const top = ranked.slice(0, k);
  return top.filter(t => t.label?.y_policy_net_positive).length / top.length;
}
export function evPerAlert(ranked, k) {  // THE metric — net EV under the policy stub, not hit rate
  const top = ranked.slice(0, k).filter(t => t.label);
  return top.reduce((s, t) => s + t.label.y_policy_net_return, 0) / top.length;
}
```

### 9.4 Shadow policy (`policy/stub.js` — Report §20)

Entry and exit costs are applied **multiplicatively**. `mode` must say "SHADOW — log only" — no automation is authorized by any plan.

```js
// backend/src/policy/stub.js
export function policyDecision(token, score, cfg) {
  if (token.admission !== 'qualified') return { action: 'none' };
  const decayFrac = token.mcap / score.alert.mcap - 1;   // supply-aware
  if (decayFrac > cfg.policy.maxEntryDecayFrac)
    return { action: 'skip', reason: 'alert_decay' };
  return {
    action: 'shadow_enter',
    invalidation: ['dev_sell_fired', 'blocker_added', 'flow_below_1_two_windows'],
    exitLadder: cfg.policy.exitLadder,                   // costs applied multiplicatively at fill
    mode: 'SHADOW — log only. No automation until the go/no-go verdict.',
  };
}
```

### 9.5 Go/no-go verdict rule (Report §19.5 — WS12)

This rule must be **frozen before shadow mode starts**. Evaluated **independently per cohort** (`pump-curve` vs `post-migration`). A partial pass is a legitimate outcome.

```text
GO requires ALL of:
  1. N >= 200 qualified shadow alerts with closed 6h horizons.
     N is predeclared from a bootstrap simulation on validation replay
     (heavy-tailed returns — size N by bootstrap power, NOT a t-test).
  2. Bootstrap 95% CI lower bound on mean policy net return > 0.
  3. Rug-after-alert rate <= predeclared ceiling.
  4. Median fill decay within policy slippage assumptions.
  5. Zero unresolved replay/live parity failures on the control sample.

NO-GO: bootstrap 95% CI entirely below 0 after N.
EXTEND: CI straddles 0 → continue to 2N, once, then verdict (no open-ended extension).
```

**Calendar note:** the minimum-sample burn-in is likely 30–90 days of shadow running to accumulate N per cohort — but the calendar is a *consequence* of reaching N, never the gate itself.

---

## 10. Regression fixtures for WS8 (Report §26.1 — include these verbatim in the test suite)

These are exact test anchors from the Report. WS8 must include them in `scoring/__tests__/computeMemeScore.test.js`. They are pure scorer tests — no mocks needed.

```js
// The 51.9% farm case: structural block must reject.
const farm = { maxSuspiciousComponentPct: 0.519, top10ExLpPct: 0.18, freshShare: 0.15 };
assert(computeMemeScore(token, farm, dyn).blockers.some(b => b.code === 'FARM'));

// unknown ≠ zero: missing bot-share must lower coverage, not score, and must NOT block.
const noBot = { ...good, nonBotShare: null, nonBotClassifierStatus: 'experimental' };
assert(computeMemeScore(token, noBot, dyn).evidenceCoverage <
       computeMemeScore(token, good, dyn).evidenceCoverage);
assert(!computeMemeScore(token, noBot, dyn).blockers.some(b => b.code === 'BOT_FLOW'));
```

**Additional prose tests WS8 must include:**
- A disabled feature (`creatorInitialBuy`, weight 0) raises no score and reduces the coverage fraction.
- `weightedScore` with all inputs `null` returns `{ score: null, coverage: 0, breakdown: {} }` — not 0.
- An EVM token returns `{ status: 'unscored' }` without touching any scoring path.
- A validated `BOT_FLOW` block with `nonBotShare = 0.10` and 35 classified trades fires the blocker.
- An experimental non-bot share with 15 classified trades does **not** fire `BOT_FLOW`.

---

## 11. Sequencing insight for WS11 — build the replay harness early against synthetic tapes (Report §26.0)

WS11's replay harness does **not** have to wait for real ingestion to stabilize. Build a **synthetic tape generator** that emits fake event streams with known ground truth — farms, grinds, organic pumps, dead tokens, right-censored baselines — and use it to:

1. Test the causality guards (`chain_ts <= asOf` never violated).
2. Test label construction including the §19.2 dead-token path.
3. Test calibration metrics (`evPerAlert`, Brier gate).
4. Prove the harness before real tape data exists.

When real replay runs, the harness is already proven. This **parallelizes** the two longest-lead items (persistent ingestion filling up and the calibration harness) instead of serializing them.

**Synthetic tape shape:** a generator function that accepts a token scenario descriptor (e.g. `{ farms: true, buys: 40, devSell: true }`) and emits `tape.append`-compatible envelope objects using a `manualClock` to control `chainTs`. The `causalFeatures` extractor (Phase 2) runs against the generated tape and output is asserted against expected feature values.

---

## 12. Plan authoring rules (every remaining WS5–WS12 plan MUST follow)

Match the format of the two written phase plans so the set stays consistent.

**Header (verbatim, per plan):**
```markdown
# Meme Finder — [Phase N: Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [one sentence]
**Architecture:** [2-3 sentences]
**Tech Stack:** Node ESM, Vitest, pg + pg-mem [+ ws / @solana/web3.js / React as relevant]
**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` (§... list). Section references below point there.
**Depends on:** [prior phase plan files / this shared-context file / Report sections]

---
```

**Task structure:** bite-sized TDD. Each task = `## Task N: Name` with a **Files** block (exact `Create:` / `Modify: path` / `Test:` paths) then numbered `- [ ] **Step:**` items:
1. Write the failing test (show the **full** test code).
2. Run it, expect FAIL (exact `cd backend && npx vitest run ...` command + expected failure reason).
3. Write the minimal implementation (show the **full** code).
4. Run it, expect PASS (exact command + expected count).
5. Commit (exact `git add ... && git commit -m "..."`, ending with the repo trailer).

**No placeholders.** No "TBD", "add error handling", "similar to Task N", "write tests for the above". Show real code and real assertions every time. Use the exact signatures from §2 above and the Report contracts. Reference only symbols defined in this plan, the §2 foundation map, or cited Report sections.

**Discipline:** DRY, YAGNI, TDD, frequent commits, injected clock/RNG, `pg-mem` for tape tests. Thresholds stay uncalibrated placeholders (never claim calibration). No automation is enabled by any plan except the shadow-only path in WS11/WS12. New feature families plug into `features/extract.js`, never a second extractor (§22).

**Honest-scope note:** where a plan delivers only a slice of a Report requirement (deferring the rest to a later WS), call it out at the task and in the self-review — as Phase 1 & 2 do — rather than implying full coverage.

**Self-review before finishing:** (1) every Report requirement in your workstream maps to a task; (2) no placeholder patterns; (3) function/type names match the Report, this file's §2 map, and the two phase plans exactly (e.g. `computeMemeScore`, `weightedScore`, `bundleClusters`, `buildLabel`, `extractAllFeatures`, `causalFeatures`, `assetKey`); (4) anything deferred is named as deferred, not omitted silently; (5) the regression fixtures in §10 are included verbatim in WS8.

---

## 13. Known gaps between the built foundation and what WS5+ needs

Phases 1–2 are internally consistent, but three things WS5+ assumes are **not yet produced by the tape**. Each is a first task in its owning workstream, not an afterthought — a feature reading a field the tape never writes silently returns `null` forever, lowering coverage with no error.

**Gap 1 — `curveTargetSol` is never captured.** `capitalFormation(trades, curveTargetSol)` (§12.1.1) divides by it, but Phase 1's `token_created` payload is only `{creator, curve, initialBuyLamports}`. **WS5 Task 1** must extend the `token_created` payload with `curveTargetSol` (plus `rawSupply` and `decimals` — see Gap 2) and bump `schemaVersion` to 2. Events already on the tape at v1 lack the field: `capitalFormation` must return `{primary: null, coverage: 0}` for them rather than assuming a default target.

**Gap 2 — no supply, decimals, or USD price on the tape.** `supplyAwareMcap` needs `rawSupply`/`decimals`/`priceUsd`, and every mcap-dependent feature (§12.3.2 snapshots, §12.3.4 analogs, §19.2 labels, §20 policy decay) depends on it. Currently: `rawSupply`/`decimals` are absent from `token_created` (fix with Gap 1, schemaVersion 2), and **no `MARKET_SNAPSHOT` event is ever emitted** — the type is declared in `EVENT_TYPES` but nothing writes it. **WS7 Task 1** must add a market-snapshot emitter (price/liquidity/interval volume/source per §9.2) for hot + control tokens at identical depth. Until it exists, treat all mcap features as unavailable — do **not** substitute DexScreener's `marketCapUsd`, which is the hardcoded-supply value the Report bans (§7.2).

**Gap 3 — `HOLDER_SNAPSHOT`, `FUNDING_LINK`, and `SELL_ROUTE_CHECK` are declared but never emitted.** `top10ExLp` (§12.1.4), `bundleClusters` (§12.1.3), `devFingerprint` (§12.1.6), and the `HONEYPOT` blocker (§15.1) all read them. **WS6** owns the first three emitters; the sell-route check emitter is WS8's (it feeds `token.sellRouteVerified`/`sellRouteChecks`/`sellRouteFirstCheckTs`, which `evaluateBlockers` reads but nothing currently sets — an unset `sellRouteVerified` must be `undefined`, not `false`, or every token blocks as a honeypot).

**Also note:** Phase 1's `top10ExcludingKnown(accounts, isKnown)` is an interim size-agnostic exclusion. WS6's `top10ExLp(rpc, mint, resolvers)` (§12.1.4) is the real contract with resolved authorities and returns `{top10ExLpPct, resolvedExclusions}`. WS6 replaces the interim function and updates `safety.js`'s call site — it does not keep both.

## 14. RPC budget and concurrency (Report §27 requires this; no plan specifies it yet)

WS6 is the expensive workstream: the funder graph costs **one RPC hop per buyer**, and the control sample must receive **identical depth** to hot tokens (§10). Before WS6 is written, its plan must pin:

- a batched wallet-age / funding-source resolver with an explicit **concurrency cap and queue** — never per-wallet unbounded `Promise.all`;
- a per-minute RPC budget with the control sample's share reserved **first** (starving the control sample makes selection bias unmeasurable by construction — the exact failure §10 forbids);
- cache TTLs for `walletAge`, `fundingSourceFor`, and account-authority lookups — these are near-immutable facts, so cache aggressively and key by **wallet**, not by token;
- backoff plus `BAD_DATA` (never a positive score) when the provider rate-limits (§24).

`config.rpcUrl` / `config.wssUrl` already exist. No API keys are needed by any current source — PumpPortal, DexScreener, GeckoTerminal, and Jupiter are all keyless — so rate limits, not cost, are the binding constraint.

## 15. Constraints to keep visible (Report §25)

- The gate passes ~20–30 tokens/day → ~100 positive-region samples in 90 days → **coarse bins, ≤ 10 feature families**. A six-category board with dozens of inputs is a v3 artifact; shipping it means fitting noise.
- Base rates: ~0.63% graduation, ~1% reaching the tracker cohort. Sub-percent targets punish every shortcut.
- The most likely honest outcome is a well-calibrated model showing **thin-to-negative EV after costs**. Build this as a **measurement instrument first, a trading tool second**. A negative result that replaces unverifiable channel signals with numbers you own is a successful outcome, not a failure.
