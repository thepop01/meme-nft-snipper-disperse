# Disperse v2 + Wallet Profiles — Design

**Date:** 2026-07-18
**Status:** Approved in brainstorming; pending implementation plan.
**Supersedes:** the execution parts of `doc/disperse.md` (its safety rules and acceptance criteria still apply).

## Summary

Rebuild the Disperse page so a user can send a native asset or token from one or many
stored wallets to one or many recipients, on any supported chain, with optional
cross-chain delivery (e.g. ETH on Ethereum delivered as ETH **or** USDC on Base) via
LI.FI. Add sender-wallet management (private keys) to the Wallets view, protected by a
profile password.

## Decisions (locked)

| Question | Decision |
|---|---|
| Key storage / signing | **Hybrid**: keys encrypted in browser (password), decrypted at job-submit, sent to local backend for execution, held in memory only, discarded after. |
| Cross-chain strategy | **Bridge once, then disperse**: one LI.FI bridge tx to the sender's own destination address, then a normal disperse there. |
| Multi-sender mapping | Many→1 = consolidation. Many→many = 1:1 pairing (round-robin if counts differ). |
| Chains | 7 EVM (Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche) **+ Solana** in this build. |
| Amount modes | Equal per recipient · Custom per recipient (paste/CSV) · Total split. |
| Key protection | Profile password → PBKDF2 → AES-256-GCM in localStorage. No recovery. |
| Sender types | Both connected MetaMask wallet (single-sender) and stored private-key wallets (single/multi). |
| Architecture | **Approach A**: backend job engine + thin frontend. |

## 1. Wallet Management (Profile)

Wallets view gains a **Sender Wallets** tab next to the existing Recipient Groups.
Dashboard gets a summary card (wallet count, per-chain balances).

- **Profile password** set on first key import. PBKDF2 (WebCrypto, ~300k iterations,
  random salt) derives an AES-256-GCM key. A verification blob (encrypted known
  string) validates the password. No recovery — lose it, re-import keys.
- Stored per wallet in localStorage:
  `{ id, label, address, chainFamily: 'evm'|'sol', encKey (ciphertext+iv), createdAt }`.
  Address derived at import (ethers / @solana/web3.js) so balances display without
  decrypting.
- **Session unlock**: derived key kept in page memory only; "Lock" button; auto-lock
  after 30 min idle.
- **Import**: paste one or many keys (one per line); EVM hex vs Solana base58
  auto-detected; auto-labels "Wallet 1…N".
- **Generate N fresh wallets** with a one-time downloadable key backup file.
- Balances column per selected chain (native + token) via public read-only RPCs.
- Raw keys are never written unencrypted anywhere; backend never persists them.

## 2. Disperse Page UX

Single panel, four zones:

1. **Source** — chain selector (7 EVM + Solana); sender mode toggle
   (Connected wallet | Stored wallets w/ balance checklist, select one or many);
   asset selector (Native, curated tokens, or Custom token address — validated,
   symbol/decimals/balance fetched).
2. **Destination** — destination chain (same chain = plain disperse; different =
   bridge+disperse); receive-asset picker populated from LI.FI-supported tokens
   (cross-token only via the bridge path — no same-chain swaps in v1); recipients
   via manual paste, recipient group picker, or CSV upload. Live validation:
   invalid lines flagged with row numbers, duplicates deduped with notice.
3. **Amount** — Equal | Custom per recipient | Total split (dust remainder to last
   recipient). MAX = (balance − gas reserve) as the **total**.
4. **Preview & execute** — plan card before any signing: sender→recipient mapping,
   totals, est. gas, bridge route/fee/ETA, actual receive amounts, tx count.
   "Review & Send" → password prompt if locked → job submits → inline progress
   tracker (per-step + per-recipient status, explorer links, live via WebSocket).
   **Retry failed** resumes only missing transfers.

## 3. Backend Job Engine

New `backend/src/disperse/` module; routes under `/api/disperse/*`; progress on the
existing WS bus; persistence via existing `store.js` in
`backend/data/disperse-jobs.json`.

