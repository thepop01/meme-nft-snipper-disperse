# Meme Score v2 — Implementation Code

Node.js, matching your existing structure. Each module is self-contained; comments carry the reasoning. Ordered by dependency: tape → features → scorer → admission → calibration → policy.

---

## 1. Versioned config — everything tunable lives here, nowhere else

```js
// backend/src/scoring/config.js
export const CONFIG = {
  version: "meme-score-v2.0.0",
  status: "v1-placeholder — thresholds NOT calibrated. Do not automate.",

  windows: {
    canonicalMs: 60_000,          // ONE window length. All breadth math derives from it.
    flowSeriesLen: 4,             // last N canonical windows shown/scored
    cohortEntryMs: 5 * 60_000,    // "bought in first 5 min"
    cohortCheckMs: [15, 30].map(m => m * 60_000),
  },

  structural: {
    // direction notes encode the CORRECTED research statement:
    // HIGHER sol/trade = better. Lower swaps-to-milestone = better.
    weights: { capitalEfficiency: 0.25, milestoneSpeed: 0.10, nonBotShare: 0.20,
               bundleCluster: 0.20, top10ExLp: 0.10, freshWallets: 0.05,
               devFingerprint: 0.05, creatorInitialBuy: 0.05 }, // dev/smart deliberately low
    nonBotMinShare: 0.30,         // paper threshold
    nonBotMinSample: 30,          // below this: "insufficient evidence", NOT a block
    freshAgeMs: 72 * 3600_000,
    freshBoundary: [20, 60],      // count inside this range → upgrade to rich profiling
    funderLookbackMs: 24 * 3600_000,
  },

  dynamic: {
    weights: { flowState: 0.25, efficiencyAnalogs: 0.25, cohortRetention: 0.20,
               athHealth: 0.15, derivatives: 0.10, smartLifecycle: 0.05 },
    emaAlpha: 0.3,
  },

  admission: {
    combined:   { structural: 70, dynamic: 60, confidence: 75 },
    momentum:   { capitalEfficiency: 90, nonBotShare: 0.5, minSwaps: 20,
                  structural: 60, confidence: 60 },
    provisionalTtlMs: 10 * 60_000,
  },

  blockers: {
    liquidityCollapsePct: 0.70,
    bundleClusterPct: 0.50,       // observed farm case was 51.9%
    devConcentrationPct: 0.20,
    madSigma: 6,
  },

  policy: {
    maxSlippageFromAlertPct: 0.05,
    exitLadder: [[2.0, 0.5], [4.0, 0.25]], // [multiple, fractionToSell]
    evalHorizonMs: 6 * 3600_000,
  },
};
```

## 2. Raw tape — append-only, the foundation everything replays

```js
// backend/src/tape/tape.js
// Store EVENTS, never conclusions. Features are recomputable; raw events are not.
export class Tape {
  constructor(db) { this.db = db; } // Postgres/Timescale: hypertable on ts

  async append(event) {
    // event: { ts, tokenMint, type, payload, source }
    // types: 'create' | 'trade' | 'migration' | 'holder_snapshot' | 'funding_link'
    await this.db.query(
      `INSERT INTO events (ts, token_mint, type, payload, source)
       VALUES ($1,$2,$3,$4,$5)`,
      [event.ts, event.tokenMint, event.type, JSON.stringify(event.payload), event.source]
    );
  }

  // Causal read: replay must NEVER see data after asOfTs. This is the lookahead guard.
  async eventsUntil(tokenMint, asOfTs, types = null) {
    const t = types ? `AND type = ANY($3)` : "";
    const params = types ? [tokenMint, asOfTs, types] : [tokenMint, asOfTs];
    const { rows } = await this.db.query(
      `SELECT * FROM events WHERE token_mint=$1 AND ts<=$2 ${t} ORDER BY ts`, params);
    return rows;
  }
}
```

## 3. Trade collection — fixes defect: PumpPortal only collected creations

