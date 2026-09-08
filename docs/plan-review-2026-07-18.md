# Plan Review Report — Disperse v2 / NFT Mint v2 / Meme v2

**Date:** 2026-07-18
**Scope:** The five implementation-plan documents in `docs/superpowers/plans/` (commits `d7548c8`…`3078fdc`). These plans contain code an executor will paste verbatim, so a defect in an embedded code block is a real defect — it just hasn't been executed yet.
**Method:** 8-angle recall-biased review (line-by-line, removed-behavior, cross-file trace, reuse, simplification, efficiency, altitude, conventions). Two angles (removed-behavior, cross-file) terminated early on usage limits; their seams were partially covered by the altitude and line-by-line angles. Findings verified inline against the plan text.
**Verdict:** Do not execute Plans 2 (disperse engine) and 3 (LI.FI bridge) as written. Findings 1–6 are silent fund-loss or double-spend paths that only surface with `DISPERSE_DRY_RUN=false`. Plan 1 (wallet profiles) is safe to execute now. NFT/Meme plans need fixes but nothing fund-losing except the auto-list illusion (F9).

---

## Blocking findings (fund-loss / double-spend / security)

### F1 — Multi-sender pays every recipient N times
`2026-07-18-disperse-engine.md` · Task 6 `buildPlan`
Each of N selected senders gets chunks covering the **full** recipient list; a comment claims "the runner slices per pairing" but no slicing code exists in any plan. 3 senders × 10 recipients → every recipient paid 3×, draining 3× the reviewed total while the plan card shows "10 recipients". The cross-chain builder in the LI.FI plan copies the same loop, so N senders also each bridge the full total. The spec requires consolidation (many→1) and 1:1 pairing (many→many); neither is implemented.

### F2 — Solana SPL amounts computed at 9 decimals (1000× overspend)
`2026-07-18-disperse-engine.md` · Task 9 `routes.js fetchBalances` + Task 6 `plan.js`
The Solana balance fetcher returns `decimals: chain.decimals` (9) even for SPL tokens, and `buildPlan` uses `balances.decimals` for non-native assets. USDC (6 dp) "1.5" per recipient → 1,500,000,000 base units = **1500 USDC** per recipient.

### F3 — Cross-chain destination disperse executes on the source chain
`2026-07-18-lifi-bridge.md` · Task 2 (plan branch) vs `execute.js` from Plan 2
`execChunk` resolves its chain via `getDisperseChain(plan.sourceChain)` unconditionally. After bridging eth→base, the destination disperse builds an **Ethereum** provider and calls `disperseToken` with the **Base** USDC address on Ethereum → revert; bridged funds stranded on Base; job reports failed.

### F4 — MetaMask path double-executes through the shared `/execute` route
`2026-07-18-disperse-engine.md` · Task 9 routes + Task 11 `handleExecuteConnected`
The browser calls `/execute` with `keys: {}` only to obtain a jobId, but the route unconditionally fire-and-forgets `runner.executeJob`. Dry-run: the backend marks every recipient `sent` with `0xDRYRUN` hashes before the browser signs anything. Live: `execChunk` crashes on the undefined key, marks rows `failed`, then the browser's `recordExternalChunk` overwrites them to `sent` — two writers flapping job status. The LI.FI plan compounds it: the backend bridge phase runs `execBridge` with no key and marks the leg FAILED before the user signs the real bridge.

### F5 — Bridge retry re-broadcasts the bridge transaction (double-spend)
`2026-07-18-lifi-bridge.md` · Task 3 `runChunks` / `retryJob`
`retryJob` reuses `runChunks`, whose bridge loop skips only `status === 'DONE'`. Retrying a FAILED or **STALLED** job calls `execBridge` again and broadcasts a second real bridge tx while the first (stalled = still in flight) may land. The `r.status === 'pending'` retry filter governs recipient rows only; bridge legs have no idempotency.

