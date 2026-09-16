remove 30 closed trades to 5 open trades + +ve pnl of more then 100$ , calcaulte , only these two 
i dont think we can check past 30days ? can we ? 

you have it wrong , you mentioned if the wallet is dev wallet that sells early we remove it , but this was for meme ,
if for a meme where the owner of the meem starts seeling that a bearish sign and we will notify that this bearish event is happeneing , and also remove that coin , mark that wallet as scam wallet and track its lieneage and mark them as scammer lineage wallet , and we will call this meme a scam meme
everytime a wallet that is early in a an scam meme and didnt make a profit we give them 1 reatrd point , and if they make a profit we mark them 1 sus wallet point, 

Here is the complete breakdown of rate limits across all platforms, followed by how you can check old memes with >$5M market cap:

we will have a meme list , where we will have name and contract address for the meme which we have already the wallets backfilled so that we dont backfill that meme again 

we will have these columns , current mcap , and ath  , current 24h volume 

we dont need to use all the sources , dont use dune as it has a monthly rate limit  which is limited , 
we wont use , cielo , arkham for api calls either 

we will distribute the work between different workers, 

- one worker will fetch all memes in last month that has current mcap of more then 2 million 
- second worker will fetch all the memes for which all time high mcap was more then 4 million 
we will fetch memes with respect  to 2 stats current mcap and ath mcap , but we will backfill wallets only on basis of ath mcap


now that we have all the mems  with CA 
 - we will fetch wallets that were either early or first i.e 0.004% of first wallet of ATH mcap  , so if ath mcap is 2M then 0.004% is first 80 wallets ,

-also if a wallet has 2m mcap ,all wallets that bought before 25% of mcap that is below 500kmcap with a +ve realized pnl on that trade + the buying mcap shouldnt go beyond 50m mcap 

Splitting by current-mcap vs ATH-mcap is fine, but they should write to one shared token table with a source flag, not two pipelines — otherwise you double-process the overlap (most ATH>4M tokens also pass current>2M).



we will add these metrics,
Capture ratio = avg realized exit mcap ÷ ATH mcap. Sold at 3.6M on a 4M ATH = 90%. Sold at 400k = 10%.

% of position sold above 50% of ATH — did they take size off near the top or dribble out?

Round-trip rate = % of winning positions they rode all the way back to under their entry. High round-trip = they can find tokens but can't sell them.

worker 3 - will fetch memes trade history to find these wallets 

worker 4 - will backfill wallets metrics like pnl , win rate , total trades , avg buy mcap , sell mcap , holding time , 

worker  5 - will check trades like how many memes that the wallet has traded that has gone above 2million mcap and how many stayed below 2 million mcap , record . we will record all the meme with ca so that there are no duplicates 

make tabel for each and record them properly.

so we need different workers for all this different task 