```js
// backend/src/discovery/pumpfun.js
// Without trades: no capital efficiency, no bot share, no flow, no retention.
// This is the #1 data gap in the current system.
import WebSocket from "ws";

export function subscribePumpFun(tape) {
  const ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.on("open", () => {
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeMigration" }));
    // trades for tokens that PASSED the gate are subscribed per-token
    // (subscribeTokenTrade) to protect the monitoring budget.
  });

  ws.on("message", async (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.txType === "create") {
      await tape.append({ ts: Date.now(), tokenMint: m.mint, type: "create",
        source: "pumpportal",
        payload: { creator: m.traderPublicKey, curve: m.bondingCurveKey,
                   initialBuySol: m.solAmount ?? null } });
    }
    if (m.txType === "buy" || m.txType === "sell") {
      await tape.append({ ts: Date.now(), tokenMint: m.mint, type: "trade",
        source: "pumpportal",
        payload: { side: m.txType, wallet: m.traderPublicKey,
                   sol: m.solAmount, tokens: m.tokenAmount,
                   vSolInCurve: m.vSolInBondingCurve, sig: m.signature } });
    }
  });
  return ws;
}

export function watchTrades(ws, mint) {
  ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
}
```

## 4. Windowing — fixes defect: mixed 24h/1h/5m breadth math

```js
// backend/src/features/windows.js
// RULE: one canonical window. Every ratio/velocity derives from it.
// Never compare 24h volume against 5m transactions again.
export function bucketize(trades, windowMs, fromTs, toTs) {
  const buckets = new Map(); // windowStart -> {buySol, sellSol, buys, sells, wallets:Set}
  for (const t of trades) {
    if (t.ts < fromTs || t.ts > toTs) continue;
    const w = Math.floor(t.ts / windowMs) * windowMs;
    if (!buckets.has(w)) buckets.set(w, { buySol: 0, sellSol: 0, buys: 0, sells: 0, wallets: new Set() });
    const b = buckets.get(w);
    if (t.side === "buy") { b.buySol += t.sol; b.buys++; } else { b.sellSol += t.sol; b.sells++; }
    b.wallets.add(t.wallet);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b)
    .map(([w, b]) => ({ windowStart: w, ...b, wallets: b.wallets.size }));
}
```

## 5. Structural block — computed once, frozen at gate

### 5a. Capital efficiency + curve milestones (paper's core predictor, correct direction)

```js
// backend/src/features/capitalFormation.js
export function capitalFormation(trades, curveTargetSol) {
  const buys = trades.filter(t => t.side === "buy");
  if (buys.length < 5) return { capitalEfficiency: null, milestones: null }; // unknown ≠ zero

  // HIGHER = better: reaching a level in few large swaps = conviction.
  // 500 tiny swaps to the same level = grind/wash.
  const solRaised = buys.reduce((s, t) => s + t.sol, 0);
  const capitalEfficiency = solRaised / buys.length;

  // LOWER = better: swaps needed to hit each curve fraction.
  let cum = 0;
  const milestones = {};
  for (const frac of [0.25, 0.5, 0.75, 1.0]) {
    const idx = buys.findIndex(t => (cum += t.sol) >= curveTargetSol * frac);
    milestones[`swaps_to_${frac * 100}pct`] = idx === -1 ? null : idx + 1;
  }
  return { capitalEfficiency, milestones, solRaised, swapCount: buys.length };
}
```

### 5b. Non-bot share — with the sample-size honesty rule

```js
// backend/src/features/nonBotShare.js
// Paper: non-bot share ≥30% lifts graduation odds.
// TODO(validate): classification must be VERIFIED before it's scored.
// Heuristic v0: frontend-routed txs carry known fee-recipient/ix patterns;
// direct program calls don't. Until validated on ground truth, report as
// coverage-flagged feature, never a blocker.
export function nonBotShare(trades) {
  if (trades.length < 30)
    return { share: null, evidence: "insufficient", n: trades.length }; // NOT a block
  const manual = trades.filter(t => t.frontendRouted).length;
  return { share: manual / trades.length, evidence: "sufficient", n: trades.length };
}
```