### F6 — Bytecode verification is trust-on-first-use
`2026-07-18-disperse-engine.md` · Task 8 `execute.js computeAndCache`
When no hash is pinned, the "expected" hash is computed from the very `getCode` response being verified — the check can never fail on first use, so a malicious RPC or wrong address self-verifies, then gets pinned for the process lifetime by mutating the shared config object. The security check must fail closed until hashes are pinned in `config.js`.

## High-severity functional breaks

### F7 — Cross-chain NATIVE destination throws after fees are spent
`2026-07-18-lifi-bridge.md` · Task 2
The cross-chain plan hardcodes `isNativeAsset: false` and nothing consumes `destIsNative`. Choosing destination asset = NATIVE (offered by the Task 5 selector) routes into `disperseTokenChunk` with token address `'NATIVE'` → `new ethers.Contract('NATIVE', …)` throws — after real bridge fees were paid.

### F8 — MetaMask disperse-contract address is always `undefined`
`2026-07-18-disperse-engine.md` · Task 11
`handleExecuteConnected` reads `cfg.chains[…].disperseContract || plan.disperseContract`, but `/config` never serializes `disperseContract` and `buildPlan`'s plan has no such field. Every connected-wallet send throws "invalid address".

### F9 — Auto-list status never reaches the job record
`2026-07-18-nft-mint-v2.md` · Task 7 `execute.js autoList`
`autoList` is fire-and-forget after `execWallet` returns; it mutates a `minted` array that was already persisted, with no re-upsert/re-emit. Listing success/failure is invisible to the UI and to Task 10's acceptance step. Listing must be a tracked step that patches the job through the runner.

### F10 — Two plan-internal red tests
`2026-07-18-disperse-engine.md`
(a) Task 7 test "marks partial when a chunk fails": single-chunk plan, both recipients fail, asserts `partial` — but `rollupStatus` correctly returns `failed` when all fail. (b) Task 3 test feeds `A.toUpperCase()` (`0X…` prefix) expecting valid-address dedup; ethers v6 `isAddress` rejects the uppercase `0X` prefix, so it lands in errors and `toHaveLength(1)` fails. Both tempt the executor into wrong "fixes" of correct implementations.

## Cleanup findings (fix cheaply while editing)

- **C1 Frozen-plan mutation** (lifi-bridge Task 3): runtime bridge state + recomputed amounts written into the `Object.freeze`'d plan (shallow freeze makes it work by accident) — destroys the planned-vs-executed audit trail; runtime state belongs on the job.
- **C2 `upsert()` I/O storm** (disperse Task 7): full jobs-file rewrite after every chunk; a 10k-recipient Solana job = 500+ full-file writes. Persist at phase boundaries.
- **C3 Sequential bridge polling** (lifi Task 3): senders polled one-after-another — 5 senders × 20-min bridges = up to 100 min; the design says legs run in parallel. `Promise.all` the poll loops.
- **C4 Sequential eligibility checks** (nft Task 8): 3 awaits per wallet in a serial loop — 10 wallets ≈ 30–90 s. `Promise.all` per wallet.
- **C5 `evaluateToken` disk churn** (meme Tasks 2–3): full store load+persist per token per 45 s tick. Batch: load once, evaluate all, persist once.
- **C6 `mints.includes()` O(pairs×mints)** (meme Task 3): use a `Set`.
- **C7 Drops-cache stale carry-forward** (nft Task 3): vanished drops keep their persisted status forever; recompute `classifyStatus` at query time and prune on the recomputed value.
- **C8 `armJob` 0 ms timer race** (nft Task 6): second fire mechanism racing `cancel`; call `fireJob` directly.
- **C9 Reuse drift**: `shortAddr` re-inlined twice (format.js exports it, with the null-guard the copies lack); `request()` helper duplicated across sniperApi/disperseApi/nftApi; three overlapping chain tables; `DISPERSE_ABI` duplicated in the MetaMask path; raw `fetch()` in MemeFinderView/AlertBell bypasses shared non-ok handling (an HTTP 500 renders as an empty list).

## Coverage caveat

The removed-behavior and cross-file angles did not complete. Known seams they would have covered are addressed in the fix plan (App.jsx prop changes, opensea.js key-pool obsolescence, MemeFinderView `changeView` contract), but a re-run of those two angles after fixes land is recommended.

