# NFT Mint v2 — Design

**Date:** 2026-07-18
**Status:** Approved in brainstorming; pending implementation plan.
**Supersedes:** the execution parts of `doc/nft-mint.md` (its support-model rules and acceptance criteria still apply).

## Summary

Move NFT mint discovery and execution to the backend: cached OpenSea drops across 8
chains with ended/sold-out mints hidden, durable scheduled mint jobs that survive
restarts, gas caps + an "all-in" gas mode, per-wallet eligibility/affordability
checks, direct mint-page links, auto-list-after-mint, and a shared in-app alert
center. Keys come from the Plan 1 wallet profile (hybrid model); the old
browser-only `mintScheduler.js`/`crypto.js` path is removed.

## Decisions (locked)

| Question | Decision |
|---|---|
| Execution home | Backend job engine (like disperse); browser timers + localStorage schedules removed. |
| Keys | Plan 1 sender-wallet profile, hybrid flow (decrypt per-job → POST → memory only → wiped). Old `crypto.js` single-key store deleted. |
| Discovery | OpenSea only, done right: backend-cached, 8 chains, active+upcoming, ended/sold-out hidden by default. |
| Gas | Max fee/priority caps + live gas display + `all-in` mode (remaining balance after mint cost becomes the gas budget). No speed presets. |
| Extras | In-app alert center (no Telegram), mint preflight simulation + stop-on-first-success, auto-list after mint. |

## 1. Discovery (backend-cached drops)

New module `backend/src/nft/`:

- **Fetcher** (`drops.js`): every 5 min, fetch OpenSea `active` + `upcoming` drops
  for Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, Zora
  concurrently. A failing chain never blocks others. Cache in
  `backend/data/nft-drops.json` with per-chain fetch timestamps.
  `OPENSEA_API_KEY` lives in backend `.env` only.
- **Normalization**: drop → `{ chain, slug, contract, name, image, stages[],
  startTime, endTime, supply, price, status }`. Status computed server-side:
  `upcoming | live | ended | sold-out | unknown`. Dedup by chain+contract+stage.
  Schedule changes on refetch are reconciled and alerted if a scheduled job
  references the changed stage.
- **Old mints hidden**: `ended`/`sold-out` excluded from the default feed;
  queryable via the All tab; pruned from cache after 7 days.
- **API**: `GET /api/nft/drops?status=live|upcoming|all&chain=&q=` serves the
  cached set. `nft:drops` WS event on cache update. Drops first seen <24h ago
  carry a `isNew` flag (NEW badge).
- **Direct mint link**: every drop card links to its OpenSea drop page
  (`https://opensea.io/collection/<slug>/drops`, falling back to the collection
  page).
- Unsupported/custom sale contracts are marked `manual-only`: visible, linked,
  never auto-executed.

## 2. Mint Job Engine

New `backend/src/nft/mintRunner.js` + routes, mirroring disperse patterns.

```
MintJob {
  id, createdAt, status: scheduled → armed → minting →
    completed | partial | failed | cancelled | awaiting-keys,
  drop: { chain, slug, contract, name, image, stageIndex, stageLabel, price },
  scheduledTime,                       // stage start or custom override
  wallets: [{ address, quantity, status, txHash?, error?, gasUsed?,
              listing?: 'listed' | 'list-failed' | null }],
  gas: { mode: 'caps' | 'all-in', maxFeeGwei?, maxPriorityGwei? },
  policy: { stopOnFirstSuccess, abortIfGasAboveCap, maxTotalCostWei?,
            autoList?: { multiplier?|fixedPriceEth?, durationDays: 7 } }
}
```

Persisted in `backend/data/nft-mint-jobs.json`.

- **Scheduler**: backend timers; on boot all `scheduled` jobs re-arm from disk.
  Custom fire-time override (earlier/later than stage start). Cancel any time
  before firing.
- **Keys (hybrid)**: schedule carries no keys. The UI prompts to arm the job —
  decrypted keys POST to `POST /api/nft/jobs/:id/arm`, held in an in-memory map,
  wiped after execution; never logged or persisted. A job reaching fire time
  un-armed pauses as `awaiting-keys` and fires as soon as keys arrive.