### 5c. Funder-graph clustering — the real supply-control metric

```js
// backend/src/features/funderGraph.js
// Why not slot-based bundling: the observed farm (51.9%) spread buys so
// top-10 showed only 18%. Fake distribution defeats slot checks.
// Graph over shared FUNDING SOURCES catches it structurally.
class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x);
    const r = this.p.get(x); return r === x ? r : (this.p.set(x, this.find(r)), this.p.get(x)); }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

export async function bundleClusters({ buyers, creationTs, balancesByWallet, fundingSourceFor }) {
  const uf = new UnionFind();
  const funderOf = new Map();

  for (const w of buyers) {
    // one RPC hop per buyer: oldest inbound SOL transfer within 24h pre-launch
    const funder = await fundingSourceFor(w, creationTs - 24 * 3600e3, creationTs);
    funderOf.set(w, funder ?? `self:${w}`); // unknown funder = its own component (honest)
    uf.union(w, funderOf.get(w));
  }

  const clusters = new Map(); // root -> { wallets, supply }
  for (const w of buyers) {
    const root = uf.find(funderOf.get(w));
    if (!clusters.has(root)) clusters.set(root, { wallets: 0, supply: 0 });
    const c = clusters.get(root);
    c.wallets++;
    c.supply += balancesByWallet.get(w) ?? 0;
  }
  const maxCluster = Math.max(0, ...[...clusters.values()].map(c => c.supply));
  return {
    clusterCount: clusters.size,
    maxClusterPct: maxCluster / 1e9,             // of 1B supply
    bundleClusterPct: [...clusters.values()]     // all clusters >1 wallet = coordinated
      .filter(c => c.wallets > 1).reduce((s, c) => s + c.supply, 0) / 1e9,
  };
}
```

### 5d. Top-10 ex-LP — fixes defect: "skip largest holder" hack

```js
// backend/src/features/topHolders.js
// Identify system accounts by OWNER PROGRAM and known addresses — never by size.
const SYSTEM_OWNERS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",   // token program accounts handled separately
]);
const KNOWN_EXCLUDED = new Set([/* pump.fun curve PDAs, Raydium LP mints, burn addr */]);

export async function top10ExLp(rpc, mint, curveAddress) {
  const accounts = await rpc.getTokenLargestAccounts(mint);
  const held = accounts
    .filter(a => a.address !== curveAddress && !KNOWN_EXCLUDED.has(a.address))
    // for LP positions: check the account's OWNER is not the Raydium program
    .filter(a => !SYSTEM_OWNERS.has(a.ownerProgram))
    .slice(0, 10);
  return held.reduce((s, a) => s + a.uiAmount, 0) / 1e9;
}
```

### 5e. Fresh wallets — two-tier (cheap at scale, rich near boundary)

```js
// backend/src/features/freshWallets.js
// Age-only is sufficient at farm scale (151 fresh = unambiguous).
// False positives (CEX withdrawals) only matter NEAR the decision boundary.
export async function freshWalletFeature(buyers, walletAge, richProfile, cfg) {
  let fresh = 0, boundary = [];
  for (const w of buyers) {
    const age = await walletAge(w); // 1 batched RPC call: oldest signature
    if (age < cfg.freshAgeMs) fresh++;
    else if (age < cfg.freshAgeMs * 2) boundary.push(w);
  }
  const [lo, hi] = cfg.freshBoundary;
  if (fresh >= lo && fresh <= hi) {
    // ambiguous zone: upgrade. tx count, funding source, activity types.
    const profiles = await Promise.all(boundary.map(richProfile));
    fresh += profiles.filter(p =>
      p.txCount < 10 && p.fundingSources === 1 && !p.hasDefiHistory).length;
  }
  return { freshCount: fresh, freshShare: fresh / buyers.size };
}
```

