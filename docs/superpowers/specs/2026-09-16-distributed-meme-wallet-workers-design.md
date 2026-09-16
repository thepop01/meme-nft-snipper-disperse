# Distributed Meme & Wallet Pipeline (5-Worker Architecture) Design Spec

- **Date:** 2026-09-16
- **Status:** Approved
- **Scope:** Background multi-worker data pipeline, zero transaction storage accumulator, rate limiter circuit breaker, and frontend views.

---

## 1. Problem & Goals

1. **Scalable Meme Discovery:** Discover high-momentum meme tokens across two dimensions—current market cap ($> \$2\text{M}$) and all-time-high market cap ($> \$4\text{M}$)—and store them into a single deduplicated registry without double-processing overlaps.
2. **True Pre-ATH Early Buyer Extraction:** Harvest wallets that demonstrated genuine early entry prior to the peak ($T_{\text{ATH}}$) rather than post-dump dip-buyers:
   - First buyers quota: first $N$ buyers where $N = M_{\text{ATH}} \times 0.00004$ (e.g. $5\text{M} \times 0.00004 = 200$ buyers).
   - Early value buyers: buyers with entry Mcap $\le 25\%$ of ATH ($< \$1.25\text{M}$ for $5\text{M}$ ATH) *prior to $T_{\text{ATH}}$* who achieved positive realized PnL on the trade.
3. **Zero Transaction History Storage:** To prevent database explosion and disk saturation, raw transactions and swaps are never saved to disk. All metrics are derived in-flight via stream accumulation, persisting only summary metrics and a transaction watermark cursor (`lastProcessedTxSignature`).
4. **Bounded Historical Lookback & Incremental Refresh:** Initial backfill inspects up to 90 days. Subsequent syncs process only transactions occurring after the watermark cursor.
5. **Execution Quality Metrics:** Compute deep execution signals:
   - **Capture Ratio:** $\frac{\text{Avg Realized Exit Mcap}}{M_{\text{ATH}}}$
   - **% Sold $>50\%$ ATH:** Fraction of position volume exited while token was above half its ATH.
   - **Round-Trip Rate:** % of winning positions held until price reverted below entry.
   - **Historical Runner Hit Rate:** % of traded tokens that reached $\ge \$2\text{M}$ ATH vs $<\$2\text{M}$ ATH.
6. **Rate-Limit & Anti-Ban Resilience:** Strict exclusion of Dune, Cielo, and Arkham. Scraped and free endpoints (GMGN, Kolscan, FOMO.family, DexScreener, GeckoTerminal) are guarded by an adaptive backoff and Cloudflare circuit breaker.

---

## 2. Architecture & Data Flow

```
                      [ DexScreener / GeckoTerminal / GMGN ]
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
      [ Worker 1 ]                                      [ Worker 2 ]
  Current Mcap > $2M                                  ATH Mcap > $4M
           │                                                 │
           └────────────────────────┬────────────────────────┘
                                    ▼
                         ┌────────────────────┐
                         │   tracked_memes    │  (Single shared registry)
                         │ (backfilled=false) │
                         └──────────┬─────────┘
                                    │
                                    ▼
                               [ Worker 3 ]
                      Pre-ATH Early Buyer Harvester
       - Extracts first N buyers (0.004% ATH quota) before T_ATH
       - Extracts buyers at <=25% ATH prior to T_ATH with profit
       - Marks meme backfilled = true
                                    │
                                    ▼
                         ┌────────────────────┐
                         │   smart_wallets    │
                         │ (new candidates)   │
                         └──────────┬─────────┘
                                    │
                                    ▼
                               [ Worker 4 ]
                      In-Memory Wallet Metrics Streamer
       - Reads wallet activity up to 90 days (or since watermark)
       - In-flight computation of PnL, Win Rate, ROI, Capture Ratio, Round-trip
       - Stores updated metrics + advances watermark signature
       - Emits distinct tradedTokenCAs
       - DISCARDS raw transaction data immediately
                                    │
                                    ▼
                               [ Worker 5 ]
                       Token ATH & Hit-Rate Classifier
       - Checks tradedTokenCAs against token_ath_cache
       - Resolves unknown token ATHs via DexScreener/Gecko
       - Updates tokensTradedGt2m vs tokensTradedLt2m on wallet
```

---

## 3. Data Schemas (Zero Transaction Storage)

