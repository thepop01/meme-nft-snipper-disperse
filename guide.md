# TradeForge Terminal & Smart Wallet Finder: Operational Guide

> For detailed documentation and context, see [`docs/guide.md`](file:///d:/project/bot/docs/guide.md).

## 1. Quick Start

### Start Backend
```powershell
cd d:\project\bot\backend
npm run dev
```

### Start Frontend
```powershell
cd d:\project\bot\frontend
npm run dev
```

---

## 2. Does the Smart Wallet Finder Start Automatically with the Backend?

**YES.** When the backend starts (`server.js`):
1. An initial scan runs **10 seconds after startup**.
2. Recurring scans run automatically in the background **every 15 minutes**.
3. All discovered Solana and Robinhood wallets, 30-day PnL, win rates, and sub-$1M, $2M, $5M, $10M brackets are saved to [`backend/data/smart-wallets.json`](file:///d:/project/bot/backend/data/smart-wallets.json).

---

## 3. Manual Script Execution

### When inside `d:\project\bot\backend`:
```powershell
node scripts/find-smart-wallets.js --chain=solana
node scripts/find-smart-wallets.js --chain=robinhood
node scripts/find-smart-wallets.js --chain=all
```
*Or:*
```powershell
npm run find-wallets -- --chain=solana
```

### When at root `d:\project\bot`:
```powershell
node backend/scripts/find-smart-wallets.js --chain=solana
node backend/scripts/find-smart-wallets.js --chain=robinhood
node backend/scripts/find-smart-wallets.js --chain=all
```

---

## 4. UI Trigger

Open `http://localhost:5173/smart-wallets` and click **"Run Smart Wallet Finder"** on either the **Solana Meme Wallets** or **Robinhood / EVM Meme Wallets** tab.

---

## 5. Unified 7-Column Layout & Execution Metrics

Both the **Smart Wallets** and **Tracked Wallets** views share the exact same 7-column execution metric layout:

1. **Wallet Address**: Address with copy button, explorer link, Twitter handle, method badge (`🎯 Mcap ≤25%`, `⏱ First N`, `⚡ Mcap ≤25% + First N`), and runner info pill (`🎯 Early #rank · $SYMBOL`).
2. **PnL**: 30-day realized PnL (`fmtUsd`).
3. **Win Rate**: Closed position win percentage badge (`winRate.toFixed(1)%`).
4. **Buy/Win**: Ratio of winning trades to total buys (`X won / Y buys`).
5. **Avg Buy Mcap**: Average token entry market cap (`fmtCurrency`) with entry price subtext (`fmtPrice`).
6. **Avg Sell Mcap**: Average token exit market cap (`fmtCurrency`) with exit price subtext (`fmtPrice`).
7. **Avg Holding Time**: Average position holding duration (`s`, `m`, `h`, `d`).
8. **Actions**: Direct GMGN link, delete button, and a 1-click **Promote** button for Tracked candidates to graduate to Smart Wallets.

---

## 6. The 25% of ATH Rule (ATH ≥ $1M Runners) & Dual Ingestion

Tokens qualify as runners when their All-Time High market cap reaches **at least $1,000,000**. Early buys must occur at or below **25% of the token's All-Time High**:

| Runner ATH | Qualifying Entry Market Cap (≤ 25%) | Quota (First N) |
|---|---|---|
| **≥ $50M Megacap** | **≤ $12.5M** | 1,080 early buyers |
| **~$10M Breakouts** | **≤ $2.5M** | 280 early buyers |
| **~$5M Early Runners** | **≤ $1.25M** | 180 early buyers |
| **≥ $1M Baseline Runners** | **≤ $250k** | 100 early buyers |

### Dual Qualification Methods
1. **Method 1: Buying Market Cap (`buying_mcap`)**: Ingests buyers entering at $\le 25\%$ of ATH whose closed trades were profitable (`profitUsd > 0`).
2. **Method 2: First N Buyers (`first_n_buyers`)**: Ingests the earliest chronological buyers up to quota ($100 + 20$ per $\$1\text{M}$ above $\$1\text{M}$) who achieved positive profit.
3. **Dual Qualification**: Wallets qualifying under both methods are tagged with `⚡ Mcap ≤25% + First N`.

---

## 7. Backfill & Rate Limit Best Practice

### Execution Metrics Backfill
To populate or refresh `avgBuyMcap`, `avgBuyPrice`, `avgSellMcap`, `avgSellPrice`, and `avgHoldingTimeSec` across stored wallets:
```powershell
# From project root:
node backend/scripts/backfill-metrics.js

# Or via API:
curl -X POST http://localhost:4517/api/smart-wallets/backfill -H "Content-Type: application/json" -d "{\"maxLiveQueries\": 5}"
```

### GMGN Rate Limits
GMGN OpenAPI rate-limits IP addresses if bombarded with rapid back-to-back requests. The script contains built-in 600–800ms pacing. Avoid firing multiple terminal commands at the exact same time. If a 429 occurs, it automatically lifts in 30–60 seconds.

---

## 8. Live Intelligence Sources Directory & Pricing Guide

### Free vs. Freemium vs. Paid Overview

| Source | Chain | Tier | API Key Required? | What It Powers in the Bot |
| :--- | :--- | :--- | :--- | :--- |
| **GMGN** (`gmgn.ai`) | Solana + EVM | **100% Free** | No | Automated 30d PnL, winrate & open trade scan (`POST /scan`) |
| **FOMO** (`fomo.family`) | Solana + EVM | **100% Free** | No | Social meme leaderboards, handles & PnL (`POST /scan/fomo`) |
| **Kolscan** (`kolscan.io`) | Solana | **100% Free** | No | Top Twitter/meme caller leaderboards (`POST /scan/kolscan`) |
| **Nock Scout** (`nockterminal.com`) | Robinhood | **100% Free** | No | Copyable PnL leaderboard on Robinhood Chain (`POST /scan/nock`) |
| **MemeMoves** (`mememoves.com`) | Solana | **100% Free** | No | Multi-wallet cluster accumulation alerts (`cluster:convergence`) |
| **MadeOnSol** (`madeonsol.com`) | Solana | **100% Free** | No | Launch snipers & deployer history verification |
| **Robinhood Blockscout** | Robinhood | **100% Free** | No | Native contract & transaction explorer |
| **HoodScan / RobinScan** | Robinhood | **100% Free** | No | Robinhood Chain explorers & whale tracking |
| **Solscan** (`solscan.io`) | Solana | **100% Free** | Optional | Raw on-chain signature verification |
| **Birdeye** (`birdeye.so`) | Solana | **Freemium** | Optional (`BIRDEYE_API_KEY`) | Portfolio multi-token balances & whale holdings evaluation |
| **Cielo** (`cielo.finance`) | Solana + EVM | **Freemium** | Webhook URL | Real-time buy/sell alerts webhook (`POST /webhook/cielo`) |
| **Dune Analytics** (`dune.com`) | Both Chains | **Freemium** | Optional (`DUNE_API_KEY`) | Community 30d realized PnL SQL leaderboards |
| **Nansen** (`nansen.ai`) | Solana + EVM | **Freemium / Paid** | Optional (`NANSEN_API_KEY`) | Institutional Smart Money netflows, DEX trades & CSV import |

---

### Detailed Directory

#### Solana (Memes)
- **[GMGN](https://gmgn.ai/)** `[Free]` — Automated smart-money discovery (7d/30d PnL, win rate, trade count).
- **[FOMO (fomo.family)](https://fomo.family/)** `[Free]` — Social-first smart money leaderboard with verified Solana wallets, handles, and 30d realized PnL.
- **[Kolscan](https://kolscan.io/)** `[Free]` — KOL / meme-trader leaderboard and alpha caller tracker.
- **[MemeMoves](https://mememoves.com/smart-money)** `[Free]` — Simultaneous multi-wallet accumulation detector.
- **[MadeOnSol](https://madeonsol.com/)** `[Free]` — Launch snipers & deployer safety scanner.
- **[Birdeye](https://birdeye.so/)** `[Freemium]` — Trader profiles, verified PnL, and token holdings.
- **[Cielo](https://cielo.finance/)** `[Freemium]` — Watchlist & real-time webhook alerts on smart money buys/sells.
- **[Nansen](https://nansen.ai/)** `[Paid API / Free Web]` — Smart Money DEX trades, holdings, and 1-click Profiler.
- **[Solscan](https://solscan.io/)** `[Free]` — Raw on-chain transaction & SPL token transfer verification.

#### Robinhood Chain (Chain ID 4663)
- **[Luma](https://withluma.app/)** `[Free]` — Main Robinhood intelligence hub (1,000+ smart wallets on Base + Robinhood).
- **[FOMO (fomo.family EVM)](https://fomo.family/)** `[Free]` — Top EVM meme traders ranked by 30d realized PnL and trade counts.
- **[Nock Scout](https://nockterminal.com/wallets)** `[Free]` — Copyable PnL leaderboard on Robinhood Chain.
- **[Dune Analytics](https://dune.com/geggonen/robinhood-chain-analytics)** `[Free / Freemium]` — 30d realized PnL leaderboard queries.
- **[HoodScan](https://hoodscan.co/)** & **[RobinScan](https://robinscan.xyz/)** `[Free]` — Robinhood Chain explorers & whale tracking.
- **[Robinhood Blockscout](https://robinhoodchain.blockscout.com/)** `[Free]` — Official block explorer for raw tx verification.

---

## 7. Optional API Key Configuration (`backend/.env`)

The bot operates 100% free with GMGN, FOMO, Kolscan, Nock Scout, and Blockscout. To enable institutional or enhanced profilers:

```env
# Optional: Nansen API (api.nansen.ai) - Leave blank if using free web CSV exports
NANSEN_API_KEY=

# Optional: Birdeye Public API (birdeye.so) for multi-token portfolio balances
BIRDEYE_API_KEY=

# Optional: Dune Analytics API (dune.com) for SQL query result ingestion
DUNE_API_KEY=
```

---

## 8. Quick Starts & The Anti-Luck Filter

- **Solana Quick Start:** GMGN or FOMO → Pick wallets with 30d profit + $\ge 5$ open trades → Verify on Solscan → Alert on Cielo.
- **Robinhood Quick Start:** Luma or Nock Scout → Check 30d PnL & trade count → Confirm on Robinhood Blockscout / HoodScan.
- **Anti-Luck Rule:** Ignore one lucky 10x. Filter for wallets with consistent 30d PnL ($> \$100$), $\ge 5$ open trades, and multi-token consistency.

