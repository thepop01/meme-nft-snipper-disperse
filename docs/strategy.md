# Meme Score v2 — Revised Engineering Plan

This rebuilds the original plan with everything established since: the academic paper, the two-bot reverse engineering, the critique rounds, and the adjudication. First the diff, then the full plan.

---

## 0. What changed vs. the original plan, and why

| Original plan | v2 | Reason |
|---|---|---|
| One weighted Meme Score, 6 categories | **Two disjoint feature blocks** (Structural / Dynamic) + blockers + coverage, combined at admission | Dev risk, concentration, and bundling appeared in multiple categories → double-counted correlated inputs, silent miscalibration. Fix is partitioning features, not adding scores |
| "Replay with graduation labels" | **Label = return from alert price, net of costs** (graduation demoted to secondary) | The paper's own breakeven math: graduation ≠ profit. Calibrating toward graduation would certify a losing system as accurate |
| Pre-migration signals only | **Two regimes**: curve profile + post-migration profile | Bot 2's evidence (ATH recorded at T+12, fixed baseline) proved the real architecture is screener → tracker. Post-migration, SOL-raised is constant across graduates, so the paper's predictor needs live analogs |
| Snapshot metrics | **Time-series features**: velocity + EMA-smoothed acceleration; explicitly **no jerk** | Third derivative at 30–60s polling is noise amplification |
| Slot-based bundling mention | **Funder-graph clustering** as the primary supply-control metric | Strictly stronger; catches farms that spread buys across slots (the 51.9% case) |
| Thresholds finalized after shadow mode | Same, plus **monthly refit cadence, never continuous auto-tuning** | Continuous updates create a feedback loop: your gate shapes the data that tunes your gate |
| No policy layer | **Explicit entry/invalidation/exit stub before any automation** | Prediction ≠ profit. The metric that matters is EV per alert net of slippage+fees, not hit rate |
| Research note statement | **Corrected: higher SOL ÷ trades = better** | The note had it reversed |

**Kept as-is (the original plan was right about these):** backend-owned pure scorer, `unknown ≠ zero`, coverage-based confidence, versioned threshold config, hard blockers, score-prioritized monitoring queue, never evict qualified/tracked/position tokens, Pump.fun-only first release with EVM `unscored`, time-based train/validation splits, shadow mode ≥7 days.

---

## 1. Architecture

```
Raw Event Tape (append-only, permanent)
  → Feature Extraction (recomputable from tape, always)
  → STRUCTURAL BLOCK (computed once, frozen at gate)
  → Candidate Gate (structural score + blockers)
  → Monitoring Queue (structural score allocates the RPC budget)
  → DYNAMIC BLOCK (time series, regime-aware)
  → Admission Engine (versioned thresholds)
  → [after calibration] Probability Layer
  → Policy Layer (entry / invalidation / exit)
  → Shadow Mode → Verdict
```

The tape is the foundation. Store events, not conclusions; every future model iteration replays it.

## 2. The label — define before building anything

```text
y₂ (primary):   max achievable return from first-alert price within 6h,
                net of estimated slippage + fees ≥ R
y₁ (secondary): max mcap within 6h ≥ $500K   (comparable to Bot 2's claims)
```

Every scoring, calibration, and threshold decision downstream depends on this being fixed now. y₁ measures whether the token pumped; y₂ measures whether *acting on the alert* made money. They diverge because of alert-latency decay — a token can hit $500K while your realistic fill is already past the move.

## 3. Feature registry — with the logic for each

### Structural block (frozen at gate)