### 5f. Dev fingerprint — profile, not counter; identity via funding graph

```js
// backend/src/features/devFingerprint.js
// "Created: 9" is a counter. This is a fingerprint.
// Devs rotate wallets → identity = creator wallet + wallets sharing its funder.
export async function devFingerprint(creatorWallet, tape, fundingSourceFor) {
  const rootFunder = await fundingSourceFor(creatorWallet, 0, Infinity);
  const pastLaunches = await tape.launchesByCreatorCluster([creatorWallet, rootFunder]);
  if (!pastLaunches.length) return { known: false };

  const outcomes = pastLaunches.map(L => ({
    graduated: !!L.migrationTs,
    athMcap: L.maxMcap,
    // "rug" must be DEFINED from the price series, not vibes:
    rugged: L.maxMcap && L.finalMcap < L.maxMcap * 0.1 &&
            (L.collapseTs - L.athTs) < 2 * 3600e3,
    timeToRugMs: L.collapseTs ? L.collapseTs - L.creationTs : null,
    devFirstSellMs: L.devFirstSellTs ? L.devFirstSellTs - L.creationTs : null,
  }));

  const n = outcomes.length;
  return {
    known: true,
    launches: n,
    graduationRate: outcomes.filter(o => o.graduated).length / n,
    rugRate: outcomes.filter(o => o.rugged).length / n,
    medianAth: median(outcomes.map(o => o.athMcap).filter(Boolean)),
    medianSellTimingMs: median(outcomes.map(o => o.devFirstSellMs).filter(Boolean)),
  };
}
```

## 6. Dynamic block — time series, updated per poll

### 6a. Snapshot reducer — fixes defect: mutated object compared with itself

```js
// backend/src/features/snapshots.js
// OLD BUG: refresh mutated the token object, then compared "before vs after"
// — both references pointed at the same mutated state, so wake events died.
// FIX: snapshots are IMMUTABLE. New state is a new object.
export function reduceSnapshot(prev, tick) {
  const isNewAth = tick.mcap > prev.ath;
  return Object.freeze({
    ...prev,
    ts: tick.ts,
    mcap: tick.mcap,
    ath: isNewAth ? tick.mcap : prev.ath,
    athTs: isNewAth ? tick.ts : prev.athTs,
    athDistance: 1 - tick.mcap / (isNewAth ? tick.mcap : prev.ath),
    athAgeMs: tick.ts - (isNewAth ? tick.ts : prev.athTs),
    // FIXED ANCHOR — never rebased. (The one proven finding: Bot 2's four
    // percentages all reverse to an identical $23.4K baseline.)
    gainVsAnchor: tick.mcap / prev.anchorMcap - 1,
  });
}

export function initSnapshot(migrationTick) {
  return Object.freeze({
    anchorMcap: migrationTick.mcap,   // migration-time mcap, set ONCE
    ath: migrationTick.mcap,
    athTs: migrationTick.ts,
    ts: migrationTick.ts,
    mcap: migrationTick.mcap,
    athDistance: 0, athAgeMs: 0, gainVsAnchor: 0,
  });
}
```

### 6b. Flow state machine — labels need drawdown state, not a one-shot rule

```js
// backend/src/features/flowState.js
// Reverse-engineered constraint: T+30 series 1.44→1.40→1.49 = "RECOVERING" while
// T+60 1.39→1.53→1.48→1.62 = "STABLE" — no single-series rule fits both.
// The missing input is ATH state: T+30 was below a STALE ath; T+60 printed ath at T+59.
export function flowState({ flowSeries, athDistance, athAgeMs }) {
  if (flowSeries.length < 2) return { label: "INSUFFICIENT", bullish: null };
  const last = flowSeries.at(-1), prev = flowSeries.at(-2);
  const allPositive = flowSeries.every(f => f > 1);

  if (last < 1 && prev < 1)          return { label: "SELL_PRESSURE", bullish: false };
  if (athDistance > 0.02 && last > 1 && last >= prev)
                                     return { label: "RECOVERING", bullish: true };
  if (athDistance < 0.02 && allPositive)
                                     return { label: "STABLE_AT_HIGHS", bullish: true };
  if (allPositive)                   return { label: "STABLE", bullish: true };
  return { label: "MIXED", bullish: null };
}

export function flowSeriesFrom(buckets, n) {
  return buckets.slice(-n).map(b =>
    b.sellSol === 0 ? (b.buySol > 0 ? 10 : 1) : b.buySol / b.sellSol); // cap div-by-zero
}
```

