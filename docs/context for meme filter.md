# Memecoin Filtering: Full Context for a Sniper Pipeline (Solana + Robinhood Chain)

---

## 0. Architecture Overview: How the Pros Structure It

Almost every serious alpha group and automated sniping bot deploys a disciplined **two-layer decision engine**:

### 0.1 Hard Filters (Kill Switches)
- **Nature:** Binary pass/fail. If any single check fails, the token is instantly discarded.
- **Execution:** Synchronous, executed on-chain within $< 1$ slot ($\sim 400\text{ms}$ on Solana).
- **Goal:** Reject rugs, honeypots, invalid programs, and dangerous mint authorities before spending execution cycles.

### 0.2 Soft Scoring (Heuristic Engine)
- **Nature:** Multi-factor weighted scoring producing a normalized rating ($0 - 100$).
- **Impact:** Determines **whether to buy**, **position sizing** ($0.25\times$ to $2\times$ base SOL), and **exit urgency**.
- **Execution:** Can incorporate asynchronous off-chain data (Twitter, DexScreener, Telegram, LLM vision) without stalling entry execution.

### 0.3 De Facto Industry Consensus
Free and commercial tools (RugCheck, GMGN, Bubblemaps, Photon, BullX) reflect standard alpha group operations. The filters detailed below constitute the industry-standard screening pipeline.

---

## 1. Token & Contract-Level Filters (Solana SPL)

### 1.1 SPL Token Contract Security Checklist

| Check | Rationale / Threat | Standard / Kill Switch Rule |
| :--- | :--- | :--- |
| **Mint Authority Revoked** | Deployer can inflate supply to infinity | **Must be `null`** (Hard Fail) |
| **Freeze Authority Revoked** | Deployer can freeze trader accounts from selling | **Must be `null`** (Hard Fail) |
| **Metadata Mutability** | Deployer can swap name, ticker, or image (rebrand rug) | Soft flag; **immutable** preferred |
| **Token Program Type** | Standard SPL vs. Token-2022 | Token-2022 extensions are red flags unless zero |
| ↳ **Transfer Fee Extension** | Hidden tax on buys/sells | **Fee must be 0%** (Hard Fail if $>0\%$) |
| ↳ **Transfer Hook** | Arbitrary smart contract execution on transfer (honeypot) | **Immediate Rejection** |
| ↳ **Permanent Delegate** | Deployer can transfer tokens out of any holder wallet | **Immediate Rejection** |
| ↳ **Non-Transferable / Frozen** | Tokens cannot be moved or sold | **Immediate Rejection** |
| **Supply & Decimals Sanity** | Non-standard decimals break pricing & routing bots | Standard: **6 or 9 decimals**, $\sim 1\text{B}$ supply |
| **Update Authority** | Who controls token metadata | Default pump.fun authority is standard / accepted |

> [!NOTE]
> Tokens launched via factory launchpads (pump.fun, letsbonk.fun, Moonshot, Boop) automatically revoke mint and freeze authorities upon contract creation. The risk on launchpads is not contract-level; it is **supply distribution and bundler activity** (see Section 3).

---

## 2. Liquidity-Level Filters

- **Launchpad vs. Raw AMM Pool:**
  - *Bonding Curve Launches:* Pre-migration bonding curves (pump.fun, Moonshot) cannot pull initial liquidity.
  - *Raw AMM Pools:* Direct Raydium (AMM v4 / CPMM), Meteora, or Orca pools require immediate verification of LP lock/burn.
- **LP Burned or Locked:**
  - Raydium pool LP tokens must be transferred to the dead/burn address or verified locked in a trusted locker (Streamflow, etc.). PumpSwap auto-burns LP on curve completion.
- **Initial Liquidity Size:**
  - $< 5\text{ SOL}$: Trivially manipulable; skip.
  - Exceptionally large initial liquidity from a brand-new wallet: Likely bundled or artificially seeded.
- **Liquidity-to-Market-Cap Ratio:**
  - An $\text{MCap} / \text{Liquidity}$ ratio $> 10\times - 15\times$ indicates fragile depth; exit slippage will be prohibitive.