GMGN, Kolscan, [FOMO.family](http://fomo.family/), MemeMoves, Nock Scout are unofficial/scraped endpoints behind Cloudflare. They break without notice and carry ToS risk. so keep checking if they broke or not and find the optimum rate 

make a plan use superpower plugin

for worker 3 , if a meme had a run to 5 million ATH , then we only fetch wallets that bought below 1.25m mcap before it reached ath of of 5million

for 5 , we will not fetch and record all the trades it the wallet , but we will have to keep updating the metrics , so sahll we record the last txn of the wallet which will signify that till this txn we have computed its metrics , we will backfill upto 3 months for a wallet , not more then that , but we will keep updating the metrics once we start recording it , 


---

### 1. Master API Endpoints & Rate Limits Reference

| Source Platform | Base URL | Rate Limit / Quota | Auth / Headers | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **FOMO** | `https://api.fomoapi.io` | **250k credits/mo** (~60 req/min) | None (Public) | Social trader leaderboards, wallet resolution (SOL+EVM), balance/whale valuation, follow graph |
| **Kolscan** | `https://kolscan-api.pump.fun`<br>`https://kolscan.io` | **SSE: Unlimited**<br>Web API: ~20 req/min | Web API: Cloudflare OpenNext | Live alpha trade stream (SSE), top KOL meme callers leaderboard |
| **MadeOnSol** | `https://madeonsol.com/api/v1` | **200 req/day** (Free BASIC)<br>~30–60 req/min | `Authorization: Bearer msk_...` | KOL leaderboard, live trade feed, early buyer alpha, bundle detection, deployer hunter |
| **Pump.fun** | `https://frontend-api-v3.pump.fun`<br>`https://pumpportal.fun` | ~60 req/min | None (Public) | Real-time token launches, curve reserve math, ATH market cap tracking, lightning execution |
| **Birdeye** | `https://public-api.birdeye.so` | **15 req/sec** (100k CUs/mo) | `X-API-KEY: {key}` | Token overview, historical launch swaps for early buyer harvest, wallet portfolio & whale net worth |
| **DexScreener** | `https://api.dexscreener.com` | **~300 req/min** | **100% Free / No Key** | Latest token boosts, token profiles, multi-chain pair resolution (up to 30 mints/request) |
| **GeckoTerminal** | `https://api.geckoterminal.com/api/v2` | **~30 req/min** | **100% Free / No Key** | Solana & Robinhood trending pools, pool reserves, 24h volume, ATH timestamps, OHLCV candles |
| **Nock Scout** | `https://nockterminal.com` | ~30–60 req/min | None (Public) | Robinhood Chain copyable PnL leaderboard and wallet tracker |
| **Robinhood Blockscout** | `https://robinhoodchain.blockscout.com/api/v2` | **10–30 req/sec** | None (Public RPC) | EVM token lists, wallet token balances, contract holders, transaction history |
| **Goldsky Indexer** | `https://api.goldsky.com` | Subgraph limits | API Key | Official Robinhood Chain Arbitrum Orbit subgraph indexer for instant DEX swaps & liquidity events |
| **PONS WebSocket** | `wss://pons.trade/ws` / `https://pons.trade/api` | Stream | Public / Keyed | Real-time Robinhood Chain token launch feed and memecoin trade firehose |
| **DeFade Forensics** | `https://defade.io/api/v1` | ~60 req/min | API Key / Free | Robinhood Chain honeypot detection, rug-pull risk scoring, and deployer forensics |
| **Luma** | `https://withluma.app/api` | ~30 req/min | None | Base + Robinhood Chain multi-wallet convergence maps (1,000+ smart wallets) |
| **HoodScan / RobinScan**| `https://hoodscan.co` / `https://robinscan.xyz` | ~30 req/min | None | Robinhood Chain whale explorer, holder distributions, and rich lists |
| **GMGN.ai** | `https://gmgn.ai` | ~1 req / 1.5s (~30–40/min) | Scraper / API Key | Solana trenches, 1h/24h trending tokens, smart degen wallet rankings |
| **Envio HyperSync** | `https://polygon.hypersync.xyz` | High-throughput | `ENVIO_API_KEY` | Ultra-fast EVM transaction and log filtering (100x faster than standard RPC `eth_getLogs`) |
| **Helius** | `https://api.helius.xyz/v0` | 10 req/sec (Free) | `HELIUS_API_KEY` | Enhanced Solana SWAP transaction parsing and DAS metadata resolution |
| **Solscan** | `https://pro-api.solscan.io/v2.0` | 5 req/sec (Free) | `SOLSCAN_API_KEY` | On-chain SPL token account verification and wallet transfer validation |

---

### 2. Exhaustive Endpoint Specifications

#### A. FOMO (`fomo.family` / `api.fomoapi.io`)
* **Base URL**: `https://api.fomoapi.io`
* **Auth**: None (Public endpoints with generous quota)
* **Endpoints**:
  * `GET /v2/leaderboard/{window}`:
    * **Windows**: `24h`, `7d`, `30d`, `all`
    * **Response**: Array of top traders with `handle`, `pnlUsd`, `winRate`, `totalTrades`, `followers`, `tradesCount`.
  * `GET /v2/users/{handle}`:
    * **Response**: Trader profile with linked on-chain addresses in `wallets` array (both Solana base58 and EVM `0x` addresses).
  * `GET /v2/users/{handle}/following`:
    * **Response**: List of social traders followed by the leader (enables multi-tier network alpha traversal).
  * `GET /v2/users/{handle}/balances`:
    * **Response**: Live token accounts, token balances, and live USD valuations. Used for whale qualification ($\ge \$5,000$).
  * `GET /v2/users/{handle}/trades`:
    * **Response**: Historical trade ledger with timestamps, buy/sell amounts, token mints, and realized PnL.
  * `WSS /v2/stream`:
    * **Format**: Live WebSocket pushing trade events from followed leaders.

#### B. Kolscan (`kolscan.io`)
* **Live SSE Stream**: `https://kolscan-api.pump.fun/api/v1/stream`
  * **Auth**: None (HTTP 200 OK text/event-stream)
  * **Function**: Real-time push stream of pump.fun token trades and alpha caller moves.
* **Web Endpoints**: `https://kolscan.io/api/*` *(Protected by Cloudflare OpenNext)*:
  * `POST /api/leaderboard`:
    * **Body**: `{"timeframe": "7d" | "24h" | "30d" | "all", "page": 1, "pageSize": 50}`
    * **Response**: Ranked callers with win rate, profit SOL/USD, and follower count.
  * `GET /api/trades`: Recent trade feed with caller identity.
  * `POST /api/tokens`: Performance stats for called tokens given `{"solPrice": number}`.
  * `POST /api/data`: Internal RPC router: `{"method": string, "params": object}`.
  * `GET https://cdn.kolscan.io/profiles/{handle}.jpg`: Avatar CDN for caller profiles.

#### C. MadeOnSol (`madeonsol.com`)
* **Base URL**: `https://madeonsol.com/api/v1`
* **Auth**: Header `Authorization: Bearer msk_...` (or `x-api-key: msk_...`)
* **Status**: Tested & Active (Tier: `BASIC` / Free, key `MADEONSOL_API_KEY` in `backend/.env`)
* **Key Endpoints**:
  * `GET /me`: Account tier, daily quota limit, and feature flags.
  * `GET /kol/leaderboard?window=30d`: PnL rankings across `today`, `7d`, `30d`, `90d`, `180d`. Returns wallet address, PnL, win/loss count, `median_hold_minutes_30d`, `percentile_early_entry_30d`, and strategy tags (`swing_trader`, `scalper`).
  * `GET /kol/feed?limit=20&action=buy`: Live stream of smart-money trades.
  * `GET /kol/{wallet}` & `GET /kol/{wallet}/pnl`: Single KOL wallet profile, FIFO cost-basis equity curve, and drawdown.
  * `GET /kol/coordination`: Detects coordinated buying across multiple KOL wallets on the same token.
  * `GET /kol/tokens/{mint}`: Real-time KOL buy/sell consensus for a specific mint.
  * `GET /alpha/leaderboard`: Scored early-buyer and sniper wallet rankings across Solana.
  * `GET /alpha/{wallet}/linked`: Finds related/funded sub-wallets and cluster groupings.
  * `GET /wallet/{address}/stats`: 90-day aggregate stats and bot classification (`is_sniper`, `is_bundler`, `is_dumper`).
  * `GET /wallet/{address}/trades`: Cursor-paginated raw trades for any Solana wallet.
  * `POST /wallet/batch/classify`: Bulk reputation flags for 1–100 wallets per request.
  * `GET /deployer-hunter/leaderboard`: Pump.fun deployers ranked by bonding rate.
  * `GET /deployer-hunter/alerts`: Real-time deploy alerts ~500ms before on-chain confirmation.
  * `GET /tokens/almost-bonded`: Pump.fun tokens near graduation (90–99% bonding curve).
  * `GET /tokens/{mint}/bundle`: Exposes slot-0 bundle cohorts and held supply percentages.
  * `GET /tokens/surges`: Real-time momentum breakouts (<30m old tokens running 3x–8x).

#### D. Pump.fun (`frontend-api-v3.pump.fun`)
* **Base URL**: `https://frontend-api-v3.pump.fun` *(v1 and v2 are deprecated/503; v3 is active)*
* **Auth**: None (Public)
* **Key Endpoints**:
  * `GET /coins`:
    * **Query Params**:
      * `offset=0&limit=50`: Pagination (up to 50 tokens per request).
      * `sort=created_timestamp`: Newly deployed tokens (seconds old).
      * `sort=last_trade_timestamp`: Actively traded tokens.
      * `sort=market_cap`: Highest market cap runners.
      * `sort=reply_count`: Trending tokens with high community discussion.
      * `order=DESC | ASC`
      * `complete=false`: Pre-graduation tokens on the bonding curve.
      * `complete=true`: Graduated tokens migrated to Raydium.
      * `creator={walletAddress}`: All tokens launched by a specific deployer.
      * `includeNsfw=false`
    * **Fields Returned**: `mint`, `name`, `symbol`, `bonding_curve`, `associated_bonding_curve`, `creator`, `created_timestamp`, `virtual_sol_reserves`, `virtual_token_reserves`, `total_supply`, `market_cap`, `usd_market_cap`, `ath_market_cap`, `ath_market_cap_timestamp`, `complete`, `raydium_pool`, `reply_count`.
  * `GET /coins/{mint}`: Full single-token object with reserve states and ATH market cap.
  * `GET /users/{walletAddress}`: Trader/creator profile: `username`, `profile_image`, `followers`, `following`, `is_pump_user`.
* **Execution & WebSocket**:
  * `POST https://pumpportal.fun/api/trade-local`: Used by `backend/src/trading/executor.js` to build signed local transactions on the bonding curve.
  * `wss://pumpportal.fun/api/data`: Real-time stream for `subscribeNewToken`, `subscribeTokenTrade`, and `subscribeRaydiumLiquidity`.
  * `wss://prod-advanced.nats.realtime.pump.fun`: Pump.fun production NATS streaming clusters.
  * **On-Chain Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`.

#### E. Birdeye (`public-api.birdeye.so`)
* **Base URL**: `https://public-api.birdeye.so`
* **Auth**: Header `X-API-KEY: {BIRDEYE_API_KEY}` (Key in `backend/.env`)
* **Key Endpoints**:
  * `GET /defi/token_overview?address={mint}`: Live price, market cap, liquidity, 24h volume, holders count.
  * `GET /defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=50`: Top volume tokens on Solana.
  * `GET /defi/txs/token?address={mint}&tx_type=swap&sort_type=asc&limit=50`: Historical swaps ordered from launch. Used by **Worker 3** to harvest early buyers who bought before ATH.
  * `GET /v1/wallet/token_balance?wallet={address}`: Token holdings, quantities, and USD value.
  * `GET /v1/wallet/portfolio?wallet={address}`: Full wallet portfolio valuation and whale categorization ($\ge \$100\text{k}$).
  * `GET /defi/token_creation_info?address={mint}`: Deployer address, transaction hash, block slot, and creation timestamp.

#### F. DexScreener (`api.dexscreener.com`)
* **Base URL**: `https://api.dexscreener.com`
* **Auth**: **100% Free / No Key Required** (~300 req/min)
* **Key Endpoints**:
  * `GET /token-boosts/latest/v1`: Live feed of boosted meme tokens across all chains. Used by **Worker 1** for initial meme discovery.
  * `GET /token-boosts/top/v1`: Highest boosted tokens by active marketing spend.
  * `GET /token-profiles/latest/v1`: Tokens with recently added social branding, banners, and links.
  * `GET /latest/dex/tokens/{tokenAddresses}`: Batch resolves up to 30 comma-separated token contracts on Solana, Robinhood, Base, and Ethereum. Returns pair addresses, prices, FDV, market cap, 24h volume, and liquidity.
  * `GET /latest/dex/pairs/{chainId}/{pairAddress}`: Single liquidity pool analytics (`chainId`: `solana` or `robinhood`).
  * `GET /latest/dex/search?q={query}`: Multi-chain search across pairs and tokens.

#### G. GeckoTerminal (`api.geckoterminal.com/api/v2`)
* **Base URL**: `https://api.geckoterminal.com/api/v2`
* **Auth**: **100% Free / No Key Required** (~30 req/min)
* **Key Endpoints**:
  * `GET /networks/{network}/trending_pools`: Top trending pools (`network`: `solana` or `robinhood`). Used by **Worker 2** for ATH $\ge \$4\text{M}$ discovery.
  * `GET /networks/{network}/pools/{pool_address}`: Comprehensive pool metrics: reserve USD, transactions count (5m, 1h, 24h), volume, and pool creation date (`pool_created_at`).
  * `GET /networks/{network}/tokens/{token_address}`: Token metadata, FDV, and total supply.
  * `GET /networks/{network}/pools/{pool_address}/ohlcv/{timeframe}`: OHLCV candlestick historical pricing (`day`, `hour`, `minute`).
  * `GET /networks/{network}/pools/{pool_address}/trades`: Recent DEX trades on the liquidity pool.

#### H. Nock Scout (`nockterminal.com`)
* **Base URL**: `https://nockterminal.com`
* **Auth**: None (Public API)
* **Key Endpoints**:
  * `GET /api/scout/wallets`: Leaderboard of Robinhood Chain / EVM copy traders ranked by copyable PnL.
  * `GET /api/scout/traders?limit=50`: Win rate, realized profit, and trade counts for Robinhood traders.
  * `GET /api/tokens/trending`: Trending tokens on Robinhood Chain.

---

### 3. Dedicated Robinhood Chain Sources (Chain ID: 4663 / Arbitrum Orbit L2)

Robinhood Chain is an Ethereum-compatible Layer 2 settling on Ethereum with 0-MEV first-come-first-served sequencing:

1. **Robinhood Blockscout (`https://robinhoodchain.blockscout.com/api/v2`)**:
   * Official explorer REST API:
     * `GET /tokens`: All deployed ERC-20 tokens and memecoins.
     * `GET /addresses/{address}/token-balances`: Token balances and USD portfolio value for any Robinhood wallet.
     * `GET /tokens/{address}/holders`: Top whale holders for any Robinhood meme token.
     * `GET /transactions`: On-chain transaction feed.
2. **Goldsky Subgraphs & Indexer (`https://api.goldsky.com`)**:
   * Official indexing partner for Robinhood Chain. Provides high-speed GraphQL subgraphs for real-time DEX swaps, liquidity pool creation, and deployer tracking.
3. **PONS WebSocket & Trade Feed (`wss://pons.trade/ws` & `https://pons.trade/api`)**:
   * Low-latency launch stream and real-time trade firehose specifically monitoring Robinhood Chain liquidity pools.
4. **DeFade Behavioral Forensics (`https://defade.io/api/v1`)**:
   * Token safety scanner for Robinhood Chain: analyzes honeypot contracts, fee-on-transfer percentages, blacklist functions, and deployer wallet lineage.
5. **Luma Intelligence (`https://withluma.app/api`)**:
   * Monitors 1,000+ smart wallets across Robinhood Chain and Base, producing multi-wallet convergence maps when whales accumulate the same token.
6. **HoodScan (`https://hoodscan.co`) & RobinScan (`https://robinscan.xyz`)**:
   * Community-built explorers providing whale net worth rankings, rich lists, and active trader dashboards for Robinhood Chain.
7. **Dune Analytics Robinhood Dashboard**:
   * Custom SQL analytics (`geggonen/robinhood-chain-analytics`) tracking 30d realized PnL and rekt/alpha trader rankings.

---

### 4. Zero Keys Needed vs. Optional Keys

#### Free & Zero Keys Needed (Out-of-the-Box):
- **FOMO.family** (Leaderboards, wallet resolution, live balances, following graph)
- **Kolscan** (SSE live stream at `kolscan-api.pump.fun` + web leaderboards)
- **Pump.fun** (`frontend-api-v3.pump.fun` coins, creator filter, and users)
- **DexScreener** (Token boosts, token profiles, multi-pair token resolver)
- **GeckoTerminal** (Trending pools, pool reserves, ATH timestamps)
- **Nock Scout** (Robinhood Chain copyable PnL leaderboard)
- **Robinhood Blockscout** (EVM explorer API)
- **GMGN** (Solana trenches & trending tokens)
- **MemeMoves** (Local cluster convergence detection engine)

#### Optional API Keys (Configured in `backend/.env`):
| Source | Env Variable | Status in `.env` | What It Unlocks |
| :--- | :--- | :--- | :--- |
| **MadeOnSol** | `MADEONSOL_API_KEY` | **Active (`msk_...`)** | 1,069+ KOL wallets, live trade feed, alpha leaderboard, bundle detection, deployer hunter |
| **Birdeye** | `BIRDEYE_API_KEY` | **Active** | Historical launch swaps (Worker 3), portfolio valuation, whale categorization |
| **Cielo Finance** | `CIELO_API_KEY` | **Active** | Real-time push webhooks when tracked wallets trade |
| **Helius** | `HELIUS_API_KEY` | **Active** | Enhanced Solana SWAP transaction parsing and DAS metadata |
| **Envio HyperSync** | `ENVIO_API_KEY` | **Active** | High-throughput EVM event log extraction |
| **Solscan Pro** | `SOLSCAN_API_KEY` | **Active** | Pro v2 Solana token and transaction verification |
| **Dune Analytics** | `DUNE_API_KEY` | **Active** | Custom smart-money SQL queries |

---

### 3. Complete Architecture & Breakdown of Roles

The platform separates **Meme Token Discovery** from **Smart Wallet Intelligence**:

```
                               ┌─────────────────────────────────────────────────────────────┐
                               │                 MEME TOKEN DISCOVERY                        │
                               │  - DexScreener (Boosts + Multi-Pair Resolution)             │
                               │  - GeckoTerminal (Solana Trending Pools)                    │
                               │  - Birdeye (Token List & Market Data)                       │
                               │  - GMGN (Solana Trending & Trenches)                        │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                                              ▼
                                                   [Tracked Memes Registry]
                                                  (Mcap > $2M / ATH > $4M)
                                                              │
                                                              ▼
                               ┌─────────────────────────────────────────────────────────────┐
                               │             WORKER 3: EARLY BUYER HARVESTER                 │
                               │  - Multi-source trade rotation: Birdeye + Helius            │
                               │  - Strict Pre-ATH filtering (T_trade < T_ATH)               │
                               │  - Quota + Value buyer qualification                        │
                               │  - Zero transaction storage (in-memory extraction)          │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                              SMART WALLETS STORE (5,000+ Wallets)                          │
│  Discovered and tracked across specialized wallet adapters:                                │
│  - Kolscan: Top Solana KOLs & alpha callers                                                │
│  - MadeOnSol: Launch snipers & top PnL traders                                             │
│  - MemeMoves: Multi-wallet accumulation clusters & whale coordinated buys                  │
│  - Nock Scout: Top Robinhood EVM copy traders                                              │
│  - Cielo: Real-time wallet tracking & webhook alerts                                       │
│  - Birdeye: Multi-token wallet portfolio valuation, meme holdings, and whale categorization│
│  - FOMO.family: Wallet activity & leaderboards                                             │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### A. Meme Token Discovery Endpoints
- **DexScreener (`worker1CurrentMcap.js`)**:
  - Fetches boosted tokens from `/token-boosts/latest/v1` and resolves their live market caps and 24h volumes via `/latest/dex/tokens/{addrs}`. Discovers tokens with current market cap $\ge \$2\text{M}$.
- **GeckoTerminal (`worker2AthMcap.js`)**:
  - Queries `/networks/solana/trending_pools` for tokens with market cap / FDV $\ge \$4\text{M}$ and captures their verified pool timestamp (`pool_created_at` / `athTimestamp`).
- **Birdeye Token List**:
  - Queries `/defi/tokenlist?sort_by=v24hUSD` for Solana tokens with verified market cap $\ge \$2\text{M}$ and 24h volume.
- **GMGN Trending (`src/discovery/gmgn.js`)**:
  - Discovers new creations and near-completion tokens across Solana and Robinhood.

#### B. Trade Extraction & Early Buyer Harvest (Worker 3)
- **Multi-Source Trade Providers (`worker3EarlyBuyers.js`)**:
  - **Birdeye DeFi API (`/defi/txs/token?sort_type=asc&offset={page*50}&limit=50`)**: Primary chronological launch swap source. Features multi-page pagination (`offset = 0, 50, 100, 150, 200...`) up to 5 pages (250+ swaps), early-stopping as soon as trades cross $T_{\text{ATH}}$ or pagination terminates. Serialized through `rateLimiter.js` mutex queue (`baseDelayMs: 1200`).
  - **Pump.fun REST API (`frontend-api-v3.pump.fun/coins/{mint}`)**: 3rd high-speed provider. Extracts the slot-0 deployer/creator trade ($\le \$5\text{k}$ market cap genesis buy) and authoritative ATH market cap / timestamp metadata. Slot-0 creator is automatically prepended to the early buyer swap feed.
  - **Helius Enhanced SWAP API (`/v0/addresses/{ca}/transactions?type=SWAP`)**: High-throughput fallback source.
- **Qualification Rules**:
  - **Rule 1 (Quota Buyers)**: First $N$ unique wallets to buy, where $N = \text{round}(\text{ATH\_MCAP} \times 0.00004)$, minimum 1. Must buy strictly before $T_{\text{ATH}}$. (e.g. $2\text{M ATH} \rightarrow 80\text{ wallets}$; $100\text{M ATH} \rightarrow 4,000\text{ wallets}$).
  - **Rule 2 (Value Buyers)**: Wallets entering at $\le \min(25\% \text{ of ATH}, \$50\text{M})$ with positive realized PnL (`pnl > 0`). Must buy strictly before $T_{\text{ATH}}$. The $\$50\text{M}$ cap prevents mega-cap runner buyers ($>\$200\text{M}$ ATH) from qualifying as early buyers at late stages.
- **Strict Pre-ATH Cutoff**: Automatically normalizes 10-digit second timestamps and 13-digit millisecond timestamps, enforcing $T_{\text{trade}} < T_{\text{ATH}}$.
- **STRICT ZERO TRANSACTION STORAGE (CRITICAL MANDATE)**: Raw transaction objects and swap histories are inspected in-memory to extract wallet addresses and metrics, then immediately discarded. Never written to disk or database.

#### C. Smart Wallet Intelligence Adapters
- **Kolscan (`src/smartwallets/adapters/kolscan.js`)**: Scrapes top Solana KOLs and alpha callers.
- **MadeOnSol (`src/smartwallets/adapters/madeonsol.js`)**: Captures pump launch snipers and top PnL traders via `MADEONSOL_API_KEY`.
- **MemeMoves (`src/smartwallets/adapters/mememoves.js`)**: Identifies multi-wallet coordinated accumulation clusters.
- **Nock Scout (`src/smartwallets/adapters/nock.js`)**: Ingests top Robinhood EVM copy traders.
- **Cielo (`src/smartwallets/adapters/cielo.js`)**: Webhook listener for real-time smart wallet transaction alerts via `CIELO_API_KEY`.
- **Birdeye Wallet Profiler (`src/smartwallets/adapters/birdeye.js`)**: Analyzes wallet portfolios, meme holdings, and whale status ($\ge \$100\text{k}$).
- **FOMO.family (`src/smartwallets/adapters/fomo.js`)**: Tracks wallet leaderboards, PnL, and win rates.

#### D. In-Memory Wallet Metrics Pass (Worker 4)
- Calculates 6 key execution metrics on-the-fly without saving raw transactions:
  1. **Capture Ratio %**: Average realized exit market cap $\div$ ATH market cap.
  2. **% Sold > 50% ATH**: Measures whether the wallet exits near the top or round-trips.
  3. **Round-Trip Rate %**: % of winning trades ridden back below entry.
  4. **ROI %**: Overall return on investment across trades.
  5. **Win Rate %**: Percentage of profitable trades.
  6. **Average Holding Time (seconds)**.
- **Watermarking Cursor**: Tracks `lastProcessedTxSignature` and `lastProcessedTimestamp` for incremental processing.
- **90-Day Ceiling**: Backfills capped strictly at `Date.now() - 90 * 86400 * 1000`.

#### E. Token ATH Cache & Hit-Rate Classifier (Worker 5)
- Maintains a global token ATH cache.
- Classifies tokens traded by each wallet against the $\$2\text{M}$ ATH benchmark.
- Computes wallet hit rate: $(\text{tokensTradedGt2m} \div \text{totalTokensTraded}) \times 100$.

---

### 4. Why 57 Memes Showed "Backfilled" & What Actually Happened

- **Do we have all early buyer wallets for those 57 memes?**
  - **No, not all of them.**
  - **4 memes** yielded 157 early buyers currently recorded in `smart-wallets.json` under `worker3-early-buyer`.
  - **53 memes** were marked `backfilled: true` with **0 early buyers harvested** due to two root causes:
    1. **Missing ATH Timestamp (`athTimestamp: 0`)**: 18 tokens were seeded with an ATH market cap but `athTimestamp: 0`. Worker 3's pre-ATH filter ($T_{\text{trade}} < T_{\text{ATH}}$) requires $T_{\text{ATH}} > 0$. When it was 0, zero trades qualified, but the code still called `markMemeBackfilled(meme.ca)`.
    2. **API Provider Cooldown & Ordering**: 35 tokens were processed when Birdeye returned HTTP 429 cooldown and Helius returned only the latest 100 recent swaps (post-ATH) instead of launch swaps. When 0 pre-ATH trades matched, Worker 3 previously called `markMemeBackfilled` anyway.

#### Hardening Implemented:
1. **Multi-Page Pagination (Birdeye 50-Item Cap Resolution)**: Birdeye strictly caps requests at `limit=50`. Previously, only page 1 (`offset=0`) was fetched, which yielded only 30–43 unique wallets after deduplication regardless of ATH size. Worker 3 now paginates up to 5 pages (`offset=0, 50, 100, 150...`) sequentially through the rate limiter, yielding 80–250+ unique early buyers per token.
2. **Pump.fun 3rd Provider Integration**: Extracts genesis slot-0 creator wallets and enriches ATH values without consuming Birdeye quota.
3. **$50M Entry Cap for Value Buyers**: Rule 2 entry market cap is bounded by `Math.min(athMcap * 0.25, 50_000_000)` with `pnl > 0`, ensuring mega-runners do not admit late momentum buyers.
4. **Source-Aware Backfill Guard**: `worker3EarlyBuyers.js` now tags trades with their origin (`birdeye`, `pumpfun`, vs `helius`). If Helius falls back to recent swaps and yields 0 pre-ATH buyers, the token is kept unbackfilled for retry when Birdeye is available.
5. **Birdeye Throttle Calibration**: `rateLimiter.js` delay for Birdeye increased from 500ms to 1,200ms (`baseDelayMs: 1200`), eliminating HTTP 429 rate limit trips.
6. **System & EVM Mint Isolation**: Base quote mints (SOL, USDC, USDT) and EVM (`0x...`) addresses are automatically excluded from Worker 3's harvest queue.
7. **Active Re-harvesting**: Hundreds of pre-ATH early buyer wallets have been successfully harvested into `smart-wallets.json` across validated runner tokens without storing any raw swap history.



