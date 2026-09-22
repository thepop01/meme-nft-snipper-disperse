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
Discovery -> hard rejection (tri-state admission & Token-2022 TLV inspection)
          -> observation -> feature extraction -> score
          -> ranked candidate queue -> strategy decision -> risk gate
          -> durable two-phase execution -> monitoring
```

### 1. Discovery

Ingest pump.fun, Raydium and approved Solana launch sources. Store every launch as an observation but do not auto-buy from the discovery event.

### 2. Hard Rejection & Tri-State Admission

Reject before ranking when any required fact is missing, failed, or unknown (`pass`, `fail`, `unknown` model):
- Required checks: `mintOwner`, `mintAuthority`, `freezeAuthority`, `sellRoute`, and `token2022Extensions`.
- Token-2022 inspection: parses TLV extension blocks directly and rejects dangerous extensions (transfer hooks, permanent delegates, non-transferable flags, transfer fees).
- Blocked creator/name, unverified liquidity/curve, no viable buy/sell route, abnormal token program, explicit risk-service failure, or unsafe holder/creator concentration.

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

---

## Distributed Runner Discovery & Early Buyer Intelligence

### Dual-Chain Historical Discovery (Solana & Robinhood Chain)
Discovers historical runner meme tokens across the previous 6 months:
1. **Solana**: Paginated Pump.fun coins (`/coins?sort=market_cap` & `last_trade_timestamp`) and GeckoTerminal Solana pools (`/networks/solana/pools`).
2. **Robinhood Chain (EVM)**: GeckoTerminal Robinhood pools (`/networks/robinhood/pools`, `/trending_pools`) and DexScreener search (`chainId: 'robinhood' | 'rh'`).
3. **Thresholds**: Tokens qualify if Current Mcap $\ge \$2\text{M}$ (Worker 1) or All-Time High (ATH) Mcap $\ge \$4\text{M}$ with valid timestamp $T_{\text{ATH}}$ (Worker 2).
4. **Registry & Deduplication**: Canonicalized contract addresses (Solana Base58 case-preserved, EVM lowercase hex) stored in `tracked-memes.json` with unioned discovery flags (`sourceFlags`), pre-resolved `poolAddress`, and system mint exclusions (SOL, WETH, USDC, USDT, and zero addresses).

### Pre-ATH Early Buyer Extraction (Worker 3)
1. **Queue Processing**: Evaluates unbackfilled tokens sequentially per chain (`batchSize = 3` for Solana, `batchSize = 2` for Robinhood) to prevent API burst limits.
2. **Trade Ingestion**:
   - **Solana**: Multi-provider failover rotation across Birdeye (`sort_type=asc` with pagination up to 12 pages $\times$ 50 swaps), GMGN CLI (`gmgn token traders --tag sniper`), Helius Enhanced Transactions SWAP API, and Pump.fun genesis trade check.
   - **Robinhood Chain**: GeckoTerminal DEX pool trades (`/networks/robinhood/pools/{poolAddress}/trades`) with in-memory `tokenPoolCache` to bypass redundant pool address resolution, with fallback to GMGN CLI (`--chain robinhood`).
3. **Canonical Qualification Rules (`selectEarlyBuyersDual`)**:
   - *Strict Pre-ATH Cutoff*: Only trades occurring strictly before the ATH timestamp ($T_{\text{trade}} < T_{\text{ATH}}$) qualify.
   - *Value Rule (25% of ATH Tiers, Min ATH $\ge \$1\text{M}$)*:
     - ATH $\ge \$50\text{M} \rightarrow$ Entry buy Mcap $\le \$12.5\text{M}$
     - ATH $\$8\text{M} - \$50\text{M} \rightarrow$ Entry buy Mcap $\le \$2.5\text{M}$
     - ATH $\$3\text{M} - \$8\text{M} \rightarrow$ Entry buy Mcap $\le \$1.25\text{M}$
     - ATH $\$1\text{M} - \$3\text{M} \rightarrow$ Entry buy Mcap $\le \$250\text{k}$
   - *Chronological Quota Rule (`earlyBuyerLimitForAth`)*: First $N$ buyer wallets before ATH, where $N = 100 + 20 \times \lfloor(\text{athMcap} - 1\text{M}) / 1\text{M}\rfloor$ ($1\text{M} \rightarrow 100$, $5\text{M} \rightarrow 180$, $10\text{M} \rightarrow 280$, $50\text{M} \rightarrow 1,080$).
   - *Mandatory Trade Profitability (`isTradeProfitable`)*: Verified positive realized PnL (`profitUsd > 0` or `sellPrice > buyPrice`). Losing trades or unverified holds are strictly excluded.
   - *Dual Union*: Wallets qualifying under both methods are preserved with `methods: ['buying_mcap', 'first_n_buyers']` and tagged accordingly.
4. **Zero Raw Transaction Storage**: Trade payloads are evaluated strictly in-memory; individual swap records and transaction histories are never saved to disk. Only qualifying wallet metadata, tags, and execution metrics are persisted via `persistWallets()`.
5. **Rate Limiting & Circuit Breaker**: All endpoints are throttled via per-source promise serialization with quiet-interval enforcement (`lastCallTs` recorded post-request), automatic 429/403 backoff, and 60-second cooldown recovery.

---

## Dual-Chain Meme Finder Architecture (Solana & Robinhood Chain)

### 1. Ingestion Pipelines

#### A. Solana Live Feeds
1. **Pump.fun WebSocket Tape (`startPumpFeed`, `handlePumpMessage`)**:
   - Real-time event tape listening to PumpPortal WebSocket for `create`, `buy`, `sell`, and `migrate` events.
   - Ingests bonding curve parameters, deployer address, initial buy lamports, and supply decimals into the registry.
2. **Raydium AMM v4 Log Stream (`startRaydiumFeed`)**:
   - Subscribes to Solana RPC logs on Raydium AMM v4 (`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`).
   - Parses `initialize2` log instructions to capture new liquidity pool launches and graduated pump.fun tokens the instant they become tradeable on Raydium.
   - Uses a rate-limiting FIFO queue drained every 3 seconds to avoid RPC burst limits.
3. **GMGN Solana Scanner (`startGmgnFeeds`)**:
   - Polls `gmgn-cli market trending --chain sol --interval 5m/1h` and `market trenches` (new creations, near completion, completed).
   - Ingests smart trader counts, sniper counts, bundler ratios, and social links.

#### B. Robinhood Chain (EVM 4663) Live Feeds
1. **GeckoTerminal EVM Poller (`startEvmFeeds`, `normalizeGeckoPool`)**:
   - Polls `api.geckoterminal.com/api/v2/networks/robinhood/new_pools` every 60 seconds.
   - Filters out wrapped native tokens and stablecoins (USDC, USDT, WETH, WBTC, DAI).
   - Canonicalizes contract addresses to lowercase hex and keys tokens as `robinhood:0x...` to prevent collisions with Solana mints.
2. **GMGN Robinhood Scanner**:
   - Polls `gmgn-cli market trending --chain robinhood` and `market trenches --chain robinhood`.
   - Normalizes EVM tokens with liquidity floor checks, honeypot detection, and tax verification.
3. **DexScreener EVM Multi-Keyword Search**:
   - Discovers new Robinhood pairs via search queries (`robinhood`, `hood`, `rh`, `meme`, `doge`, `pepe`) filtered by `chainId === 'robinhood' || chainId === 'rh'`.

---

### 2. Staged Lifecycle & Curation Gates

Raw discovery feeds register launches into `tokens.json`, but **no token reaches the curated feed or trade bots without passing staged observation**:

```text
Discovery -> watching (pass 0)
          -> re-enrichment passes at [1, 3, 8, 15, 30, 60, 120, 240] minutes
          -> passes quality gate (Score ≥ 55, Liq ≥ $5k, Passes ≥ 2) -> curated
          -> drops > 70% liq or sub-floor mcap -> discarded
          -> completes passes without score threshold -> dormant (lightweight monitoring)
