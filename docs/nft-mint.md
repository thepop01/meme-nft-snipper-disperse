# NFT Mint Specification

## Objective

Automatically discover live and upcoming NFT mints from the selected OpenSea source across its supported chains, allow users to choose eligible drops and wallets, then execute mint jobs reliably at the configured time.

## Current State & Execution Hardening

- The product discovers live and upcoming drops via OpenSea's drops API across supported chains (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, and Zora).
- Browser-side scheduled minting and client-side private key decryption have been deprecated and disabled for safety.
- All automated and scheduled mint execution is orchestrated through the backend NFT engine with pre-simulation (`provider.call`), native value caps, and gas caps.
- Transactions are strictly verified against reviewed sale adapters (`opensea-rest`). Unreviewed or custom sale standards are categorized as `manual-only` or `discover-only` and rejected from automated execution.

## Support Model

Initial OpenSea discovery matrix: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, and Zora. Provider availability may vary by chain and time; a chain without returned drops is shown as unavailable or empty, never silently treated as complete coverage.

Every chain and source must declare one of these states:

- `discover-and-execute`: source and sale contract standard are supported.
- `discover-only`: the drop is visible but needs manual execution because the contract is custom or unsupported.
- `unavailable`: no trusted source or adapter is available.

## Discovery Requirements

1. Fetch OpenSea `active` and `upcoming` drops concurrently for each declared chain. Tolerate a failing chain response and cache successful results for five minutes to respect API limits.
2. Normalize each drop into chain, contract, sale type, stage, start/end, supply, price/currency, quantity limits, allowlist method, source URL, media, and source-status fields.
3. Deduplicate by chain plus contract plus stage, retain source provenance, and reconcile changed schedules.
4. Classify drops as `upcoming`, `live`, `ended`, `sold-out`, `unknown`, or `manual-only`; provide Live, Upcoming, and All tabs with a chain filter.
5. Search, filter, and alert by chain, source, live state, time window, price, and supported execution status.

## Execution Requirements

1. Persist schedules in the backend database and execute them through durable workers; restart must not lose jobs.
2. Use server-side encrypted credentials, an external signer, or a connected-wallet signing session. Do not rely on browser local-storage private keys for unattended operation.
3. Synchronize time, calculate a chain-specific send lead time, simulate the mint, validate wallet/phase limits, and estimate gas before submission.
4. Build transactions only through a sale-standard adapter or a contract-specific reviewed adapter. Never guess calldata from collection metadata.
5. Enforce maximum unit price, maximum total cost, maximum gas/priority fee, maximum wallet quantity, and an optional stop-on-first-success policy.
6. Record every attempt, transaction hash, receipt, error, and final per-wallet outcome. Notify on success, failure, and schedule changes.

## Contract Adapters

Start with clearly identifiable public-mint implementations. Add allowlist/merkle claims, third-party mint APIs, and custom sale contracts only with a verified ABI and test coverage. A failed/unknown allowlist probe must be displayed as unknown, not as not eligible.

## Acceptance Criteria

- The UI shows normalized live and upcoming drops on every declared source/chain with its support status.
- A scheduled testnet job survives worker restart and produces a complete audit trail.
- An unsupported sale is never automatically executed.
- No unattended mint requires a browser tab or plaintext/decryptable browser-stored private key.
