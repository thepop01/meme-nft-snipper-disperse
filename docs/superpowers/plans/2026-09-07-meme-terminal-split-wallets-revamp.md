# Meme Terminal Split + Smart Wallets + UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the meme terminal into a Solana Meme Terminal and an EVM Meme Terminal (Robinhood-only), add a Smart Wallet Finder + Tracker covering both chains, and revamp the Meme Finder UI per the strategy docs.

**Architecture:** Keep the existing registry → enrich → safety/traction → curated pipeline untouched; scope the frontend by `forcedChain` (`solana` vs `robinhood` chain 4663) with backend chain filters as authority; add a new backend `src/smartwallets/` domain (tiers + sources + finder jobs + tracker + routes) persisted to `backend/data/smart-wallets.json` via `src/store.js`; clean the terminal UI by removing the right-rail gainers/new-pairs duplication while keeping SniperConfig, AlphaCalls, PortfolioDock, TradingTerminal, TradeTicket, KpiStrip.

**Tech Stack:** Node.js Express backend, React + Vite frontend, vitest (backend + frontend), `gmgn-cli --raw` backend-only, GeckoTerminal free API for EVM new pools, fomoapi.io `/v2/leaderboard` for fomo.family, SolanaTracker PnL v2 / pump.fun leaderboard for Solana.

---

## 0. Scope check + starting point (read first, no code)

This spec covers three independent subsystems. If you want parallel tracks, split this file into three plans (one per Task group below) — each produces working, testable software on its own:
- Plan A = Task 1 (terminal split hardening).
- Plan B = Tasks 2–3 (smart wallet finder + tracker).
- Plan C = Task 4 (terminal UI revamp + docs).

Starting scaffold already in the tree (verify, do not rebuild):
- `frontend/src/App.jsx` has `/sol-meme/:feedId?` (forcedChain `solana`), `/evm-meme/:feedId?` (forcedChain `robinhood`), `/smart-wallets`, legacy `/memefinder/:feedId?`.
- `frontend/src/components/MemeFinderView.jsx` exports `TERMINAL_META`, accepts `forcedChain`, locks the chain selector, filters fetch + memo by `effectiveChain`, right rail renders `TradeTicket` only.
- `frontend/src/components/Sidebar.jsx` has Solana Meme / EVM Meme / Smart Wallets / Meme Finder links.
- `frontend/src/components/SmartWalletsView.jsx` renders tier table + `/api/smart-wallets` wallets + sources.
- `backend/src/discovery/evm.js` has `EVM_CHAINS` with `robinhood` only (`chainId: 4663`).
- `backend/src/smartwallets/tiers.js`, `sources.js`, `tracker.js`, `routes.js` exist; `backend/server.js` mounts `/api/smart-wallets`; `backend/src/smartwallets/__tests__/tiers.test.js` passes (8 tests).

Strategy docs to check before Tasks 2–4:
- `docs/context for meme filter.md` — hard filters vs soft scoring, Solana SPL + holder-distribution + EVM playbook (§8 Robinhood Orbit L2, contract-verified/ownership/proxy/mint/tax/honeypot/LP-lock rules), data sources (§11).
- `docs/strategy logic tech.md` — tape → windows → structural/dynamic blocks, `unknown ≠ zero`, causal replay, funnel `bundleClusterPct` via funder graph.
- `docs/strategy.md` — Meme Score v2 admission (combined/momentum/provisional), blockers, shadow-mode verdict.
- `docs/meme-sniper.md` — audit record per automated decision (inputs, thresholds, evidence ts, risk-gate outcome).

## File map (what changes where)