| Feature | Computation | Direction / threshold | Why (evidence) |
|---|---|---|---|
| `capital_efficiency` | cum. SOL bought ÷ swap count | **Higher = better** (corrected) | Paper's strongest predictor: reaching a curve level in 10–50 swaps vs 500–1000 = concentrated conviction, not grind |
| `swaps_to_milestones` | swaps to reach 25/50/75/100% of curve | Lower = better | Same signal, robust to one oversized buy |
| `nonbot_share` | frontend-routed trades ÷ total | ≥30% required after n≥30 swaps; below → blocker | Paper: non-bot share above ~30% lifts graduation odds. **Validate derivability before scoring** (frontend program routing vs direct calls) |
| `bundle_cluster_pct` | supply % held by connected components in the common-funder graph (shared funding source within 24h pre-launch) + same-slot buys | High → penalty/blocker | Strictly stronger than slot-based; the 51.9%-bundled token had top-10 of only 18% — fake distribution is exactly what graphs catch. Cost: one RPC hop per buyer |
| `fresh_wallet_count` | buyers with wallet age < threshold | Count, not auto-zero | Age-only suffices at farm scale (151 = unambiguous). Near decision boundary (~20–60), upgrade to rich profiling (tx count, funding source, activity) to resolve CEX-withdrawal false positives |
| `top10_ex_lp` | `getTokenLargestAccounts`, top 10 minus **precisely identified** LP/curve/burn/program accounts | High → penalty | One RPC call; requires fixing the "blindly skip largest holder" bug |
| `dev_fingerprint` | {launches, graduation rate, median ATH, avg time-to-rug, bundle% history, sell timing}; "rug" = −90% from ATH within Xh | Profile, low weight | Paper: creator history is real but weak. Devs rotate wallets → identity must link via funding-source tracing |
| `creator_initial_buy` | dev's first-buy size | Feature, sign learned from data | Ambiguous: conviction or dump inventory. Don't hand-assign direction |
| `time_to_first_dev_sell` | armed at creation | Fires early → blocker | Cheapest near-real-time rug detector; only trade-stream data needed |

### Dynamic block (time series, per poll)

| Feature | Computation | Regime | Why |
|---|---|---|---|
| `efficiency_velocity` | SOL/trade per minute window, trend | Curve | Growing conviction beats static ratio |
| `gain_vs_anchor` | mcap ÷ **migration-time mcap** − 1, never rebased | Post | The one *proven* finding: all four of Bot 2's percentages reverse to an identical fixed $23.4K baseline |
| `ath_distance`, `ath_age` | 1 − mcap/ATH; time since ATH | Post | Stale ATH + rebounding flow = "recovering"; fresh ATH = at highs. Bot 2's RECOVERING/STABLE labels need this state, not a one-shot rule |
| `flow_series` | buy$ ÷ sell$ per **single fixed window length**, stored as series | Post | Fixes the mixed 24h/1h/5m window bug. Labels via state machine on (drawdown, series), not thresholds on one value |
| `efficiency_analogs` | volume/trade, volume/unique_buyer, Δmcap/new_buyers per window | Post | Post-migration, SOL-raised is identical for all graduates — the paper's predictor collapses; these are its live equivalents. Within-cohort predictive power is an open empirical question — re-estimate, don't transplant the paper's effect size |
| `cohort_sellthrough` | of wallets buying in minutes 1–5, fraction sold by T+15/T+30 | Both | Cheap proxy for holder half-life; same information as full retention tracking at ~1% of the RPC cost |
| `smart_wallet_lifecycle` | per smart wallet: entered→held→added→reduced→exited | Both | "3 smart wallets, 2 already exited" ≠ "3 smart wallets." Weight stays low — paper found smart-money presence weak and non-monotonic |
| Derivatives | EMA-smoothed velocity + acceleration of mcap, flow, unique buyers | Both | Momentum-of-momentum. **No jerk** — noise at this polling cadence |

### Blockers (hard vetoes, unchanged + two clarifications)

MAD/Shewhart dump · verified sell failure · liquidity collapse >70% · non-bot share <30% **after sufficient sample** (before that: "insufficient evidence," not a block) · extreme bundle-cluster or dev concentration · stale/internally inconsistent data (price×supply vs reported mcap, non-monotonic timestamps — the class of bug that made dormant-spike detection compare an object to itself).

## 4. Score math and admission