- **Bonding Curve Progress (%):**
  - **Early Entry Zone:** $0\% - 5\%$ (earliest snipe window).
  - **Pre-Migration Zone:** $85\% - 100\%$ (anticipating graduation pump).
  - **Dead Zone:** $15\% - 80\%$ without momentum is often a stagnation trap.
- **Migration Event:**
  - Transition from pump.fun to PumpSwap/Raydium serves as an organic filter. Migrated tokens have survived a $\sim \$60\text{k} - \$70\text{k}$ market cap curve, eliminating immediate zero-effort rugs.
- **Pool Age & Creation Slot:**
  - Track pool age in slots to prevent buying re-launched dead contracts and enforce sniper cooldowns (e.g. wait $N$ slots for initial bundler dumps).

---

## 3. Holder Distribution Filters (Most Critical on Solana)

*Over 80% of launchpad memecoin rugs are caught at the holder distribution layer.*

- **Top 10 Non-LP Holders (%):**
  - Standard threshold: $< 15\% - 25\%$ cumulative supply.
  - Strict alpha groups require Top 5 $< 10\%$.
- **Deployer Wallet Share (%):**
  - Dev holding $> 5\%$: Caution flag.
  - Dev holding $> 10\%$: **Hard reject**.
  - Dev holding $0\%$: Flag if dev sold 100% of tokens before public arrival.
- **Bundled Buys (Jito Same-Slot Bundles):**
  - Deployers distribute capital across 5–30 fresh wallets and buy in slot 0.
  - *Detection:* Same slot, common funding root, sequential wallet derivation, identical SOL buy amounts.
  - *Rule:* Reject if unsold bundled supply $> 20\% - 30\%$.
- **Sniper Density in Slots 0–2:**
  - High concentration of bot wallets in the initial slots indicates immediate dump pressure; you will serve as their exit liquidity.
- **Insider Funding Trees:**
  - Walk `SystemProgram.transfer` history back 2–4 hops. Wallets funded by the deployer or shared intermediate accounts are classified as dev-controlled.
- **Fresh Wallet Ratio:**
  - If $> 50\%$ of supply is held by wallets created $< 24\text{h}$ ago with no prior transaction history, it indicates a sybil/bundle setup.
- **Holder Growth Velocity:**
  - Organic growth: $> 100$ distinct active wallets over 5 minutes.
  - Artificial growth: Hundreds of wallets receiving exact $0.01\%$ transfers in $< 30$ seconds (airdrop/sybil script).
- **Known Wallet Labels:**
  - Check against tagged databases (GMGN, Cielo) for Smart Money, KOLs, known serial ruggers, or bot clusters.
- **Cluster & Graph Analysis (Bubblemaps):**
  - Reject if an interconnected cluster controls $> 15\% - 20\%$ of circulating supply.

---

## 4. Deployer & Dev Wallet Filters

- **Historical Track Record:**
  - Inspect all prior mints created by the deployer address.
  - *Metrics:* Launch count, % of tokens where liquidity was pulled or dev dumped $> 50\%$ within 1 hour, ATH multiples achieved, average token lifespan.
  - *Heuristic:* $\ge 3$ consecutive prior launches dying in $< 1\text{h} \implies$ **Hard Reject**.
- **Deployer Funding Source:**
  - Fresh centralized exchange withdrawal (Binance, Coinbase, OKX, Bybit hot wallet): Neutral to acceptable.
  - Funded from another deployer wallet, Tornado/mixer, or known rugger cluster: **Hard Reject**.
- **Deployer Wallet Age & Balance:**
  - Created $< 1\text{h}$ prior and funded with exact gas needed: Disposable throwaway wallet.
  - Depleted SOL balance post-launch: Dev has zero skin in the game.
- **Dev Creation Buy:**
  - Pump.fun allows devs to buy in the creation transaction. $0\% - 3\%$ is standard; $> 10\%$ represents dump risk.
- **Real-Time Dev Sells:**
  - Continuous balance monitoring. Trigger auto-exit if the deployer sells $> 50\%$ of their holdings.