### 3.1 `tracked_memes` (`backend/data/tracked-memes.json`)
```typescript
interface TrackedMeme {
  ca: string;                // Primary key (Solana mint or EVM address)
  name: string;
  symbol: string;
  chain: 'solana' | 'robinhood';
  currentMcap: number;       // USD
  athMcap: number;           // USD
  athTimestamp: number;      // Epoch ms when ATH occurred (T_ATH)
  volume24hUsd: number;      // 24h volume USD
  sourceFlags: ('current_gt_2m' | 'ath_gt_4m')[];
  backfilled: boolean;       // false until Worker 3 extracts buyers
  backfilledAt: number | null;
  updatedAt: number;
}
```

### 3.2 `token_ath_cache` (`backend/data/token-ath-cache.json`)
```typescript
interface TokenAthRecord {
  ca: string;                // Token contract address
  symbol: string;
  athMcap: number;           // Historical ATH market cap
  isGt2m: boolean;           // true if athMcap >= 2_000_000
  updatedAt: number;
}
```

### 3.3 `smart_wallets` (`backend/data/smart-wallets.json`)
*(Zero raw transaction logs or swap history stored)*
```typescript
interface SmartWalletRecord {
  address: string;           // Primary key
  chain: 'solana' | 'robinhood';
  source: string;            // e.g. 'worker3-early-buyer'
  
  // Core Performance
  realizedProfitUsd: number;
  winRatePct: number;
  roiPct: number;            // realizedProfit / totalInvested * 100
  totalTrades: number;
  avgBuyMcap: number;
  avgSellMcap: number;
  avgHoldingTimeSec: number;

  // Advanced Execution
  captureRatio: number;      // avg realized exit mcap / token ATH mcap (0.0 to 1.0)
  pctSoldAbove50Ath: number; // % volume sold while token was >= 50% ATH
  roundTripRate: number;     // % winning trades held until price < entry

  // Historical Runner Hit Rate
  tokensTradedGt2m: number;  // Traded tokens that reached >= $2M ATH
  tokensTradedLt2m: number;  // Traded tokens that stayed < $2M ATH
  hitRateGt2mPct: number;    // tokensTradedGt2m / totalTokensTraded * 100
  tradedTokenCAs: string[];  // Compact list of distinct token CAs traded in 90d window

  // Watermark Cursor
  lastProcessedTxSignature: string | null;
  lastProcessedTimestamp: number;
  firstBackfillTimestamp: number;
  updatedAt: number;
}
```

---

## 4. Worker Responsibilities & Logic

### Worker 1: Current Mcap > $2M Discovery
- **Schedule:** Runs every 10 minutes.
- **Source:** DexScreener, GeckoTerminal, GMGN trending.
- **Filter:** Tokens active in last 30 days with `currentMcap >= 2_000_000`.
- **Action:** Upserts to `tracked_memes`, appending `'current_gt_2m'` to `sourceFlags` if not present.

### Worker 2: ATH Mcap > $4M Discovery
- **Schedule:** Runs every 15 minutes.
- **Source:** DexScreener, GeckoTerminal, GMGN runners.
- **Filter:** Tokens with `athMcap >= 4_000_000`.
- **Action:** Upserts to `tracked_memes`, appending `'ath_gt_4m'` to `sourceFlags`. Records `athTimestamp` ($T_{\text{ATH}}$).

### Worker 3: Pre-ATH Early Buyer Harvester
- **Schedule:** Continuous queue (processes 1 unbackfilled token per tick).
- **Selection:** Finds first token with `backfilled === false` and `athMcap > 0`.
- **Chronological Window:** Trades between token launch and $T_{\text{ATH}}$.
- **Qualification Rules:**
  1. **0.004% ATH Quota:** First $N$ buyers ($N = M_{\text{ATH}} \times 0.00004$; e.g., $\$2\text{M} \to 80$ buyers, $\$5\text{M} \to 200$ buyers).
  2. **$\le 25\%$ ATH Early Buyers:** Bought at $\text{Mcap} \le 0.25 \times M_{\text{ATH}}$ before $T_{\text{ATH}}$ and exited with a positive realized PnL.
- **Action:** Inserts candidate addresses into `smart_wallets` (if not already existing) with `source: 'worker3-early-buyer'`. Sets `backfilled = true` and `backfilledAt = Date.now()`.