### 6c. Post-migration efficiency analogs — the paper's predictor, live form

```js
// backend/src/features/efficiencyAnalogs.js
// Post-migration, "SOL raised" is ~CONSTANT across all graduates (deterministic
// curve end) → the paper's feature collapses. These are its live equivalents.
// Within-cohort predictive power is an OPEN empirical question — re-estimate,
// do not transplant the paper's effect size.
export function efficiencyAnalogs(buckets) {
  const w = buckets.at(-1);
  if (!w || w.buys + w.sells === 0) return { volPerTrade: null, volPerBuyer: null };
  const total = w.buySol + w.sellSol;
  return {
    volPerTrade: total / (w.buys + w.sells),   // high = conviction; low = grind/wash
    volPerBuyer: w.buySol / Math.max(1, w.wallets),
  };
}

export function mcapPerNewBuyer(prevSnap, tick, newBuyersThisWindow) {
  if (!newBuyersThisWindow) return null;
  return (tick.mcap - prevSnap.mcap) / newBuyersThisWindow;
}
```

### 6d. Cohort sell-through — retention at 1% of the RPC cost

```js
// backend/src/features/cohortRetention.js
// Cheap proxy for holder half-life: no holder-set enumeration, trade stream only.
export function cohortSellThrough(trades, t0, entryMs, checkMs) {
  const cohort = new Set(
    trades.filter(t => t.side === "buy" && t.ts >= t0 && t.ts <= t0 + entryMs)
          .map(t => t.wallet));
  if (cohort.size < 5) return null;
  const sold = trades.filter(t =>
    t.side === "sell" && t.ts <= t0 + checkMs && cohort.has(t.wallet));
  const soldWallets = new Set(sold.map(t => t.wallet));
  return {
    cohortSize: cohort.size,
    retention: 1 - soldWallets.size / cohort.size, // fraction still holding at check time
  };
}
```

### 6e. Smoothed derivatives — velocity + acceleration, NO jerk

```js
// backend/src/features/derivatives.js
// Third derivative at 30–60s polling = noise amplification. Explicitly rejected.
export class DerivativeTracker {
  constructor(alpha = 0.3) { this.a = alpha; this.level = null; this.vel = 0; this.acc = 0; }
  update(x, dtMs) {
    if (dtMs <= 0) return this.state();
    if (this.level === null) { this.level = x; return this.state(); }
    const rawVel = (x - this.level) / dtMs;
    const vel = this.a * rawVel + (1 - this.a) * this.vel;
    const rawAcc = (vel - this.vel) / dtMs;
    this.acc = this.a * rawAcc + (1 - this.a) * this.acc;
    this.vel = vel;
    this.level = this.a * x + (1 - this.a) * this.level;
    return this.state();
  }
  state() { return { level: this.level, velocity: this.vel, acceleration: this.acc }; }
}
```

## 7. Scorer — pure, testable, unknown ≠ zero

