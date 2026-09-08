# Plan — Meme Finder v3 redesign, sleeper/revival capture, routing, blank-screen fix
_Date: 2026-07-19. Case study: Udin (`2aQK…hpump`) — created 2025-03-26, dormant ~16 months, revived to ~$893k ATH mcap on 2026-07-15, still trading at ~$647k._

## Why Udin matters (what the scanner must learn)

Udin is an **aged revival**, a class the current system structurally cannot catch:

- The pump.fun launch feed only sees tokens **at creation**. Udin launched 16 months before the bot ever ran.
- The tracked tier (sleeper wake, climber detection — already built and working) only watches tokens **we observed and promoted**, retained max 14 days.
- Conclusion: revivals must be discovered by **market-wide momentum scanning**, not launch-time observation. When an old coin wakes, the signals are: h1 volume ≫ trailing baseline, txn breadth (many small buys), attention boosts (DexScreener), trending placement. All of these are visible on free APIs *after* momentum starts — which is exactly when the user wants to find them.

## Current state (audited today)

- Backend already has: dormant state + spike wake, tracked tier (`data/tracked.json`, wake detection, climber detection), `/api/tracked` GET/POST/pin/DELETE, WS events `token:tracked:wake`, `token:climber`. **None of it is surfaced in the UI.**
- MemeFinderView: 3-column terminal (strategy rail / scanner+workspace / trade ticket) + portfolio dock. Works, but no Tracked view, no wake/climber display, un-memoized scanner rows (code-review finding), and crashes to a **full white screen** for the user (no ErrorBoundary anywhere — any render error blanks the entire app).
- Navigation: `activeTab` state + localStorage. No router, no URLs — `localhost:5173/mintbot` is meaningless today.

---

## Task 0 — Blank screen: reproduce, fix root cause, add ErrorBoundary (do first)

**Files:** `frontend/src/components/ui/ErrorBoundary.jsx` (new), `frontend/src/App.jsx`, guards in `MemeFinderView.jsx` / `meme/*.jsx`

1. Add a class-based `ErrorBoundary` (componentDidCatch) wrapping **each view** in `App.jsx`'s render switch. On crash it renders an error card with the message + stack and a "Back to dashboard" button — a tab crash can never white-screen the whole app again.
2. Reproduce: run backend (`node backend/server.js`) + `npm run dev`, open Meme Finder with DevTools console; the boundary will also surface the real error text.
3. Fix the root cause + harden the fragile spots found in audit (all unguarded, data-dependent):
   - `TokenScanner` row: `token.mint.slice(0, 8)` and row render assume `token` and `token.mint` exist → skip malformed entries (`if (!token?.mint) return null`).
   - `TokenWorkspace:46`: `token.mint.slice(...)` → guard.
   - `MemePortfolioDock:95,104,107`: `position.mint.slice`, `order.mint.slice` → `(x.mint || '').slice`.
   - Clear stale `memeActiveFeed` localStorage if it points to a deleted list.
4. Acceptance: Meme Finder renders with live backend data; killing the backend mid-session degrades to the offline banner, not a crash.

## Task 1 — Real URL routing (`localhost:5173/mintbot`)

**Files:** `frontend/package.json` (+`react-router-dom@7`), `frontend/src/main.jsx`, `App.jsx`, `Sidebar.jsx`, `DashboardView.jsx`

- `BrowserRouter` in main.jsx; routes `/dashboard`, `/wallets`, `/disperse`, `/mintbot`, `/memefinder`, `/sniper`, `/bots`; `/` redirects to last-visited tab (localStorage) else `/dashboard`; wildcard → redirect `/dashboard`.
- Sidebar buttons → `NavLink` (active styling from `isActive`), delete `activeTab`/`setActiveTab` prop threading; `DashboardView` quick-links use `useNavigate`.
- Meme Finder feed in the URL: `/memefinder/:feedId?` (e.g. `/memefinder/tracked`, `/memefinder/list:abc`) so scans are shareable/bookmarkable; falls back to saved feed.
- Vite dev/preview already SPA-fallback; note in README that any prod static server needs history fallback.
- Acceptance: typing `localhost:5173/mintbot` opens Mint Bot directly; browser back/forward moves between tabs; refresh keeps the page.

## Task 2 — Backend: Movers & Revivals discovery (the Udin catcher)