- **Gas**:
  - `caps`: tx `maxFeePerGas`/`maxPriorityFeePerGas` never exceed the user caps.
    If base fee > cap at fire time, `abortIfGasAboveCap` chooses abort vs.
    retry each block up to 2 min.
  - `all-in`: per wallet, gas budget = balance − mint cost − dust buffer;
    `maxFeePerGas` set so `gasLimit × maxFee ≤ budget`.
  - `GET /api/nft/gas?chain=` returns current base fee + priority estimate;
    UI refreshes every 15 s.
- **Execution**: per wallet — preflight `eth_call` of the exact mint calldata
  (revert/not-eligible/not-started caught before gas is spent) → submit → wait
  receipt → record. Wallets run in parallel; `stopOnFirstSuccess` cancels the
  rest after the first confirmed success. All attempts audit-logged and streamed
  (`nft:job` WS events).
- **Calldata**: only via the OpenSea sale-standard adapter (moved server-side
  from `opensea.js` with tests). Never guessed from metadata.
- `NFT_DRY_RUN` env (default true) simulates mint + listing without
  broadcasting.

## 3. Wallet Panel + Auto-List

**Eligibility & selection panel** on the drop detail card:

- Lists profile sender wallets (EVM) and recipient-group addresses with source
  badges: `profile` (executable) vs `watch-only` (visible, not selectable).
- Columns: label/address · live native balance on the drop's chain ·
  eligibility · affordability (balance vs. price×qty + gas estimate; ✓ or
  shortfall) · include checkbox.
- Eligibility via `POST /api/nft/eligibility`: server-side `eth_call`
  simulation of the real mint calldata per wallet → `eligible | not-eligible |
  unknown` with revert reason. The old `isWhitelisted()` probe survives only as
  a secondary hint. Unknown is displayed as unknown, never as not-eligible.
- Bulk actions: select all eligible · all affordable · clear.

**Auto-list after mint**:

- Per-job option: list minted NFTs at X× mint price or a fixed ETH price;
  duration default 7 days.
- After a wallet's mint confirms, minted token IDs are read from receipt
  `Transfer` logs; an OpenSea listing is created via the Seaport SDK signed with
  the wallet key still in job memory.
- Listing failures never affect mint status — recorded per token as
  `list-failed`, retryable from the job card. Backend retries for up to 10 min
  (new collections index slowly on OpenSea).

## 4. Alert Center + UI + Testing

**Alert center** (shared with Meme v2):

- `backend/src/alerts.js`: `pushAlert({ type, title, body, severity, link? })`
  → stored in `backend/data/alerts.json` (last 200) → WS `alert:new`.
- Frontend: sidebar bell with unread count, dropdown panel, deep links; toasts
  for `critical`.
- NFT events: job armed/fired/success/partial/failed, gas-above-cap abort,
  schedule change on a scheduled drop, new drop matching a watched collection.

**Rebuilt NFTMintBotView**:

1. Drops browser — Live/Upcoming/All tabs, chain chips, search, NEW badges;
   cards show image/name/chain/price/countdown/status + ↗ mint-page link +
   Schedule (or `manual-only` tag).
2. Drop detail — phase timeline, wallet panel, gas panel (live fee + mode
   picker), quantity, custom fire time, stop-on-first-success + auto-list
   toggles, Schedule.
3. Jobs board — scheduled/armed jobs (countdown, Cancel, Arm now); finished
   jobs (per-wallet txs, listing status, audit log). One-time migration of
   localStorage mints to the backend, then `mintScheduler.js` and `crypto.js`
   are deleted.

**Testing**: vitest — normalizer status classification (ended/sold-out hidden),
scheduler restart recovery, gas math (caps + all-in incl. dust buffer),
calldata builder against sale-standard fixtures, eligibility simulator (mocked
provider), stop-on-first-success, token-ID extraction from receipt logs.
Manual acceptance: a scheduled testnet mint surviving backend restart, a
gas-capped abort, an all-in mint, an auto-list on a testnet collection.

## Out of Scope (v2)

- Magic Eden / Zora / launchpad discovery sources.
- Telegram/Discord notifications.
- Solana NFT mints.
- Allowlist/merkle-proof claim adapters (drops needing them stay `manual-only`).