- **Rug-and-Relaunch Detection:**
  - Compare name, ticker, metadata hashes, and image perceptual hashes against recently dead tokens to filter relaunch farms.

---

## 5. Trading & Volume Pattern Filters

- **Buy / Sell Ratio in First Minutes:**
  - Healthy launches maintain buy-side dominance ($> 60\% - 70\%$ buys). $> 40\%$ sell volume in the first 2 minutes signals early distribution.
- **Unique Buyers vs. Total Transactions:**
  - 200 trades generated by only 10 unique addresses indicates automated wash trading.
- **Volume-to-Market-Cap Velocity:**
  - Unusually high volume paired with flat price action indicates volume bot churn.
- **Volume Bot Fingerprint:**
  - Thousands of micro-transactions ($\sim 0.05\text{ SOL}$) alternating rapidly from newly seeded addresses to fake DexScreener trending metrics.
- **Price Impact & Slippage Simulation:**
  - Skip if your intended order size moves market price $> 3\% - 5\%$.
  - Simulate entry via RPC; if required honest slippage exceeds $15\%$, liquidity is thin or manipulated.
- **RPC Sell Simulation (Honeypot Test):**
  - Run `simulateTransaction` for an immediate sell before executing buy orders. If the simulated sell reverts or incurs $> 90\%$ slippage, reject.
- **MEV & Sandwich Bot Density:**
  - Elevated Jito tip activity on a specific pool signals predatory sandwich bots.

---

## 6. Social & Narrative Filters (Async — Sizing vs. Entry)

*Runs asynchronously to calibrate position sizing and profit targets.*

- **Metadata Completeness:**
  - Missing website, Twitter, and Telegram entirely: Low-effort spam.
- **Twitter / X Account Verification:**
  - Account age, follower engagement ratio, bot ratio, and rename history (detects recycled accounts). Reject dead/fake links.
- **Telegram Community Dynamics:**
  - Active chat, organic message velocity, human admin presence.
- **Website & Domain Quality:**
  - Domain WHOIS registration age; reject pump.fun generic default landing pages.
- **Narrative Alignment:**
  - Does the token capitalize on an active meta (breaking news, celebrity post, AI agent, viral trend)?
  - First-mover tokens capturing a live viral trend dramatically outperform secondary clones.
- **KOL & Smart Money Activity:**
  - Identify whether verified smart wallets or reputable alpha callers have entered. Flag known paid-shill promoters as sell signals.
- **Ticker Collisions:**
  - When a breaking event triggers 30 tokens with identical tickers, identify the primary runner by earliest creation slot and organic buyer concentration.
- **DexScreener Boosts & Visibility:**
  - Paid DexScreener info updates and community boosts indicate financial commitment from the dev/community.

---

## 7. Timing & Market Regime Filters

- **SOL Macro Trend:**
  - Memecoin risk appetite heavily correlates with SOL price action. Reduce sizing by $50\%$ or pause operations when SOL is in sharp drawdown.
- **Intraday Trading Windows:**
  - Peak liquidity and sustained runners typically occur during the US afternoon and evening sessions (UTC 14:00 – 02:00).
- **Platform Saturation:**
  - When daily pump.fun creation volume spikes ($> 30\text{k}$ launches/day), capital attention is diluted; tighten hard filters.
- **Graduation Rate Health:**
  - Hourly pump.fun graduation rates below $1\%$ signal market fatigue; tighten entry gates.
- **Network Congestion:**
  - High block cluster congestion and elevated compute unit pricing increase dropped transaction rates; pause or raise priority fees.

---

## 8. Robinhood Chain Specifics (Arbitrum Orbit EVM L2)

### 8.1 Current Status & Outlook
Robinhood Chain is an Arbitrum Orbit L2 (EVM) designed primarily for tokenized assets and regulated instruments. In the event permissionless memecoins launch, EVM contract rules apply.

### 8.2 EVM Filter Checklist (Robinhood Chain / Base / Arbitrum)

