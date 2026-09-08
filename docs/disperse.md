# Disperse Specification

## Objective

Send a native asset or token to many recipients safely across major chains. "All major chains" is a maintained support matrix, not a hard-coded contract address or an open-ended promise.

## Current State

- The view supports only Ethereum and BNB Chain.
- USDC and USDT addresses are hard-coded.
- Every transfer uses the same EVM Disperse contract address without verifying deployment or bytecode on the active chain.
- It uses unlimited ERC-20 approval, does not validate or deduplicate recipients, and the `MAX` action assigns the full wallet balance to every recipient rather than a safe total allocation.

## Supported Chains

Initial EVM release: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, and Linea.

Second release: Solana native SOL and SPL tokens. Future adapters are added only after RPC, token-standard, transaction-size, and explorer support are defined.

## Required Behavior

1. Let the operator choose a supported chain, asset, sender wallet, and recipients.
2. Support native asset, known token list, and validated custom ERC-20/SPL token addresses.
3. Support equal amount, per-recipient custom amounts, and CSV import.
4. Normalize addresses, reject invalid addresses, remove duplicates, reject zero/negative amounts, and show the final total.
5. Fetch decimals and balance from chain. Reserve native-token gas before allowing a maximum allocation.
6. Preflight with `eth_call`/simulation, estimate fees, show the exact total, and require a confirmation of the summarized operation.
7. For ERC-20s, approve the exact required amount by default. Permit an unlimited approval only as an explicit opt-in.
8. Submit through an adapter-owned batch mechanism when it is verified for that chain; otherwise chunk direct transfers while preserving nonce order and receipt tracking.
9. Record every job, recipient, transaction, result, and retry in the backend database.

## Bridge

Use LI.FI as the bridge aggregator. The bridge flow obtains a route quote for the selected source and destination chain, asset, amount, and sender; displays received amount, gas/cost, route, and ETA; then asks the user to sign the returned transaction request. ERC-20 approval must be exact by default. Track the transaction through LI.FI status until it reaches a terminal state.

Supported bridge routes are determined at quote time by LI.FI. The UI must not promise a token or chain route before the quote validates it.

## Architecture

```text
UI -> Disperse API -> validation + planner -> chain adapter -> signer/connected wallet
                                      |                     -> simulation/fee estimate
                                      -> database + event stream
```

- `ChainAdapter`: address validation, asset metadata, balance, fee estimation, simulation, batch construction, and confirmation policy.
- `BatchPlanner`: chunks recipients by chain limits and returns an immutable execution plan.
- `Signer`: either connected-wallet signing for interactive jobs or a server-side/external signer for approved unattended jobs.
- `JobRunner`: serializes nonces per sender, retries only idempotent/known-pending operations, and monitors receipts.

## Safety Rules

- Never use the current unlimited approval default.
- Verify the active-chain contract address and code hash before using a deployed batch contract.
- Do not attempt to disperse the full token balance while leaving no gas for execution.
- Never resend a transaction merely because the RPC response was lost; first resolve nonce and transaction status.
- Keep chain-specific recipient limits and transaction-size limits in configuration.

## Acceptance Criteria

- Invalid and duplicate recipients cannot be submitted.
- Plans show correct totals, exact approvals, gas reserve, and transaction chunks before signing.
- Each declared EVM chain passes a native-token and ERC-20 testnet batch with full receipt reporting.
- A partial failure is visible per recipient/chunk and can be reconciled without duplicating completed transfers.
