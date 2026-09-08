# Meme Finder — Phase 3: Structural Features + Holder/Funding Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the six structural feature families — capital formation, non-bot share, funder graph (coordinated ownership), top-10 ex-LP, fresh wallets, and developer fingerprint — that plug into the Phase 2 `extractAllFeatures` extractor and feed the Phase 4 scorer.

**Architecture:** Each feature family is a pure function in its own file under `backend/src/features/`. All six consume events/trades from the tape and produce a typed result that `extractAllFeatures` (Phase 2) orchestrates. RPC-dependent features (`topHolders`, `freshWallets`, `devFingerprint`, `funderGraph`) accept their RPC/lookup dependencies as injected parameters — never import `@solana/web3.js` directly — so tests run against fakes with no live connection. The feature outputs feed the structural score block; they are **not** themselves scored yet (that is Phase 4, WS8). Phase 3 extends the `extractAllFeatures` return object to include these structural families and updates the parity test.

**Tech Stack:** Node ESM, Vitest, pg + pg-mem (from Phase 1). `@solana/web3.js` is an existing dep used by `analysis/safety.js`; no new runtime deps. All RPC calls are injected — tests use fakes.

**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` (§12.1.1 capital formation, §12.1.2 non-bot share, §12.1.3 funder graph, §12.1.4 top-10 ex-LP, §12.1.5 fresh wallets, §12.1.6 dev fingerprint). Section references below point there.

**Depends on:**
- Phase 1: `docs/superpowers/plans/2026-07-24-meme-finder-phase1-event-tape.md` (tape, identity, chain-scope gate).
- Phase 2: `docs/superpowers/plans/2026-07-24-meme-finder-phase2-ingestion-snapshots.md` (`extractAllFeatures`/`causalFeatures` in `features/extract.js`, `bucketize` in `features/windows.js`, `supplyAwareMcap` in `features/mcap.js`, `EVENT_TYPES` incl. `HOLDER_SNAPSHOT`, `FUNDING_LINK`).
- Shared context: `docs/superpowers/plans/2026-07-24-memefinder-00-shared-context.md` (§1 conventions, §2 contract map, §4 layout, §5 contract table).

---

## File Structure

**Create — Workstream 5 (capital formation + non-bot share):**
- `backend/src/features/capitalFormation.js` — single-pass curve-progress milestones (§12.1.1).
- `backend/src/features/nonBotShare.js` — experimental-until-validated classifier contract (§12.1.2).
- `backend/src/features/__tests__/capitalFormation.test.js`
- `backend/src/features/__tests__/nonBotShare.test.js`

**Create — Workstream 6 (holder, funding-graph, developer evidence):**
- `backend/src/features/funderGraph.js` — `bundleClusters` via UnionFind over funding links (§12.1.3).
- `backend/src/features/topHolders.js` — `top10ExLp` with resolved system account exclusion (§12.1.4).
- `backend/src/features/freshWallets.js` — age-based freshness + separate low-history profiling (§12.1.5).
- `backend/src/features/devFingerprint.js` — shrinkage-adjusted creator-cluster history (§12.1.6).
- `backend/src/features/__tests__/funderGraph.test.js`
- `backend/src/features/__tests__/topHolders.test.js`
- `backend/src/features/__tests__/freshWallets.test.js`
- `backend/src/features/__tests__/devFingerprint.test.js`

**Modify:**
- `backend/src/features/extract.js` — extend `extractAllFeatures` to call the six new feature families and include their results in the returned object.
- `backend/src/features/__tests__/extract.test.js` — update to verify structural features appear in the output.
- `backend/src/features/__tests__/parity.test.js` — verify the CI invariant still holds with the expanded extractor.

**Scope note (honest):** The non-bot classifier (§12.1.2) ships as `experimental` with zero score weight. The actual classifier *implementation* (Jito bundle detection, known bot program IDs, repeat first-block buyer heuristics) is a research deliverable that requires labeled transaction data — this plan delivers the **contract and integration point** so WS8's scorer and blocker can consume it once validated. The `bundleClusters` function accepts an injected `fundingSourceFor` — the actual RPC funding-source tracer (SOL transfer history lookup) is wired in at integration time; this plan delivers the graph algorithm and the contract. `top10ExLp` accepts injected `rpc` and `resolvers` — the actual PDA resolution for Pump.fun curve/Raydium vault is wired in at integration. Similarly, `devFingerprint` accepts `tape.launchesByCreatorCluster` — this plan adds that query method to the Tape class. These are called out at their tasks.

---

## Task 1: Capital formation — single-pass milestones (§12.1.1)

**Files:**
- Create: `backend/src/features/capitalFormation.js`
- Test: `backend/src/features/__tests__/capitalFormation.test.js`

> **Spec (§12.1.1):** HIGHER curve-progress-per-swap = better; FEWER swaps to a milestone = better. Milestones computed in ONE chronological pass. `unknown ≠ 0` — fewer than 5 buys returns `{ primary: null, coverage: 0 }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/capitalFormation.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { capitalFormation } from '../capitalFormation.js';

const curveTarget = 1000; // lamports for simplicity

function buy(sol) { return { side: 'buy', solLamports: sol }; }
function sell(sol) { return { side: 'sell', solLamports: sol }; }