| Check | Vulnerability Detail | Required Action |
| :--- | :--- | :--- |
| **Contract Verification** | Unverified source code on block explorer | **Immediate Rejection** |
| **Ownership Renounced** | `owner()` set to dead address (`0x0...dead`) | Must be renounced or restricted |
| **Upgradeable Proxy** | Dev can swap implementation logic to a drainer | **Reject upgradeable contracts** |
| **Mint Function** | Callable `mint()` function present | **Immediate Rejection** |
| **Blacklist / Whitelist** | Functions capable of freezing arbitrary addresses | **Immediate Rejection** |
| **Max Transaction Limits** | Anti-bot limit that can be maliciously set to zero | Verify non-zero and immutable |
| **Trading Toggle** | `enableTrading()` or `setTradingOpen()` can pause sells | Verify trading cannot be disabled |
| **Hidden Tax Functions** | Dynamic fee setter allowing taxes up to $99\%$ | Taxes must be $\le 5\%$ and capped |
| **Hidden Transfer Logic** | Bytecode overrides on `_transfer` causing honeypots | Automated bytecode analysis |
| **Honeypot Simulation** | Simulate buy $\to$ sell via `eth_call` | Must pass (GoPlus / Honeypot.is) |
| **LP Token Lock/Burn** | LP tokens burned or locked in trusted lockers | Must be locked $\ge 30$ days or burned |
| **Bytecode Similarity** | Hash matches known scam or drainer templates | **Immediate Rejection** |

---

## 9. Scoring Engine: A Representative Model

```yaml
# ==============================================================================
# PIPELINE EXECUTION ARCHITECTURE
# ==============================================================================

HARD_FILTERS (Kill switches — any failure skips token immediately):
  - mint_authority == null
  - freeze_authority == null
  - no_dangerous_token_2022_extensions: true
  - sell_simulation_succeeds: true
  - market_cap >= $4,000                   # Strict floor
  - peak_drawdown_valid: true              # Peak $50k->$5k or $300k->$10k check
  - bundled_supply_unsold < 30%
  - top10_holders_supply < 30%
  - dev_holdings < 15%
  - deployer_not_blacklisted: true
  - not_dead_token_relaunch: true

SOFT_SCORE (0 - 100 Points):
  Distribution (35 Points):
    - top10_holders < 15%:          +10 pts
    - dev_holdings < 3%:            +8 pts
    - bundled_supply < 10%:         +8 pts
    - fresh_wallet_ratio < 30%:     +5 pts
    - smart_money_present:          +4 pts

  Deployer Track Record (20 Points):
    - zero_prior_rugs:              +10 pts
    - has_prior_runner (>5x):       +6 pts
    - aged_cex_funded_wallet:       +4 pts

  Liquidity & Order Flow (20 Points):
    - buy_sell_ratio > 70% (first 2m): +8 pts
    - unique_buyers > 50 (first 5m):   +7 pts
    - price_impact_for_size < 3%:      +5 pts

  Social & Narrative (25 Points, Async):
    - matches_active_meta:             +10 pts
    - verified_aged_twitter:           +6 pts
    - smart_kol_wallet_bought:         +5 pts
    - organic_telegram_community:      +4 pts

POSITION_SIZING:
  score < 50:  Skip
  50 - 64:     0.25x Base Size
  65 - 79:     1.0x Base Size
  80 - 100:    2.0x Base Size

DYNAMIC_EXIT_TRIGGERS:
  - Dev sells > 50% of bag
  - Bundler wallets initiate coordinated dump
  - Top 10 holder concentration increases sharply
  - Liquidity drops > 30% from peak
  - Token breaches drawdown rules from ATH
```

---

## 10. Common Pitfalls & High-Alpha Improvements

### 10.1 Multi-Hop Funding Tree Analysis
Most public bots only inspect 1 funding hop. Professional ruggers route SOL through 3–5 intermediate accounts or CEX sub-wallets. Constructing a complete multi-hop wallet graph delivers a primary edge.

### 10.2 Dynamic Real-Time Bundle Unwind Tracking
Static bundle metrics only measure holdings at launch. Monitoring the **real-time unwind** of bundle wallets allows snipers to buy the post-bundle dip once sniper and deployer supply has cleared.