```

1. **Observation Schedule**:
   - Passes execute at $[0, 1, 3, 8, 15, 30, 60, 120, 240]$ minutes post-discovery.
   - Every pass evaluates price, liquidity, volume consistency, holder evolution, and appends to `token.history`.
2. **Curation Gate Thresholds**:
   - **Minimum Composite Score**: $\ge 55 / 100$.
   - **Minimum Liquidity**: $\ge \$5,000\text{ USD}$.
   - **Minimum Observation Passes**: $\ge 2$ passes completed (prevents instant-rug slot-0 buys).
3. **Discard & Rug Criteria**:
   - **Liquidity Collapse**: $\ge 70\%$ liquidity drop from peak marks token as `rugged`.
   - **Market Cap Floor**: Collapsed below $\$4\text{k}$ (or below $\$10\text{k}$ after peaking $\ge \$300\text{k}$).
   - **Persistent Zero Activity**: Discarded after 6 hours if no organic activity is detected.
4. **Dormant Revival & Spike Detection**:
   - Tokens with volume $\ge \$1,000$ that fail curation remain in `'dormant'`.
   - If subsequent refresh loops detect a **$3\times$ volume spike** or **$2\times$ liquidity jump**, a `token:tracked:wake` event re-activates the token into the terminal.

---

### 3. Tri-State Safety Gate (`safetyAdmission` & `assertTokenBuyable`)

Safety analysis is strictly tri-state (`pass`, `fail`, `unknown`). An unavailable or unverified check is never assumed safe:

1. **Required Checks (`REQUIRED_SAFETY_CHECKS`)**:
   - `mintOwner`: Verified token program owner.
   - `mintAuthority`: Must be revoked (`null`).
   - `freezeAuthority`: Must be revoked (`null`).
   - `sellRoute`: Real route quote and simulation verified (Jupiter quote on Solana, DEX quote on EVM).
2. **Token-2022 Byte-Level TLV Inspection**:
   - Parses raw mint account data directly using SPL extension decoders.
   - Hard fails dangerous extensions: `TransferHook`, `PermanentDelegate`, `NonTransferable`, or `TransferFeeConfig` ($>0\%$).
3. **Holder Concentration Spread**:
   - Excludes only verified LP, bonding curve, or burn addresses (`1nc1nerator...`).
   - Fails if non-LP top 10 holders control an unsafe percentage of circulating supply.
4. **EVM Contract Security**:
   - Rejects verified honeypots (`is_honeypot === 1`), high buy/sell tax ($>10\%$), or wash trading flags from GMGN.

---

### 4. Continuous Price Refresh (`refreshLoop.js`)

Market data is refreshed using DexScreener chunked multi-token requests (30 mints per batch, 500ms between batches):
- **Fast Tier (45 seconds)**: Curated tokens, active open trading positions, and custom strategy list matches.
- **Slow Tier (30 minutes)**: Tracked tokens that have shown no market activity for $>48\text{ hours}$.

---

### 5. UI Terminals & Scanner Controls

1. **Dedicated Terminal Routes**:
   - `/sol-meme`: Scoped exclusively to `chain=solana` (Pump.fun + GMGN + Raydium).
   - `/evm-meme`: Scoped exclusively to `chain=robinhood` (Robinhood chain 4663 via GeckoTerminal + GMGN).
   - `/memefinder`: Unified legacy view displaying both chains with full filter controls.
   - `/memes/registry`: Paginated view of historical runner memes discovered by Workers 1 & 2.
2. **Scanner Control & Focus Kill Switch**:
   - Managed via `POST /api/scanners/pause` and `POST /api/scanners/resume` (`ENABLE_MEME_SCANNERS`).
   - When paused, live launch listeners are suspended, dedicating system resources entirely to Tracked Wallets scoring and Tracked Memes runner backfills.