```js
// backend/src/scoring/computeMemeScore.js
import { CONFIG } from "./config.js";

// Chain gate — fixes defect: EVM tokens through Solana checks.
export function computeMemeScore(token, structural, dynamic, cfg = CONFIG) {
  if (token.chain !== "solana" || token.launchpad !== "pumpfun")
    return { version: cfg.version, status: "unscored",
             reason: "no calibrated profile for this chain/launchpad" };

  const blockers = evaluateBlockers(token, structural, dynamic, cfg);

  const structuralResult = weightedScore([
    { value: norm(structural.capitalEfficiency, [0.05, 0.5]), weight: cfg.structural.weights.capitalEfficiency },
    { value: normInv(structural.milestones?.swaps_to_100pct, [30, 800]), weight: cfg.structural.weights.milestoneSpeed },
    { value: structural.nonBotShare,                  weight: cfg.structural.weights.nonBotShare },
    { value: inv(structural.bundleClusterPct),        weight: cfg.structural.weights.bundleCluster },
    { value: inv(structural.top10ExLp),               weight: cfg.structural.weights.top10ExLp },
    { value: inv(structural.freshShare),              weight: cfg.structural.weights.freshWallets },
    { value: structural.devFingerprint?.known ? 1 - structural.devFingerprint.rugRate : null,
                                                      weight: cfg.structural.weights.devFingerprint },
    { value: null, /* creatorInitialBuy: sign learned from data, not hand-assigned */
                                                      weight: cfg.structural.weights.creatorInitialBuy },
  ]);

  const dynamicResult = weightedScore([
    { value: dynamic.flowState?.bullish === null ? null : dynamic.flowState.bullish ? 1 : 0,
                                                      weight: cfg.dynamic.weights.flowState },
    { value: norm(dynamic.efficiency?.volPerTrade, [0.02, 0.4]), weight: cfg.dynamic.weights.efficiencyAnalogs },
    { value: dynamic.retention,                     weight: cfg.dynamic.weights.cohortRetention },
    { value: inv(dynamic.snapshot?.athDistance),    weight: cfg.dynamic.weights.athHealth },
    { value: norm(dynamic.derivatives?.velocity, [0, 0.01]), weight: cfg.dynamic.weights.derivatives },
    { value: dynamic.smartLifecycleScore,           weight: cfg.dynamic.weights.smartLifecycle },
  ]);

  // confidence = evidence coverage ONLY. Never blended with probability.
  const confidence = Math.round(
    (structuralResult.coverage * 0.6 + dynamicResult.coverage * 0.4) * 100);

  return {
    version: cfg.version,
    profile: token.migrated ? "post-migration" : "pump-curve",
    structural: structuralResult,
    dynamic: dynamicResult,
    confidence,
    blockers,
  };
}

// weighted mean over AVAILABLE inputs only. Missing data reduces coverage,
// it is NEVER converted to zero. (Fixes: 0%-coverage fields scored as present.)
function weightedScore(inputs) {
  const avail = inputs.filter(i => i.value !== null && i.value !== undefined);
  const totalW = inputs.reduce((s, i) => s + i.weight, 0);
  if (!avail.length) return { score: null, coverage: 0 };
  const wSum = avail.reduce((s, i) => s + i.weight, 0);
  return {
    score: Math.round(100 * avail.reduce((s, i) => s + i.value * i.weight, 0) / wSum),
    coverage: wSum / totalW,
  };
}

// normalizers: map raw value in [lo,hi] to [0,1]; clamp. null passes through.
const norm = (v, [lo, hi]) => v == null ? null : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
const normInv = (v, r) => v == null ? null : 1 - norm(v, r);
const inv = v => v == null ? null : 1 - v;
```

## 8. Blockers — hard vetoes, with evidence attached

