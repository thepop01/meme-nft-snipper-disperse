# Code Review — 2026-07-17

**Scope:** entire local codebase (~7,300 LOC, backend + frontend) vs. `origin/main` (README-only).
**Method:** 8 finder angles (2× line-by-line, cross-file tracer, reuse, simplification, efficiency, altitude, conventions) → 42 candidates → 38 after dedup → verify pass. **All 38 confirmed, none refuted.**

**Top theme:** every real-money path (mint execution, live buy/sell) lacks idempotency guards — timers, poll cycles, and API calls can all double-fire. Fix findings 1–5 before flipping `DRY_RUN=false`.

---

## Top 10 (ranked most severe first)

### 1. One key signs mints for every selected wallet — `frontend/src/utils/mintScheduler.js:176`
`executeMint` builds mint calldata for each selected wallet address but signs every transaction with the single stored private key. A 5-address group mint makes the one funded wallet broadcast 5 transactions paying 5× the mint price; each either reverts (`msg.sender ≠ minter`, gas burned 5×) or mints from the wrong account. Real money lost either way.

### 2. Duplicate timers double-mint — `frontend/src/utils/mintScheduler.js:229`
`restoreTimers` arms a new `setTimeout` per mint on every NFTMintBotView mount (NFTMintBotView.jsx:485) without clearing the old handle, and `executeMint`'s guard (line 143) only skips `'minted'`/`'cancelled'` — not `'minting'`. N tab-switches = N timers; at fire time the second callback passes the guard and re-runs the wallet loop → `wallet.sendTransaction` executes twice per wallet on a paid mint.

### 3. Position double-sell race — `backend/src/engine/positions.js:114`
`refreshPositions` runs on a 5s `setInterval` with no reentrancy guard; `closePosition` only sets `status='closed'` **after** `await executeSell` resolves. A slow cycle (350ms-throttled serial price fetches; live sells await confirmation 10–30s) overlaps the next tick: both evaluate the same position's TP/SL, both pass the status check → two real on-chain sells for the same tokens.

### 4. Live buy with null price → Infinity PnL, unsellable position — `backend/src/trading/executor.js:50`
The null-price throw exists only in the dryRun branch. Live-mode `executeBuy` executes the real swap when `fetchPriceUsd` returns null (token not on DexScreener yet, `onCurve=false` skips curve fallback) and returns `{tokenAmount: null, priceUsd: null}`. Position stores nulls → `pnlPct = Infinity` → TP fires instantly → `executeSell` computes amount `0` → swap rejected → position retries a broken exit every 5s forever while real SOL was spent.

### 5. Stale mints-array write-back revives cancelled mints — `frontend/src/utils/mintScheduler.js:221`
`executeMint` snapshots the mints array before minutes-long awaits (`tx.wait`) and writes the whole snapshot back at the end. A mint scheduled meanwhile is silently deleted; a mint cancelled meanwhile reverts to `'scheduled'` so `restoreTimers` re-arms and executes a paid mint the user explicitly cancelled.

### 6. Unvalidated fraction/solAmount on trade API — `backend/src/engine/positions.js:73` (+ `server.js:94`)
`fraction=5` sells 5× holdings (fabricated paper PnL or oversized live order); `fraction=-0.5` makes `soldTokens` negative so `tokenAmount` grows and `solSpent` ×1.5 — corrupted accounting. `/api/trade/buy` admits negative `solAmount`.

### 7. Live sell PnL recorded from pre-trade estimate — `backend/src/trading/executor.js:62`
`solReceived`/`priceUsd` computed **before** the swap from DexScreener (falling back to stale `currentPriceUsd` or even `entryPriceUsd` when DexScreener is down). A rug's stop-loss sell that filled at a fraction of entry is recorded near break-even in trades.json — permanently wrong realized-PnL history.

### 8. `chainChanged` → full reload aborts disperse mid-flow — `frontend/src/components/Sidebar.jsx:187`
`provider.on('chainChanged', () => window.location.reload())` registered at connect. DisperseView programmatically calls `wallet_switchEthereumChain` (DisperseView.jsx:144) → page reloads mid-flow, potentially after the MaxUint256 approve was paid but before the disperse tx. Wallet state and flow lost, no error message.

### 9. Agent-mode confirm skips blacklist/age/holding filters — `backend/src/engine/botManager.js:271`
`onWatchedUpdate` re-checks only traction/ratio/liquidity/pump/max-positions; `baseFilterReasons`' age, keyword/creator blacklist, source, and already-holding checks run once at curation only. Blacklisting a creator while the token sits on the watchlist doesn't stop the buy.

### 10. Position cap blind to in-flight buys — `backend/src/engine/botManager.js:282`
`maxConcurrentPositions` checked against `getPositions()` only. While `executeBuy` for token A awaits Jupiter (seconds), token B passes the same count → cap overshoot and SOL over-exposure. Same blindness in `baseFilterReasons` for sniper mode.

---

## Remaining confirmed findings (28)