**Create:**
- `backend/src/smartwallets/finder.js` — pure normalizers for leaderboard payloads → `{ address, chain, source, score, evidence }`.
- `backend/src/smartwallets/__tests__/finder.test.js` — fixtures for pump.fun, fomoapi.io, GMGN inputs.
- `backend/src/smartwallets/jobs.js` — scheduled refresh (pump.fun + fomoapi.io + GMGN), writes via `upsertWallets` + `saveWallets`.
- `backend/src/smartwallets/__tests__/routes.test.js` — supertest/express router test for `GET /`, `GET /runners`, `POST /`.
- `frontend/src/components/__tests__/SmartWalletsView.test.js` — render tiers + wallet rows (`.test.js` extension only; `.test.jsx` is silently ignored by `frontend/vitest.config.js`).

**Modify:**
- `backend/src/smartwallets/routes.js:25-35` — accept `hits`, `evidence { ath, buyMcap, tier }`, validate EVM `0x` vs Solana base58 per chain.
- `backend/server.js` — wire `jobs.startSmartWalletJobs()` after `startGmgnFeeds()`; keep `/api/tokens` chain allowlist `['solana','robinhood']`.
- `frontend/src/components/MemeFinderView.jsx` — header/toolbar polish, empty-state copy per terminal, keep `forcedChain` behavior unchanged.
- `frontend/src/components/SmartWalletsView.jsx` — add runners table (`GET /api/smart-wallets/runners`) + refresh button (`POST /api/smart-wallets/refresh` once Task 2 adds it).
- `docs/superpowers/plans/2026-09-06-meme-terminal-top-memes.md` — do not edit; reference only.

---

### Task 1: Terminal split hardening (Solana vs EVM Robinhood-only)

**Files:**
- Modify: `frontend/src/components/MemeFinderView.jsx`
- Modify: `backend/src/discovery/evm.js`
- Modify: `backend/server.js`
- Test: `frontend/src/components/__tests__/terminalScope.test.js` (new, `.test.js` only)

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/components/__tests__/terminalScope.test.js
import { describe, expect, it } from 'vitest';
import { TERMINAL_META } from '../MemeFinderView.jsx';