```js
{
  version: "meme-score-v2",
  profile: "pump-curve" | "post-migration",   // two regimes, shared structural block
  structural: { score: 81, coverage: 95, breakdown: {...} },
  dynamic:    { score: 74, coverage: 80, breakdown: {...} },
  confidence: 87,          // evidence coverage ONLY — never blended with probability
  blockers: [],
  admission: "qualified" | "provisional" | "watching" | "rejected",
  reasons: []
}
```

- `unknown` stays `unknown`; category scores are weighted means over **available** inputs with coverage recorded.
- Admission keeps the two-path design (combined ≥75 / exceptional-momentum path) + short-lived **Provisional** state — a single strong metric can provision, never fully qualify. This directly encodes the paper's warning that standalone signals sit below breakeven.
- The capital-formation/organic-participation split in admission exists for a reason: whale-only flow also produces high SOL/trade. Efficiency is only meaningful conditioned on organic share — hence both gates are mandatory.
- All thresholds in one versioned config, marked `v1-placeholder`, finalized only after calibration. **Monthly refit against holdout; never continuous auto-tuning.**

## 5. Probability layer (only after calibration data exists)

- Small n → **cohort frequency tables** with minimum-support fallback to coarser bins. Nested events (max-mcap ≥1M is a subset of ≥500K) make P(1M) ≤ P(500K) hold by construction — two independent regressions cannot guarantee this, and Bot 2's own outputs never violated it.
- Large n → ordinal model or isotonic-calibrated GBM. The n/p ratio chooses the model, not preference.
- **Replay must be causal**: every feature at time t computed only from data ≤ t. Lifecycle stage labels are the lookahead trap — "expansion" is only knowable in retrospect; keep live stages coarse (curve / active / terminal) or use proper changepoint detection.

## 6. Policy layer (stub, before any automation)

```text
Entry:        only if achievable fill ≤ X% above alert price
Invalidation: dev sell fires · dump blocker · flow < 1 sustained across 2 windows
Exit:         ladder (e.g., 50% at 2x, 25% at 4x, trail the rest)
Metric:       EV per qualified alert, net of slippage + fees — never hit rate
```

## 7. Phased implementation

**Phase 0 — Fix the eight known defects** (each is silent corruption, not a crash):
mixed-window breadth math · mutated before/after comparison (a detector that can't fire while appearing to work is worse than none) · EVM tokens through Solana checks · precise pool/curve account identification · reversed research-note statement · PumpPortal trade collection missing (this is the #1 data gap — no trades = no efficiency, no bot share, no flow) · 0%-coverage fields scored as if present · compressed safety score (median 50, max 60 = a constant, not a signal).

**Phase 1 — Raw tape.** Append-only store: creations, trades, migrations, holder snapshots, funding links. Nothing scored yet. Everything downstream replays this.

**Phase 2 — Structural block + gate.** Scorer as pure testable function; gate live for screening only; monitoring queue prioritized by structural score so the expensive trade/holder budget protects the best candidates first.

**Phase 3 — Dynamic block + post-migration tracker.** Fixed migration anchor, flow state machine, retention cohorts, lifecycle states (coarse, causal).

**Phase 4 — Replay + calibration.** Time-based splits (base rate drifts); calibration curve, Brier score, precision@10/50, rug rate, time-to-signal, simulated net EV.

**Phase 5 — Shadow mode ≥7 days with policy stub.** Log every alert as-if-acted.

**Phase 6 — Verdict.** Go/no-go decided by calibration + net EV. Not by how the alerts feel.

## 8. Honest constraints (write these on the wall)

- Gate passing ~20–30 tokens/day → ~100 positive-region samples in 90 days → **coarse bins, ≤10 features**. The 6-category board with dozens of inputs is a v3 artifact; launching with it means fitting noise.
- Base rates: 0.63% graduation, ~1% reaching the tracker cohort. Sub-percent targets punish every shortcut.
- Most likely outcome of doing everything right: a well-calibrated model showing **thin-to-negative EV after costs**. Build it as a measurement instrument first, a trading tool second — a negative result permanently replaces unverifiable channel signals with numbers you own; a positive one is an edge you can size against.