```
Job {
  id, createdAt, status: planned → running → completed | failed | partial,
  source: { chain, asset, senders: [address...] },   // addresses only, never keys
  dest:   { chain, asset },
  recipients: [{ address, amount, status, txHash?, error? }],
  bridge?: { tool, quoteId, txHash, lifiStatus, received? },
  steps:  [{ type: approve|bridge|wait-bridge|approve-dest|disperse|transfer,
             status, txHash?, chunk? }]
}
```

- `POST /api/disperse/plan` — validate everything, fetch balances/decimals, LI.FI
  quote if cross-chain, gas reserve, chunk recipients (per-chain config: ~200/tx
  EVM, ~20/tx Solana). No keys involved. Returns the plan for the preview card.
- `POST /api/disperse/execute` — plan id + decrypted keys. Keys live in an
  in-memory `Map` keyed by jobId, wiped on completion/error, never logged or
  persisted.
- Steps run serially per sender with nonce management: exact-amount approve
  (unlimited only by explicit opt-in) → bridge tx → poll LI.FI status to `DONE` →
  destination disperse via the verified batch contract (bytecode-hash-checked per
  chain) or sequential transfers where none is verified. Solana: batched
  SPL/native transfers via versioned txs.
- Restart recovery: `running` jobs reload from disk; key-less steps (bridge
  polling) resume automatically; key-needing steps pause as `awaiting-keys` and
  the UI re-prompts.
- Every receipt recorded. Retry resolves on-chain nonce/tx status first — never a
  blind re-send. `POST /api/disperse/:id/retry` re-runs only failed recipients.
- **MetaMask path**: frontend uses the same plan, signs approve/bridge/disperse
  itself via ethers, POSTs each tx hash back so job tracking is identical.
  Single-sender only.

## 4. LI.FI Bridge Integration

`backend/src/disperse/bridge.js`, REST API `https://li.quest/v1` (no key).

- **Quote** at plan time: `GET /quote` with from/to chain+token, amount,
  `fromAddress`, and `toAddress` = the sender's own destination-chain address.
  Response supplies `estimate.toAmount`, costs, duration, tool, and a
  ready-to-sign `transactionRequest`. No route promised before the quote
  validates it; unsupported pairs are marked unavailable with the reason.
- **Slippage** default 0.5%, shown in preview. Destination disperse amounts are
  computed from the **actual received amount**, not the quote. Equal/total-split
  adjust automatically; custom amounts that exceed the received total pause the
  job as `underfunded` — user chooses top-up or proportional scale-down.
- **Execution**: exact approve to the quote's `approvalAddress` (ERC-20 source),
  send `transactionRequest`, then poll `GET /status` every 15 s until
  `DONE`/`FAILED`. `FAILED`/`REFUNDED` fails the job with the reason; refunds to
  the source address are detected and reported. Not terminal after 60 min →
  `stalled` (keep polling, alert user).
- **Multi-sender bridges** run in parallel (independent quotes/txs); destination
  disperse starts only when **all** legs are `DONE`.

## 5. Errors, Config, Testing

**Errors** — failures are scoped (recipient ⊄ chunk ⊄ job); jobs end `partial`
with per-recipient errors. Insufficient gas/balance is rejected at plan time with
exact shortfalls per sender. All `alert()` calls replaced by inline status + the
WS tracker.

**Config** (`backend/src/disperse/config.js`) — per chain: RPC URLs
(env-overridable), verified Disperse contract address + expected bytecode hash,
max recipients/tx, gas reserves, explorer URL, native symbol. Curated token lists
move here from the frontend, served by `GET /api/disperse/config`.

**Testing**
- Unit: split math incl. dust, address validation/dedup (EVM checksum + base58),
  chunking, encryption round-trip, gas-reserve logic.
- Integration (mocked RPC + LI.FI): full state-machine walk, failure/resume,
  underfunded pause, retry idempotency (no double-sends — the code-review's
  headline risk).
- Manual acceptance on Sepolia/Base Sepolia + Solana devnet before mainnet:
  native + ERC-20 disperse per chain, one bridge job, one multi-sender
  consolidation.
- `DISPERSE_DRY_RUN=true` default: simulate without broadcasting, mirroring the
  existing `DRY_RUN` convention.

## Out of Scope (v1)

- Same-chain token swaps (cross-token only via the bridge path).
- Pooled draining for many→many (1:1 pairing only).
- Password recovery for the profile.
- Bridging to/from chains outside the 7 EVM + Solana set.