```js
// backend/src/scoring/blockers.js
export function evaluateBlockers(token, structural, dynamic, cfg) {
  const b = [];
  const B = cfg.blockers;

  if (dynamic.dumpDetected) // MAD/Shewhart on price series
    b.push({ code: "DUMP", evidence: { sigma: B.madSigma } });

  if (token.sellRouteVerified === false)
    b.push({ code: "HONEYPOT", evidence: {} });

  if (dynamic.liquidityDropPct > B.liquidityCollapsePct)
    b.push({ code: "LIQ_COLLAPSE", evidence: { drop: dynamic.liquidityDropPct } });

  // ONLY blocks after sufficient sample. Below it: insufficient evidence ≠ block.
  if (structural.nonBotShareEvidence === "sufficient" &&
      structural.nonBotShare < cfg.structural.nonBotMinShare)
    b.push({ code: "BOT_FLOW", evidence: { share: structural.nonBotShare } });

  if (structural.bundleClusterPct > B.bundleClusterPct)
    b.push({ code: "FARM", evidence: { pct: structural.bundleClusterPct } });

  if (structural.devHoldPct > B.devConcentrationPct)
    b.push({ code: "DEV_CONCENTRATION", evidence: { pct: structural.devHoldPct } });

  if (dynamic.staleData || dynamic.inconsistentData) // price×supply ≠ reported mcap, etc.
    b.push({ code: "BAD_DATA", evidence: {} });

  return b;
}
```

## 9. Admission engine — two paths + provisional

```js
// backend/src/scoring/admission.js
export function admit(score, token, cfg) {
  if (score.status === "unscored") return "unscored";
  if (score.blockers.length) return "rejected";

  const A = cfg.admission;
  const s = score.structural.score, d = score.dynamic.score;
  if (s === null || d === null) return "watching"; // not enough evidence yet

  // Path 1: combined qualification
  if (s >= A.combined.structural && d >= A.combined.dynamic &&
      score.confidence >= A.combined.confidence)
    return "qualified";

  // Path 2: exceptional early momentum (paper: only very fast, low-bot-share,
  // low-trade-count accumulation clears breakeven — so this path is strict)
  const ce = score.structural.breakdown?.capitalEfficiency;
  if (ce >= 0.9 && // normalized ≥90
      token.structural.nonBotShare >= 0.5 &&
      token.structural.swapCount >= A.momentum.minSwaps &&
      s >= A.momentum.structural && score.confidence >= A.momentum.confidence)
    return "qualified";

  // Single strong metric can PROVISION, never fully qualify.
  // Encodes the paper's warning: standalone signals sit below breakeven.
  if (ce >= 0.9) return "provisional";

  return "watching";
}
```

## 10. Monitoring queue — fixes defect: 300-token eviction loses qualified tokens

```js
// backend/src/discovery/monitoringQueue.js
// Replace "newest 300" with a score-prioritized budget.
const HOT_LIMIT = 300;

export function prioritize(tokens) {
  const pinned = tokens.filter(t => !canEvict(t));
  const rest = tokens.filter(canEvict)
    .sort((a, b) => (b.score?.structural.score ?? -1) - (a.score?.structural.score ?? -1));
  return [...pinned, ...rest].slice(0, HOT_LIMIT);
}

function canEvict(t) {
  // NEVER evict qualified, actively tracked, or open-position tokens.
  return !(t.admission === "qualified" || t.tracked || t.hasOpenPosition);
}
// Aggregates for evicted tokens persist in the DB (lightweight rows),
// so eviction loses monitoring, not history.
```

## 11. Replay labels — causal, decision-aligned (y₂)

```js
// backend/src/calibration/labels.js
// y₂ (primary): return achievable from FIRST-ALERT price, net of costs.
// y₁ (secondary): max mcap ≥ $500K within horizon (comparable to channel claims).
// Graduation alone is NOT the label — the paper's breakeven math lives in the
// gap between "token pumped" and "you profited after entry latency."
export function buildLabel(tape, tokenMint, alertTs, cfg) {
  const horizon = alertTs + cfg.policy.evalHorizonMs;
  const trades = tape.eventsUntil(tokenMint, horizon, ["trade"]); // sees future ON PURPOSE —
  // labels are built offline after the fact; the CAUSAL constraint applies to FEATURES.

  const alertPrice = priceAt(trades, alertTs);
  if (!alertPrice) return null;

  const peakPrice = Math.max(...trades.filter(t => t.ts >= alertTs).map(priceOf));
  const grossReturn = peakPrice / alertPrice - 1;
  const netReturn = grossReturn - cfg.policy.maxSlippageFromAlertPct - FEE_PCT;

  return {
    y2_profitable: netReturn >= 0.5,          // R = +50% net, configurable
    y2_netReturn: netReturn,
    y1_hit500k: peakPrice * 1e9 >= 500_000,
  };
}

// Feature snapshot for replay: STRICTLY causal.
export async function causalFeatures(tape, tokenMint, asOfTs) {
  const events = await tape.eventsUntil(tokenMint, asOfTs); // ts <= asOfTs, nothing later
  return extractAllFeatures(events); // same extractor used live — ONE code path
}
```