### 10.3 Bayesian Deployer Reputation Modeling
Rather than binary whitelists/blacklists, maintain a Bayesian probability distribution of a deployer's expected outcome based on historical launch multiples and liquidity durations.

### 10.4 Intelligent Narrative De-duplication & Clone Detection
Deploy perceptual image hashing (`pHash`) and ticker/name fuzzy string matching. Automatically identify the original launch within the first 60 seconds among dozens of copycats.

### 10.5 Continuous Post-Buy Sell Simulation
Rugs often arm after public entry (e.g. changing Token-2022 fees or altering DEX state). Continuously re-simulate sell execution via RPC every few seconds while holding.

### 10.6 Ultra-Low-Latency Social Ingestion
Standard polling of Twitter/Telegram introduces 30–60s delays. Connecting directly to filtered firehose streams or alpha group listeners detects token addresses seconds ahead of general distribution.

### 10.7 Dynamic Regime-Adaptive Filtering
Hardcoded thresholds fail during regime shifts. Automatically tighten liquidity and holder distribution criteria when market-wide graduation rates drop, and relax them during breakout cycles.

### 10.8 Sniper-vs-Sniper Density Modeling
Measure the ratio of bot wallets entering in slots 0–2. If slot 0 is dominated by known sniper bots, exit liquidity risk is extreme.

### 10.9 Survival-Based Backtesting (PnL vs. Rug Rate)
Evaluating filters solely by rug avoidance often eliminates top runners (e.g., hyper-viral tokens naturally exhibit higher initial holder concentration). Optimize filters for net PnL impact rather than raw rug rate.

### 10.10 Proprietary Smart/Dumb Money Wallet Labeling
Replace public labels (GMGN, Cielo) with proprietary tracking: wallets maintaining $\ge 60\%$ win rates across $\ge 30$ closed trades over 120 days. Conversely, track persistent top-buyers as contrarian signals.

### 10.11 Vision & LLM Token Quality Scoring
Run fast ($\sim 1\text{s}$) async vision/multimodal passes over token images and names to filter low-effort AI slop from high-potential cultural memes.

### 10.12 Continuous Post-Entry Exit Filters
Most trading capital is lost on delayed exits rather than poor entries. Run continuous monitoring on holder concentration, buy/sell ratios, liquidity health, and developer transactions.

---

## 11. Data Sources & Tooling Architecture (Solana)

### 11.1 Real-Time On-Chain Streams
- **gRPC / Geyser Feeds:** Helius, Triton, QuickNode Yellowstone gRPC for sub-slot transaction and account monitoring.
- **Jito MEV Block Engine:** Bundle submission and real-time same-slot multi-transaction bundle analysis.
- **Direct Program Subscriptions:** WebSocket/gRPC streams watching pump.fun bonding curve account state.

### 11.2 Token Security Verification
- **Native On-Chain RPC Ingestion:** Direct account deserialization for mint/freeze authorities (fastest).
- **RugCheck API & GoPlus:** Secondary validation for multi-chain and metadata checks.

### 11.3 Holder & Wallet Intelligence
- **Bubblemaps API:** Algorithmic cluster detection.
- **Helius DAS (Digital Asset Standard) API:** High-speed asset ownership and wallet transaction histories.
- **Internal Graph Database:** PostgreSQL / Neo4j tracking funding trees and wallet associations.

### 11.4 Market & Pricing Data
- **Raydium & PumpSwap AMM Subscriptions:** Direct pool reserve parsing for zero-latency pricing.
- **DexScreener & Jupiter APIs:** Aggregated pricing and volume analytics.

### 11.5 Social & Narrative Monitoring
- **X (Twitter) API v2 Filtered Stream:** Real-time contract mention monitoring.
- **Telethon / Pyrogram Listener Bots:** Automated monitoring of major alpha call channels.

---

## 12. Reality Check & Execution Strategy