describe('capitalFormation (§12.1.1)', () => {
  it('returns null primary with fewer than 5 buys (unknown ≠ 0)', () => {
    const trades = [buy(100), buy(200), sell(50), buy(300)]; // 3 buys
    const r = capitalFormation(trades, curveTarget);
    expect(r.primary).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it('computes milestones in one chronological pass', () => {
    // 5 buys: 250 each → cumulative: 250, 500, 750, 1000
    const trades = [buy(250), buy(250), buy(250), buy(250), buy(50)];
    const r = capitalFormation(trades, curveTarget);
    expect(r.milestones.swaps_to_25pct).toBe(1);
    expect(r.milestones.swaps_to_50pct).toBe(2);
    expect(r.milestones.swaps_to_75pct).toBe(3);
    expect(r.milestones.swaps_to_100pct).toBe(4);
    expect(r.coverage).toBe(1);
  });

  it('reports null milestones for unreached thresholds', () => {
    const trades = [buy(50), buy(50), buy(50), buy(50), buy(50)]; // 250 total, target 1000
    const r = capitalFormation(trades, curveTarget);
    expect(r.milestones.swaps_to_25pct).toBe(5); // 250/1000 = 25% exactly
    expect(r.milestones.swaps_to_50pct).toBeNull();
    expect(r.milestones.swaps_to_75pct).toBeNull();
    expect(r.milestones.swaps_to_100pct).toBeNull();
  });

  it('primary is curve progress per observed buy swap', () => {
    // 5 buys of 200 each = 1000 total, target 1000 → progress = 1.0, primary = 1.0 / 5 = 0.2
    const trades = [buy(200), buy(200), buy(200), buy(200), buy(200)];
    const r = capitalFormation(trades, curveTarget);
    expect(r.primary).toBeCloseTo(0.2);
  });

  it('caps curve progress at 1.0 even if overfunded', () => {
    const trades = [buy(500), buy(500), buy(500), buy(500), buy(500)]; // 2500 >> 1000
    const r = capitalFormation(trades, curveTarget);
    expect(r.primary).toBeCloseTo(1.0 / 5); // 0.2 — progress capped at 1.0
  });

  it('ignores sells for milestone counting but includes them in diagnostics', () => {
    const trades = [buy(250), sell(100), buy(250), buy(250), buy(250), buy(50)];
    const r = capitalFormation(trades, curveTarget);
    expect(r.diagnostics.sellCount).toBe(1);
    expect(r.diagnostics.swapCount).toBe(5); // buy count only
    expect(r.milestones.swaps_to_25pct).toBe(1);
  });

  it('reports diagnostics: solRaisedLamports, grossSolPerBuy, swapCount, sellCount', () => {
    const trades = [buy(100), buy(100), buy(100), buy(100), buy(100), sell(50)];
    const r = capitalFormation(trades, curveTarget);
    expect(r.diagnostics.solRaisedLamports).toBe(500);
    expect(r.diagnostics.grossSolPerBuy).toBe(100);
    expect(r.diagnostics.swapCount).toBe(5);
    expect(r.diagnostics.sellCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/capitalFormation.test.js`
Expected: FAIL — cannot resolve `../capitalFormation.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/capitalFormation.js`:
```js
// HIGHER curve-progress-per-swap = better; FEWER swaps to a milestone = better.
// ONE chronological pass. (Foundation report §12.1.1)
export function capitalFormation(trades, curveTargetSol) {
  const buys = trades.filter(t => t.side === 'buy');
  if (buys.length < 5) return { primary: null, coverage: 0 };   // unknown ≠ zero

  // One chronological pass: cumSol accumulates once; each milestone recorded on first crossing.
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
    diagnostics: {                                       // NOT scored — distortable by one whale buy
      grossSolPerBuy: cumSol / buys.length,
      solRaisedLamports: cumSol, swapCount: buys.length,
      sellCount: trades.length - buys.length,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/capitalFormation.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/capitalFormation.js backend/src/features/__tests__/capitalFormation.test.js
git commit -m "feat(features): capitalFormation — single-pass milestones + efficiency (§12.1.1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Non-bot share — experimental classifier contract (§12.1.2)

**Files:**
- Create: `backend/src/features/nonBotShare.js`
- Test: `backend/src/features/__tests__/nonBotShare.test.js`

> **Spec (§12.1.2):** The classifier is `experimental` until validated against labeled transactions. It contributes **no score** and cannot trigger `BOT_FLOW` before validation. The 30-trade minimum and precision floor apply only after validation. Ground-truth labels: Jito bundles, known bot program IDs, repeat first-block buyers → bot; long multi-protocol histories with CEX funding and no bundle interaction → manual; everything else → excluded (ambiguous).

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/nonBotShare.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { nonBotShare } from '../nonBotShare.js';

const experimental = { version: 'v0.1', status: 'experimental', precision: null, recall: null,
  isFrontendRouted: () => true };
const validated = { version: 'v1.0', status: 'validated', precision: 0.92, recall: 0.78,
  isFrontendRouted: (t) => t.frontendRouted };

function trade(i, frontendRouted = true) { return { wallet: `w${i}`, frontendRouted }; }

describe('nonBotShare (§12.1.2)', () => {
  it('returns share: null when classifier is experimental (display only)', () => {
    const trades = Array.from({ length: 40 }, (_, i) => trade(i));
    const r = nonBotShare(trades, experimental);
    expect(r.share).toBeNull();
    expect(r.classifierStatus).toBe('experimental');
    expect(r.sampleSize).toBe(40);
  });

  it('returns evidence: insufficient when validated but fewer than 30 trades', () => {
    const trades = Array.from({ length: 20 }, (_, i) => trade(i));
    const r = nonBotShare(trades, validated);
    expect(r.share).toBeNull();
    expect(r.evidence).toBe('insufficient');
  });

  it('computes share correctly when validated with sufficient trades', () => {
    // 35 trades, 28 frontend-routed → share = 28/35 = 0.8
    const trades = [
      ...Array.from({ length: 28 }, (_, i) => trade(i, true)),
      ...Array.from({ length: 7 }, (_, i) => trade(i + 28, false)),
    ];
    const r = nonBotShare(trades, validated);
    expect(r.share).toBeCloseTo(0.8);
    expect(r.evidence).toBe('sufficient');
    expect(r.classifierVersion).toBe('v1.0');
    expect(r.precision).toBe(0.92);
    expect(r.recall).toBe(0.78);
  });

  it('returns share: null for zero trades regardless of status', () => {
    const r = nonBotShare([], validated);
    expect(r.share).toBeNull();
    expect(r.sampleSize).toBe(0);
  });

  it('never blocks with experimental status (no BOT_FLOW possible)', () => {
    // Even if only 5% would be frontend-routed, experimental ≠ block
    const trades = Array.from({ length: 50 }, (_, i) => trade(i, false));
    const r = nonBotShare(trades, experimental);
    expect(r.share).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/nonBotShare.test.js`
Expected: FAIL — cannot resolve `../nonBotShare.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/nonBotShare.js`:
```js
// Non-bot share: experimental until validated against labeled transactions.
// Contributes NO score and cannot trigger BOT_FLOW before validation. (§12.1.2)
//
// Ground-truth labels (named, not vague):
//   Bot:    wallets inside Jito bundles; known trading-bot program IDs;
//           repeat first-block buyers across >= 3 launches.
//   Manual: long multi-protocol histories with CEX funding and no bundle interaction.
//   Excluded: everything else (ambiguous — do not force-label).
//
// BOT_FLOW armed only after classifier clears a predeclared precision floor.

export function nonBotShare(trades, classifier) {
  const n = trades.length;
  const contract = {
    share: null, sampleSize: n,
    classifierVersion: classifier.version,
    classifierStatus: classifier.status,          // "experimental" | "validated"
    precision: classifier.precision ?? null,
    recall: classifier.recall ?? null,
  };
  if (classifier.status !== 'validated') return contract;      // display only, never scored/blocked
  if (n < 30) return { ...contract, evidence: 'insufficient' }; // insufficient ≠ block
  const manual = trades.filter(t => classifier.isFrontendRouted(t)).length;
  return { ...contract, share: manual / n, evidence: 'sufficient' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/nonBotShare.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/nonBotShare.js backend/src/features/__tests__/nonBotShare.test.js
git commit -m "feat(features): nonBotShare — experimental classifier contract (§12.1.2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Funder graph — coordinated ownership via UnionFind (§12.1.3)

**Files:**
- Create: `backend/src/features/funderGraph.js`
- Test: `backend/src/features/__tests__/funderGraph.test.js`

> **Spec (§12.1.3):** Uses actual raw supply + decimals (not a fixed 1e9 denominator). Classifies suspicious components (>1 wallet, non-service shared funder) and excludes known CEX/router services. Primary risk value is the **maximum** suspicious component's supply share. The `fundingSourceFor` and `isKnownService` dependencies are injected — this plan delivers the graph algorithm, not the RPC funding-source tracer.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/funderGraph.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { bundleClusters } from '../funderGraph.js';

// All dependencies injected — no RPC needed.
const cfg = { funderLookbackMs: 24 * 3600_000 };
const isKnownService = (addr) => addr === 'binance_hot';
const rawSupply = 1_000_000n; // BigInt raw units

describe('bundleClusters (§12.1.3)', () => {
  it('identifies a suspicious cluster when 2+ wallets share a non-service funder', async () => {
    const buyers = ['w1', 'w2', 'w3'];
    const fundingSourceFor = async (w) => {
      if (w === 'w1' || w === 'w2') return 'shared_funder'; // suspicious link
      return null; // w3 is self-funded
    };
    const rawBalanceOf = (w) => {
      if (w === 'w1') return 200_000n;
      if (w === 'w2') return 300_000n;
      return 100_000n;
    };
    const r = await bundleClusters({
      buyers, creationTs: Date.now(), rawBalanceOf, rawSupply,
      fundingSourceFor, isKnownService,
    }, cfg);
    // w1 + w2 = 500_000 / 1_000_000 = 0.5
    expect(r.maxSuspiciousComponentPct).toBeCloseTo(0.5);
    expect(r.clusterCount).toBeGreaterThanOrEqual(2); // shared_funder cluster + self:w3
  });

  it('does not flag wallets funded by a known service (CEX is not coordination)', async () => {
    const buyers = ['w1', 'w2'];
    const fundingSourceFor = async () => 'binance_hot'; // known service
    const rawBalanceOf = () => 400_000n;
    const r = await bundleClusters({
      buyers, creationTs: Date.now(), rawBalanceOf, rawSupply,
      fundingSourceFor, isKnownService,
    }, cfg);
    // Both wallets → self:w1, self:w2 (no suspicious link through a known service)
    expect(r.maxSuspiciousComponentPct).toBe(0);
  });

  it('self-funded wallets each form their own single-wallet cluster (not suspicious)', async () => {
    const buyers = ['w1', 'w2', 'w3'];
    const fundingSourceFor = async () => null;
    const rawBalanceOf = () => 100_000n;
    const r = await bundleClusters({
      buyers, creationTs: Date.now(), rawBalanceOf, rawSupply,
      fundingSourceFor, isKnownService,
    }, cfg);
    expect(r.maxSuspiciousComponentPct).toBe(0);
    expect(r.clusterCount).toBe(3);
  });

  it('reports unionSuspiciousPct as a diagnostic (sum of all suspicious components)', async () => {
    const buyers = ['w1', 'w2', 'w3', 'w4'];
    const fundingSourceFor = async (w) => {
      if (w === 'w1' || w === 'w2') return 'funder_A';
      if (w === 'w3' || w === 'w4') return 'funder_B';
      return null;
    };
    const rawBalanceOf = (w) => {
      if (w === 'w1' || w === 'w2') return 100_000n;
      return 150_000n;
    };
    const r = await bundleClusters({
      buyers, creationTs: Date.now(), rawBalanceOf, rawSupply,
      fundingSourceFor, isKnownService,
    }, cfg);
    // Cluster A: 200_000/1_000_000 = 0.2; Cluster B: 300_000/1_000_000 = 0.3
    expect(r.maxSuspiciousComponentPct).toBeCloseTo(0.3);
    expect(r.unionSuspiciousPct).toBeCloseTo(0.5);
  });

  it('handles an empty buyers list', async () => {
    const r = await bundleClusters({
      buyers: [], creationTs: Date.now(), rawBalanceOf: () => 0n, rawSupply,
      fundingSourceFor: async () => null, isKnownService,
    }, cfg);
    expect(r.maxSuspiciousComponentPct).toBe(0);
    expect(r.clusterCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/funderGraph.test.js`
Expected: FAIL — cannot resolve `../funderGraph.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/funderGraph.js`:
```js
// Coordinated ownership: UnionFind over funding links. (§12.1.3)
// Uses ACTUAL raw supply (BigInt) — never a fixed 1e9 denominator.
// Primary risk value: maximum suspicious component's supply share → FARM blocker.

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x);
    const r = this.p.get(x);
    return r === x ? r : (this.p.set(x, this.find(r)), this.p.get(x));
  }
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

  const clusters = new Map();  // root -> { wallets, raw, funder }
  for (const w of buyers) {
    const root = uf.find(funderOf.get(w));
    if (!clusters.has(root)) clusters.set(root, { wallets: 0, raw: 0n, funder: root });
    const c = clusters.get(root);
    c.wallets++; c.raw += rawBalanceOf(w);          // BigInt raw units — never 1e9 SOL floats
  }

  // A component is "suspicious" only with supporting evidence: >1 wallet AND a non-service
  // shared funder.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/funderGraph.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/funderGraph.js backend/src/features/__tests__/funderGraph.test.js
git commit -m "feat(features): bundleClusters — coordinated ownership via UnionFind (§12.1.3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Top-10 ex-LP — resolved system account exclusion (§12.1.4)

**Files:**
- Create: `backend/src/features/topHolders.js`
- Test: `backend/src/features/__tests__/topHolders.test.js`

> **Spec (§12.1.4):** System accounts identified by fetched account authority / known PDA-vault relationships, never by size (fixes the "blindly skip the largest holder" hack). Token Program ownership alone is not an exclusion because normal token accounts share that owner. `rpc` and `resolvers` are injected — this plan delivers the algorithm, not the PDA resolution logic.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/topHolders.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { top10ExLp } from '../topHolders.js';

function makeRpc({ rawSupply, accounts }) {
  return {
    getMintInfo: async () => ({ rawSupply }),
    getTokenLargestAccounts: async () => accounts,
    getAccountAuthority: async (addr) => accounts.find(a => a.address === addr)?.authorityInfo ?? {},
  };
}

function makeResolvers(curveAddrs = [], ammAddrs = [], burnAddrs = []) {
  return {
    isCurvePool: (info) => curveAddrs.includes(info.authority),
    isAmmVault: (info) => ammAddrs.includes(info.authority),
    isBurn: (addr) => burnAddrs.includes(addr),
  };
}

describe('top10ExLp (§12.1.4)', () => {
  it('excludes curve pool and AMM vault accounts by resolved authority, not by size', async () => {
    const accounts = [
      { address: 'pool', rawAmount: 500_000n, authorityInfo: { authority: 'curve_pda' } },
      { address: 'amm', rawAmount: 300_000n, authorityInfo: { authority: 'raydium_vault' } },
      { address: 'u1', rawAmount: 100_000n, authorityInfo: { authority: 'user1' } },
      { address: 'u2', rawAmount: 50_000n, authorityInfo: { authority: 'user2' } },
    ];
    const rpc = makeRpc({ rawSupply: 1_000_000n, accounts });
    const resolvers = makeResolvers(['curve_pda'], ['raydium_vault'], []);
    const r = await top10ExLp(rpc, 'mint', resolvers);
    // Only u1 (100k) + u2 (50k) = 150k / 1M = 0.15
    expect(r.top10ExLpPct).toBeCloseTo(0.15);
    expect(r.resolvedExclusions).toBe(true);
  });

  it('excludes burn addresses', async () => {
    const accounts = [
      { address: 'burn_addr', rawAmount: 200_000n, authorityInfo: {} },
      { address: 'u1', rawAmount: 100_000n, authorityInfo: { authority: 'user1' } },
    ];
    const rpc = makeRpc({ rawSupply: 1_000_000n, accounts });
    const resolvers = makeResolvers([], [], ['burn_addr']);
    const r = await top10ExLp(rpc, 'mint', resolvers);
    expect(r.top10ExLpPct).toBeCloseTo(0.10);
  });

  it('keeps at most 10 non-excluded accounts', async () => {
    const accounts = Array.from({ length: 15 }, (_, i) => ({
      address: `u${i}`, rawAmount: BigInt(10_000 - i * 100),
      authorityInfo: { authority: `user${i}` },
    }));
    const rpc = makeRpc({ rawSupply: 1_000_000n, accounts });
    const resolvers = makeResolvers();
    const r = await top10ExLp(rpc, 'mint', resolvers);
    // Sum of top 10: 10000+9900+9800+...+9100 = 95500
    expect(r.top10ExLpPct).toBeCloseTo(95_500 / 1_000_000);
  });

  it('handles empty accounts list gracefully', async () => {
    const rpc = makeRpc({ rawSupply: 1_000_000n, accounts: [] });
    const resolvers = makeResolvers();
    const r = await top10ExLp(rpc, 'mint', resolvers);
    expect(r.top10ExLpPct).toBe(0);
  });

  it('does NOT exclude the largest holder by default (fixes defect #5)', async () => {
    const accounts = [
      { address: 'whale', rawAmount: 400_000n, authorityInfo: { authority: 'whale_user' } },
      { address: 'u1', rawAmount: 100_000n, authorityInfo: { authority: 'user1' } },
    ];
    const rpc = makeRpc({ rawSupply: 1_000_000n, accounts });
    const resolvers = makeResolvers();
    const r = await top10ExLp(rpc, 'mint', resolvers);
    // whale IS included — it's a real holder, not a system account
    expect(r.top10ExLpPct).toBeCloseTo(0.50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/topHolders.test.js`
Expected: FAIL — cannot resolve `../topHolders.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/topHolders.js`:
```js
// KNOWN_EXCLUDED: pump.fun curve PDA, Raydium/AMM vaults, burn address — resolved, not guessed.
// Never skip by size; resolve by authority. (Foundation report §12.1.4, fixes defect #5)

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/topHolders.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/topHolders.js backend/src/features/__tests__/topHolders.test.js
git commit -m "feat(features): top10ExLp — resolved authority exclusion, not size skip (§12.1.4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fresh wallets — age-based freshness + separate low-history (§12.1.5)

**Files:**
- Create: `backend/src/features/freshWallets.js`
- Test: `backend/src/features/__tests__/freshWallets.test.js`

> **Spec (§12.1.5):** Freshness (age-only) and low-history profiling are **separate** features. Rich profiling adds `lowHistoryShare` and must never mutate the count of wallets younger than the configured age. Both start at ZERO score weight (experimental). `walletAge` and `richProfile` are injected.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/freshWallets.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { freshWalletFeature } from '../freshWallets.js';

const cfg = { freshAgeMs: 72 * 3600_000, freshBoundary: [20, 60] };

describe('freshWalletFeature (§12.1.5)', () => {
  it('counts wallets younger than freshAgeMs as fresh', async () => {
    const buyers = ['w1', 'w2', 'w3', 'w4', 'w5'];
    const walletAge = async (w) => {
      if (w === 'w1' || w === 'w2') return 1_000; // very fresh
      return 999_999_999; // old
    };
    const r = await freshWalletFeature(buyers, walletAge, async () => ({}), cfg);
    expect(r.freshCount).toBe(2);
    expect(r.freshShare).toBeCloseTo(2 / 5);
  });

  it('returns freshShare: null for empty buyers', async () => {
    const r = await freshWalletFeature([], async () => 0, async () => ({}), cfg);
    expect(r.freshCount).toBe(0);
    expect(r.freshShare).toBeNull();
  });

  it('computes lowHistoryShare for boundary wallets when freshCount is in [lo, hi]', async () => {
    // 25 fresh (in [20, 60]) → triggers rich profiling of boundary wallets
    const buyers = Array.from({ length: 50 }, (_, i) => `w${i}`);
    const walletAge = async (w) => {
      const i = parseInt(w.slice(1));
      if (i < 25) return 1_000; // fresh
      if (i < 30) return cfg.freshAgeMs * 1.5; // boundary (between freshAgeMs and 2x)
      return cfg.freshAgeMs * 5; // old
    };
    const richProfile = async (w) => {
      const i = parseInt(w.slice(1));
      if (i === 25 || i === 26) return { txCount: 5, fundingSources: 1, hasDefiHistory: false };
      return { txCount: 50, fundingSources: 3, hasDefiHistory: true };
    };
    const r = await freshWalletFeature(buyers, walletAge, richProfile, cfg);
    expect(r.freshCount).toBe(25);
    // 5 boundary wallets (w25-w29), 2 of them are low-history → 2/5 = 0.4
    expect(r.lowHistoryShare).toBeCloseTo(0.4);
  });

  it('does NOT compute lowHistoryShare when freshCount is outside boundary', async () => {
    // 10 fresh (below [20, 60] boundary) → no rich profiling
    const buyers = Array.from({ length: 50 }, (_, i) => `w${i}`);
    const walletAge = async (w) => {
      const i = parseInt(w.slice(1));
      return i < 10 ? 1_000 : cfg.freshAgeMs * 5;
    };
    const r = await freshWalletFeature(buyers, walletAge, async () => ({}), cfg);
    expect(r.freshCount).toBe(10);
    expect(r.lowHistoryShare).toBeUndefined();
  });

  it('freshCount is never mutated by rich profiling', async () => {
    const buyers = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const walletAge = async (w) => {
      const i = parseInt(w.slice(1));
      if (i < 25) return 1_000;
      if (i < 30) return cfg.freshAgeMs * 1.5;
      return cfg.freshAgeMs * 5;
    };
    const richProfile = async () => ({ txCount: 2, fundingSources: 1, hasDefiHistory: false });
    const r = await freshWalletFeature(buyers, walletAge, richProfile, cfg);
    expect(r.freshCount).toBe(25); // MUST stay 25 regardless of profiling
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/freshWallets.test.js`
Expected: FAIL — cannot resolve `../freshWallets.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/freshWallets.js`:
```js
// Freshness (age-only) and low-history profiling are SEPARATE features.
// Rich profiling adds lowHistoryShare but NEVER mutates freshCount. (§12.1.5)
// Both start at ZERO score weight (experimental).

export async function freshWalletFeature(buyers, walletAge, richProfile, cfg) {
  let fresh = 0; const boundary = [];
  for (const w of buyers) {
    const age = await walletAge(w);                // batched RPC: oldest signature
    if (age < cfg.freshAgeMs) fresh++;
    else if (age < cfg.freshAgeMs * 2) boundary.push(w);
  }
  const feature = { freshCount: fresh, freshShare: buyers.length ? fresh / buyers.length : null };

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/freshWallets.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/freshWallets.js backend/src/features/__tests__/freshWallets.test.js
git commit -m "feat(features): freshWalletFeature — age-based freshness, separate lowHistory (§12.1.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Developer fingerprint — shrinkage-adjusted history (§12.1.6)

**Files:**
- Create: `backend/src/features/devFingerprint.js`
- Test: `backend/src/features/__tests__/devFingerprint.test.js`
- Modify: `backend/src/tape/tape.js` — add `launchesByCreatorCluster` query method.

> **Spec (§12.1.6):** Devs rotate wallets → identity links via funding-source tracing. History is shrinkage-adjusted toward the base rate at low sample size; "rug" is defined from the price series, not vibes. `fundingSourceFor` and `tape.launchesByCreatorCluster` are injected.

**Scope note:** `launchesByCreatorCluster` is added to the `Tape` class as a query method that looks up past launches by creator wallet or linked funder. This plan delivers the function and the `devFingerprint` algorithm. The actual funding-source tracing RPC (SOL transfer history) is wired at integration time — not built here.

- [ ] **Step 1: Write the failing test**

Create `backend/src/features/__tests__/devFingerprint.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { devFingerprint } from '../devFingerprint.js';

const baseRates = { prior: 0.15 }; // 15% base rug rate
const cfg = { rugWindowMs: 30 * 60_000, devConfidentN: 8, shrinkStrength: 5 };

function launch({ rugged = false, migrated = false, maxMcap = 10_000, devFirstSellTs = null }) {
  return {
    maxMcap,
    finalMcap: rugged ? maxMcap * 0.05 : maxMcap * 0.5,
    athTs: 1000, collapseTs: rugged ? 1000 + cfg.rugWindowMs * 0.5 : 1000 + cfg.rugWindowMs * 2,
    migrationTs: migrated ? 5000 : null,
    devFirstSellTs,
    creationTs: 0,
  };
}

describe('devFingerprint (§12.1.6)', () => {
  it('returns { known: false, coverage: 0 } for an unknown creator', async () => {
    const fundingSourceFor = async () => null;
    const tape = { launchesByCreatorCluster: async () => [] };
    const r = await devFingerprint('unknown_wallet', tape, fundingSourceFor, baseRates, cfg);
    expect(r.known).toBe(false);
    expect(r.coverage).toBe(0);
  });

  it('computes shrinkage-adjusted rug rate toward the base rate', async () => {
    const fundingSourceFor = async () => 'root_funder';
    const past = [
      launch({ rugged: true }), launch({ rugged: true }),
      launch({ rugged: false }), launch({ rugged: false }),
    ];
    const tape = { launchesByCreatorCluster: async () => past };
    const r = await devFingerprint('dev1', tape, fundingSourceFor, baseRates, cfg);
    expect(r.known).toBe(true);
    expect(r.launches).toBe(4);
    // shrink(k=2) = (2 + 0.15*5) / (4 + 5) = 2.75 / 9 ≈ 0.3056
    expect(r.rugRate).toBeCloseTo(2.75 / 9);
  });

  it('with zero past rugs, shrinkage pulls toward base rate', async () => {
    const past = [launch({}), launch({})]; // 2 launches, no rugs
    const tape = { launchesByCreatorCluster: async () => past };
    const fundingSourceFor = async () => null;
    const r = await devFingerprint('dev2', tape, fundingSourceFor, baseRates, cfg);
    // shrink(k=0) = (0 + 0.15*5) / (2 + 5) = 0.75 / 7 ≈ 0.1071
    expect(r.rugRate).toBeCloseTo(0.75 / 7);
  });

  it('tracks graduation rate from migration timestamps', async () => {
    const past = [launch({ migrated: true }), launch({ migrated: false }), launch({ migrated: true })];
    const tape = { launchesByCreatorCluster: async () => past };
    const fundingSourceFor = async () => null;
    const r = await devFingerprint('dev3', tape, fundingSourceFor, baseRates, cfg);
    // shrink(k=2) = (2 + 0.15*5) / (3 + 5) = 2.75 / 8 = 0.34375
    expect(r.graduationRate).toBeCloseTo(2.75 / 8);
  });

  it('coverage converges to 1 as launch count reaches devConfidentN', async () => {
    const past = Array.from({ length: 8 }, () => launch({}));
    const tape = { launchesByCreatorCluster: async () => past };
    const fundingSourceFor = async () => null;
    const r = await devFingerprint('dev4', tape, fundingSourceFor, baseRates, cfg);
    expect(r.coverage).toBe(1);
  });

  it('reports medianAthMcap and medianDevFirstSellMs', async () => {
    const past = [
      launch({ maxMcap: 5000, devFirstSellTs: 2000 }),
      launch({ maxMcap: 15000, devFirstSellTs: 4000 }),
      launch({ maxMcap: 10000 }),
    ];
    past[0].creationTs = 0; past[1].creationTs = 0; past[2].creationTs = 0;
    const tape = { launchesByCreatorCluster: async () => past };
    const fundingSourceFor = async () => null;
    const r = await devFingerprint('dev5', tape, fundingSourceFor, baseRates, cfg);
    expect(r.medianAthMcap).toBe(10000);
    expect(r.medianDevFirstSellMs).toBe(3000); // median of [2000, 4000]
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/devFingerprint.test.js`
Expected: FAIL — cannot resolve `../devFingerprint.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/features/devFingerprint.js`:
```js
// Shrinkage-adjusted creator-cluster history. Devs rotate wallets → identity links via
// funding-source tracing. "Rug" is defined from the price series, not vibes. (§12.1.6)

export async function devFingerprint(creatorWallet, tape, fundingSourceFor, baseRates, cfg) {
  const rootFunder = await fundingSourceFor(creatorWallet, 0, Infinity);
  const cluster = [creatorWallet];
  if (rootFunder) cluster.push(rootFunder);
  const past = await tape.launchesByCreatorCluster(cluster);
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

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/features/__tests__/devFingerprint.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Add `launchesByCreatorCluster` to the Tape class**

In `backend/src/tape/tape.js`, add the following method to the `Tape` class:
```js
  // Query past launches by creator wallet or linked funder cluster. (§12.1.6)
  // Returns rows with maxMcap, finalMcap, athTs, collapseTs, migrationTs, devFirstSellTs, creationTs.
  async launchesByCreatorCluster(wallets) {
    const { rows } = await this.db.query(
      `SELECT DISTINCT ON (e.asset_key)
         e.payload->>'creator' AS creator,
         e.asset_key,
         e.chain_ts AS creation_ts
       FROM events e
       WHERE e.type = 'token_created'
         AND e.payload->>'creator' = ANY($1)
       ORDER BY e.asset_key, e.chain_ts`,
      [wallets]);
    // NOTE: full launch summary (maxMcap, finalMcap, etc.) requires aggregating
    // market_snapshot and migration events per asset. For Phase 3, this returns
    // the foundation query; full aggregation is completed when score_evaluated
    // events and market snapshots are in the tape. The devFingerprint function
    // accepts the pre-aggregated result via its injected tape dependency.
    return rows;
  }
```

**Scope note:** The `launchesByCreatorCluster` method above is a **partial implementation** — it queries creator-linked token_created events but does not yet aggregate maxMcap/finalMcap/athTs from market_snapshot events (those events are not yet collected at sufficient depth). The `devFingerprint` function is designed to accept a pre-aggregated array and the tape query will be completed in WS9/WS10 when market snapshot collection is deeper. Tests use the injected `tape.launchesByCreatorCluster` mock with pre-aggregated data.

- [ ] **Step 6: Commit**

```bash
git add backend/src/features/devFingerprint.js backend/src/features/__tests__/devFingerprint.test.js backend/src/tape/tape.js
git commit -m "feat(features): devFingerprint — shrinkage-adjusted creator history (§12.1.6)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integrate structural features into `extractAllFeatures` (§22)

**Files:**
- Modify: `backend/src/features/extract.js`
- Modify: `backend/src/features/__tests__/extract.test.js`

> **Spec (§22 CI invariant #1):** Every feature family plugs into `extractAllFeatures` — the one function called by both live and replay. Phase 3 extends it to include the structural block. RPC-dependent features (`topHolders`, `freshWallets`, `devFingerprint`, `funderGraph`) are called only when the required data is available — they accept optional injected dependencies and return null results when absent.

- [ ] **Step 1: Write the failing test**

Update `backend/src/features/__tests__/extract.test.js` — add a new describe block:
```js
// Add to existing imports:
import { capitalFormation } from '../capitalFormation.js';

// Add after the existing tests:
describe('extractAllFeatures — structural features (Phase 3)', () => {
  it('includes capitalFormation in the output when trades are present', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: {
        creator: 'dev', rawSupply: '1000000000', decimals: 6,
        initialBuyLamports: 100, curve: 'curve1',
      }}),
      ...Array.from({ length: 6 }, (_, i) => row({
        chainTs: (i + 1) * 1000, type: EVENT_TYPES.TRADE_OBSERVED,
        payload: { side: 'buy', wallet: `w${i}`, lamports: 200 },
      })),
    ];
    const f = extractAllFeatures(events, { nowTs: 300_000, windowMs: 60_000, curveTargetSol: 2000 });
    expect(f.structural).toBeDefined();
    expect(f.structural.capitalFormation).toBeDefined();
    expect(f.structural.capitalFormation.primary).toBeTypeOf('number');
    expect(f.structural.capitalFormation.milestones).toBeDefined();
  });

  it('returns null capitalFormation when fewer than 5 buys', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: { rawSupply: '1', decimals: 0 } }),
      row({ chainTs: 1000, type: EVENT_TYPES.TRADE_OBSERVED, payload: { side: 'buy', wallet: 'w1', lamports: 100 } }),
    ];
    const f = extractAllFeatures(events, { nowTs: 300_000, windowMs: 60_000, curveTargetSol: 1000 });
    expect(f.structural.capitalFormation.primary).toBeNull();
  });

  it('includes nonBotShare placeholder with experimental classifier', () => {
    const events = [
      row({ chainTs: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: { rawSupply: '1', decimals: 0 } }),
      ...Array.from({ length: 6 }, (_, i) => row({
        chainTs: (i + 1) * 1000, type: EVENT_TYPES.TRADE_OBSERVED,
        payload: { side: 'buy', wallet: `w${i}`, lamports: 100 },
      })),
    ];
    const f = extractAllFeatures(events, { nowTs: 300_000, windowMs: 60_000, curveTargetSol: 1000 });
    expect(f.structural.nonBotShare).toBeDefined();
    expect(f.structural.nonBotShare.classifierStatus).toBe('experimental');
    expect(f.structural.nonBotShare.share).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/features/__tests__/extract.test.js`
Expected: FAIL — `f.structural` is undefined (the current extractor doesn't return it).

- [ ] **Step 3: Update extract.js to include structural features**

Modify `backend/src/features/extract.js`:
```js
import { EVENT_TYPES } from '../tape/identity.js';
import { bucketize } from './windows.js';
import { initSnapshot } from './snapshots.js';
import { capitalFormation } from './capitalFormation.js';
import { nonBotShare } from './nonBotShare.js';

// The default experimental classifier — zero weight, no blocking. Replaced when validated.
const EXPERIMENTAL_CLASSIFIER = {
  version: 'v0-experimental',
  status: 'experimental',
  precision: null,
  recall: null,
  isFrontendRouted: () => false,
};

// ONE extractor shared by live and replay (CI enforces the same reference — §22).
// Phase 2 assembled trade/event data; Phase 3 adds structural feature families.
// Phase 4 adds dynamic feature families. RPC-dependent features (holder, funder, dev) are
// called externally and injected via opts — extractAllFeatures is synchronous on tape events.
export function extractAllFeatures(events, opts) {
  const windowMs = opts?.windowMs ?? 60_000;
  const nowTs = opts?.nowTs ?? 0;
  const curveTargetSol = opts?.curveTargetSol ?? 85_000_000_000; // ~85 SOL in lamports (pump.fun default)

  const createdEvt = events.find(e => e.type === EVENT_TYPES.TOKEN_CREATED);
  const migrationEvt = events.find(e => e.type === EVENT_TYPES.MIGRATION_OBSERVED);
  const baselineEvt = events.find(e => e.type === EVENT_TYPES.BASELINE_CLOSED);

  const trades = events
    .filter(e => e.type === EVENT_TYPES.TRADE_OBSERVED)
    .map(e => ({ chainTs: e.chain_ts, side: e.payload.side, wallet: e.payload.wallet,
                 solLamports: e.payload.lamports, rawTokens: e.payload.rawTokens }));

  const fromTs = createdEvt?.chain_ts ?? (trades[0]?.chainTs ?? 0);
  const buckets = bucketize(trades, windowMs, fromTs, nowTs, nowTs);

  // Structural features — computed from tape events (no RPC needed for these two).
  const capForm = capitalFormation(trades, curveTargetSol);
  const botShare = nonBotShare(trades, opts?.classifier ?? EXPERIMENTAL_CLASSIFIER);

  // RPC-dependent structural features (injected via opts when available).
  // These are called externally and passed in; extractAllFeatures stays synchronous on events.
  const structural = {
    capitalFormation: capForm,
    nonBotShare: botShare,
    // Injected from external RPC calls (null until available):
    funderGraph: opts?.funderGraph ?? null,
    topHolders: opts?.topHolders ?? null,
    freshWallets: opts?.freshWallets ?? null,
    devFingerprint: opts?.devFingerprint ?? null,
  };

  return {
    created: createdEvt?.payload ?? null,
    baseline: baselineEvt?.payload ?? null,   // right-censoring evidence (null = still open / unknown)
    trades, buckets,
    migrated: !!migrationEvt,
    snapshot: migrationEvt
      ? initSnapshot({ mcap: migrationEvt.payload.anchorMcap, ts: migrationEvt.chain_ts })
      : null,
    structural,
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
Expected: PASS — all existing tests + the 3 new structural tests.

- [ ] **Step 5: Run the parity test to verify it still holds**

Run: `cd backend && npx vitest run src/features/__tests__/parity.test.js`
Expected: PASS (2 tests) — `causalFeatures` still delegates to the same `extractAllFeatures` reference.

- [ ] **Step 6: Commit**

```bash
git add backend/src/features/extract.js backend/src/features/__tests__/extract.test.js
git commit -m "feat(features): integrate capitalFormation + nonBotShare into extractAllFeatures (§22)

Structural feature block added to the shared extractor. RPC-dependent features
(funderGraph, topHolders, freshWallets, devFingerprint) are injected via opts and
default to null until external calls provide them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full regression + phase close

**Files:**
- No new files.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: all suites PASS — Phase 1 tape/scope/ingestion tests, Phase 2 baseline/monitor/ingestion/mcap/windows/snapshots/extract/parity tests, plus the new capitalFormation, nonBotShare, funderGraph, topHolders, freshWallets, devFingerprint tests.

- [ ] **Step 2: Verify the structural feature integration end-to-end**

Manually verify in the test output that `extract.test.js` shows the Phase 3 structural tests passing alongside the original Phase 2 tests — confirming backward compatibility.

- [ ] **Step 3: Verify parity invariant**

Run: `cd backend && npx vitest run src/features/__tests__/parity.test.js`
Expected: PASS (2 tests) — the single-extractor invariant is preserved.

- [ ] **Step 4: Commit the phase close**

```bash
git add -A
git commit -m "chore: Phase 3 complete — structural features + holder/funding evidence (WS5+WS6)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed)

**Spec coverage vs Phase 3 scope (§26 WS5–WS6):**
- Capital formation (§12.1.1): single-pass milestones, progress-per-swap efficiency, unknown ≠ 0 → Task 1.
- Non-bot share (§12.1.2): experimental classifier contract, ground-truth label types named, validation gate, zero initial weight → Task 2.
- Coordinated ownership / funder graph (§12.1.3): UnionFind, BigInt raw supply, max suspicious component (not union), known service exclusion → Task 3.
- Top-10 ex-LP (§12.1.4): resolved authority exclusion, never size-based skip (defect #5 resolution completed) → Task 4.
- Fresh wallets (§12.1.5): age-only freshness, separate lowHistoryShare, freshCount never mutated, both at zero weight → Task 5.
- Dev fingerprint (§12.1.6): shrinkage-adjusted rug/graduation/ATH/sell-timing, rug defined from price series, tape query added → Task 6.
- Integration into extractAllFeatures (§22 CI invariant): structural block added, parity test preserved → Task 7.

**Deferred-by-design (called out at their tasks, not gaps):**
- The actual non-bot classifier implementation (Jito bundle detection, known bot program IDs) is a research deliverable → delivered as contract only; activation requires labeled data and validation.
- The actual `fundingSourceFor` RPC tracer (SOL transfer history lookup) → wired at integration time; Task 3 delivers the graph algorithm.
- The actual PDA resolvers (`isCurvePool`, `isAmmVault`) for `top10ExLp` → wired at integration time; Task 4 delivers the exclusion algorithm.
- The `launchesByCreatorCluster` full aggregation (maxMcap from market_snapshot events) → completed when market snapshot depth is sufficient; Task 6 adds the foundation query.
- Dynamic features (flowState, efficiencyAnalogs, cohortRetention, derivatives) → Workstream 7 (Phase 4).
- Scorer, blockers, admission → Workstream 8 (Phase 4).
- Scoring configuration → Workstream 8 (Phase 4).

**Placeholder scan:** none — every code step contains runnable code and exact commands.

**Type consistency:** `capitalFormation`, `nonBotShare`, `bundleClusters`, `top10ExLp`, `freshWalletFeature`, `devFingerprint`, `extractAllFeatures`, `causalFeatures` — each defined once and referenced consistently. Reuses Phase 1 `assetKey`, `EVENT_TYPES`, `Tape` and Phase 2 `bucketize`, `initSnapshot`, `supplyAwareMcap` unchanged.

**Score-version note:** Phase 3 adds feature families but does not touch `CONFIG.version` — that constant is created in Phase 4 (WS8) when the scorer consumes these features. Any future change to a feature definition (e.g. changing the freshness age threshold) requires a `CONFIG.version` bump per §22.