**Files:** `backend/src/discovery/movers.js` (new), `backend/src/discovery/__tests__/movers.test.js`, `server.js` (start feed), `registry.js` (accept `source: 'revival'`)

Poll two free, keyless sources every 3 min (well inside rate limits):
1. **GeckoTerminal** `GET /api/v2/networks/solana/trending_pools` — momentum ranking regardless of token age.
2. **DexScreener** `GET /token-boosts/latest/v1` — paid-attention signal (the "narrative arrived" moment), filter to solana.

Pipeline per candidate:
- Skip if pool age < 24h (young launches already come from the pump.fun feed) or liquidity < $20k.
- Compute **revival heat**: `h1Vol * 24 / max(h24Vol, ε)` ≥ 2.5 OR boosted OR trending-top-20. Skip if cold.
- `registerToken({ source: 'revival', revivedAgeDays, … })` → existing enrichment/safety/traction pipeline runs unchanged; **auto-promote straight into the tracked tier** (pinned=false) so the existing wake/climber detectors take over the ongoing monitoring.
- Emit `token:revival` + alert-center entry (`SLEEPER REVIVAL <sym> — <ageDays>d old, h1 vol x<N>`).
- Pure-function unit tests for the heat/age/liquidity filter (vitest, no network).

## Task 3 — Frontend: Meme Finder v3 layout

**Files:** `MemeFinderView.jsx`, `meme/StrategyRail.jsx`, `meme/TrackedPanel.jsx` (new), `meme/Sparkline.jsx` (new), `meme/TokenRow.jsx` (new, memoized), `utils/memeStrategies.js`, `utils/sniperApi.js` (+`api.tracked`, `api.trackToken`, `api.untrack`), `index.css`

Layout keeps the proven 3-column terminal shell, reorganized:

```
┌───────────┬──────────────────────────────────┬───────────┐
│ Strategy  │  [Scanner] [Tracked & Sleepers]  │  Trade    │
│ rail      │  toolbar: search/chain/filters   │  ticket   │
│           │  ────────────────────────────    │           │
│ + Movers  │  Wake-event strip (live)         │           │
│ + Tracked │  Token workspace (selected)      │           │
│   feeds   │  Scanner table OR Tracked table  │           │
├───────────┴──────────────────────────────────┴───────────┤
│ Portfolio dock (positions / orders / history / PnL)      │
└──────────────────────────────────────────────────────────┘
```

1. **New feeds in the rail** (top section "Signals"):
   - `Movers & Revivals` — strategy preset matching `source === 'revival'` or `ageDays > 7 && revival heat` (rules mirrored client-side in `memeStrategies.js`).
   - `Tracked & Sleepers` — switches center to the Tracked panel.
2. **Tracked panel** (`TrackedPanel.jsx`): table of `/api/tracked` entries — symbol, age, state, wake count + last wake reasons, `climber` badge, 24h `Sparkline` (tiny inline SVG from `entry.history`), promoted-reason, Untrack button. Live-updates on `token:tracked:wake` / `token:climber` WS events.
3. **Wake-event strip**: dismissible banner queue in the center column; a `token:tracked:wake` or `token:revival` event shows `⚡ SYMBOL woke: h1 vol 4.2x baseline` with click-to-select.
4. **Track button** on scanner rows + token workspace → `POST /api/tracked/pin` (manual pin, the "few selected tokens" flow).
5. **Perf fix** (code-review finding): extract `TokenRow.jsx` wrapped in `React.memo` keyed by mint+updatedAt so `token:update` WS ticks stop re-rendering ~300 rows.
6. Feed selection syncs to `/memefinder/:feedId` (Task 1).

## Task 4 — Verify + docs

- `cd frontend && npx vite build` clean; `npx vitest run` (frontend + backend) green.
- Manual pass: deep-link every route; Meme Finder with backend on/off; track→wake flow with a live token; Udin-style dry-run: confirm GeckoTerminal trending returns aged tokens and they appear in Movers feed with revival alert.
- Update `PLAN.md` + memory. DRY_RUN discipline untouched — Movers/Tracked are watch/alert only; entries route through the existing paper-trading ticket.

**Order:** 0 → 1 → 2 → 3 → 4. Tasks 0+1 are quick wins (~half day); Task 2 ~half day; Task 3 ~1–1.5 days.