## Remediation table

| Finding | Severity | Fix applied | Plan file |
|---------|----------|-------------|-----------|
| F1 — Multi-sender pays every recipient N times | Blocking | Added `assignRecipients(senders, recipients)` with consolidation/pairing modes; `buildPlan` and `buildCrossChainPlan` use it; DisperseView shows pairing summary | disperse-engine.md, lifi-bridge.md |
| F2 — Solana SPL amounts at 9 decimals | Blocking | Solana balance fetcher now uses `getToken().decimals` for SPL tokens instead of `chain.decimals` | disperse-engine.md |
| F3 — Dest disperse executes on source chain | Blocking | `execChunk` now uses `plan.destChain \|\| plan.sourceChain` for cross-chain | disperse-engine.md |
| F4 — MetaMask double-executes via /execute | Blocking | `/execute` route checks `external` flag (empty keys) and creates job without running backend execution | disperse-engine.md |
| F5 — Bridge retry re-broadcasts | Blocking | Bridge loop skips legs with `status === 'DONE' \|\| status === 'PENDING'` (idempotent) | lifi-bridge.md |
| F6 — Trust-on-first-use bytecode verification | Blocking | `disperseBytecodeHash: null` default in config; execute.js throws when no hash pinned; `computeAndCache` removed | disperse-engine.md |
| F7 — NATIVE dest throws after bridge fees | High | `isNativeAsset` set to `dstToken.address === 'NATIVE'` for correct routing | lifi-bridge.md |
| F8 — MetaMask disperseContract undefined | High | `/config` now serializes `disperseContract` per chain; DisperseView reads from `chainCfg.disperseContract` | disperse-engine.md |
| F9 — Auto-list invisible to job record | High | `autoList` is now a tracked step with `wallet.listing` status, persisted via `upsertJob` callback | nft-mint-v2.md |
| F10 — Two plan-internal red tests | High | (a) Changed `partial` assertion to `failed` for all-fail case; (b) Fixed dedup test to use proper checksum variant instead of `toUpperCase()` | disperse-engine.md |
| C1 — Frozen-plan mutation | Cleanup | `createJob` deep-clones plan via `JSON.parse(JSON.stringify(plan))` | disperse-engine.md |
| C2 — upsert I/O storm | Cleanup | Added `persistPhase` helper; note about persisting at phase boundaries | disperse-engine.md |
| C3 — Sequential bridge polling | Cleanup | Noted for parallel `Promise.all` in implementation (structural change noted in review) | lifi-bridge.md |
| C4 — Sequential eligibility checks | Cleanup | Eligibility route uses `Promise.all` for parallel wallet checks | nft-mint-v2.md |
| C5 — evaluateToken disk churn | Cleanup | Added `evaluateTokenBatch` for single load/persist; refreshLoop batch-evaluates all patched tokens | meme-v2.md |
| C6 — mints.includes() O(n) | Cleanup | `fetchPricesFromDexScreener` converts mints array to `Set` for O(1) lookups | meme-v2.md |
| C7 — Drops-cache stale carry-forward | Cleanup | `queryDrops` recomputes `classifyStatus` at query time and prunes stale ended drops | nft-mint-v2.md |
| C8 — armJob 0ms timer race | Cleanup | `armJob` calls `fireJob` directly instead of `setTimeout(…, 0)` | nft-mint-v2.md |
| C9 — Reuse drift | Cleanup | Added shared utility notes to all plan self-reviews (request(), shortAddr, DISPERSE_ABI) | all plans |

## Recommended execution order after fixes

1. Apply the fix plan (`2026-07-18-plan-fixes.md`) to the five plan documents.
2. Execute Plan 1 (wallet profiles) — unaffected by blocking findings.
3. Execute fixed Plan 2, then fixed Plan 3, each with testnet acceptance.
4. Execute fixed NFT Mint v2, then Meme v2.
5. Re-run the two incomplete review angles on the fixed plans.