### Worker 4: In-Memory Wallet Metrics Streamer & Watermark Manager
- **Schedule:** Continuous queue (processes 5 wallets per batch).
- **Time Bounds:**
  - **Cold wallet:** Fetches activity back to `Date.now() - 90 * 86400 * 1000`.
  - **Warm wallet:** Fetches only transactions newer than `lastProcessedTxSignature`.
- **In-Memory Accumulator:**
  - Aggregates buys, sells, holding periods, realized PnL.
  - Computes `captureRatio`, `pctSoldAbove50Ath`, `roundTripRate`, `roiPct`.
  - Discards individual transactions immediately from memory.
- **Action:** Updates wallet record, sets new `lastProcessedTxSignature` and `lastProcessedTimestamp`, and saves `tradedTokenCAs`.

### Worker 5: Token ATH Resolver & Hit-Rate Classifier
- **Schedule:** Runs every 5 minutes.
- **Input:** Aggregates unique `tradedTokenCAs` across all smart wallets.
- **Resolution:** Checks `token_ath_cache`. For any missing CA, queries DexScreener/GeckoTerminal in rate-controlled batches to obtain ATH Mcap.
- **Action:**
  - Stores resolved tokens in `token_ath_cache`.
  - Computes `tokensTradedGt2m`, `tokensTradedLt2m`, and `hitRateGt2mPct` for each wallet based on cached data.

---

## 5. Circuit Breaker & Rate Limiter (`rateLimiter.js`)

- **Prohibited Sources:** No API calls to Dune, Cielo, or Arkham.
- **Adaptive Backoff:**
  - Baseline delays: DexScreener (1,000ms), GeckoTerminal (1,500ms), GMGN (1,500ms), scrapers (2,000ms).
  - On HTTP 200: Gradually reduce delay by 100ms toward baseline.
  - On HTTP 429 or 403: Exponentially double delay (`delay = delay * 2`).
  - On 3 consecutive failures: Enter `'cooling_down'` state for 3–5 minutes.
- **API:**
  ```javascript
  executeWithThrottle(sourceName, asyncFn)
  getEndpointHealth()
  ```

---

## 6. Frontend Integration

1. **`MemeRegistryView.jsx` (New Tracked Memes View):**
   - Displays all tokens from `tracked_memes`.
   - Columns: Token Name & Symbol, Contract Address (with copy button & Solscan link), Current Mcap, ATH Mcap, 24h Volume, Source Tags (`Current > $2M`, `ATH > $4M`), Backfill Status badge (`✅ Backfilled` vs `⏳ Pending Worker 3`).
   - Filters: Search by CA/name, filter by backfill status or Mcap threshold.
2. **`SmartWalletsView.jsx` (Updated Table):**
   - New Columns:
     - **Capture Ratio** (e.g. `85%`)
     - **Round-Trip %** (e.g. `12%`)
     - **Sold >50% ATH %**
     - **$\ge \$2\text{M}$ Hit Rate** (`X / Y (Z%)`)
     - **ROI %**
     - **Last Processed Watermark**
3. **`Sidebar.jsx`:**
   - Adds navigation link for "Tracked Memes" pointing to `MemeRegistryView`.

---

## 7. Testing Strategy

- **Unit Tests:**
  - `backend/src/workers/__tests__/rateLimiter.test.js`: verifies adaptive backoff and cooldown.
  - `backend/src/workers/__tests__/memeRegistry.test.js`: verifies deduplication, source flags, and backfill toggle.
  - `backend/src/workers/__tests__/worker1And2.test.js`: verifies discovery and merging into shared table.
  - `backend/src/workers/__tests__/worker3EarlyBuyers.test.js`: verifies pre-ATH cutoff, 0.004% quota, and 25% ATH entry.
  - `backend/src/workers/__tests__/worker4Metrics.test.js`: verifies in-memory stream accumulator and watermark updates.
  - `backend/src/workers/__tests__/worker5Distribution.test.js`: verifies token ATH caching and hit rate calculations.
- **Integration Tests:**
  - `backend/src/workers/__tests__/workerManager.test.js`: verifies worker lifecycle and status reporting.
- **Frontend Tests:**
  - `frontend/src/components/__tests__/MemeRegistryView.test.js`
  - `frontend/src/components/__tests__/SmartWalletsView.test.js`