## 12. Calibration — the only verdict that matters

```js
// backend/src/calibration/metrics.js
// Train/validation split is TIME-BASED (base rate drifts). Never random-split.
export function calibrationTable(predictions, bins = 10) {
  // predictions: [{ p, outcome }] sorted into bins by p
  const table = Array.from({ length: bins }, (_, i) => ({
    binMid: (i + 0.5) / bins, n: 0, observed: 0 }));
  for (const { p, outcome } of predictions) {
    const b = Math.min(bins - 1, Math.floor(p * bins));
    table[b].n++; table[b].observed += outcome ? 1 : 0;
  }
  return table.map(r => ({ ...r, rate: r.n ? r.observed / r.n : null }));
  // Perfect calibration: rate ≈ binMid. If your "75" bucket resolves at 40%,
  // the thresholds are decoration.
}

export function brier(predictions) {
  return predictions.reduce((s, { p, outcome }) => s + (p - (outcome ? 1 : 0)) ** 2, 0)
    / predictions.length;
}

export function precisionAtK(ranked, k) {
  // ranked: tokens sorted by score desc, with labels
  const top = ranked.slice(0, k);
  return top.filter(t => t.label.y2_profitable).length / top.length;
}

export function evPerAlert(ranked, k, cfg) {
  // THE metric. Not hit rate — expected value net of costs under the policy stub.
  const top = ranked.slice(0, k).filter(t => t.label);
  return top.reduce((s, t) => s + t.label.y2_netReturn, 0) / top.length;
}
```

## 13. Policy stub — before any automation

```js
// backend/src/policy/stub.js
export function policyDecision(token, score, cfg) {
  if (token.admission !== "qualified") return { action: "none" };

  const slippageFromAlert = token.mcap / score.alertMcap - 1;
  if (slippageFromAlert > cfg.policy.maxSlippageFromAlertPct)
    return { action: "skip", reason: "alert_decay" }; // move already happened

  return {
    action: "shadow_enter",
    invalidation: ["dev_sell_fired", "blocker_added", "flow_below_1_two_windows"],
    exitLadder: cfg.policy.exitLadder,
    mode: "SHADOW — log only. No automation until Phase 6 verdict.",
  };
}
```

---

## Testing notes

The scorer is pure — test it with fixtures, no mocks needed:

```js
// The 51.9% farm case from the real alert: structural block must reject.
const farmCase = { bundleClusterPct: 0.519, top10ExLp: 0.18, freshShare: 0.15, ... };
assert(computeMemeScore(token, farmCase, dyn).blockers.some(b => b.code === "FARM"));

// unknown ≠ zero: missing bot-share data must lower coverage, not score.
const noBotData = { ...good, nonBotShare: null, nonBotShareEvidence: "insufficient" };
assert(computeMemeScore(token, noBotData, dyn).confidence < withBotData.confidence);
assert(!computeMemeScore(token, noBotData, dyn).blockers.some(b => b.code === "BOT_FLOW"));
```

Two invariants to enforce in CI: **(1)** `causalFeatures` and the live extractor are the same function — replay and production can never drift; **(2)** any config change bumps `CONFIG.version`, because a calibration curve is only valid against the exact threshold set that produced it.