### Correctness (8)
- **NFTMintBotView.jsx:86** — Unlock stores any typed password in sessionStorage with a success checkmark, no decrypt verification; wrong password surfaces only at mint fire time (drop missed). Plaintext password in sessionStorage beside the encrypted key defeats the encryption.
- **App.jsx:17** — unguarded `JSON.parse` of localStorage `walletGroups` in a useState initializer white-screens the app on corrupted data (same pattern in mintScheduler `loadMints`/`loadLog` and NFTMintBotView initializers).
- **DisperseView.jsx:170** — `approve(MaxUint256)` reverts for mainnet USDT (`0xdAC17F…`, offered in TOKENS) when an existing allowance is nonzero-but-insufficient; USDT requires reset-to-0 first. User pays gas for the failed approve and can never disperse USDT.
- **registry.js:171** — `trim()` evicts in insertion order past MAX_TOKENS (300) regardless of state, no `token:discarded` emitted → frontend still shows the token; Buy → 400 "Token not in registry".
- **registry.js:64** — analysisQueue overflow `shift()` can evict a token whose `nextPassAt` was already nulled by the tick → permanently starved of analysis passes, discarded at 45min age-out.
- **botManager.js:224** — the "failed buy stays eligible for one retry" contract is dead code: `token:curated` fires once; agent mode deletes the watchlist entry before `buy()`.
- **DashboardView.jsx:52** — "Open PnL" and "N open positions" computed over ALL positions (backend returns closed ones too, forever) — closed positions permanently inflate the stat.
- **NFTMintBotView.jsx:529** — `handleSchedule` ignores `scheduleMint`'s null return (stage missing `start_time`) → no error, no entry, mint silently never scheduled.

### Efficiency (6)
- **positions.js:123** — serial 350ms-throttled price fetches; ~8 positions exceed the 5s interval. Batch via DexScreener's 30-mint endpoint (`/latest/dex/tokens/{m1,m2,...}`).
- **positions.js:136** — `persist()` rewrites positions.json AND the full 1000-entry trades.json every 5s (~17k full-file writes/day); save trades only in `recordTrade`, debounce positions.
- **positions.js:98** — closed positions never pruned: unbounded array, rewritten every 5s, served whole by GET /api/positions.
- **DashboardView.jsx:42** — full `refresh()` (4 REST calls) on every `position:update` (per open position per 5s) → ~20 req/5s with 5 positions; apply the WS delta instead.
- **MemeFinderView.jsx:251** — every `token:update` re-renders ~100 un-memoized rows every ~2s; extract a `React.memo` TokenRow keyed by mint.
- **safety.js:61** — redundant `getTokenSupply()` RPC when `parsed.supply` was already captured at line 49; up to 5 wasted calls/token on a rate-limited public RPC.

### Reuse / simplification / altitude (14)
- **executor.js:46 + positions.js:39** — venue selection via inline `token.onCurve` ternaries; `position.onCurve` snapshotted at entry and never updated → graduated tokens sell through PumpPortal (softened by `pool:'auto'`). Deeper fix: venue table keyed off current token state.
- **botManager.js:58** — bots keep a second, unpersisted lifecycle (watchlists + decided Maps); restart wipes them; decided-cap can evict 'bought' entries with the position still open.
- **mintScheduler.js:250 / NFTMintBotView.jsx:207 / opensea.js / DisperseView.jsx:19** — chain config duplicated across 4 tables in 3 files (RPC map verbatim ×2 with silent `|| rpcs.ethereum` fallback; DisperseView uses incompatible hex-chainId scheme). One CHAINS table should own it.
- **safety.js:138-141 vs executor.js:88-91** — Jupiter v6 quote fetch duplicated; WSOL constant declared ×3 (executor.js:10, safety.js:134, raydium.js:9).
- **MemeFinderView.jsx:8 / SniperView.jsx:7** — `ago()` byte-identical ×2; `fmtUsd` ×2 with different semantics ($1.2M vs $0.00001234); `fmtSol` ×2 with different precision — same value renders differently per tab. Extract utils/format.js.
- **NFTMintBotView.jsx:256,344,411,606,673 / DashboardView.jsx:135** — address truncation inlined 6×, disagreeing on ellipsis and width; one call site unguarded. Extract `shortAddr()`.
- **mintScheduler.js:149** — raw `localStorage.getItem('encryptedPrivateKey')` bypasses crypto.js's exported `getEncryptedKey()` (already imported from).
- **Sidebar.jsx:105** — dead plumbing: `checkConnection` never called; `handleAccountsChanged` only ever passed to `removeListener` (never registered) so removals are no-ops; empty useEffect.
- **opensea.js:53** — `getAllDrops` (~54 lines), `removeApiKey`, and mintScheduler's `scheduleMintAtTime` exported but never imported anywhere.
- **BotsView.jsx:10** — EMPTY_FORM hard-codes all 18 numeric fields of backend PRESETS.standard, which arrives live via `backend?.presets` — two sources of truth.
- **registry.js:130 vs 159** — the 45-min discard rule implemented twice with identical reason string; keep it in the periodic tick only.
- **botManager.js:268 / registry.js:122,137** — inline magic thresholds (1.2 buy/sell ratio, $1000 peak-liquidity rug floor, -30% growth floor) while siblings live in PRESETS / config.js constants.
- **BotsView/SniperView/MemeFinderView/DashboardView** — four hand-rolled copies of refresh-on-mount + ws-reconnect + offline-banner + swallow-error, already divergent (3 different banner texts). sniperApi.js should export a `useBackend()` hook + shared banner.
- **check_disperse.js:3 / bot.js:7-10** — root scripts re-declare DISPERSE_ADDRESS and the ERC20 ABI from DisperseView.jsx; bot.js loops per-recipient `transfer()` doing what `disperseTokenSimple` does in one tx. Consolidate or retire.
