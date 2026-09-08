# Meme Finder — Foundation & Technical Specification (Finalized Baseline)

_Date: 2026-07-24_
_Status: **finalized implementation-planning baseline** — spec + corrected code contracts_
_Initial scope: Solana tokens launched on Pump.fun_
_Source documents: `strategy.md` (design rationale), `strategy logic tech.md` (reference implementation), the prior foundation report, the current repository, and the persisted 300-token audit snapshot_

> This document supersedes the earlier spec-level foundation report. It merges three things into one authoritative base for the implementation plan:
> 1. the **design rationale** — what the system is and *why each decision was made* (from `strategy.md`);
> 2. the **specification** — product behavior, data contracts, feature semantics, admission rules, calibration, and acceptance criteria;
> 3. **corrected code contracts** — the reference pseudocode from `strategy logic tech.md` with every known defect from §23 fixed and annotated.
>
> The reference code below is a **contract**, not drop-in production code: it fixes the ~20 identified defects and pins the intended signatures, units, and missing-data behavior. Thresholds and normalizer ranges remain uncalibrated placeholders. **No automatic trading is authorized by this design.**

---

## 1. Executive decision

The existing collection of frontend strategies should be replaced by one backend-owned Meme Finder decision system. The system will produce:

- one **structural score** describing relatively stable launch, ownership, and actor evidence;
- one **regime-specific dynamic score** describing live market behavior;
- one combined ranking index called `memeScore`;
- **evidence coverage**, kept separate from score and from any future probability;
- **hard blockers** with attached evidence;
- one **admission state**: `unscored`, `watching`, `provisional`, `qualified`, `rejected`, or `expired`.

The production UI centers on one **Qualified Memes** list. Provisional and watching tokens are lifecycle states within the same system, not separate trading strategies. "All Discovered" may remain as a diagnostic feed.

The first release must be **Pump.fun-only**. Tokens from EVM chains or unsupported launchpads must be returned as `unscored`; they must not pass through Solana-specific checks or inherit an uncalibrated score.

The project must be built first as a **measurement system**. A positive go-live decision requires causal replay, shadow execution, and positive net expected value after realistic entry latency, slippage, fees, and exits.

## 2. Purpose and how to read this report

This report resolves the research and technical notes into a single specification that can be used to write an implementation plan. It defines product behavior, data contracts, feature boundaries, scoring semantics, admission rules, storage requirements, calibration rules, operational controls, corrected code contracts, and acceptance criteria.

It intentionally does **not** provide a task-by-task implementation sequence or effort estimate. Those belong in the implementation plan derived from this report (see §26 workstreams and §27 acceptance criteria).

**Reading order.** §3 explains why the design looks the way it does. §4–§7 define scope, evidence honesty, current defects, product, and outcomes. §8–§21 are the specification with corrected contracts inline. §23 is the master defect-correction table. §24–§28 are versioning, operations, workstreams, acceptance, and the final recommendation.

## 3. Design evolution — what changed vs. the original plan, and why

The design was rebuilt after the academic paper, the two-bot reverse engineering, the critique rounds, and the adjudication. The table records what changed from the naïve first plan and the reasoning, so the implementation plan does not silently revert any of it.

| Original plan | Final design | Reason |
|---|---|---|
| One weighted Meme Score across 6 categories | **Two disjoint feature blocks** (structural / dynamic) + blockers + coverage, combined only at admission | Dev risk, concentration, and bundling appeared in multiple categories → correlated inputs were double-counted, causing silent miscalibration. Fix is *partitioning* features, not adding scores. |
| "Replay with graduation labels" | **Label = policy-realizable return from alert price, net of costs**; graduation demoted to a secondary label | The breakeven math: graduation ≠ profit. Calibrating toward graduation would certify a losing system as "accurate." |
| Pre-migration signals only | **Two regimes**: curve profile + post-migration profile with separate registries | The real architecture is screener → tracker. Post-migration, SOL-raised is ~constant across graduates, so the paper's headline predictor collapses and needs live analogs. |
| Snapshot metrics | **Time-series features**: velocity + EMA-smoothed acceleration; explicitly **no jerk** | Third derivative at 30–60 s polling is noise amplification. |
| Slot-based bundling mention | **Funder-graph clustering** as the primary supply-control metric | Strictly stronger: catches farms that spread buys across slots (the observed 51.9% case whose top-10 read only 18%). Cost: one RPC hop per buyer. |
| Thresholds finalized after shadow mode | Same, plus **monthly refit cadence, never continuous auto-tuning** | Continuous updates create a feedback loop: the gate shapes the data that tunes the gate. |
| No policy layer | **Explicit entry / invalidation / exit stub before any automation** | Prediction ≠ profit. The metric that matters is EV per alert net of slippage + fees, not hit rate. |
| Research note as written | **Corrected: higher SOL ÷ trades = better** | The note had the direction reversed. |

**Kept from the original plan (it was right about these):** backend-owned pure scorer; `unknown ≠ zero`; coverage-based confidence; versioned threshold config; hard blockers; score-prioritized monitoring queue; never evict qualified/tracked/position tokens; Pump.fun-only first release with EVM `unscored`; time-based train/validation splits; shadow mode ≥ 7 days.

## 4. Evidence classification

Every feature and threshold must carry an evidence class. This prevents research findings, reverse-engineered observations, implementation assumptions, and placeholders from being presented as equally certain.

| Class | Meaning | Examples |
|---|---|---|
| Repository fact | Directly observed in current code or persisted data | 300-token cap, missing trade stream, mixed time windows |
| Research claim | Reported by the supplied empirical notes; primary paper/dataset still need archiving | capital efficiency, non-bot share, dump relationship |
| Reverse-engineered observation | Inferred from external bot outputs, not a controlled outcome study | fixed post-migration market-cap anchor, flow labels |
| Engineering hypothesis | Plausible but must be tested on owned data | volume per buyer, funding-graph clustering, cohort retention |
| Placeholder | Needed to run shadow mode but not approved for automation | score weights, normalizer ranges, admission thresholds |

No raw score is a probability. A probability field can be added only after a separately evaluated calibration layer exists (§20).

## 5. Current-system diagnosis

The persisted audit snapshot contains 300 tokens: 284 Solana and 16 Robinhood-chain records. Its coverage and behavior explain why the Meme Finder feels unreliable.

### 5.1 Data coverage

| Signal | Coverage in snapshot | Consequence |
|---|---:|---|
| Safety | 240/300 | Present, but heavily compressed |
| Traction | 240/300 | Present, but many zero or low values |
| Top-10 holder percentage | 0/300 | Concentration rules cannot function |
| Holder count | 0/300 | Holder-growth logic cannot function |
| Smart wallets | 0/300 | Smart-money strategy cannot function |
| Bundler percentage | 0/300 | Farm detection cannot function |
| Attention boost | 1/300 | Attention strategy is effectively dead |
| Liquidity | 18/300 | Most absolute-liquidity rules lack evidence |
| Five-minute transactions | 97/300 active | Snapshot flow exists only for a minority |

Safety has a median of 50 and a maximum of 60 in the persisted sample — with this little spread it is a near-constant, not a ranker. Seven built-in selection presets currently produce zero matches.

### 5.2 Confirmed architectural defects (must be remediated first)

1. PumpPortal collects creation events but **not the complete trade stream**. Capital efficiency, non-bot share, cohort retention, dev selling, and robust dump detection therefore cannot be computed. **This is the #1 data gap.**
2. The current breadth calculation divides 24-hour volume by overlapping 1-hour + 5-minute transaction counts. Numerator and denominator describe different windows, and the 5-minute count is double-counted inside the 1-hour period.
3. Refresh processing **mutates the token object before comparing "before" and "after."** Both references can point to the same new values, preventing dormant-spike detection from firing (a detector that cannot fire while appearing to work is worse than none).
4. The current safety analyzer is Solana-specific but can receive EVM tokens.
5. Holder analysis **blindly skips the largest token account** as a presumed pool/curve account. System accounts must be identified explicitly.
6. The in-memory registry, API, and frontend impose 300/100-record truncation. Arrival order can evict better candidates while the UI implies exhaustive discovery.
7. Missing fields are inconsistently treated as zero / pass / fail / unavailable across strategies.
8. Scores and admission predicates are split between backend lifecycle code and frontend strategy functions, allowing labels and actual gates to drift.

## 6. Product definition

### 6.1 User-facing outcome

The primary product is one ranked list of tokens with enough positive, independent evidence to justify investigation. For each token the system must explain: why it is present; which evidence is missing; which regime and score version were used; which signals helped or hurt; whether any blocker fired; when the score was last evaluated; and whether the entry opportunity has decayed since the alert.

### 6.2 Non-goals for the first release