- **Base Rates:** Out of 20,000–40,000 tokens launched daily on pump.fun, over $98\%$ fail to graduate. Of those that graduate, the majority retrace to near-zero within 24 hours.
- **Filter Limitations:** Rigorous filtering lifts win-rates from $\sim 1\%$ to $10\% - 15\%$. The remaining edge relies entirely on **execution speed, disciplined sizing, and dynamic exit management**.
- **Adversarial Reality:** Serial deployers actively optimize to bypass basic checks (e.g. revoking authorities, scattering bundles across aged wallets). Long-term edge is derived from **deep funding-graph analysis, real-time bundle tracking, and wallet clustering**.

---

## 13. 4-Month Smart Wallet Historical Crawler & Anti-Luck Architecture

### 13.1 Why 4 Months (120 Days)?
- **Seasonality & Endurance:** A 30-day window is easily skewed by 1–2 lucky trades. A 120-day window tests endurance across diverse market cycles and market sentiment regimes.
- **System Parameters:**
  - `LOOKBACK_DAYS = 120`
  - `LOOKBACK_MS = 120 * 24 * 3600 * 1000` ($10,368,000,000\text{ ms}$)
  - CLI execution: `node backend/scripts/find-smart-wallets.js --days=120 --chain=all`

### 13.2 Anti-Luck Heuristic Criteria
To eliminate one-hit wonders and insider single-token windfalls, wallets must satisfy:
1. **Trade Volume:** $\ge 30$ closed positions in the 120-day window.
2. **Net Realized PnL:** Net positive across 30-day and 120-day periods in both USD and SOL.
3. **Win Rate:** $\ge 60\%$ on closed trades.
4. **Discrete Micro-Cap Entry Distribution:** Proven history of early entries across tiers.

### 13.3 Runner All-Time High Qualification & The 25% of ATH Rule
A runner token is defined as having achieved an All-Time High (ATH) market cap of **$\ge \$1,000,000$** (raised from $\$500\text{k}$). To qualify as an early buyer, the wallet must have purchased at an entry market cap **$\le 25\%$ of the token's ATH**:
- **Megacap ($\ge \$50\text{M}$ ATH):** Entry $\le \$12.5\text{M}$ ($25\%$ of ATH).
- **~10M Breakouts ($8\text{M} - 50\text{M}$ ATH):** Entry $\le \$2.5\text{M}$ ($25\%$ of ATH).
- **~5M Early Runners ($3\text{M} - 8\text{M}$ ATH):** Entry $\le \$1.25\text{M}$ ($25\%$ of ATH).
- **$\ge \$1\text{M}$ Baseline Runners ($1\text{M} - 3\text{M}$ ATH):** Entry $\le \$250\text{k}$ ($25\%$ of ATH).

### 13.4 Dual-Method Candidate Ingestion
Early buyers for $\ge \$1\text{M}$ ATH runners are ingested via two complementary paths:
1. **Method 1: Buying Market Cap (`buying_mcap`):** Entry market cap $\le 25\%$ of ATH. **Must be profitable (`profitUsd > 0`).**
2. **Method 2: First N Buyers (`first_n_buyers`):** Earliest chronological buyers up to quota ($100 + 20$ per $\$1\text{M}$ above $\$1\text{M}$). **Must be profitable (`profitUsd > 0`).**
3. **Dual Qualification:** Wallets meeting both methods earn the `⚡ Mcap ≤25% + First N` badge.

### 13.5 Unified 7-Column Execution Metric Terminal (Smart & Tracked)
Both Smart Wallets and Tracked Candidate Wallets are monitored with an identical 7-column execution layout:
- **`Wallet Address`:** Address, explorer link, Twitter handle, qualification method badge, and runner early buyer pill (`🎯 Early #rank · $SYMBOL`).
- **`PnL`:** 30-day net realized profit (`fmtUsd`).
- **`Win Rate`:** Percentage of winning closed positions (`winRate.toFixed(1)%`).
- **`Buy/Win`:** Total won trades vs total buys (`X won / Y buys`).
- **`Avg Buy Mcap`:** Mean entry market cap (`fmtCurrency`) with entry token purchase price subtext (`fmtPrice`).
- **`Avg Sell Mcap`:** Mean exit market cap (`fmtCurrency`) with exit selling price subtext (`fmtPrice`).
- **`Avg Holding Time`:** Holding period (`s`, `m`, `h`, `d`) from GMGN closed trades (`avg_holding_period`).
- **`Actions`:** 1-click **Promote** button (for tracked candidates to graduate into verified smart wallets), GMGN link, and delete button.

