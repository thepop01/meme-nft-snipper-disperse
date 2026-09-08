# Meme Finder and Sniper Specification

## Objective

Build a selective Solana meme-trading agent. It must not buy or even aggressively promote every new meme launch. New launches are raw observations; only a small, evidence-backed subset can become candidates.

## Current Logic Review

The current backend ingests every pump.fun launch and selected new Raydium pools. It then enriches and assigns a 0-100 score before each running bot checks source, score, liquidity, age, blacklists, and concurrent position count.

Important gaps:

- The bot can buy every token that clears those basic thresholds; it has no observation period, candidate quota, global risk budget, creator-quality threshold, market-behavior filter, or daily loss circuit breaker.
- Enrichment and safety analysis run only once shortly after launch, so scores can be stale while a token's market data develops.
- Raydium's three-second throttle discards excess pool events rather than queueing them for lookup.
- The attempted-buy flag is set before execution succeeds, preventing a controlled retry after a transient failure; skip statistics can increase repeatedly on update events.
- The holder check excludes the largest token account without proving it is an LP or bonding curve. This can make a concentrated token appear safer than it is.
- Pump.fun launches are scored before reliable liquidity, holder evolution, price stability, and transaction behavior exist. Missing evidence can still produce a score that crosses a permissive bot threshold.
- A Jupiter sell quote is useful but is neither a proof that the curve route works nor a complete honeypot simulation.
- The raw feed, analysis queue, and public RPC limits can delay or drop evidence. An automated decision must record data freshness and reject stale or incomplete evidence.

## Target Pipeline

```text
Discovery -> hard rejection -> observation -> feature extraction -> score
          -> ranked candidate queue -> strategy decision -> risk gate -> execution -> monitoring
```

### 1. Discovery

Ingest pump.fun, Raydium and approved Solana launch sources. Store every launch as an observation but do not auto-buy from the discovery event.

### 2. Hard Rejection

Reject before ranking when any required fact is missing or fails: invalid mint, blocked creator/name, mutable mint/freeze authority under the strategy policy, unverified liquidity/curve, no viable buy/sell route, abnormal token program, explicit risk-service failure, or an unsafe holder/creator condition.

### 3. Observation Window

Watch a token for a configurable period and minimum number of samples. Re-enrich and re-score at approximately 1, 3, 8, and 15 minutes. Track price, liquidity, unique buyers/sellers, buy/sell ratio, volume, holder change, creator actions, and pool/curve state. The window prevents buying a token solely because it was new.

### 4. Scoring and Candidate Selection

Score only complete, fresh observations. Use explainable weighted features:

- verified authorities, pool/curve ownership, liquidity and lock/burn evidence;
- holder concentration after excluding only verified pool, LP, and burn accounts;
- creator wallet history and linked-wallet activity;
- organic transaction and holder growth, volume consistency, and sell pressure;
- metadata/social provenance as a small signal only;
- quote quality, route depth, estimated price impact, and exit viability.

Promote a token to the curated queue only when it meets the safety/liquidity threshold, has at least two complete observations, and demonstrates non-negative traction. Discard rugs, persistently low-score tokens, and unproven tokens that age out. Rank candidates and cap the queue. A strategy may examine the top `N` candidates per interval, rather than every launch.

### 5. Agent Decision and Risk Gate

Each named agent has source allowlists, strategy threshold, observation duration, candidate limit, cooldowns, creator/token blacklists, max price impact, max slippage, per-trade size, max open positions, exposure cap, daily loss limit, and a kill switch. Agent mode watches a curated candidate and requires confirmation; sniper mode can enter directly from the curated event. Neither reacts to raw discovery events.

The risk gate independently enforces global exposure and loss limits. It may reject a high-scoring candidate. Every rejection and buy records the inputs, thresholds, evidence timestamp, and reason.

### 6. Execution and Monitoring

Start in replay and paper mode. For live mode, re-quote immediately before signing, cap slippage/price impact, use bounded priority fees, and verify the submitted transaction. Monitor positions for stop loss, take profit, trailing stop, time exit, liquidity collapse, creator sell activity, and loss-limit trip.

## Default Strategy

Use one conservative paper agent by default: approved sources only, verified authority state, verified liquidity, a completed observation window, high confidence threshold, one small position, strict max price impact, and daily-loss lockout. The finder defaults to the curated queue, with an explicit raw-feed toggle for investigation. Live mode stays disabled until replay and paper-trading acceptance criteria pass.

## Acceptance Criteria

- Raw launches appear as observations, while the candidate queue contains only the configured top subset with clear reasons.
- The holder calculation identifies verified excluded accounts rather than blindly omitting the largest account.
- Every automated decision has an immutable audit record and a risk-gate outcome.
- Replay and paper tests cover rejection, buy, exit, stale data, RPC failure, and circuit-breaker behavior before live trading is enabled.
