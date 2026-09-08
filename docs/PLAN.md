# Product Delivery Plan

## Goal

Turn the current three tools into reliable products:

- **Disperse and bridge:** batch native-token and ERC-20 transfers across the major EVM chains, with LI.FI bridge quotes and execution.
- **NFT Mint:** use OpenSea as the selected source to discover and track live and upcoming mints across its supported chains, then execute approved mint jobs reliably.
- **Meme Sniper:** a selective Solana trading agent that watches a small, explainable candidate set instead of buying every new launch.

Detailed requirements live in [`doc/`](doc/).

## Current Gaps

1. Disperse supports only Ethereum and BNB Chain, hard-codes one Disperse contract, accepts unvalidated recipients, grants an unlimited token approval, and has no bridge.
2. NFT minting is browser-only. It polls only OpenSea, shows ten upcoming drops, stores encrypted private keys in browser storage, and cannot guarantee a scheduled action when the browser is closed.
3. The meme finder is Solana-only and subscribes to raw pump.fun and Raydium launches. A bot can still auto-buy every launch that meets a simple score. Token analysis runs only once, Raydium throttling discards pool events, and the holder check incorrectly assumes the largest token account is a pool.

## Scope and Principles

- Ship an explicit chain-support matrix, not an unbounded claim of support for every chain.
- Keep signing material in a server-side signer or connected wallet flow; never keep unattended private keys in browser storage.
- Default every automation action to dry run, simulation, or explicit user approval.
- Persist jobs, decisions, execution attempts, and transaction receipts in a durable database.
- Make every automated buy or mint explainable: source data, checks, decision, and transaction must be auditable.

## Delivery Sequence

### Phase 0: Shared Foundation

1. Add a backend job runner, PostgreSQL persistence, migrations, structured logs, and WebSocket events for unattended or scheduled operations.
2. Add encrypted server-side wallet credential management or external signer support. Require explicit live-mode enablement per feature.
3. Create common chain metadata: chain ID, RPC, explorer, native token, finality policy, feature support, and health status.
4. Add test fixtures and a testnet/paper environment.

### Phase 1: Disperse

1. Implement the EVM disperse adapter for Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, and Linea.
2. Support native assets and arbitrary ERC-20s, recipient validation/deduplication, CSV import, equal and custom allocations, preflight simulation, fee estimate, and exact approval by default.
3. Add transaction tracking, retry rules, failure reporting, and nonce-safe per-wallet queues.
4. Add the LI.FI bridge adapter: obtain a quote, validate route and cost, request the exact approval, submit the returned transaction request, and monitor status until terminal.
5. Add a Solana adapter after the EVM path is stable, using SPL token transfers and transaction chunking.

### Phase 2: NFT Mint Discovery and Execution

1. Move discovery, scheduling, and execution from the browser to backend workers.
2. Ingest live and upcoming mints from OpenSea's drops API across the selected chains. Normalize each result, retain its source status, cache it briefly, and tolerate per-chain failures.
3. Ship initial EVM discovery for Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, and Zora. Label a chain `unavailable` when OpenSea does not return it; do not claim coverage beyond provider data.
4. Build mint adapters for supported sale standards and clearly label unsupported/custom contracts as manual-only.
5. Execute scheduled jobs with clock synchronization, preflight, wallet limits, gas controls, idempotency, receipt monitoring, and alerting.

### Phase 3: Selective Meme Sniper

1. Replace the raw-launch-first path with discovery, repeated observation, hard rejection, scoring, candidate selection, decision, and execution stages.
2. Correct ownership and liquidity analysis with verified pool/curve addresses. Add creator history, trading behavior, liquidity quality, holder evolution, and quote-based exit checks.
3. Re-analyze watched tokens at 1, 3, 8, and 15 minutes. Require a watch window and minimum evidence before a candidate can become eligible. Limit active candidates and enforce a global risk budget.
4. Build a per-strategy agent with allowlists, denylists, source selection, confidence threshold, cooldowns, daily loss limits, one controlled buy retry, and a full decision log.
5. Run paper trading and replay/backtesting before enabling a narrowly scoped live strategy.

### Phase 4: Frontend and Operations

1. Replace current local-only views with backend-backed job, wallet, activity, and audit pages.
2. Add chain filters, feature availability, live health, risk controls, and clear simulation/live indicators.
3. Add unit, integration, testnet, and failure-recovery coverage for every adapter.
4. Deploy monitoring for RPC failures, discovery lag, stuck transactions, job retries, and risk-limit trips.

## Exit Criteria

- Disperse completes an audited, simulated and then testnet batch on every declared supported chain.
- NFT discovery returns normalized live and upcoming drops on every declared supported source/chain, and scheduled jobs survive a backend restart.
- The meme agent logs rejections for most launches, promotes only evidence-backed candidates, and completes replay plus paper-trading acceptance checks before live mode is enabled.