### 13.6 Execution Metrics Pipeline & Backfill
- **GMGN Extraction:** Direct extraction of `pnl_stat.avg_holding_period` and activity execution prices/supplies via GMGN CLI.
- **Fallback Derivation:** `deriveExecutionMetrics()` reliably computes metrics for rate-limited records.
- **Backfill CLI & API:** Standalone script `backend/scripts/backfill-metrics.js` and endpoint `POST /api/smart-wallets/backfill`.
- **Dual Persistence:** Automatic synchronization across PostgreSQL (`smart_wallets` table) and local JSON store (`backend/data/smart-wallets.json`).

---

## 14. Early Meme Caller Specification (~40k MCap / $6k+ 5m Vol Engine)

### 14.1 Core Signal Philosophy
The **Early Meme Caller** identifies tokens in their breakout velocity window—after initial sniper bot volatility has settled, but prior to widespread social promotion.

### 14.2 Breakout Signal Signature
1. **Market Cap Sweet Spot:**
   - Range: $\$20,000 - \$150,000$
   - Target sweet spot: **$\sim \$35,000 - \$60,000$ (centered at $\sim \$40\text{k}$)**.
2. **5-Minute Volume Velocity:**
   - Minimum 5m volume: $> \$5,000$ (target $> \$6,000$).
   - Velocity ratio: $5\text{m Volume} / \text{Market Cap} \ge 10\% - 15\%$.
3. **Liquidity Depth & Health:**
   - Minimum liquidity: $> \$3,500$ (target $> \$4,500$).
   - $\text{MCap} / \text{Liquidity} \le 10\times - 12\times$.
4. **Order Flow & Buyer Dominance:**
   - $5\text{m Buy/Sell Ratio} \ge 1.25\times$ ($55\% - 60\%$ buyers).
   - Unique transaction count: $\ge 8 - 10$ distinct buyer wallets within 5 minutes.
5. **Smart Money Confluence:**
   - At least 1 verified smart wallet from the 120-day crawler database holding or actively buying.
6. **Safety Clearance:**
   - Mint authority revoked (`null`).
   - Freeze authority revoked (`null`).
   - Top 10 non-bonding curve holders $\le 50\%$ supply.

### 14.3 Pipeline Surfacing
- Evaluated via `backend/src/analysis/earlyCaller.js` (`evaluateEarlyCaller(token)`).
- Fast-tracks approved tokens to **Alpha Calls** with the `🚀 Early Runner` strategy tag.
- Emits real-time WebSocket event: `token:early-call`.

---

## 15. Market Cap Floor & Peak Drawdown Eviction Rules

To keep the **Alpha Calls** and **Tracked Watchlist** focused on viable tokens, strict eviction gates are continuously enforced in `registry.js` and `tracked.js`:

### 15.1 Absolute Market Cap Floor ($< \$4\text{k}$)
- **Rule:** Any token with $\text{MCap} < \$4,000$ is immediately evicted from **Alpha Calls** (`state = 'discarded'`) and **Tracked Watchlist** (`untrack(mint)`).
- **Gate:** Tokens with $\text{MCap} < \$4,000$ are barred from promotion into Alpha Calls or Tracked status.

### 15.2 Peak ATH Drawdown Evictions
Tokens that have experienced terminal pump-and-dump crashes are purged regardless of prior scores:
- **\$50k Peak Collapse:** If all-time-high market cap peaked at $\ge \$50,000$ and current market cap drops below **$\$5,000$**, the token is immediately evicted.
- **\$300k Peak Collapse:** If all-time-high market cap peaked at $\ge \$300,000$ and current market cap drops below **$\$10,000$**, the token is immediately evicted.

### 15.3 Continuous Lifecycle Enforcement
- `peakMarketCapUsd` is continuously tracked and updated on discovery, during re-analysis passes, and on every live price tick.
- Breaches immediately trigger `discard(token)` and `untrack(mint)`, removing the token across both backend registries and frontend tables.