- No EVM or non-Pump.fun scoring.
- No social, narrative, or paid-attention score contribution.
- No autonomous trading.
- No continuously self-tuning thresholds.
- No claim that a score is a graduation or profit probability.
- No unverified bot/manual classifier used as a blocker.

## 7. Outcome definitions

The system optimizes for a decision-aligned financial outcome, not merely graduation.

### 7.1 Primary label

`y_policy_net_positive` measures the net return produced by a fixed, causal policy simulation from the first executable price after an alert. It includes: configured execution latency; entry and exit slippage; Pump.fun/DEX/priority/network fees where applicable; the configured invalidation and exit rules; and the full evaluation horizon, initially six hours.

The initial positive threshold may be configured at **+50% net return**, but it remains a placeholder until outcome distributions are measured.

### 7.2 Secondary labels

- `y_peak_opportunity`: maximum post-alert return inside the horizon, labeled explicitly as an optimistic opportunity measure, not an achievable return.
- `y_hit_market_cap`: whether observed market cap crossed a configured threshold such as $500,000 (comparable to external-bot claims).
- `y_graduated`: whether the token migrated successfully.
- `y_rugged`: whether market cap or executable price collapsed ≥ 90% from ATH inside the configured rug interval.
- `y_dead`: no observed trades after the alert within the horizon. Set explicitly so the label pipeline classifies "went nowhere" tokens rather than producing degenerate values on an empty trade set (see §19.2).

Market cap must come from **supply-aware observations**. It must never be computed with a hardcoded one-billion-token supply.

## 8. Target architecture

```text
Launch and chain data sources
  -> canonical event ingestion (idempotent)
  -> append-only event tape (chain time + receive time, exact units)
  -> causal feature snapshots (asOf)
       -> structural feature family (frozen at gate)
       -> curve dynamic profile
       -> post-migration dynamic profile
  -> blockers (hard vetoes)
  -> versioned pure scorer
  -> admission engine (state machine)
  -> score-prioritized monitoring
  -> Qualified Memes API and UI
  -> replay, calibration, and shadow-policy evaluation
```

The raw event tape is the foundation. Features and scores are derived artifacts and must always be reproducible from a tape prefix ending at an `asOf` timestamp. **Store events, not conclusions** — every future model iteration replays the tape.

## 9. Canonical identity and event tape

### 9.1 Asset identity

Every stored record uses an `assetKey`, not a plain mint:

```text
assetKey = chain + ":" + launchpad + ":" + mint      // e.g. solana:pumpfun:<mint>
```

The full key prevents future cross-chain address collisions and makes the profile explicit.

### 9.2 Required event types

| Event | Required purpose |
|---|---|
| `token_created` | creator, curve address, initial buy, supply, launch metadata |
| `trade_observed` | side, wallet, raw SOL/token amounts, price state, curve state, transaction identity |
| `baseline_closed` | why Stage A baseline collection ended (`window` vs `min_swaps`), swaps observed, duration — the right-censoring indicator |
| `migration_observed` | migration timestamp, destination pool, fixed anchor market cap |
| `holder_snapshot` | supply, resolved system accounts, top holders, dev balance |
| `funding_link` | funded wallet, funder, amount, source transaction, confidence |
| `market_snapshot` | price, market cap, liquidity, interval volume, data source |
| `sell_route_check` | route status, venue, amount tested, timestamp |
| `score_evaluated` | score version, causal feature snapshot ID, result |
| `admission_changed` | prior state, new state, reason, alert price and timestamp |

### 9.3 Event envelope

```js
{
  eventId,           // globally unique, deterministic where possible
  assetKey,          // chain:launchpad:mint
  type,
  chainTs,           // authoritative chain/effective time (used for causal reads)
  receivedAt,        // local ingestion time (observability only)
  slot,
  signature,
  instructionIndex,
  source,
  schemaVersion,
  payload            // exact units: lamports & raw token units as integers/decimal strings
}
```

### 9.4 Tape invariants

- **Append-only**: corrections are new events, never silent mutation.
- **Idempotent**: unique `(source, signature, instructionIndex)` identity prevents reconnect duplicates.
- **Causal**: live and replay extractors accept the same event prefix and the same `asOf` time.
- **Ordered**: chain time and receive time are both retained; out-of-order arrivals handled explicitly.
- **Exact units**: lamports and raw token units stored as integers or exact decimal strings, never floating-point SOL.
- **Resumable**: ingestion records checkpoints and resubscribes after disconnects.
- **Observable**: lag, dropped events, duplicate rate, reconnects, and parse failures are measured.

A Postgres-compatible event store is the recommended target (time-series extensions optional). **JSON files are not suitable** as the permanent tape at Pump.fun event volume. The implementation plan decides database and retention policy.

### 9.5 Corrected tape contract

> Fixes §23 items: event identity uses `assetKey` + idempotency (not `token_mint` alone); `chainTs`/`receivedAt` preserved separately (not `Date.now()` as event time); reads are `await`ed and causal on chain/effective time.

