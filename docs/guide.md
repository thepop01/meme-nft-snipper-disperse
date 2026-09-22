# TradeForge Terminal & Smart Wallet Finder: Operational Guide

## 1. Quick Start

### Start the Backend
From `d:\project\bot\backend`:
```powershell
npm run dev
```
- Listens on `http://localhost:4517` with WebSocket support at `ws://localhost:4517`.
- Automatically loads environment variables from [`backend/.env`](file:///d:/project/bot/backend/.env).

### Start the Frontend
From `d:\project\bot\frontend`:
```powershell
npm run dev
```
- Available at `http://localhost:5173`.

---

## 2. Does the Smart Wallet Finder Run Automatically with the Backend?

**YES.** When the backend starts, the Smart Wallet Finder runs automatically:

1. **Initial Auto-Scan**: 10 seconds after server startup, the backend triggers an initial scan for both Solana and Robinhood meme traders.
2. **Periodic Recurring Scan**: The finder automatically runs in the background **every 15 minutes**.
3. **Automatic Persistence**: Any discovered wallets, along with their 30-day profit, win rates, and entry market-cap brackets, are saved into [`backend/data/smart-wallets.json`](file:///d:/project/bot/backend/data/smart-wallets.json).
4. **Live UI Updates**: The frontend [Smart Wallets View](file:///d:/project/bot/frontend/src/components/SmartWalletsView.jsx) reflects these updates automatically upon refresh or when clicking the scan button.

To adjust the recurring frequency or startup delay, modify [`backend/src/smartwallets/finder.js`](file:///d:/project/bot/backend/src/smartwallets/finder.js):
```javascript
// Defaults: intervalMs = 15 minutes, initialDelayMs = 10 seconds
startSmartWalletFinder({ intervalMs: 15 * 60_000, initialDelayMs: 10_000 });
```

---

## 3. Running the Standalone Script Manually

You can also trigger scans manually from the command line at any time.

### If your terminal is inside `d:\project\bot\backend`:
```powershell
# Solana only
node scripts/find-smart-wallets.js --chain=solana

# Robinhood (EVM) only
node scripts/find-smart-wallets.js --chain=robinhood

# Both chains
node scripts/find-smart-wallets.js --chain=all
```
*Or using npm:*
```powershell
npm run find-wallets -- --chain=solana
npm run find-wallets -- --chain=robinhood
npm run find-wallets -- --chain=all
```

### If your terminal is at the project root `d:\project\bot`:
```powershell
node backend/scripts/find-smart-wallets.js --chain=solana
node backend/scripts/find-smart-wallets.js --chain=robinhood
node backend/scripts/find-smart-wallets.js --chain=all
```

---

## 4. UI Trigger (Web Browser)

1. Navigate to **Smart Wallets** in the sidebar (`http://localhost:5173/smart-wallets`).
2. Switch between **Solana Meme Wallets** and **Robinhood / EVM Meme Wallets**.
3. Click the top-right button:
   - **"Run Smart Wallet Finder (Solana)"** or **"Run Smart Wallet Finder (Robinhood)"**.
4. The frontend calls `POST /api/smart-wallets/scan`, performs live discovery, and reloads the table with the newly analyzed wallets.

---

## 5. Unified 7-Column Layout, Execution Metrics & 25% ATH Rules

Both the **Smart Wallets** and **Tracked Wallets** tables share the exact same streamlined 7-column execution metric layout, giving traders immediate visibility into how wallets enter and exit tokens:

| Column Header | Field / Data Source | Description |
|---|---|---|
| **Wallet Address** | `address`, `tags`, `methods`, `earlyBuyerInfo` | Truncated address with 1-click copy, Twitter/social handle, Solscan/Robinhood explorer link, method qualification badge (`🎯 Mcap ≤25%`, `⏱ First N`, `⚡ Mcap ≤25% + First N`), and runner early buyer pill (`🎯 Early #rank · $SYMBOL`). |
| **PnL** | `realizedProfitUsd` / `score` | 30-day net realized profit or loss formatted in USD (`+$X.Xk` / `+$X.XXM`). |
| **Win Rate** | `winRatePct` | Percentage of closed positions that were profitable (color-coded: green $\ge 50\%$, amber $\ge 35\%$, red $< 35\%$). |
| **Buy/Win** | `profitableTrades` / `tokenNum` | Ratio of winning trades to total buys (`X won / Y buys`). |
| **Avg Buy Mcap** | `avgBuyMcap`, `avgBuyPrice` | Average token entry market cap (`fmtCurrency`) with the entry token purchase price (`fmtPrice`) subtext. |
| **Avg Sell Mcap** | `avgSellMcap`, `avgSellPrice` | Average token exit market cap (`fmtCurrency`) with the exit selling price (`fmtPrice`) subtext across closed positions. |
| **Avg Holding Time** | `avgHoldingTimeSec` | Average trade duration formatted cleanly (`s`, `m`, `h`, `d`) extracted from GMGN closed positions. |
| **Actions** | Action Handlers | Direct links to GMGN profile, wallet deletion, and a 1-click **Promote** button for Tracked candidates to graduate into verified Smart Degens. |

---

### Qualification Rules: The 25% of ATH Rule (ATH ≥ $1M)

A runner is defined as any token that achieved an All-Time High (ATH) market cap of **at least $1,000,000** (raised from $500k). 

To qualify as an early buyer, the purchase must occur at an entry market cap of **no more than 25% of the token's All-Time High**:

| Runner ATH Bracket | Max Qualifying Entry Market Cap | Early Buyer Rule |
|---|---|---|
| **Megacap (≥ $50M ATH)** | **≤ $12.5M** | Entered at $\le 25\%$ of ATH ($50\text{M} \times 0.25$). |
| **~10M Breakouts (8M–50M ATH)** | **≤ $2.5M** | Entered at $\le 25\%$ of ATH ($10\text{M} \times 0.25$). |
| **~5M Early Runners (3M–8M ATH)** | **≤ $1.25M** | Entered at $\le 25\%$ of ATH ($5\text{M} \times 0.25$). |
| **≥ $1M Baseline Runners (1M–3M ATH)** | **≤ $250k** | Entered at $\le 25\%$ of ATH ($1\text{M} \times 0.25$). |

---

### Dual-Method Early Buyer Ingestion

To capture both high-conviction micro-cap buyers and the earliest tape snipers, the engine supports two complementary qualification methods:

1. **Method 1: Buying Market Cap (`buying_mcap`)**
   - Filters all buyers whose purchase occurred while the token's market cap was $\le 25\%$ of its ultimate ATH.
   - **Profit Requirement:** The trade must have been profitable (`profitUsd > 0`). Unprofitable or rugged entries are automatically rejected.

2. **Method 2: First N Buyers (`first_n_buyers`)**
   - Captures the first chronological buyers up to a dynamic quota:
     $$\text{Quota} = 100 + 20 \times \left(\frac{\text{ATH} - \$1,000,000}{\$1,000,000}\right)$$
   - Tokens at $\$1\text{M}$ ATH evaluate the first 100 buyers; tokens reaching $\$5\text{M}$ ATH evaluate the first 180 buyers.
   - **Profit Requirement:** Strictly requires positive realized profit (`profitUsd > 0`).

3. **Dual Qualification (`methods: ['buying_mcap', 'first_n_buyers']`)**
   - Wallets that satisfy **both** criteria receive the high-priority `⚡ Mcap ≤25% + First N` badge.

---

### Execution Metrics Pipeline & Backfill

Execution metrics (`avgBuyMcap`, `avgBuyPrice`, `avgSellMcap`, `avgSellPrice`, `avgHoldingTimeSec`) are sourced and maintained through a three-layer pipeline:

1. **Live GMGN Crawler Enrichment (`finder.js`):**
   - Extracts `pnl_stat.avg_holding_period` (in seconds) from `gmgn portfolio stats`.
   - Reconstructs trade execution history and token supplies via `gmgn portfolio activity` to compute average entry and exit prices.

2. **Rate-Limit Resilient Fallback Derivation (`backfill.js`):**
   - When GMGN API limits are encountered, `deriveExecutionMetrics()` reliably computes consistent execution metrics based on the wallet's historical buy brackets, realized PnL, and win rates.

3. **Manual & Automated Backfill:**
   - Run the standalone backfill script:
     ```powershell
     node backend/scripts/backfill-metrics.js
     ```
   - Or trigger via REST API:
     ```http
     POST /api/smart-wallets/backfill
     Content-Type: application/json
     { "maxLiveQueries": 5 }
     ```

4. **Dual-Layer Persistence:**
   - Every wallet update is simultaneously persisted to PostgreSQL (`smart_wallets` table) and local JSON storage ([`backend/data/smart-wallets.json`](file:///d:/project/bot/backend/data/smart-wallets.json)).

---

## 6. Route Structure

- **Solana Meme Terminal**: [`/sol-meme`](file:///d:/project/bot/frontend/src/App.jsx#L130) (Dedicated Solana pump.fun, raydium, and GMGN discovery)
- **EVM Meme Terminal**: [`/evm-meme`](file:///d:/project/bot/frontend/src/App.jsx#L131) (Dedicated Robinhood chain 4663 discovery via GeckoTerminal and GMGN)
- **Smart Wallets**: [`/smart-wallets`](file:///d:/project/bot/frontend/src/App.jsx#L132) (Separate Solana & Robinhood smart degens)
- **Sniper & Bots**: [`/sniper`](file:///d:/project/bot/frontend/src/App.jsx#L133) and [`/bots`](file:///d:/project/bot/frontend/src/App.jsx#L134)
- **Legacy `/memefinder`**: Automatically redirects to `/sol-meme` (no unified "all" page).

---

## 7. GMGN API Rate Limiting Note

GMGN OpenAPI imposes temporary rate-limit cooldowns (~30 to 60 seconds) if an IP sends rapid back-to-back requests without delays. 
- The finder script includes built-in sleep pacing (600–800ms) between calls.
- Avoid pasting multiple CLI commands on the same line without pauses (e.g. running solana, robinhood, and all simultaneously).
- If GMGN returns `HTTP 429 RATE_LIMIT_BANNED`, simply wait 30–60 seconds for the temporary ban to lift automatically.

---

## 8. Smart Meme Wallet Intelligence Sources & Playbooks

Solana and Robinhood Chain (chain ID 4663) represent two entirely different tech stacks and intelligence ecosystems.

### Solana (Memes) Sources Directory
- **[GMGN](https://gmgn.ai/)** — Default Solana smart-money tab. Filter by 7d / 30d PnL, win rate, trade count.
- **[Kolscan](https://kolscan.io/)** — KOL / meme-trader leaderboard. Primary upstream source for many downstream trackers.
- **[Cielo](https://cielo.finance/)** — Watchlist + real-time alerts when a smart wallet buys or sells.
- **[Birdeye](https://birdeye.so/)** — Trader profiles, verified PnL, token holdings on any Solana wallet.
- **[MadeOnSol](https://madeonsol.com/)** — KOL tracker + wallet scanner.
- **[MemeMoves](https://mememoves.com/smart-money)** — Tokens that multiple profitable meme wallets are accumulating simultaneously.
- **[uwuu](https://uwuu.ai/)** — PnL leaderboard + copy trading.
- **[Solscan](https://solscan.io/)** — Raw on-chain verification of signatures and balances.

> **Solana Quick Start:** GMGN or Kolscan → Pick wallets with 30d profit + 30+ trades + decent win rate → Verify on Solscan → Alert them on Cielo.

---

### Robinhood Chain (Chain ID 4663) Sources Directory
*Note: This is Robinhood's Arbitrum Orbit L2, not the stock app.*
- **[Luma](https://withluma.app/)** — Main intelligence hub. Tracks 1,000+ smart wallets on Base + Robinhood with feeds, convergence maps, and ranks.
- **[Polymarket Intelligence](https://polymarketintelligence.com/)** — High-speed smart-wallet activity feed for event & narrative memes.
- **[Nock Scout](https://nockterminal.com/wallets)** — Robinhood wallet leaderboard ranked by copyable PnL rather than raw wallet size.
- **[Dune Robinhood Analytics](https://dune.com/geggonen/robinhood-chain-analytics)** — Memecoin alpha / rekt leaderboard with 30d realized PnL.
- **[HoodScan](https://hoodscan.co/)** & **[RobinScan](https://robinscan.xyz/)** — Explorers with whale tracking and activity views.
- **[Robinhood Blockscout](https://robinhoodchain.blockscout.com/)** — Official block explorer for raw transaction and contract verification.

> **Robinhood Chain Quick Start:** Luma or Nock Scout → Check 7d/30d PnL and trade count → Confirm the same address on Robinhood Blockscout.

---

### The Anti-Luck Filter (Crucial Edge)
**Ignore one lucky 10x.**
Look for wallets with:
1. **Many closed trades (30+)**: Proves repeatable execution rather than survivor bias on a single pump.
2. **Consistent 7d & 30d PnL**: Positive over multi-week regimes, not just a 1-day spike.
3. **Recent activity**: Active in the last few days to ensure the wallet hasn't been retired or rotated.

*Past PnL is not a signal that the next meme will print — trade frequency and entry discipline (e.g. consistently entering below $1M or $2M and winning) are the true predictors.*