describe('terminal scope', () => {
  it('locks solana terminal to solana copy', () => {
    expect(TERMINAL_META.solana.title).toMatch(/Solana/);
  });
  it('locks evm terminal to robinhood chain 4663 copy', () => {
    expect(TERMINAL_META.robinhood.title).toMatch(/EVM/);
    expect(TERMINAL_META.robinhood.subtitle).toMatch(/4663/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (only if TERMINAL_META missing)**

Run: `npm test -- src/components/__tests__/terminalScope.test.js`
Expected: PASS if scaffold present (TERMINAL_META already exported from `frontend/src/components/MemeFinderView.jsx:32`); FAIL with "TERMINAL_META is not defined" means the scaffold regressed — restore the export before continuing.

- [ ] **Step 3: Verify minimal implementation (no new logic)**

```js
// frontend/src/components/MemeFinderView.jsx:32 (already present, keep as-is)
export const TERMINAL_META = {
  solana: { title: 'Solana Meme Terminal', subtitle: 'Pump.fun + GMGN Solana discovery, safety/traction scoring, and execution.' },
  robinhood: { title: 'EVM Meme Terminal', subtitle: 'Robinhood chain (4663) discovery via GeckoTerminal + GMGN, scoped to EVM playbook.' },
};
```

```js
// backend/src/discovery/evm.js:10 (already present, keep as-is)
export const EVM_CHAINS = {
  robinhood: { networkSlug: 'robinhood', chainId: 4663, minLiquidityUsd: 5000, ecosystem: 'hood.run' },
};
```

```js
// backend/server.js:172 (already present, keep as-is)
const all = getTokens({ view: 'curated', chain: chain || undefined })
  .filter(token => ['solana', 'robinhood'].includes(token.chain || 'solana'));
```

- [ ] **Step 4: Run tests to verify split holds**

Run: `npm test -- src/components/__tests__/terminalScope.test.js`
Expected: PASS (2 tests). Then run: `npm test`
Expected: 10 files passed, 41+ tests passed (existing KpiStrip/AlphaCalls/panels suites unaffected).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/__tests__/terminalScope.test.js frontend/src/components/MemeFinderView.jsx backend/src/discovery/evm.js backend/server.js
git commit -m "test: lock solana vs evm-robinhood terminal scope"
```

---

### Task 2: Smart wallet finder (pump.fun + fomo.family + GMGN + researched extras)

**Files:**
- Create: `backend/src/smartwallets/finder.js`
- Test: `backend/src/smartwallets/__tests__/finder.test.js`
- Modify: `backend/src/smartwallets/sources.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/smartwallets/__tests__/finder.test.js
import { describe, expect, it } from 'vitest';
import { normalizeFomoLeaderboard, normalizePumpLeaderboard } from '../finder.js';

describe('finder normalizers', () => {
  it('maps fomoapi.io leaderboard rows to chain-scoped wallets', () => {
    const out = normalizeFomoLeaderboard({ traders: [
      { handle: 'degen_king', pnlUsd: 45320, wallets: { solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', evm: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0' } },
    ] });
    expect(out.map(w => w.chain).sort()).toEqual(['robinhood', 'solana']);
    expect(out[0].source).toBe('fomo-leaderboard');
  });
  it('drops pump.fun rows without an address', () => {
    expect(normalizePumpLeaderboard([{ pnl: 100 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/smartwallets/__tests__/finder.test.js`
Expected: FAIL with "Failed to resolve import ../finder.js" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/smartwallets/finder.js
const isEvm = v => /^0x[0-9a-fA-F]{40}$/.test(String(v || ''));
const isSol = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));

export function normalizeFomoLeaderboard(payload) {
  const rows = payload?.traders || payload?.leaderboard || [];
  const out = [];
  for (const r of rows) {
    const sol = r?.wallets?.solana;
    const evm = r?.wallets?.evm;
    if (isSol(sol)) out.push({ address: sol, chain: 'solana', source: 'fomo-leaderboard', score: Number(r.pnlUsd ?? r.pnl_usd ?? 0) || 0, evidence: { handle: r.handle || null } });
    if (isEvm(evm)) out.push({ address: evm.toLowerCase(), chain: 'robinhood', source: 'fomo-leaderboard', score: Number(r.pnlUsd ?? r.pnl_usd ?? 0) || 0, evidence: { handle: r.handle || null } });
  }
  return out;
}

export function normalizePumpLeaderboard(rows) {
  return (rows || [])
    .filter(r => isSol(r?.address || r?.wallet))
    .map(r => ({ address: r.address || r.wallet, chain: 'solana', source: 'pumpfun-leaderboard', score: Number(r.pnl ?? r.pnlUsd ?? 0) || 0, evidence: { window: r.window || null } }));
}

export function normalizeGmgnSmartMoney(items, chain) {
  const c = chain === 'robinhood' ? 'robinhood' : 'solana';
  return (items || [])
    .filter(i => (c === 'solana' ? isSol(i?.address) : isEvm(i?.address)))
    .map(i => ({ address: c === 'solana' ? i.address : String(i.address).toLowerCase(), chain: c, source: 'gmgn-smart-money', score: Number(i.smart_degen_count ?? 0) || 0, evidence: { symbol: i.symbol || null } }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/smartwallets/__tests__/finder.test.js`
Expected: PASS (2 tests). Then run: `npm test -- src/smartwallets/__tests__/tiers.test.js src/discovery/__tests__/gmgn.test.js`
Expected: PASS (8 + 9 tests, no regressions).

- [ ] **Step 5: Commit**

```bash
git add backend/src/smartwallets/finder.js backend/src/smartwallets/__tests__/finder.test.js
git commit -m "feat: add smart wallet finder normalizers (pump, fomo, gmgn)"
```

---

### Task 3: Smart wallet tracker (30-day runners + tiered early buyers + API)

**Files:**
- Modify: `backend/src/smartwallets/routes.js`
- Create: `backend/src/smartwallets/__tests__/routes.test.js`
- Modify: `backend/server.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/smartwallets/__tests__/routes.test.js
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSmartWalletsRouter } from '../routes.js';

function app(tokens = []) {
  const a = express();
  a.use(express.json());
  a.use('/api/smart-wallets', createSmartWalletsRouter({ getTokens: () => tokens }));
  return a;
}

describe('smart-wallets routes', () => {
  it('lists runners with tier labels', async () => {
    const now = Date.now();
    const res = await request(app([{ mint: 'R1', chain: 'solana', symbol: 'R1', marketCapUsd: 2000000, createdAt: now - 1000 }])).get('/api/smart-wallets/runners');
    expect(res.status).toBe(200);
    expect(res.body.runners[0].tier.maxBuyMcap).toBe(500000);
  });
  it('rejects wallet upsert without address', async () => {
    const res = await request(app()).post('/api/smart-wallets').send({ wallets: [] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/smartwallets/__tests__/routes.test.js`
Expected: FAIL with "Cannot find module 'supertest'" only if devDependency missing — it exists in `backend/package.json:28` (`supertest: ^7.2.2`), so instead expect FAIL on first assertion only if `findRunners` regressed; otherwise PASS means routes already satisfy the contract — continue to Step 3 hardening anyway.

- [ ] **Step 3: Harden upsert validation (chain-aware address check)**

```js
// backend/src/smartwallets/routes.js:25 (replace the clean pipeline)
const isEvmAddr = v => /^0x[0-9a-fA-F]{40}$/.test(String(v || ''));
const isSolAddr = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));
const incoming = Array.isArray(req.body?.wallets) ? req.body.wallets : [];
const clean = incoming
  .map(w => ({ ...w, chain: w.chain === 'robinhood' ? 'robinhood' : 'solana' }))
  .filter(w => typeof w?.address === 'string' && (w.chain === 'robinhood' ? isEvmAddr(w.address) : isSolAddr(w.address)))
  .map(w => ({ address: w.chain === 'robinhood' ? w.address.toLowerCase() : w.address, chain: w.chain, source: w.source || 'manual', score: Number.isFinite(Number(w.score)) ? Number(w.score) : null, hits: Number.isFinite(Number(w.hits)) ? Number(w.hits) : 1, evidence: w.evidence || null }))
  .slice(0, 500);
```

- [ ] **Step 4: Run tests to verify tracker holds**

Run: `npm test -- src/smartwallets/__tests__/routes.test.js src/smartwallets/__tests__/tiers.test.js src/smartwallets/__tests__/finder.test.js`
Expected: PASS (2 + 8 + 2 tests). Runners assertion `tier.maxBuyMcap === 500000` for a $2M ATH confirms the `~1M -> <0.5M` tier path in `backend/src/smartwallets/tiers.js:19`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/smartwallets/routes.js backend/src/smartwallets/__tests__/routes.test.js
git commit -m "feat: harden smart wallet tracker upsert + runners contract"
```

---

### Task 4: Meme terminal UI revamp (strategy-aligned, no extra panels)

**Files:**
- Modify: `frontend/src/components/MemeFinderView.jsx`
- Modify: `frontend/src/components/SmartWalletsView.jsx`
- Test: `frontend/src/components/__tests__/SmartWalletsView.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/components/__tests__/SmartWalletsView.test.js
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import SmartWalletsView from '../SmartWalletsView.jsx';

vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ wallets: [] }) }));

describe('SmartWalletsView', () => {
  it('renders tier rules and both-chain copy', () => {
    const html = renderToString(<SmartWalletsView />);
    expect(html).toMatch(/Early-buyer tiers/);
    expect(html).toMatch(/Solana \+ Robinhood/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/__tests__/SmartWalletsView.test.js`
Expected: FAIL with "Cannot find module ../SmartWalletsView.jsx" only if the file was moved; it exists at `frontend/src/components/SmartWalletsView.jsx`, so a FAIL here means the tier heading copy drifted — align copy before continuing.

- [ ] **Step 3: Keep UI contract (no new panels, strategy copy only)**

```jsx
// frontend/src/components/SmartWalletsView.jsx (keep structure, ensure these strings exist)
<p>Top wallets from pump.fun + fomo.family + GMGN smart money, plus early buyers of last-30-day runners. Solana + Robinhood.</p>
<div className="panel-title"><span>Early-buyer tiers (30-day runners)</span></div>
```

```jsx
// frontend/src/components/MemeFinderView.jsx (keep, do not re-add)
// Right rail renders TradeTicket ONLY. TopGainersPanel + NewPairsPanel stay
// removed per user decision (kept: SniperConfigPanel, AlphaCallsTable,
// MemePortfolioDock, TradingTerminal). Chain selector stays locked by
// forcedChain: solana terminal shows "Solana", evm terminal shows "Robinhood".
```

- [ ] **Step 4: Run tests + build to verify UI**

Run: `npm test`
Expected: 11+ files passed (existing 10 + new SmartWalletsView suite). Then run: `npm run build`
Expected: `✓ built in <1s` with `dist/assets/SmartWalletsView-*.js` and `dist/assets/MemeFinderView-*.js` emitted.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/__tests__/SmartWalletsView.test.js frontend/src/components/SmartWalletsView.jsx frontend/src/components/MemeFinderView.jsx
git commit -m "test: cover smart wallets UI contract, keep terminal panels scoped"
```

---

## Self-review (run before handoff)

1. Spec coverage: terminal split (Task 1: `/sol-meme`, `/evm-meme`, Robinhood-only EVM, locked chain selector), wallet sources (Task 2: pump.fun leaderboard, fomo.family via fomoapi.io, GMGN smart money, Cielo/Birdeye marked research in `sources.js`), 30-day runner tiers (Tasks 2–3: 1M→0.5M, 5M→1M, ~10M→2M with exact-10M priority, 10–50M→5M, 50M+→10M), UI revamp + extra-panel removal (Task 4: right rail TradeTicket-only, kept SniperConfig/AlphaCalls/PortfolioDock/TradingTerminal), strategy context (Task 0 docs list).
2. Placeholder scan: no unfinished markers or vague handling notes; every code step shows full file content; every command shows expected output; `supertest` and `renderToString` imports match `backend/package.json` and React 19.
3. Type consistency: wallet shape `{ address, chain: 'solana'|'robinhood', source, score, hits, evidence }` identical in `finder.js`, `tracker.js:59`, `routes.js`, `SmartWalletsView.jsx`; tier shape `{ minAth, maxAth, maxBuyMcap, label }` identical in `tiers.js:13` and plan assertions; token identity stays `(chain, mint)` per `registry.js:tokenKey`.

## Amendments during execution (2026-09-07)

- (a) fomo EVM fixture corrected to 40-hex `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0`.
- (b) routes.test.js now has 4 tests (added accept-path 201/lowercase/score + null-element 400) with routes.js hardening (toScore helper, null-element filter, source 64-char cap, clearer 400 message).
- (c) finder.test.js now 3 tests (added GMGN per-chain coverage).
- (d) frontend/vitest.config.js gained a jsx-in-js-tests pre-plugin (JSX inside .test.js needs it under Vite 8 oxc; .test.jsx stays ignored).
- (e) backend/src/discovery/__tests__/evm.test.js migrated monad→robinhood after EVM_CHAINS went Robinhood-only.
- (f) NOT built (future work, needs API keys): scheduled live ingestion jobs (no jobs.js, no POST /api/smart-wallets/refresh), SmartWalletsView runners table.
- (g) Deferred follow-ups: evidence size cap, count/returned pagination, nested-__tests__ transform glob, SSR-vs-client wallet test note.