```js
// backend/src/tape/tape.js
// Store EVENTS, never conclusions. Features are recomputable; raw events are not.
export class Tape {
  constructor(db) { this.db = db; }   // Postgres/Timescale: hypertable on chainTs

  // Idempotent append: reconnect duplicates collapse on (source, signature, instructionIndex).
  async append(e) {
    await this.db.query(
      `INSERT INTO events
         (event_id, asset_key, type, chain_ts, received_at, slot, signature,
          instruction_index, source, schema_version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (source, signature, instruction_index) DO NOTHING`,
      [e.eventId, e.assetKey, e.type, e.chainTs, e.receivedAt, e.slot, e.signature,
       e.instructionIndex, e.source, e.schemaVersion, JSON.stringify(e.payload)]);
  }

  // Causal read: replay must NEVER see events after asOf. Filter on chain/effective time,
  // NOT receivedAt. This is the lookahead guard for FEATURES (labels may see the future — §19).
  async eventsUntil(assetKey, asOfChainTs, types = null) {
    const t = types ? `AND type = ANY($3)` : "";
    const params = types ? [assetKey, asOfChainTs, types] : [assetKey, asOfChainTs];
    const { rows } = await this.db.query(
      `SELECT * FROM events
        WHERE asset_key=$1 AND chain_ts<=$2 ${t}
        ORDER BY chain_ts, slot, instruction_index`, params);
    return rows;
  }
}
```

## 10. Collection strategy and monitoring budget

Trade collection cannot begin only after a token passes the structural gate — the gate itself requires trades. The accepted design is staged.

- **Stage A — unbiased baseline.** Collect creations, migrations, and enough early trade events for **every** observed Pump.fun token to compute initial capital formation and maintain an unbiased replay sample. Prefer a provider-wide stream; if only per-token subscriptions exist, subscribe every new token for a short baseline window or until a minimum swap count is reached. **When the window closes, emit a `baseline_closed` event recording which condition fired.** A token cut at 30 swaps is not "missing `swaps_to_100pct`" — it is **right-censored**, and "failed to reach 30 swaps within T seconds" is itself a causal signal. Feature extraction must read `baseline_closed`; without it, capital formation is biased toward fast tokens and replay cannot measure the bias.
- **Stage B — cheap preliminary allocation.** After ≥ 5 observed buys, compute only legitimately available features. Use this preliminary evidence to allocate holder and funding-graph RPC work. **Do not call this a qualified score.**
- **Stage C — hot monitoring.** Continue high-frequency monitoring for the best provisional, qualified, manually tracked, and position-linked tokens. Keep a **random control sample** of low-ranked tokens so replay data is not fully selected by the current gate.

**Control-sample depth rule (non-negotiable).** Control-sample tokens must receive **identical monitoring depth** to hot tokens, sized at **5–10% of launches**. Shallower polling of control tokens leaves their post-migration labels incomplete, which makes selection bias unmeasurable *by construction* — defeating the entire purpose of the control. This RPC cost is the price of being able to measure the gate's own error rate.

**Capacity rule.** The hot limit applies only to *evictable* candidates. Qualified, manually tracked, and open-position tokens sit outside that capacity and may never be removed by a final array slice. Eviction stops expensive monitoring but does not delete persisted events or aggregates.

### 10.1 Corrected ingestion contract

> Fixes §23 items: trades are collected in an unbiased baseline for all launches (not only after a trade-dependent gate); event time comes from the chain, with `receivedAt` recorded separately; amounts are kept exact.

```js
// backend/src/discovery/pumpfun.js
// Without trades: no capital efficiency, no bot share, no flow, no retention.
import WebSocket from "ws";

export function subscribePumpFun(tape, budget) {
  const ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.on("open", () => {
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeMigration" }));
    // Stage A: subscribe EVERY new token's trades for a short baseline window / min-swap count.
    // Stage C promotes only budget-approved tokens to sustained hot monitoring.
  });

  ws.on("message", async (raw) => {
    const m = JSON.parse(raw.toString());
    const assetKey = `solana:pumpfun:${m.mint}`;
    // chainTs from the event; receivedAt is local and used only for observability.
    const base = {
      assetKey, source: "pumpportal", schemaVersion: 1,
      chainTs: m.blockTime ?? null,          // resolve to chain/effective time; never Date.now()
      receivedAt: nowMonotonic(),            // injected clock — not Date.now() in replay
      slot: m.slot ?? null, signature: m.signature ?? null,
      instructionIndex: m.instructionIndex ?? 0,
    };
    if (m.txType === "create") {
      await tape.append({ ...base, eventId: idOf(base), type: "token_created",
        payload: { creator: m.traderPublicKey, curve: m.bondingCurveKey,
                   initialBuyLamports: toLamports(m.solAmount), rawSupply: m.rawSupply,
                   decimals: m.decimals } });
      // Stage A window opens. budget fires onBaselineClose(reason, swapsObserved, durationMs)
      // when EITHER the window elapses OR min-swaps is reached — recording the censoring reason.
      budget.registerBaseline(assetKey, async (close) =>
        tape.append({ ...base, chainTs: close.ts, eventId: idOf({ ...base, type: "baseline_closed" }),
          type: "baseline_closed",
          payload: { reason: close.reason /* "window" | "min_swaps" */,
                     swapsObserved: close.swapsObserved, durationMs: close.durationMs } }));
    }
    if (m.txType === "buy" || m.txType === "sell") {
      await tape.append({ ...base, eventId: idOf(base), type: "trade_observed",
        payload: { side: m.txType, wallet: m.traderPublicKey,
                   lamports: toLamports(m.solAmount), rawTokens: BigInt(m.tokenAmountRaw),
                   vSolInCurveLamports: toLamports(m.vSolInBondingCurve) } });
    }
    if (m.txType === "migrate") {
      await tape.append({ ...base, eventId: idOf(base), type: "migration_observed",
        payload: { pool: m.pool, anchorMcap: m.anchorMcap /* supply-aware, set ONCE */ } });
    }
  });
  return ws;
}
```

## 11. Lifecycle and scoring regimes

### 11.1 Admission states

| State | Meaning |
|---|---|
| `unscored` | Unsupported chain/launchpad or no calibrated profile |
| `watching` | Supported token, but evidence or score is insufficient |
| `provisional` | Exceptional early evidence; short-lived and **not** equivalent to qualified |
| `qualified` | Passed an admission path with no blockers |
| `rejected` | A hard blocker fired |
| `expired` | Monitoring window ended without qualification |

### 11.2 Regimes

- `pump-curve`: creation through migration or terminal curve failure.
- `post-migration`: begins from one immutable migration snapshot and anchor market cap.

Structural facts are **not** represented by one mutable object. Each score evaluation references an **immutable feature snapshot**. Expensive actor/holder features may be frozen for an admission decision while trade-derived evidence keeps evolving. A later blocker (e.g. dev selling) can invalidate a previously qualified token.

## 12. Feature specification

To control overfitting at the expected sample size, the first calibrated model uses **no more than ten effective feature families**. Closely correlated raw values are combined inside one family rather than getting independent top-level weights.

### 12.1 Structural block (frozen at gate)

| Family | Raw evidence | Accepted computation | Initial role |
|---|---|---|---|
| Capital formation | curve state and all swaps | progress-conditioned swap efficiency + swaps-to-25/50/75/100% milestones; higher progress per swap and fewer swaps are better | High weight |
| Organic routing | transaction instruction patterns | validated frontend/manual share with sample count and classifier version | High weight **only after validation** |
| Coordinated ownership | buyers, funders, balances, timing | maximum suspicious connected-component supply share after excluding known CEX/router behavior | High weight / blocker |
| Visible ownership | resolved token accounts and supply | top-10 share excluding precisely identified curve/pool/burn/program accounts; dev share reported separately | Medium weight / blocker |
| Creator prior | creator-cluster history available before creation | shrinkage-adjusted rug/graduation/ATH/sell-timing history with sample size | Low weight |

Collected as **experimental diagnostics with zero initial weight**: creator initial buy (sign may mean conviction or dump inventory); raw fresh-wallet count (CEX-funded/low-history wallets can be misclassified); smart-wallet presence (weak and non-monotonic without lifecycle). Freshness and low-history must remain **separate** definitions — rich profiling may add a `lowHistoryShare` but must not retroactively change the count of wallets younger than the configured age.

#### 12.1.1 Capital formation — corrected contract

> Fixes §23 items: milestones computed in **one chronological pass** (the original re-accumulated `cum` while restarting `findIndex`); progress-conditioned efficiency is primary, gross ratio is a diagnostic; both buys and sells plus curve reserve state retained; `unknown ≠ zero`.

```js
// backend/src/features/capitalFormation.js
// HIGHER curve-progress-per-swap = better; FEWER swaps to a milestone = better.
export function capitalFormation(trades, curveTargetSol) {
  const buys = trades.filter(t => t.side === "buy");
  if (buys.length < 5) return { primary: null, coverage: 0 };   // unknown ≠ zero

  // ONE chronological pass. cumSol accumulates once; each milestone is recorded on first crossing.
  const fracs = [0.25, 0.5, 0.75, 1.0];
  const milestones = {}; let fi = 0, cumSol = 0;
  buys.forEach((t, i) => {
    cumSol += t.solLamports;
    while (fi < fracs.length && cumSol >= curveTargetSol * fracs[fi]) {
      milestones[`swaps_to_${fracs[fi] * 100}pct`] = i + 1; fi++;
    }
  });
  for (; fi < fracs.length; fi++) milestones[`swaps_to_${fracs[fi] * 100}pct`] = null;

  // Primary feature: efficiency conditioned on how far the curve actually progressed.
  const curveProgress = Math.min(1, cumSol / curveTargetSol);
  const primary = curveProgress / buys.length;          // progress per observed swap

  return {
    primary,                                             // scored family value
    milestones,
    coverage: 1,
    diagnostics: {                                       // NOT scored — distortable by one whale buy / sells
      grossSolPerBuy: cumSol / buys.length,
      solRaisedLamports: cumSol, swapCount: buys.length,
      sellCount: trades.length - buys.length,
    },
  };
}
```

#### 12.1.2 Non-bot classifier — corrected contract

> Fixes §23 item: the classifier is `experimental` until validated against labeled transactions; it contributes **no score** and cannot trigger `BOT_FLOW` before validation; the 30% threshold and 30-trade minimum apply only after validation.
>
> **Ground-truth labels (must be named in the plan, not left to "labeled transactions"):**
> - **Bot labels:** wallets inside Jito bundles; known trading-bot program IDs; repeat first-block buyers across ≥ 3 launches.
> - **Manual labels:** long multi-protocol histories with CEX funding and no bundle interaction.
> - **Excluded from the validation set:** everything else (ambiguous) — do not force-label it.
>
> `BOT_FLOW` is armed only once the classifier clears a **predeclared precision floor** on this labeled set. Recall is reported but the arming gate is precision (a false `BOT_FLOW` block is the costly error).

```js
// backend/src/features/nonBotShare.js
export function nonBotShare(trades, classifier) {
  const n = trades.length;
  const contract = {
    share: null, sampleSize: n,
    classifierVersion: classifier.version,
    classifierStatus: classifier.status,          // "experimental" | "validated"
    precision: classifier.precision ?? null,
    recall: classifier.recall ?? null,
  };
  if (classifier.status !== "validated") return contract;      // display only, never scored/blocked
  if (n < 30) return { ...contract, evidence: "insufficient" }; // insufficient ≠ block
  const manual = trades.filter(t => classifier.isFrontendRouted(t)).length;
  return { ...contract, share: manual / n, evidence: "sufficient" };
}
```

#### 12.1.3 Coordinated ownership (funder graph) — corrected contract

> Fixes §23 items: uses **actual raw supply + decimals** (not a fixed 1e9 denominator); classifies suspicious components and excludes known CEX/router services; primary risk value is the **maximum** suspicious component's supply share (summing every multi-wallet component would create false positives). Slot-based bundling is replaced because the observed farm spread buys until top-10 read only 18%.

```js
// backend/src/features/funderGraph.js
class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x);
    const r = this.p.get(x); return r === x ? r : (this.p.set(x, this.find(r)), this.p.get(x)); }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

export async function bundleClusters(
  { buyers, creationTs, rawBalanceOf, rawSupply, fundingSourceFor, isKnownService }, cfg) {
  const uf = new UnionFind(); const funderOf = new Map();
  for (const w of buyers) {
    const funder = await fundingSourceFor(w, creationTs - cfg.funderLookbackMs, creationTs);
    // Unknown / known-service funders do NOT link wallets — a shared CEX is not coordination.
    funderOf.set(w, (funder && !isKnownService(funder)) ? funder : `self:${w}`);
    uf.union(w, funderOf.get(w));
  }

  const clusters = new Map();  // root -> { wallets, rawSupply, timings:[], funder }
  for (const w of buyers) {
    const root = uf.find(funderOf.get(w));
    if (!clusters.has(root)) clusters.set(root, { wallets: 0, raw: 0n, funder: root });
    const c = clusters.get(root);
    c.wallets++; c.raw += rawBalanceOf(w);          // BigInt raw units — never 1e9 SOL floats
  }

  // A component is "suspicious" only with supporting evidence: >1 wallet AND a non-service
  // shared funder (narrow timing / related amounts / same-slot may strengthen this — added by caller).
  const suspicious = [...clusters.values()].filter(c => c.wallets > 1 && !isKnownService(c.funder));
  const share = raw => Number(raw) / Number(rawSupply);
  const maxSuspicious = suspicious.reduce((m, c) => Math.max(m, share(c.raw)), 0);

  return {
    clusterCount: clusters.size,
    maxSuspiciousComponentPct: maxSuspicious,        // PRIMARY risk value → FARM blocker
    unionSuspiciousPct: suspicious.reduce((s, c) => s + share(c.raw), 0), // diagnostic only
  };
}
```

#### 12.1.4 Visible ownership (top-10 ex-LP) — corrected contract

> Fixes §23 items: system accounts identified by **fetched account authority / known PDA-vault relationships**, never by size (fixes the "blindly skip the largest holder" hack); Token Program ownership alone is not an exclusion because normal token accounts share that owner.

```js
// backend/src/features/topHolders.js
// KNOWN_EXCLUDED: pump.fun curve PDA, Raydium/AMM vaults, burn address — resolved, not guessed.
export async function top10ExLp(rpc, mint, resolvers) {
  const { rawSupply } = await rpc.getMintInfo(mint);          // supply-aware, not 1e9
  const accounts = await rpc.getTokenLargestAccounts(mint);   // raw amounts

  const held = [];
  for (const a of accounts) {
    // getTokenLargestAccounts does NOT tell us the authority — resolve it explicitly.
    const info = await rpc.getAccountAuthority(a.address);     // owner authority + PDA class
    if (resolvers.isCurvePool(info) || resolvers.isAmmVault(info) ||
        resolvers.isBurn(a.address)) continue;                 // excluded system account
    held.push(a);
    if (held.length === 10) break;
  }
  const heldRaw = held.reduce((s, a) => s + a.rawAmount, 0n);
  return { top10ExLpPct: Number(heldRaw) / Number(rawSupply), resolvedExclusions: true };
}
```

#### 12.1.5 Fresh wallets — corrected contract

> Fixes §23 item: freshness (age-only) and low-history profiling are **separate** features; rich profiling adds `lowHistoryShare` and must never mutate the count of wallets younger than the configured age.

```js
// backend/src/features/freshWallets.js
export async function freshWalletFeature(buyers, walletAge, richProfile, cfg) {
  let fresh = 0; const boundary = [];
  for (const w of buyers) {
    const age = await walletAge(w);                // batched RPC: oldest signature
    if (age < cfg.freshAgeMs) fresh++;
    else if (age < cfg.freshAgeMs * 2) boundary.push(w);
  }
  const feature = { freshCount: fresh, freshShare: buyers.size ? fresh / buyers.size : null };

  // Ambiguous zone → OPTIONAL richer signal, reported as its OWN field. freshCount is untouched.
  const [lo, hi] = cfg.freshBoundary;
  if (fresh >= lo && fresh <= hi) {
    const profiles = await Promise.all(boundary.map(richProfile));
    const lowHistory = profiles.filter(p =>
      p.txCount < 10 && p.fundingSources === 1 && !p.hasDefiHistory).length;
    feature.lowHistoryShare = boundary.length ? lowHistory / boundary.length : null; // separate feature
  }
  return feature;                                  // both start at ZERO score weight (experimental)
}
```

#### 12.1.6 Creator prior — corrected contract

> Devs rotate wallets → identity links via funding-source tracing. History is shrinkage-adjusted toward the base rate at low sample size; "rug" is defined from the price series, not vibes.

```js
// backend/src/features/devFingerprint.js
export async function devFingerprint(creatorWallet, tape, fundingSourceFor, baseRates, cfg) {
  const rootFunder = await fundingSourceFor(creatorWallet, 0, Infinity);
  const past = await tape.launchesByCreatorCluster([creatorWallet, rootFunder]);
  if (!past.length) return { known: false, coverage: 0 };

  const rug = L => L.maxMcap && L.finalMcap < L.maxMcap * 0.1 &&
                   (L.collapseTs - L.athTs) < cfg.rugWindowMs;   // defined, not vibes
  const n = past.length;
  const shrink = (k) => (k + baseRates.prior * cfg.shrinkStrength) / (n + cfg.shrinkStrength);

  return {
    known: true, launches: n, coverage: Math.min(1, n / cfg.devConfidentN),
    rugRate: shrink(past.filter(rug).length),                    // shrinkage-adjusted
    graduationRate: shrink(past.filter(L => L.migrationTs).length),
    medianAthMcap: median(past.map(L => L.maxMcap).filter(Boolean)),
    medianDevFirstSellMs: median(past.map(L => L.devFirstSellTs && L.devFirstSellTs - L.creationTs)
                                     .filter(Boolean)),
  };
}
```

### 12.2 Curve dynamic profile

| Family | Computation |
|---|---|
| Flow health | fixed one-minute buy-SOL / sell-SOL buckets with minimum activity requirements |
| Unique participation | new unique buyers and buyer growth per fixed window |
| Cohort retention | token-unit sell-through for wallets entering during a defined early window |
| Drawdown health | robust dump state, curve/liquidity drawdown, and recovery state |
| Smoothed momentum | normalized percentage velocity and acceleration per minute |

### 12.3 Post-migration dynamic profile

| Family | Computation |
|---|---|
| Flow health | state machine over same-length flow windows with activity minimums |
| Efficiency analogs | volume/trade, buy-volume/unique-buyer, and market-cap-change/new-buyer, calibrated **only within the post-migration cohort** |
| Cohort retention | token-unit retention and partial sell-through |
| ATH and anchor health | gain from immutable migration anchor, ATH distance, and ATH age |
| Smoothed momentum | normalized market-cap, flow, and buyer velocity/acceleration |
| Smart-wallet lifecycle | entered / held / added / reduced / exited; low maximum weight |

Curve and post-migration profiles require **separate** enabled features, normalizers, and weights. A single dynamic weight table cannot serve both regimes.

#### 12.3.1 Windowing — corrected contract

> Fixes §23 item: one canonical window; incomplete current bucket flagged `partial` so scoring never treats it as complete.

```js
// backend/src/features/windows.js
export function bucketize(trades, windowMs, fromTs, toTs, nowTs) {
  const buckets = new Map();
  for (const t of trades) {
    if (t.chainTs < fromTs || t.chainTs > toTs) continue;
    const w = Math.floor(t.chainTs / windowMs) * windowMs;
    if (!buckets.has(w)) buckets.set(w, { buySol: 0, sellSol: 0, buys: 0, sells: 0, wallets: new Set() });
    const b = buckets.get(w);
    if (t.side === "buy") { b.buySol += t.solLamports; b.buys++; }
    else                  { b.sellSol += t.solLamports; b.sells++; }
    b.wallets.add(t.wallet);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([w, b]) => ({
    windowStart: w, buySol: b.buySol, sellSol: b.sellSol, buys: b.buys, sells: b.sells,
    wallets: b.wallets.size,
    partial: (w + windowMs) > nowTs,          // current bucket is incomplete — do not score as full
  }));
}
```

#### 12.3.2 Immutable snapshots — corrected contract

> Fixes §23 items: snapshots are **immutable** (new state = new object — fixes the mutate-then-compare bug that killed dormant-spike detection); market cap is **supply-aware**; the migration anchor is set **once** and never rebased.

```js
// backend/src/features/snapshots.js
export function initSnapshot(migrationTick) {
  return Object.freeze({
    anchorMcap: migrationTick.mcap,     // supply-aware, set ONCE at migration — never rebased
    ath: migrationTick.mcap, athTs: migrationTick.ts,
    ts: migrationTick.ts, mcap: migrationTick.mcap,
    athDistance: 0, athAgeMs: 0, gainVsAnchor: 0,
  });
}

export function reduceSnapshot(prev, tick) {      // tick.mcap MUST be supply-aware (rawSupply·price)
  const isNewAth = tick.mcap > prev.ath;
  return Object.freeze({                          // NEW object — never mutate prev
    ...prev, ts: tick.ts, mcap: tick.mcap,
    ath: isNewAth ? tick.mcap : prev.ath,
    athTs: isNewAth ? tick.ts : prev.athTs,
    athDistance: 1 - tick.mcap / (isNewAth ? tick.mcap : prev.ath),
    athAgeMs: tick.ts - (isNewAth ? tick.ts : prev.athTs),
    gainVsAnchor: tick.mcap / prev.anchorMcap - 1,   // fixed anchor
  });
}
```

#### 12.3.3 Flow state — corrected contract

> Fixes §23 item: the state machine **uses ATH freshness plus minimum activity** (the reverse-engineered cases only reconcile when ATH state is an input); zero-sell buckets are capped for display but retain raw amounts, and a near-empty bucket cannot become bullish on a mathematically high ratio.

```js
// backend/src/features/flowState.js
// Labels: INSUFFICIENT | SELL_PRESSURE | RECOVERING | STABLE_AT_HIGHS | STABLE | MIXED
export function flowState({ flowSeries, athDistance, athAgeMs, buckets }, cfg) {
  const active = buckets.slice(-flowSeries.length).filter(b =>
    !b.partial && (b.buys + b.sells) >= cfg.minTrades && (b.buySol + b.sellSol) >= cfg.minVolLamports);
  if (active.length < 2) return { label: "INSUFFICIENT", bullish: null };  // near-empty ≠ bullish

  const last = flowSeries.at(-1), prev = flowSeries.at(-2);
  const allPositive = flowSeries.every(f => f > 1);
  if (last < 1 && prev < 1)                                   return { label: "SELL_PRESSURE", bullish: false };
  if (athDistance > cfg.athNearBand && last > 1 && last >= prev)
                                                              return { label: "RECOVERING", bullish: true };
  if (athDistance <= cfg.athNearBand && allPositive)          return { label: "STABLE_AT_HIGHS", bullish: true };
  if (allPositive)                                            return { label: "STABLE", bullish: true };
  return { label: "MIXED", bullish: null };
}

export function flowSeriesFrom(buckets, n) {
  return buckets.filter(b => !b.partial).slice(-n).map(b =>
    b.sellSol === 0 ? (b.buySol > 0 ? cfg.zeroSellDisplayCap : 1) : b.buySol / b.sellSol); // raw retained upstream
}
```

#### 12.3.4 Efficiency analogs — corrected contract

> Post-migration, SOL-raised is ~constant across graduates → the paper's headline predictor collapses. These are its live equivalents; within-cohort predictive power is an **open empirical question** — re-estimate, do not transplant the paper's effect size.

```js
// backend/src/features/efficiencyAnalogs.js
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

#### 12.3.5 Cohort retention — corrected contract

> Fixes §23 item: a wallet that sells one token is **not** a full exit. Retention uses token-unit net positions with partial/full bands.

```js
// backend/src/features/cohortRetention.js
export function cohortRetention(trades, t0, entryMs, checkMs, rawBoughtByWallet) {
  const cohort = new Set(trades.filter(t =>
    t.side === "buy" && t.chainTs >= t0 && t.chainTs <= t0 + entryMs).map(t => t.wallet));
  if (cohort.size < 5) return null;

  const net = new Map();  // wallet -> raw token net position at checkMs
  for (const w of cohort) net.set(w, rawBoughtByWallet.get(w) ?? 0n);
  for (const t of trades) {
    if (t.chainTs > t0 + checkMs || !cohort.has(t.wallet)) continue;
    if (t.side === "sell") net.set(t.wallet, net.get(t.wallet) - t.rawTokens);
  }
  const positions = [...cohort].map(w => ({ w, bought: rawBoughtByWallet.get(w) ?? 0n, held: net.get(w) }));
  const fullyExited  = positions.filter(p => p.held <= 0n).length;
  const partiallySold = positions.filter(p => p.held > 0n && p.held < p.bought).length;
  const remainingRaw  = positions.reduce((s, p) => s + (p.held > 0n ? p.held : 0n), 0n);
  const boughtRaw     = positions.reduce((s, p) => s + p.bought, 0n);
  return {
    cohortSize: cohort.size, fullyExited, partiallySold,
    remainingTokenPct: boughtRaw ? Number(remainingRaw) / Number(boughtRaw) : null,
    // concentration of remaining inventory reported by caller (HHI over held positions)
  };
}
```

#### 12.3.6 Smoothed derivatives — corrected contract

> Fixes §23 item: velocity/acceleration are **normalized percentage change per minute**, not raw units per millisecond; EMA parameters are versioned config; **no jerk**.

```js
// backend/src/features/derivatives.js
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

## 13. Time-series rules

### 13.1 Canonical windows

All flow ratios use one canonical window length, initially one minute. Larger horizons are aggregates of **complete** canonical buckets. A 24-hour volume value may never be divided by a 5-minute or 1-hour transaction count. Incomplete current buckets are marked `partial`; scoring excludes them or compares them only with similarly partial buckets.

### 13.2 Flow state

Flow state uses buy/sell ratio, minimum volume, minimum trades, ATH distance, and ATH age. Accepted labels: `INSUFFICIENT`, `SELL_PRESSURE`, `RECOVERING`, `STABLE_AT_HIGHS`, `STABLE`, `MIXED`. Zero-sell buckets are capped for display but retain raw buy and sell amounts.

### 13.3 Dump detection

Operates causally on trade-level log returns:

1. Build a baseline from the preceding 30–200 eligible swaps.
2. Compute the median return and median absolute deviation (MAD).
3. Convert MAD to robust sigma with the configured scale factor.
4. Flag a lower-tail break when a new return falls below `median − k·sigma`.
5. Attach the triggering trade, baseline size, return, median, MAD, and threshold.

The research note reports a **four-sigma** rule; any different initial value (e.g. six) must be labeled an engineering placeholder and compared in replay. **Zero-MAD and sparse-price cases require explicit fallback and cannot silently produce a block.**

### 13.4 Retention

Cohort retention uses token-unit net positions or categorized sell-through bands. At minimum report: cohort size; wallets fully exited; wallets partially sold; remaining token percentage; concentration of remaining cohort inventory.

### 13.5 Derivatives

Velocity and acceleration use normalized percentage change per minute. EMA parameters and units live in versioned config. Third derivatives are out of scope.

## 14. Score contract and semantics

```js
{
  version: "meme-score-v2.x",
  assetKey: "solana:pumpfun:<mint>",
  asOf: 0,                                   // chain/effective time of evaluation
  profile: "pump-curve" | "post-migration",
  status: "scored" | "unscored",
  structural: { score: 0, coverage: 0, breakdown: {} },  // breakdown: per-family {value, weight, contribution}
  dynamic:    { score: 0, coverage: 0, breakdown: {} },
  memeScore: 0,                              // ranking index, NOT a probability
  evidenceCoverage: 0,
  blockers: [],
  admission: "watching",
  reasons: [],
  alert: null                                // { price, mcap, ts } when first admitted
}
```

### 14.1 Score math

- Each enabled raw feature is normalized to `[0,1]` using versioned, cohort-specific transforms.
- Correlated raw features are combined **inside a family** before family weights are applied.
- Structural and dynamic scores are weighted means over **available, enabled** families.
- Missing evidence is **not** zero; it reduces coverage.
- Experimental or disabled features are excluded from both score and coverage denominators.
- `memeScore = 0.60·structuralScore + 0.40·dynamicScore` when both blocks exist.
- `evidenceCoverage = 0.60·structuralCoverage + 0.40·dynamicCoverage`.
- Absolute normalizer ranges in the pseudocode are **placeholders**; production transforms are time-fitted, progress/regime-specific empirical bins or monotonic mappings with minimum support and coarse fallback.

### 14.2 Scorer — corrected contract

> Fixes §23 items: `weightedScore` returns a **breakdown** (per-family value + contribution) that the scorer/UI actually read; `creatorInitialBuy` is **disabled and excluded from the denominator** (not a null-valued weight); regimes use **separate** weight tables; EVM/non-Pump.fun returns `unscored`; `unknown ≠ zero`.

```js
// backend/src/scoring/computeMemeScore.js
import { CONFIG } from "./config.js";

export function computeMemeScore(token, structural, dynamic, cfg = CONFIG) {
  if (token.chain !== "solana" || token.launchpad !== "pumpfun")
    return { version: cfg.version, status: "unscored", reason: "no calibrated profile" };

  const profile = token.migrated ? "post-migration" : "pump-curve";
  const dw = cfg.dynamic[profile].weights;                 // SEPARATE registry per regime
  const blockers = evaluateBlockers(token, structural, dynamic, cfg);

  const structuralResult = weightedScore([
    { key: "capitalEfficiency", value: norm(structural.capitalEfficiency, cfg.norm.capEff), weight: cfg.structural.weights.capitalEfficiency },
    { key: "milestoneSpeed",    value: normInv(structural.milestones?.swaps_to_100pct, cfg.norm.milestone), weight: cfg.structural.weights.milestoneSpeed },
    { key: "nonBotShare",       value: structural.nonBotShare /* null unless validated */, weight: cfg.structural.weights.nonBotShare },
    { key: "bundleCluster",     value: inv(structural.maxSuspiciousComponentPct), weight: cfg.structural.weights.bundleCluster },
    { key: "top10ExLp",         value: inv(structural.top10ExLpPct), weight: cfg.structural.weights.top10ExLp },
    { key: "devPrior",          value: structural.devFingerprint?.known ? 1 - structural.devFingerprint.rugRate : null, weight: cfg.structural.weights.devPrior },
    // creatorInitialBuy, rawFreshCount, smartPresence: DISABLED (weight 0) → excluded from denominator.
  ]);

  const dynamicResult = weightedScore([
    { key: "flowState", value: dynamic.flowState?.bullish == null ? null : (dynamic.flowState.bullish ? 1 : 0), weight: dw.flowState },
    { key: "efficiencyAnalogs", value: norm(dynamic.efficiency?.volPerTrade, cfg.norm.volPerTrade), weight: dw.efficiencyAnalogs },
    { key: "cohortRetention", value: dynamic.retention?.remainingTokenPct ?? null, weight: dw.cohortRetention },
    { key: "athHealth", value: inv(dynamic.snapshot?.athDistance), weight: dw.athHealth },
    { key: "derivatives", value: norm(dynamic.derivatives?.velocity, cfg.norm.velocity), weight: dw.derivatives },
    { key: "smartLifecycle", value: dynamic.smartLifecycleScore ?? null, weight: dw.smartLifecycle },
  ]);

  const memeScore = (structuralResult.score != null && dynamicResult.score != null)
    ? Math.round(0.60 * structuralResult.score + 0.40 * dynamicResult.score) : null;
  const evidenceCoverage = Math.round(
    (structuralResult.coverage * 0.60 + dynamicResult.coverage * 0.40) * 100);

  return { version: cfg.version, assetKey: token.assetKey, asOf: token.asOf, profile,
           status: "scored", structural: structuralResult, dynamic: dynamicResult,
           memeScore, evidenceCoverage, blockers };
}

// Weighted mean over AVAILABLE, ENABLED inputs only. Missing data lowers coverage; NEVER becomes zero.
// Returns per-family breakdown so nothing downstream reads a field this function never produced.
function weightedScore(inputs) {
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

const norm    = (v, [lo, hi]) => v == null ? null : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
const normInv = (v, r) => v == null ? null : 1 - norm(v, r);
const inv     = v => v == null ? null : 1 - v;
```

## 15. Hard blockers

Every blocker contains a code, source evidence, timestamp, feature version, and whether it is reversible.

| Code | Initial rule | Notes |
|---|---|---|
| `DUMP` | Confirmed robust lower-tail dump | Requires sufficient price history |
| `HONEYPOT` | Supported venue confirms sell failure | "Not indexed yet" is unknown, not failure. Bounded rechecks: after N failed verifications over T minutes, route to `BAD_DATA` (persistent unknown) — never re-probe forever |
| `LIQ_COLLAPSE` | Fractional drop > 0.70 from valid peak | Units fixed as fraction `[0,1]` |
| `BOT_FLOW` | Validated non-bot share < 0.30 with ≥ 30 trades | **Disabled until classifier validation** |
| `FARM` | Suspicious funding cluster controls more than placeholder threshold | Default 0.50, uncalibrated |
| `DEV_CONCENTRATION` | Creator cluster controls more than placeholder threshold | Default 0.20, uncalibrated |
| `DEV_SELL` | Creator/linked dev cluster sells before configured safe state | Severity may depend on amount |
| `BAD_DATA` | Stale, inconsistent, non-causal, or impossible market state | Blocks decisions, not necessarily the token permanently |

Unknown evidence **never** creates a blocker. A later blocker immediately removes a qualified token from the main list and emits an invalidation event.

### 15.1 Blockers — corrected contract

> Fixes §23 items: proportions standardized as fractions in `[0,1]`; `BOT_FLOW` only fires on a **validated** classifier with sufficient sample; `DEV_SELL` present; every blocker carries `reversible` and evidence.

```js
// backend/src/scoring/blockers.js
export function evaluateBlockers(token, s, d, cfg) {
  const b = []; const B = cfg.blockers;
  const push = (code, reversible, evidence) => b.push({ code, reversible, evidence, ts: token.asOf, version: cfg.version });

  if (d.dumpConfirmed)                         push("DUMP", false, { sigma: d.dumpSigma, k: B.madK });
  // HONEYPOT is reversible ONLY while rechecks remain. "Not indexed yet" can recur forever;
  // each recurrence re-blocks the token → a blocked/eligible livelock. Cap the probing.
  if (token.sellRouteVerified === false) {
    if (token.sellRouteChecks < B.honeypotMaxChecks &&
        (token.asOf - token.sellRouteFirstCheckTs) < B.honeypotStaleMs)
      push("HONEYPOT", true, { venue: token.sellRouteVenue, checks: token.sellRouteChecks });
    else
      push("BAD_DATA", true, { reason: "honeypot_unverifiable", checks: token.sellRouteChecks });
  }
  if (d.liquidityDropFrac > B.liquidityCollapseFrac) push("LIQ_COLLAPSE", false, { drop: d.liquidityDropFrac }); // [0,1]

  // ONLY with a validated classifier AND sufficient sample. Experimental/insufficient ≠ block.
  if (s.nonBotClassifierStatus === "validated" && s.nonBotEvidence === "sufficient" &&
      s.nonBotShare < B.nonBotMinShare)        push("BOT_FLOW", false, { share: s.nonBotShare });

  if (s.maxSuspiciousComponentPct > B.farmFrac) push("FARM", false, { pct: s.maxSuspiciousComponentPct });
  if (s.devHoldFrac > B.devConcentrationFrac)  push("DEV_CONCENTRATION", false, { pct: s.devHoldFrac });
  if (d.devSellBeforeSafeState)                push("DEV_SELL", false, { ms: d.devFirstSellMs });
  if (d.staleData || d.inconsistentData)       push("BAD_DATA", true, { reason: d.dataIssue });
  return b;
}
```

## 16. Admission policy

All numeric values are **shadow-mode placeholders**. They must be versioned and calibrated before automation.

### 16.1 Combined qualification — a token becomes `qualified` when all hold

- no blocker;
- `memeScore >= 75`;
- structural score `>= 70`;
- dynamic score `>= 60`;
- evidence coverage `>= 75`;
- both blocks satisfy their profile-specific minimum required families.

### 16.2 Exceptional momentum qualification (research-supported fast, organic curve case)

- capital-formation family score `>= 90`;
- **validated** non-bot share `>= 0.50` from ≥ 30 classified trades;
- structural score `>= 70`; dynamic score `>= 50`; `memeScore >= 70`; evidence coverage `>= 70`;
- no blocker.

If classifier evidence or the minimum trade sample is unavailable, this path cannot fully qualify.

### 16.3 Provisional state (single exceptional metric → never `qualified`)

- capital-formation family score `>= 90`; ≥ 10 observed swaps; sufficient data integrity; no known blocker.
- Expires after **ten minutes** unless the token qualifies, is renewed by a new versioned evaluation, or is rejected. The UI must visually distinguish it from Qualified Memes.

### 16.4 Remaining transitions

- A blocker → `rejected`. Unsupported scope → `unscored`. Supported-but-not-passing → `watching`. Leaving the monitoring horizon without qualifying → `expired` (tape remains available).

### 16.5 Admission — corrected contract

> Fixes §23 item: paths keyed off the `memeScore` contract and the family breakdown that `weightedScore` actually returns; provisional TTL enforced; classifier gate respected.

```js
// backend/src/scoring/admission.js
export function admit(score, token, cfg) {
  if (score.status === "unscored") return "unscored";
  if (score.blockers.length) return "rejected";
  const A = cfg.admission;
  const s = score.structural.score, d = score.dynamic.score, m = score.memeScore;
  if (s == null || d == null || m == null) return "watching";
  const capEff = score.structural.breakdown?.capitalEfficiency?.value ?? null; // real field now

  // Path 1: combined
  if (m >= A.combined.meme && s >= A.combined.structural && d >= A.combined.dynamic &&
      score.evidenceCoverage >= A.combined.coverage) return "qualified";

  // Path 2: exceptional momentum — requires VALIDATED bot share + min classified sample
  if (capEff != null && capEff >= 0.90 &&
      token.structural.nonBotClassifierStatus === "validated" &&
      token.structural.nonBotShare >= 0.50 && token.structural.classifiedTrades >= 30 &&
      s >= A.momentum.structural && d >= A.momentum.dynamic &&
      m >= A.momentum.meme && score.evidenceCoverage >= A.momentum.coverage) return "qualified";

  // Single strong metric → provisional only (short-lived; TTL enforced by lifecycle loop)
  if (capEff != null && capEff >= 0.90 && token.structural.swapCount >= A.provisional.minSwaps)
    return "provisional";

  return "watching";
}
```

## 17. Score-prioritized monitoring and retention

> Fixes §23 item: the hot-capacity slice applies **only to evictable** records; qualified, tracked, and open-position tokens are outside the cap and can never be sliced away. Eviction stops monitoring, not history.

```js
// backend/src/discovery/monitoringQueue.js
export function prioritize(tokens, cfg) {
  const protectedT = tokens.filter(t => !canEvict(t));               // outside the cap entirely
  const evictable = tokens.filter(canEvict)
    .sort((a, b) => (b.score?.memeScore ?? -1) - (a.score?.memeScore ?? -1));
  return [...protectedT, ...evictable.slice(0, cfg.hotLimit)];       // slice ONLY the evictable set
}
function canEvict(t) {
  return !(t.admission === "qualified" || t.tracked || t.hasOpenPosition);
}
// Aggregates for evicted tokens persist as lightweight DB rows: eviction loses monitoring, not the tape.
```

## 18. API and UI requirements

### 18.1 Backend ownership

The backend is the only authority for scores and admission. The frontend must not duplicate `matches(token)` predicates or independently decide whether a token qualifies.

### 18.2 Feeds

1. **Qualified Memes** — admitted tokens ranked by score, then recency.
2. **Provisional / Watching** — an optional research view, not a strategy.
3. **All Discovered** — an optional diagnostic feed.

Risk reasons live in the token evidence panel, not a separate strategy tab. Custom boolean strategies may remain only behind an advanced/debug surface and must not be confused with the production score.

### 18.3 Token presentation

Each token row/detail shows: Meme Score, structural score, dynamic score; evidence coverage labeled **coverage, not confidence of profit**; regime and score version; admission reason and alert age; blocker/invalidation state; top positive and negative evidence; unavailable/experimental features; last chain event and last market-update timestamps.

The API must be **paginated**. The main list cannot be silently truncated to the newest 300 records.

## 19. Replay and calibration

### 19.1 Causal replay

Live and replay paths call the **same** feature extractor. A feature evaluated at `asOf = t` may read only events with chain/effective timestamps ≤ t. Derived lifecycle labels that require future data may be **outcomes** but never live features. Keep live lifecycle stages coarse (curve / active / terminal) or use proper changepoint detection — "expansion" is a lookahead trap.

### 19.2 Labels and features — corrected contract

> Fixes §23 items: tape reads are `await`ed; the label simulates a **causal fixed execution policy** with **multiplicative** cost application (not "ideal peak minus one percent"); market cap is **supply-aware**; features and labels share one extractor.

```js
// backend/src/calibration/labels.js
// FEATURES are strictly causal (asOf). LABELS may see the future ON PURPOSE — they are built
// offline after the horizon closes. The distinction is the whole point.
export async function buildLabel(tape, assetKey, alert, cfg) {
  const horizon = alert.ts + cfg.policy.evalHorizonMs;
  const trades = await tape.eventsUntil(assetKey, horizon, ["trade_observed"]);   // awaited

  // Dead-token guard: no trades after the alert. Math.max(...[]) is -Infinity, which would
  // poison y_peak_opportunity and any downstream aggregate. These are exactly the tokens the
  // policy label must classify as "went nowhere" — return an explicit failed label, not garbage.
  const futureTrades = trades.filter(t => t.chainTs >= alert.ts);
  if (!futureTrades.length) return {
    y_policy_net_positive: false, y_policy_net_return: -1,
    y_peak_opportunity: null, y_hit_market_cap: false, y_dead: true,
  };

  const entry = simulateEntry(futureTrades, alert, cfg.policy);  // latency + entry slippage, multiplicative
  if (!entry) return null;
  const exit = simulateExitLadder(futureTrades, entry, cfg.policy); // ladder + invalidation + time stop
  const netReturn = exit.proceedsMultiple - 1;                // costs already applied multiplicatively

  const peak = Math.max(...futureTrades.map(supplyAwareMcapOf));
  return {
    y_policy_net_positive: netReturn >= cfg.policy.positiveReturn,   // R, e.g. +0.50
    y_policy_net_return: netReturn,
    y_peak_opportunity: peak / alert.mcap - 1,                       // optimistic, labeled as such
    y_hit_market_cap: peak >= cfg.policy.mcapTarget,                 // supply-aware, not price·1e9
  };
}

// Replay features: ONE extractor shared with production. CI enforces they are the same function.
export async function causalFeatures(tape, assetKey, asOf) {
  const events = await tape.eventsUntil(assetKey, asOf);            // chain_ts <= asOf, nothing later
  return extractAllFeatures(events);
}
```

### 19.3 Data splits

Time-based train / validation / untouched test periods. Keep a control sample outside the hot gate to measure selection bias. Report results **separately** for curve and post-migration profiles. Refit on a scheduled **monthly** cadence only after a new version is approved. Never continuously tune from the system's own selected alerts.

### 19.4 Evaluation metrics

**Before a probability model exists:** net return per alert under the fixed policy; precision@10 and @50; qualified-alert volume per day; rug/blocker rate after alert; time from creation to alert; alert-to-executable-fill decay; maximum adverse excursion and drawdown; coverage and missing-feature rates.

**After a probability model exists:** calibration table and reliability curve; Brier score; log loss; PR-AUC appropriate to the low base rate; probability monotonicity for nested outcomes (P(≥1M) ≤ P(≥500K) by construction).

> **Brier must never be computed against the raw Meme Score** as though `75` meant 75% success probability. Nested-event monotonicity is why small-n calibration uses cohort frequency tables (with minimum-support fallback to coarser bins), not two independent regressions.

```js
// backend/src/calibration/metrics.js  — probability metrics are GATED on a calibrated layer.
export function calibrationTable(predictions, bins = 10) { /* rate ≈ binMid or thresholds are decoration */ }
export function brier(predictions) { /* ONLY for calibrated probabilities — never the raw memeScore */ }
export function precisionAtK(ranked, k) {
  const top = ranked.slice(0, k);
  return top.filter(t => t.label?.y_policy_net_positive).length / top.length;
}
export function evPerAlert(ranked, k) {   // THE metric — net EV under the policy stub, not hit rate
  const top = ranked.slice(0, k).filter(t => t.label);
  return top.reduce((s, t) => s + t.label.y_policy_net_return, 0) / top.length;
}
```

### 19.5 Shadow duration and the go/no-go verdict rule

Seven days is the minimum operational burn-in for ingestion, scoring, reconnect, and alert correctness. It is **not** enough to establish an edge at a sub-percent base rate. Duration is not a decision rule — a duration alone is a slower way to reach the conclusion you already wanted. The verdict rule below must be **frozen before shadow mode starts**, and is evaluated **independently per cohort** (`pump-curve` vs `post-migration`). A partial pass is a legitimate outcome: one regime goes live, the other stays watching-only.

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
EXTEND: CI straddles 0 -> continue to 2N, once, then verdict (no open-ended extension).
```

The predeclared minimum-sample-and-positive-outcome burn-in is therefore likely **30–90 days** of shadow running to accumulate N per cohort — but the calendar is a consequence of reaching N, never the gate itself.

## 20. Shadow policy

Shadow mode records an executable decision without sending a transaction. Initial policy fields: maximum entry decay from alert price; simulated latency; maximum slippage and position size; invalidation on dev sell, new blocker, or sustained sell pressure; versioned exit ladder; time stop and trailing-remainder behavior.

**Entry and exit costs must be applied multiplicatively to simulated fills.** Subtracting a single percentage from ideal peak return is not a sufficient execution model.

```js
// backend/src/policy/stub.js
export function policyDecision(token, score, cfg) {
  if (token.admission !== "qualified") return { action: "none" };
  const decayFrac = token.mcap / score.alert.mcap - 1;              // supply-aware
  if (decayFrac > cfg.policy.maxEntryDecayFrac)
    return { action: "skip", reason: "alert_decay" };              // the move already happened
  return {
    action: "shadow_enter",
    invalidation: ["dev_sell_fired", "blocker_added", "flow_below_1_two_windows"],
    exitLadder: cfg.policy.exitLadder,                              // costs applied multiplicatively at fill
    mode: "SHADOW — log only. No automation until the go/no-go verdict.",
  };
}
```

## 21. Versioned configuration contract

Everything tunable lives in one versioned config and nowhere else. Separate curve vs post-migration dynamic registries; fractions in `[0,1]`; MAD candidates preserved; `status` string forbids automation.

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
               // DISABLED (weight 0 → excluded from denominator): creatorInitialBuy, rawFreshCount, smartPresence
               creatorInitialBuy: 0, rawFreshCount: 0, smartPresence: 0 },
    freshAgeMs: 72 * 3600_000, freshBoundary: [20, 60], funderLookbackMs: 24 * 3600_000,
    devConfidentN: 8, shrinkStrength: 5,
  },

  // SEPARATE registries per regime — one table cannot serve both.
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
              honeypotMaxChecks: 5, honeypotStaleMs: 10 * 60_000, // bound recheck livelock → BAD_DATA
              madK: 4, madKCandidates: [4, 6] },   // 4σ (paper) vs 6σ decided in replay

  policy: { maxEntryDecayFrac: 0.05, exitLadder: [[2.0, 0.5], [4.0, 0.25]],
            evalHorizonMs: 6 * 3600_000, positiveReturn: 0.50, mcapTarget: 500_000 },
};
```

## 22. Versioning and reproducibility

A score-version bump is required for any change to: feature definition or unit; feature enabled/disabled status; normalizer or cohort definition; block or family weight; blocker threshold; admission threshold; classifier version; event-schema interpretation; policy assumptions used for outcome labels.

Each score row retains the feature-snapshot ID, configuration hash, code version, and provider versions needed to reproduce it. **CI invariants:** (1) `causalFeatures` and the live extractor are the same function — replay and production can never drift; (2) any config change bumps `CONFIG.version`, because a calibration curve is valid only against the exact threshold set that produced it.

## 23. Corrections applied to the reference code

The supplied technical pseudocode was valuable design material but not directly copyable. Every issue below is now fixed in the corrected contracts in §9–§21; the table remains as the audit trail and the acceptance checklist.

| Source issue | Correction applied | Section |
|---|---|---|
| Trades subscribed only after passing a trade-dependent gate | Unbiased early baseline for all launches, then hot-budget allocation | §10, §10.1 |
| Milestone loop reuses cumulative state while restarting `findIndex` | All milestones computed in one chronological pass | §12.1.1 |
| Event identity uses only `token_mint` | Chain/launchpad-aware `assetKey` + idempotent `(source, signature, instructionIndex)` | §9.1, §9.5 |
| Tape records `Date.now()` as event time | `chainTs` and `receivedAt` preserved separately; causal reads use chain time | §9.3, §9.5 |
| Funder/holder code assumes one-billion supply | Actual raw supply and decimals (BigInt) | §12.1.3, §12.1.4 |
| Holder resolver expects owner-program in largest-account response | Fetch account authority / PDA relationships explicitly; no size-based skip | §12.1.4 |
| Every multi-wallet funding component summed as coordinated | Classify suspicious components, exclude known services, use the **max** component | §12.1.3 |
| Rich profiling changes the definition of "fresh" | Freshness and low-history kept as separate features | §12.1.5 |
| Flow state receives ATH age but ignores it | ATH freshness + minimum activity drive the state machine | §12.3.3 |
| Any cohort sell treated as full exit | Token-unit partial/full sell-through | §12.3.5 |
| Derivative ranges depend on raw units per millisecond | Normalized percentage change per minute | §12.3.6 |
| One dynamic weight table serves two regimes | Separate curve and post-migration registries | §21 |
| Scorer reads a breakdown `weightedScore` never returns | Per-family normalized value + contribution added to the score contract | §14.2 |
| `creatorInitialBuy` has weight but is always `null` | Disabled; excluded from the enabled-weight denominator | §14.2, §21 |
| Hot queue slices across protected records | Capacity applied only to evictable records | §17 |
| Replay label omits async waits and uses ideal peak | Awaited reads; causal fixed execution policy; multiplicative costs | §19.2, §20 |
| Market-cap label multiplies price by fixed supply | Supply-aware observed market cap | §7.2, §19.2 |
| Brier shown before a probability layer exists | Brier only for calibrated probabilities | §19.4 |
| Liquidity drop mixes `70` and `0.70` | All proportions standardized as fractions `[0,1]` | §15.1, §21 |
| Four-sigma rule becomes an unexplained six-sigma config | Both preserved as versioned candidates, decided in replay | §13.3, §21 |
| Non-bot classifier used before validation | `experimental` until validated; no score/no `BOT_FLOW` until then | §12.1.2, §15.1 |
| Mutated before/after comparison kills dormant-spike detection | Immutable snapshots (new state = new object) | §12.3.2 |
| EVM tokens through Solana checks | Chain/launchpad gate returns `unscored` | §14.2 |

## 24. Observability and operational controls

Structured health output / dashboards for: events received per source and type; source lag and reconnect count; duplicate and out-of-order rates; missing trade spans; score evaluations and latency; feature coverage by family; state counts (`unscored`/`watching`/`provisional`/`qualified`/`rejected`/`expired`); blocker counts by code; provisional upgrade and expiry rates; hot-queue utilization and evictions; replay/live feature-parity failures; provider RPC error and rate-limit rates.

**Provider failure must lower coverage or raise `BAD_DATA`; it must never silently turn missing evidence into a positive score.**

## 25. Honest constraints (write these on the wall)

- Gate passing ~20–30 tokens/day → ~100 positive-region samples in 90 days → **coarse bins, ≤ 10 feature families**. A six-category board with dozens of inputs is a v3 artifact; launching with it means fitting noise.
- Base rates: ~0.63% graduation, ~1% reaching the tracker cohort. Sub-percent targets punish every shortcut.
- Most likely outcome of doing everything right: a well-calibrated model showing **thin-to-negative EV after costs**. Build it as a **measurement instrument first, a trading tool second** — a negative result permanently replaces unverifiable channel signals with numbers you own; a positive one is an edge you can size against.

## 26. Implementation-plan workstreams (dependency-ordered)

1. Current defect remediation and chain-scope gate.
2. Canonical identity, event schemas, and persistent tape.
3. Resilient creation/trade/migration ingestion (staged collection).
4. Fixed-window aggregation and immutable causal snapshots.
5. Structural features and cheap preliminary allocation.
6. Holder, funding-graph, and developer evidence.
7. Curve and post-migration dynamic profiles.
8. Pure scorer, blockers, and admission state machine.
9. Score-prioritized monitoring and retention.
10. Backend API and simplified Meme Finder UI.
11. Causal replay, labels, shadow policy, and metrics.
12. Operational shadow run, calibration, and go/no-go report.

Each workstream must include unit tests, integration tests, replay fixtures, telemetry, migration/rollback behavior, and explicit completion criteria.

### 26.0 Sequencing insight — build the replay harness against synthetic tapes early

The dependency order is correct (tape before features), but workstream 11's **replay harness does not have to wait for real ingestion to stabilize.** Build a synthetic tape generator that emits fake event streams with **known ground truth** — farms, grinds, organic pumps, dead tokens, right-censored baselines — and use it to test the causality guards, label construction (including the §19.2 dead-token path), and calibration metrics while the real tape is still filling. When real replay runs, the harness is already proven. This parallelizes the two longest-lead items (persistent ingestion and the calibration harness) instead of serializing them.

### 26.1 Testing anchors (regression fixtures)

The scorer is pure — test it with fixtures, no mocks:

```js
// The 51.9% farm case: structural block must reject.
const farm = { maxSuspiciousComponentPct: 0.519, top10ExLpPct: 0.18, freshShare: 0.15 };
assert(computeMemeScore(token, farm, dyn).blockers.some(b => b.code === "FARM"));

// unknown ≠ zero: missing bot-share must lower coverage, not score, and must not block.
const noBot = { ...good, nonBotShare: null, nonBotClassifierStatus: "experimental" };
assert(computeMemeScore(token, noBot, dyn).evidenceCoverage < computeMemeScore(token, good, dyn).evidenceCoverage);
assert(!computeMemeScore(token, noBot, dyn).blockers.some(b => b.code === "BOT_FLOW"));
```

## 27. Acceptance criteria for the implementation plan

The implementation plan derived from this report is complete only if it specifies: exact files/modules to add or change; persistent schema and migration strategy; data-provider contracts and reconnect behavior; concurrency, batching, and RPC budgets; feature formulas, units, minimum samples, and missing-data behavior; score and configuration versioning; blocker and admission transitions; API response and WebSocket event contracts; removal/deprecation of current frontend strategies; historical-data bootstrap and replay procedure; tests for every boundary and known defect (§23); operational dashboards and alerts; shadow-mode start, minimum sample, and verdict criteria; and a rollback path with **no loss of the raw event tape**.

## 28. Final recommendation

Proceed with an implementation plan only after treating the **event tape and causal feature contract as Phase 1**, not optional infrastructure. The strongest research-backed signals cannot be reconstructed from the current DexScreener snapshots, and a score built before trade collection would reproduce the same failure in a cleaner interface.

The recommended product is one evidence-backed qualification system with two non-overlapping score blocks, regime-specific dynamics, explicit coverage, and hard risk vetoes. Its value must be judged by **policy-realizable net return and calibration on owned data** — not by the number of alerts, graduation accuracy, or resemblance to external bots.
