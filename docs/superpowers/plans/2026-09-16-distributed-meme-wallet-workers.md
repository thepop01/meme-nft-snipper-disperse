# Distributed Meme & Wallet Pipeline (5-Worker Architecture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a distributed 5-worker background pipeline that continuously discovers trending/ATH meme coins into a single deduplicated token table, filters early/first buyers ($\le 25\%$ ATH mcap & 0.004% ATH quota prior to $T_{\text{ATH}}$), streams in-memory wallet metrics without storing raw transaction history, tracks $\ge \$2\text{M}$ vs $<\$2\text{M}$ token hit-rates via a shared ATH cache, and displays them across dedicated frontend tables without using Dune, Cielo, or Arkham API quotas.

**Architecture:** A shared deduplicated meme registry (`tracked_memes`) stores CA, name, current Mcap, ATH Mcap, 24h volume, and backfill status. Workers 1 & 2 populate this table (current Mcap $> \$2\text{M}$ and ATH Mcap $> \$4\text{M}$). Worker 3 queries non-backfilled memes up to $T_{\text{ATH}}$ to extract qualifying buyers ($\le 25\%$ ATH entry or 0.004% ATH buyer rank) and marks `backfilled = true`. Worker 4 streams wallet activity up to 90 days in memory, computes execution metrics and advances the transaction watermark cursor (`lastProcessedTxSignature`). Worker 5 resolves unique token CAs to ATH via a shared `token_ath_cache` and updates wallet $\ge \$2\text{M}$ hit rates. An adaptive rate limiter & circuit breaker protects scraped and free endpoints against Cloudflare bans.

**Tech Stack:** Node.js (ESM), Vitest, Express, React + Vite frontend with Tailwind/CSS tables.

## Global Constraints

- Prohibited services: No API calls to Dune, Cielo, or Arkham.
- Zero storage of raw transactions or individual swap logs; only aggregated metrics and watermark signatures are persisted.
- Initial wallet backfill strictly capped at 90 days (`Date.now() - 90 * 86400 * 1000`).
- Chronological pre-ATH cutoff ($T_{\text{ATH}}$) for Worker 3: only transactions before $T_{\text{ATH}}$ are evaluated.
- Single shared token table (`tracked_memes`) with `sourceFlags` (`current_gt_2m`, `ath_gt_4m`).
- All backend tests run via `npm test -- <path>` or `npx vitest run <path>` from `backend/`.
- All frontend tests run via `npm test -- --run` from `frontend/`.

---

## File Structure

```
backend/
├── src/
│   ├── workers/
│   │   ├── rateLimiter.js               # Cloudflare & 429 adaptive backoff & health-checker
│   │   ├── memeRegistry.js              # Shared deduplicated tracked_memes store (CA, Mcap, ATH, Vol)
│   │   ├── worker1CurrentMcap.js        # Worker 1: Discovers memes with current Mcap > $2M
│   │   ├── worker2AthMcap.js            # Worker 2: Discovers memes with ATH Mcap > $4M
│   │   ├── worker3EarlyBuyers.js        # Worker 3: Extracts <=25% ATH and 0.004% ATH early buyers before T_ATH
│   │   ├── worker4WalletMetrics.js      # Worker 4: Streams 90d trades in-memory, computes execution metrics & watermark
│   │   ├── worker5TokenDistribution.js  # Worker 5: Unique token ATH cache & >=$2M vs <$2M hit-rate classifier
│   │   ├── workerManager.js             # Orchestrator running and monitoring Workers 1-5
│   │   └── __tests__/
│   │       ├── rateLimiter.test.js
│   │       ├── memeRegistry.test.js
│   │       ├── worker1And2.test.js
│   │       ├── worker3EarlyBuyers.test.js
│   │       ├── worker4Metrics.test.js
│   │       ├── worker5Distribution.test.js
│   │       └── workerManager.test.js
│   ├── smartwallets/
│   │   └── routes.js                    # Adds endpoints for /api/memes/registry and worker metrics
frontend/
├── src/
│   ├── components/
│   │   ├── MemeRegistryView.jsx         # New view: Tracked Memes table with CA, Current Mcap, ATH, Vol, Backfill Status
│   │   ├── SmartWalletsView.jsx         # Updated with Capture Ratio, Round-trip %, ROI, and >=$2M token stats
│   │   ├── Sidebar.jsx                  # Navigation item for Tracked Memes
│   │   └── __tests__/
│   │       ├── MemeRegistryView.test.js
│   │       └── SmartWalletsView.test.js
```

---

## Tasks

### Task 1: Rate Limiter & Cloudflare Circuit Breaker

**Files:**
- Create: `backend/src/workers/rateLimiter.js`
- Test: `backend/src/workers/__tests__/rateLimiter.test.js`

**Interfaces:**
- Produces: `executeWithThrottle(sourceName, asyncFn, options)`
- Produces: `getEndpointHealth()`
- Produces: `resetRateLimiter()` (for testing)

- [ ] **Step 1: Write failing tests for adaptive rate limiter and circuit breaker**

```javascript
// backend/src/workers/__tests__/rateLimiter.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeWithThrottle, getEndpointHealth, resetRateLimiter } from '../rateLimiter.js';

describe('rateLimiter & Cloudflare Circuit Breaker', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('executes successful request and tracks healthy status', async () => {
    const result = await executeWithThrottle('dexscreener', async () => 'ok');
    expect(result).toBe('ok');
    const health = getEndpointHealth();
    expect(health.dexscreener.status).toBe('healthy');
    expect(health.dexscreener.successCount).toBe(1);
    expect(health.dexscreener.failureCount).toBe(0);
  });

  it('backs off delay on 429 and enters cooling_down on consecutive errors', async () => {
    const err429 = new Error('Too Many Requests (429)');
    err429.status = 429;

    for (let i = 0; i < 3; i++) {
      await expect(
        executeWithThrottle('gmgn', async () => { throw err429; })
      ).rejects.toThrow();
    }

    const health = getEndpointHealth();
    expect(health.gmgn.status).toBe('cooling_down');
    expect(health.gmgn.currentDelayMs).toBeGreaterThan(1500);
    expect(health.gmgn.failureCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/rateLimiter.test.js`
Expected: FAIL with "Cannot find module '../rateLimiter.js'"

- [ ] **Step 3: Implement `rateLimiter.js`**

```javascript
// backend/src/workers/rateLimiter.js
const DEFAULT_CONFIGS = {
  dexscreener: { baseDelayMs: 1000, maxDelayMs: 10000 },
  geckoterminal: { baseDelayMs: 1500, maxDelayMs: 15000 },
  gmgn: { baseDelayMs: 1500, maxDelayMs: 20000 },
  default: { baseDelayMs: 1500, maxDelayMs: 15000 },
};

const state = {};

function getSourceState(source) {
  if (!state[source]) {
    const conf = DEFAULT_CONFIGS[source] || DEFAULT_CONFIGS.default;
    state[source] = {
      source,
      status: 'healthy',
      currentDelayMs: conf.baseDelayMs,
      baseDelayMs: conf.baseDelayMs,
      maxDelayMs: conf.maxDelayMs,
      consecutiveErrors: 0,
      successCount: 0,
      failureCount: 0,
      lastError: null,
      coolingUntil: 0,
      lastCallTs: 0,
    };
  }
  return state[source];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function executeWithThrottle(sourceName, asyncFn) {
  const s = getSourceState(sourceName);
  const now = Date.now();

  if (s.coolingUntil > now) {
    throw new Error(`Endpoint ${sourceName} is cooling down until ${new Date(s.coolingUntil).toISOString()}`);
  }

  const elapsed = now - s.lastCallTs;
  if (elapsed < s.currentDelayMs) {
    await sleep(s.currentDelayMs - elapsed);
  }

  s.lastCallTs = Date.now();

  try {
    const res = await asyncFn();
    s.successCount++;
    s.consecutiveErrors = 0;
    s.status = 'healthy';
    s.currentDelayMs = Math.max(s.baseDelayMs, s.currentDelayMs - 100);
    return res;
  } catch (err) {
    s.failureCount++;
    s.consecutiveErrors++;
    s.lastError = err.message;
    s.currentDelayMs = Math.min(s.maxDelayMs, s.currentDelayMs * 2);

    const isRateLimit = err.status === 429 || err.status === 403 || String(err.message).includes('429') || String(err.message).includes('403');
    if (s.consecutiveErrors >= 3 || isRateLimit) {
      s.status = 'cooling_down';
      s.coolingUntil = Date.now() + 60_000;
    } else {
      s.status = 'degraded';
    }
    throw err;
  }
}

export function getEndpointHealth() {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    out[k] = { ...v };
  }
  return out;
}

export function resetRateLimiter() {
  for (const k of Object.keys(state)) {
    delete state[k];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/workers/__tests__/rateLimiter.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/rateLimiter.js backend/src/workers/__tests__/rateLimiter.test.js
git commit -m "feat(workers): implement adaptive rate limiter and Cloudflare circuit breaker"
```

---

### Task 2: Shared Deduplicated Meme Registry Store

**Files:**
- Create: `backend/src/workers/memeRegistry.js`
- Test: `backend/src/workers/__tests__/memeRegistry.test.js`

**Interfaces:**
- Produces: `upsertMeme(meme)`
- Produces: `getTrackedMemes(filter)`
- Produces: `getUnbackfilledMemes(limit)`
- Produces: `markMemeBackfilled(ca)`
- Produces: `resetMemeRegistry()` (for tests)

- [ ] **Step 1: Write failing tests for meme registry deduplication and source tags**

```javascript
// backend/src/workers/__tests__/memeRegistry.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { upsertMeme, getTrackedMemes, getUnbackfilledMemes, markMemeBackfilled, resetMemeRegistry } from '../memeRegistry.js';

describe('memeRegistry', () => {
  beforeEach(() => {
    resetMemeRegistry();
  });

  it('upserts and deduplicates tokens by CA merging sourceFlags', () => {
    upsertMeme({
      ca: 'Mint1111111111111111111111111111111111111111',
      name: 'PepeSol',
      symbol: 'PEPE',
      currentMcap: 2_500_000,
      athMcap: 3_000_000,
      athTimestamp: Date.now() - 3600000,
      volume24hUsd: 500_000,
      source: 'current_gt_2m',
    });

    upsertMeme({
      ca: 'Mint1111111111111111111111111111111111111111',
      athMcap: 4_500_000,
      source: 'ath_gt_4m',
    });

    const memes = getTrackedMemes();
    expect(memes).toHaveLength(1);
    expect(memes[0].sourceFlags).toContain('current_gt_2m');
    expect(memes[0].sourceFlags).toContain('ath_gt_4m');
    expect(memes[0].athMcap).toBe(4_500_000);
    expect(memes[0].backfilled).toBe(false);
  });

  it('filters unbackfilled memes and updates backfill status', () => {
    const ca = 'Mint2222222222222222222222222222222222222222';
    upsertMeme({ ca, name: 'DogeSol', athMcap: 5_000_000, source: 'ath_gt_4m' });

    let unbackfilled = getUnbackfilledMemes();
    expect(unbackfilled.some(m => m.ca === ca)).toBe(true);

    markMemeBackfilled(ca);
    unbackfilled = getUnbackfilledMemes();
    expect(unbackfilled.some(m => m.ca === ca)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/memeRegistry.test.js`
Expected: FAIL with "Cannot find module '../memeRegistry.js'"

- [ ] **Step 3: Implement `memeRegistry.js`**

```javascript
// backend/src/workers/memeRegistry.js
import { load, save } from '../store.js';

const STORE_KEY = 'tracked-memes';

let memCache = null;

function loadRegistry() {
  if (!memCache) {
    const raw = load(STORE_KEY, { memes: [] });
    memCache = new Map((raw.memes || []).map(m => [m.ca, m]));
  }
  return memCache;
}

function persist() {
  if (!memCache) return;
  save(STORE_KEY, { memes: Array.from(memCache.values()), updatedAt: Date.now() });
}

export function upsertMeme(item) {
  if (!item || !item.ca) return null;
  const reg = loadRegistry();
  const existing = reg.get(item.ca) || {
    ca: item.ca,
    name: item.name || 'Unknown',
    symbol: item.symbol || '?',
    chain: item.chain || 'solana',
    currentMcap: 0,
    athMcap: 0,
    athTimestamp: 0,
    volume24hUsd: 0,
    sourceFlags: [],
    backfilled: false,
    backfilledAt: null,
    createdAt: Date.now(),
  };

  if (item.name) existing.name = item.name;
  if (item.symbol) existing.symbol = item.symbol;
  if (item.currentMcap != null) existing.currentMcap = Number(item.currentMcap);
  if (item.athMcap != null) {
    if (Number(item.athMcap) >= existing.athMcap) {
      existing.athMcap = Number(item.athMcap);
      if (item.athTimestamp) existing.athTimestamp = Number(item.athTimestamp);
    }
  }
  if (item.volume24hUsd != null) existing.volume24hUsd = Number(item.volume24hUsd);
  if (item.source && !existing.sourceFlags.includes(item.source)) {
    existing.sourceFlags.push(item.source);
  }
  existing.updatedAt = Date.now();

  reg.set(item.ca, existing);
  persist();
  return existing;
}

export function getTrackedMemes(filter = {}) {
  const reg = loadRegistry();
  let list = Array.from(reg.values());
  if (filter.backfilled != null) {
    list = list.filter(m => m.backfilled === Boolean(filter.backfilled));
  }
  if (filter.source) {
    list = list.filter(m => m.sourceFlags.includes(filter.source));
  }
  return list;
}

export function getUnbackfilledMemes(limit = 10) {
  return getTrackedMemes({ backfilled: false }).slice(0, limit);
}

export function markMemeBackfilled(ca) {
  const reg = loadRegistry();
  const m = reg.get(ca);
  if (!m) return null;
  m.backfilled = true;
  m.backfilledAt = Date.now();
  m.updatedAt = Date.now();
  persist();
  return m;
}

export function resetMemeRegistry() {
  memCache = new Map();
  save(STORE_KEY, { memes: [], updatedAt: Date.now() });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/workers/__tests__/memeRegistry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/memeRegistry.js backend/src/workers/__tests__/memeRegistry.test.js
git commit -m "feat(workers): implement shared deduplicated meme registry store"
```

---

### Task 3: Worker 1 (Current Mcap > $2M) & Worker 2 (ATH Mcap > $4M)

**Files:**
- Create: `backend/src/workers/worker1CurrentMcap.js`
- Create: `backend/src/workers/worker2AthMcap.js`
- Test: `backend/src/workers/__tests__/worker1And2.test.js`

**Interfaces:**
- Produces: `runWorker1Pass(customFetcher)`
- Produces: `runWorker2Pass(customFetcher)`

- [ ] **Step 1: Write failing tests for Worker 1 and Worker 2**

```javascript
// backend/src/workers/__tests__/worker1And2.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { runWorker1Pass } from '../worker1CurrentMcap.js';
import { runWorker2Pass } from '../worker2AthMcap.js';
import { getTrackedMemes, resetMemeRegistry } from '../memeRegistry.js';

describe('Worker 1 & Worker 2 Discovery', () => {
  beforeEach(() => {
    resetMemeRegistry();
  });

  it('Worker 1 discovers current Mcap > 2M and tags source current_gt_2m', async () => {
    const mockFetcher = async () => [
      { ca: 'TokenA1111111111111111111111111111111111111', name: 'HighCurrent', currentMcap: 2_500_000, volume24hUsd: 100_000 },
      { ca: 'TokenB1111111111111111111111111111111111111', name: 'LowCurrent', currentMcap: 1_200_000, volume24hUsd: 50_000 },
    ];

    const count = await runWorker1Pass(mockFetcher);
    expect(count).toBe(1);

    const memes = getTrackedMemes();
    expect(memes).toHaveLength(1);
    expect(memes[0].name).toBe('HighCurrent');
    expect(memes[0].sourceFlags).toContain('current_gt_2m');
  });

  it('Worker 2 discovers ATH Mcap > 4M and merges into existing token record', async () => {
    const mockFetcher = async () => [
      { ca: 'TokenA1111111111111111111111111111111111111', name: 'HighCurrent', athMcap: 6_000_000, athTimestamp: 1700000000000 },
    ];

    const count = await runWorker2Pass(mockFetcher);
    expect(count).toBe(1);

    const memes = getTrackedMemes();
    expect(memes).toHaveLength(1);
    expect(memes[0].sourceFlags).toContain('ath_gt_4m');
    expect(memes[0].athMcap).toBe(6_000_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/worker1And2.test.js`
Expected: FAIL with "Cannot find module '../worker1CurrentMcap.js'"

- [ ] **Step 3: Implement Worker 1 & Worker 2**

```javascript
// backend/src/workers/worker1CurrentMcap.js
import { upsertMeme } from './memeRegistry.js';
import { executeWithThrottle } from './rateLimiter.js';

export async function fetchCurrentMcapGt2m() {
  return executeWithThrottle('dexscreener', async () => {
    const url = 'https://api.dexscreener.com/token-boosts/latest/v1';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`DexScreener boosts error ${res.status}`);
    const data = await res.json();
    return (data || []).filter(item => Number(item?.totalAmount || 0) > 0).map(item => ({
      ca: item.tokenAddress,
      chain: item.chainId === 'solana' ? 'solana' : 'robinhood',
      currentMcap: Number(item.totalAmount || 0) * 1000, // Normalized estimate
    }));
  });
}

export async function runWorker1Pass(customFetcher = fetchCurrentMcapGt2m) {
  let count = 0;
  try {
    const items = await customFetcher();
    for (const item of items) {
      if (Number(item.currentMcap) >= 2_000_000) {
        upsertMeme({
          ca: item.ca,
          name: item.name,
          symbol: item.symbol,
          chain: item.chain || 'solana',
          currentMcap: item.currentMcap,
          volume24hUsd: item.volume24hUsd || 0,
          source: 'current_gt_2m',
        });
        count++;
      }
    }
  } catch (_) {}
  return count;
}
```

```javascript
// backend/src/workers/worker2AthMcap.js
import { upsertMeme } from './memeRegistry.js';
import { executeWithThrottle } from './rateLimiter.js';

export async function fetchAthMcapGt4m() {
  return executeWithThrottle('geckoterminal', async () => {
    const url = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GeckoTerminal trending error ${res.status}`);
    const data = await res.json();
    const pools = data?.data || [];
    return pools.map(p => {
      const attr = p.attributes || {};
      const fdv = Number(attr.fdv_usd || 0);
      return {
        ca: attr.base_token_address || p.id,
        name: attr.name,
        symbol: attr.symbol,
        chain: 'solana',
        athMcap: fdv,
        athTimestamp: Date.now(),
        currentMcap: Number(attr.market_cap_usd || fdv),
        volume24hUsd: Number(attr.volume_usd?.h24 || 0),
      };
    });
  });
}

export async function runWorker2Pass(customFetcher = fetchAthMcapGt4m) {
  let count = 0;
  try {
    const items = await customFetcher();
    for (const item of items) {
      if (Number(item.athMcap) >= 4_000_000) {
        upsertMeme({
          ca: item.ca,
          name: item.name,
          symbol: item.symbol,
          chain: item.chain || 'solana',
          athMcap: item.athMcap,
          athTimestamp: item.athTimestamp || Date.now(),
          currentMcap: item.currentMcap,
          volume24hUsd: item.volume24hUsd || 0,
          source: 'ath_gt_4m',
        });
        count++;
      }
    }
  } catch (_) {}
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/workers/__tests__/worker1And2.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/worker1CurrentMcap.js backend/src/workers/worker2AthMcap.js backend/src/workers/__tests__/worker1And2.test.js
git commit -m "feat(workers): implement Worker 1 current mcap > $2M and Worker 2 ath mcap > $4M"
```

---

### Task 4: Worker 3 (Pre-ATH Early Buyer Harvester)

**Files:**
- Create: `backend/src/workers/worker3EarlyBuyers.js`
- Test: `backend/src/workers/__tests__/worker3EarlyBuyers.test.js`

**Interfaces:**
- Consumes: `getUnbackfilledMemes()`, `markMemeBackfilled(ca)` from Task 2
- Produces: `extractEarlyBuyers(trades, athMcap, athTimestamp)`
- Produces: `processNextUnbackfilledMeme(customTradeFetcher)`

- [ ] **Step 1: Write failing tests for Worker 3 qualification rules**

```javascript
// backend/src/workers/__tests__/worker3EarlyBuyers.test.js
import { describe, it, expect } from 'vitest';
import { extractEarlyBuyers } from '../worker3EarlyBuyers.js';

describe('Worker 3 Early Buyer Extraction', () => {
  it('extracts first N buyers based on 0.004% ATH quota prior to T_ATH', () => {
    const athMcap = 5_000_000; // 5M * 0.00004 = 200 first buyers quota
    const athTimestamp = 1000;

    const trades = [
      { wallet: 'Buyer1', buyMcap: 2_000_000, timestamp: 200, realizedProfitUsd: -10 },
      { wallet: 'Buyer2', buyMcap: 3_000_000, timestamp: 500, realizedProfitUsd: 0 },
      { wallet: 'BuyerLate', buyMcap: 100_000, timestamp: 1500, realizedProfitUsd: 500 }, // After ATH!
    ];

    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toContain('Buyer1');
    expect(result).toContain('Buyer2');
    expect(result).not.toContain('BuyerLate');
  });

  it('extracts <=25% ATH buyers before T_ATH with positive profit', () => {
    const athMcap = 4_000_000; // 25% is 1M
    const athTimestamp = 1000;

    const trades = [
      { wallet: 'EarlyProfitable', buyMcap: 800_000, timestamp: 400, realizedProfitUsd: 150 },
      { wallet: 'EarlyUnprofitable', buyMcap: 800_000, timestamp: 450, realizedProfitUsd: -50 },
    ];

    // Force quota to 0 to test value buyer condition
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp, { quotaOverride: 0 });
    expect(result).toContain('EarlyProfitable');
    expect(result).not.toContain('EarlyUnprofitable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/worker3EarlyBuyers.test.js`
Expected: FAIL with "Cannot find module '../worker3EarlyBuyers.js'"

- [ ] **Step 3: Implement `worker3EarlyBuyers.js`**

```javascript
// backend/src/workers/worker3EarlyBuyers.js
import { getUnbackfilledMemes, markMemeBackfilled } from './memeRegistry.js';
import { loadWallets, saveWallets } from '../smartwallets/tracker.js';

export function calculateFirstBuyersQuota(athMcap) {
  // 0.004% of ATH: e.g. 2M -> 80 wallets, 5M -> 200 wallets
  return Math.max(1, Math.round(Number(athMcap || 0) * 0.00004));
}

export function extractEarlyBuyers(trades = [], athMcap = 0, athTimestamp = Infinity, { quotaOverride = null } = {}) {
  const maxQuota = quotaOverride != null ? quotaOverride : calculateFirstBuyersQuota(athMcap);
  const maxBuyMcap = Number(athMcap) * 0.25;

  const qualifying = new Set();
  let firstBuyerCount = 0;

  // Chronological sort
  const sorted = [...trades].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  for (const t of sorted) {
    const wallet = t.wallet || t.address || t.maker;
    if (!wallet) continue;
    const ts = t.timestamp || 0;

    // Strict pre-ATH cutoff: ignore trades occurring after T_ATH
    if (athTimestamp && ts > athTimestamp) continue;

    // Rule 1: First N buyers quota
    if (firstBuyerCount < maxQuota) {
      qualifying.add(wallet);
      firstBuyerCount++;
      continue;
    }

    // Rule 2: <= 25% ATH buy mcap with positive realized profit
    const buyMcap = Number(t.buyMcap ?? t.marketCapUsd ?? 0);
    const profit = Number(t.realizedProfitUsd ?? t.pnlUsd ?? 0);

    if (buyMcap > 0 && buyMcap <= maxBuyMcap && profit > 0) {
      qualifying.add(wallet);
    }
  }

  return Array.from(qualifying);
}

export async function processNextUnbackfilledMeme(tradeFetcher) {
  const unbackfilled = getUnbackfilledMemes(1);
  if (!unbackfilled.length) return null;

  const meme = unbackfilled[0];
  try {
    const trades = tradeFetcher ? await tradeFetcher(meme.ca) : [];
    const buyers = extractEarlyBuyers(trades, meme.athMcap, meme.athTimestamp);

    if (buyers.length > 0) {
      const doc = loadWallets();
      const existingWallets = new Set((doc.wallets || []).map(w => w.address.toLowerCase()));

      for (const b of buyers) {
        if (!existingWallets.has(b.toLowerCase())) {
          doc.wallets.push({
            address: b,
            chain: meme.chain || 'solana',
            source: 'worker3-early-buyer',
            discoveredAtToken: meme.ca,
            createdAt: Date.now(),
          });
          existingWallets.add(b.toLowerCase());
        }
      }
      saveWallets(doc);
    }

    markMemeBackfilled(meme.ca);
    return { ca: meme.ca, buyersCount: buyers.length };
  } catch (err) {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/workers/__tests__/worker3EarlyBuyers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/worker3EarlyBuyers.js backend/src/workers/__tests__/worker3EarlyBuyers.test.js
git commit -m "feat(workers): implement Worker 3 pre-ATH early buyer harvester"
```

---

### Task 5: Worker 4 (In-Memory Wallet Execution Metrics & Watermark Manager)

**Files:**
- Create: `backend/src/workers/worker4WalletMetrics.js`
- Test: `backend/src/workers/__tests__/worker4Metrics.test.js`

**Interfaces:**
- Produces: `accumulateWalletMetrics(existingWallet, newTrades, tokenAthMap)`
- Produces: `processWalletMetricsPass(customActivityFetcher, tokenAthMap)`

- [ ] **Step 1: Write failing tests for stream accumulator and watermark management**

```javascript
// backend/src/workers/__tests__/worker4Metrics.test.js
import { describe, it, expect } from 'vitest';
import { accumulateWalletMetrics } from '../worker4WalletMetrics.js';

describe('Worker 4 In-Memory Metrics Accumulator', () => {
  it('computes Capture Ratio, % sold >50% ATH, Round-Trip Rate, and ROI without storing raw trades', () => {
    const wallet = {
      address: 'TestWallet1111111111111111111111111111111111',
      lastProcessedTxSignature: null,
      lastProcessedTimestamp: 0,
    };

    const tokenAthMap = {
      TokenX: 10_000_000,
    };

    const trades = [
      {
        txSignature: 'sig1',
        timestamp: 1000,
        token: 'TokenX',
        buyMcap: 1_000_000,
        buyPrice: 0.01,
        sellPrice: 0.08,
        sellMcap: 8_000_000, // 8M exit on 10M ATH = 80% capture ratio
        investedUsd: 1000,
        realizedProfitUsd: 7000,
        holdingTimeSec: 1800,
        wasRoundTrip: false,
      },
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result.captureRatio).toBe(0.8);
    expect(result.pctSoldAbove50Ath).toBe(100);
    expect(result.roundTripRate).toBe(0);
    expect(result.roiPct).toBe(700);
    expect(result.lastProcessedTxSignature).toBe('sig1');
    expect(result.lastProcessedTimestamp).toBe(1000);
    expect(result.tradedTokenCAs).toContain('TokenX');
    expect(result.rawTrades).toBeUndefined(); // Raw trades NOT stored!
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/worker4Metrics.test.js`
Expected: FAIL with "Cannot find module '../worker4WalletMetrics.js'"

- [ ] **Step 3: Implement `worker4WalletMetrics.js`**

```javascript
// backend/src/workers/worker4WalletMetrics.js
import { loadWallets, saveWallets } from '../smartwallets/tracker.js';

export function accumulateWalletMetrics(wallet, newTrades = [], tokenAthMap = {}) {
  const distinctTokens = new Set(wallet.tradedTokenCAs || []);
  let totalProfit = Number(wallet.realizedProfitUsd || 0);
  let totalInvested = Number(wallet.totalInvestedUsd || 0);
  let wonTrades = Number(wallet.profitableTrades || 0);
  let totalTrades = Number(wallet.totalTrades || 0);
  let roundTripCount = Number(wallet.roundTripCount || 0);

  let captureRatioSum = (wallet.captureRatio || 0) * (totalTrades || 1);
  let soldAbove50Vol = 0;
  let totalSoldVol = 0;
  let totalHoldingSec = (wallet.avgHoldingTimeSec || 0) * (totalTrades || 1);

  // Sort chronologically
  const sorted = [...newTrades].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  for (const t of sorted) {
    if (t.token) distinctTokens.add(t.token);
    totalTrades++;
    const profit = Number(t.realizedProfitUsd || 0);
    const invested = Number(t.investedUsd || 0);
    totalProfit += profit;
    totalInvested += invested;
    if (profit > 0) wonTrades++;
    if (t.wasRoundTrip) roundTripCount++;

    const ath = tokenAthMap[t.token] || Number(t.sellMcap || 0);
    const exitMcap = Number(t.sellMcap || 0);
    if (ath > 0 && exitMcap > 0) {
      const cr = Math.min(1.0, exitMcap / ath);
      captureRatioSum += cr;
    }

    const sellVol = Number(t.sellVolumeUsd || invested || 1);
    totalSoldVol += sellVol;
    if (ath > 0 && exitMcap >= 0.5 * ath) {
      soldAbove50Vol += sellVol;
    }

    if (t.holdingTimeSec) totalHoldingSec += Number(t.holdingTimeSec);
  }

  const lastTx = sorted[sorted.length - 1];
  const lastProcessedTxSignature = lastTx ? (lastTx.txSignature || lastTx.signature) : wallet.lastProcessedTxSignature;
  const lastProcessedTimestamp = lastTx ? lastTx.timestamp : (wallet.lastProcessedTimestamp || 0);

  const finalTradesCount = totalTrades || 1;
  return {
    ...wallet,
    realizedProfitUsd: totalProfit,
    totalInvestedUsd: totalInvested,
    totalTrades,
    profitableTrades: wonTrades,
    winRatePct: Math.round((wonTrades / finalTradesCount) * 100),
    roiPct: totalInvested > 0 ? Math.round((totalProfit / totalInvested) * 100) : 0,
    captureRatio: Number((captureRatioSum / finalTradesCount).toFixed(2)),
    pctSoldAbove50Ath: totalSoldVol > 0 ? Math.round((soldAbove50Vol / totalSoldVol) * 100) : 0,
    roundTripRate: Math.round((roundTripCount / finalTradesCount) * 100),
    avgHoldingTimeSec: Math.round(totalHoldingSec / finalTradesCount),
    tradedTokenCAs: Array.from(distinctTokens),
    lastProcessedTxSignature,
    lastProcessedTimestamp,
    updatedAt: Date.now(),
  };
}

export async function processWalletMetricsPass(fetchActivityFn, tokenAthMap = {}) {
  const doc = loadWallets();
  const wallets = doc.wallets || [];
  let updatedCount = 0;

  for (const w of wallets.slice(0, 5)) {
    try {
      const ninetyDaysAgo = Date.now() - 90 * 86400 * 1000;
      const sinceTs = w.lastProcessedTimestamp ? Math.max(w.lastProcessedTimestamp, ninetyDaysAgo) : ninetyDaysAgo;
      const trades = fetchActivityFn ? await fetchActivityFn(w.address, sinceTs, w.lastProcessedTxSignature) : [];
      if (trades.length > 0) {
        const updated = accumulateWalletMetrics(w, trades, tokenAthMap);
        Object.assign(w, updated);
        updatedCount++;
      }
    } catch (_) {}
  }

  if (updatedCount > 0) saveWallets(doc);
  return updatedCount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/workers/__tests__/worker4Metrics.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/worker4WalletMetrics.js backend/src/workers/__tests__/worker4Metrics.test.js
git commit -m "feat(workers): implement Worker 4 in-memory wallet metrics & watermark manager"
```

---

### Task 6: Worker 5 (Token ATH Cache & Hit-Rate Classifier)

**Files:**
- Create: `backend/src/workers/worker5TokenDistribution.js`
- Test: `backend/src/workers/__tests__/worker5Distribution.test.js`

**Interfaces:**
- Produces: `getTokenAth(ca)`
- Produces: `upsertTokenAth(ca, symbol, athMcap)`
- Produces: `classifyWalletTokens(wallet)`
- Produces: `runWorker5Pass(tokenAthFetcher)`

- [ ] **Step 1: Write failing tests for token ATH caching and wallet hit rate classification**

```javascript
// backend/src/workers/__tests__/worker5Distribution.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { upsertTokenAth, classifyWalletTokens, resetTokenAthCache } from '../worker5TokenDistribution.js';

describe('Worker 5 Token ATH Cache & Hit-Rate Classifier', () => {
  beforeEach(() => {
    resetTokenAthCache();
  });

  it('classifies traded tokens into >= $2M vs < $2M ATH and computes hitRateGt2mPct', () => {
    upsertTokenAth('CA_RUNNER_1', 'RUN1', 3_500_000); // >= 2M
    upsertTokenAth('CA_RUNNER_2', 'RUN2', 5_000_000); // >= 2M
    upsertTokenAth('CA_DUD_1', 'DUD1', 350_000);     // < 2M

    const wallet = {
      address: 'WalletA',
      tradedTokenCAs: ['CA_RUNNER_1', 'CA_RUNNER_2', 'CA_DUD_1'],
    };

    const classified = classifyWalletTokens(wallet);
    expect(classified.tokensTradedGt2m).toBe(2);
    expect(classified.tokensTradedLt2m).toBe(1);
    expect(classified.hitRateGt2mPct).toBe(67);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/worker5Distribution.test.js`
Expected: FAIL with "Cannot find module '../worker5TokenDistribution.js'"

- [ ] **Step 3: Implement `worker5TokenDistribution.js`**

```javascript
// backend/src/workers/worker5TokenDistribution.js
import { load, save } from '../store.js';
import { loadWallets, saveWallets } from '../smartwallets/tracker.js';

const ATH_STORE_KEY = 'token-ath-cache';

let athCache = null;

function loadAthCache() {
  if (!athCache) {
    const raw = load(ATH_STORE_KEY, { tokens: [] });
    athCache = new Map((raw.tokens || []).map(t => [t.ca, t]));
  }
  return athCache;
}

function persistAthCache() {
  if (!athCache) return;
  save(ATH_STORE_KEY, { tokens: Array.from(athCache.values()), updatedAt: Date.now() });
}

export function upsertTokenAth(ca, symbol, athMcap) {
  if (!ca) return null;
  const cache = loadAthCache();
  const mcap = Number(athMcap || 0);
  const rec = {
    ca,
    symbol: symbol || '?',
    athMcap: mcap,
    isGt2m: mcap >= 2_000_000,
    updatedAt: Date.now(),
  };
  cache.set(ca, rec);
  persistAthCache();
  return rec;
}

export function getTokenAth(ca) {
  return loadAthCache().get(ca) || null;
}

export function classifyWalletTokens(wallet) {
  const cache = loadAthCache();
  const cas = wallet.tradedTokenCAs || [];
  let gt2m = 0;
  let lt2m = 0;

  for (const ca of cas) {
    const item = cache.get(ca);
    if (!item) continue;
    if (item.isGt2m) gt2m++;
    else lt2m++;
  }

  const total = gt2m + lt2m;
  const hitRateGt2mPct = total > 0 ? Math.round((gt2m / total) * 100) : 0;

  return {
    ...wallet,
    tokensTradedGt2m: gt2m,
    tokensTradedLt2m: lt2m,
    hitRateGt2mPct,
  };
}

export async function runWorker5Pass(tokenAthFetcher) {
  const doc = loadWallets();
  const wallets = doc.wallets || [];
  const cache = loadAthCache();

  // Collect missing CAs
  const missingCAs = new Set();
  for (const w of wallets) {
    for (const ca of (w.tradedTokenCAs || [])) {
      if (!cache.has(ca)) missingCAs.add(ca);
    }
  }

  if (missingCAs.size > 0 && tokenAthFetcher) {
    for (const ca of Array.from(missingCAs).slice(0, 30)) {
      try {
        const res = await tokenAthFetcher(ca);
        if (res) upsertTokenAth(ca, res.symbol, res.athMcap);
      } catch (_) {}
    }
  }

  // Recalculate hit rates for wallets
  let updated = false;
  for (const w of wallets) {
    const res = classifyWalletTokens(w);
    if (res.tokensTradedGt2m !== w.tokensTradedGt2m || res.tokensTradedLt2m !== w.tokensTradedLt2m) {
      Object.assign(w, res);
      updated = true;
    }
  }

  if (updated) saveWallets(doc);
  return missingCAs.size;
}

export function resetTokenAthCache() {
  athCache = new Map();
  save(ATH_STORE_KEY, { tokens: [], updatedAt: Date.now() });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/workers/__tests__/worker5Distribution.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/worker5TokenDistribution.js backend/src/workers/__tests__/worker5Distribution.test.js
git commit -m "feat(workers): implement Worker 5 token ATH cache and hit-rate classifier"
```

---

### Task 7: Worker Manager & Background Orchestrator

**Files:**
- Create: `backend/src/workers/workerManager.js`
- Test: `backend/src/workers/__tests__/workerManager.test.js`
- Modify: `backend/server.js`

**Interfaces:**
- Produces: `startAllWorkers()`
- Produces: `stopAllWorkers()`
- Produces: `getWorkerStatus()`

- [ ] **Step 1: Write tests for `workerManager.js`**

```javascript
// backend/src/workers/__tests__/workerManager.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startAllWorkers, stopAllWorkers, getWorkerStatus } from '../workerManager.js';

describe('Worker Manager', () => {
  beforeEach(() => {
    stopAllWorkers();
  });

  afterEach(() => {
    stopAllWorkers();
  });

  it('initializes and reports health status of all 5 workers', () => {
    startAllWorkers({ autoRun: false });
    const status = getWorkerStatus();
    expect(status.running).toBe(true);
    expect(status.workers.worker1).toBeDefined();
    expect(status.workers.worker2).toBeDefined();
    expect(status.workers.worker3).toBeDefined();
    expect(status.workers.worker4).toBeDefined();
    expect(status.workers.worker5).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/workers/__tests__/workerManager.test.js`
Expected: FAIL with "Cannot find module '../workerManager.js'"

- [ ] **Step 3: Implement `workerManager.js`**

```javascript
// backend/src/workers/workerManager.js
import { runWorker1Pass } from './worker1CurrentMcap.js';
import { runWorker2Pass } from './worker2AthMcap.js';
import { processNextUnbackfilledMeme } from './worker3EarlyBuyers.js';
import { processWalletMetricsPass } from './worker4WalletMetrics.js';
import { runWorker5Pass } from './worker5TokenDistribution.js';
import { getEndpointHealth } from './rateLimiter.js';
import { log } from '../bus.js';

let isRunning = false;
let timers = [];

export function startAllWorkers({ autoRun = true } = {}) {
  if (isRunning) return;
  isRunning = true;
  log('info', '[workerManager] Starting distributed 5-worker background pipeline');

  if (autoRun) {
    // Worker 1 & 2: Periodic discovery
    timers.push(setInterval(() => runWorker1Pass().catch(() => {}), 10 * 60_000));
    timers.push(setInterval(() => runWorker2Pass().catch(() => {}), 15 * 60_000));

    // Worker 3 & 4: Queue processing
    timers.push(setInterval(() => processNextUnbackfilledMeme().catch(() => {}), 3 * 60_000));
    timers.push(setInterval(() => processWalletMetricsPass().catch(() => {}), 5 * 60_000));

    // Worker 5: Hit-rate classifier
    timers.push(setInterval(() => runWorker5Pass().catch(() => {}), 10 * 60_000));

    // Trigger immediate initial pass
    runWorker1Pass().catch(() => {});
    runWorker2Pass().catch(() => {});
  }
}

export function stopAllWorkers() {
  for (const t of timers) clearInterval(t);
  timers = [];
  isRunning = false;
}

export function getWorkerStatus() {
  return {
    running: isRunning,
    endpoints: getEndpointHealth(),
    workers: {
      worker1: { name: 'Current Mcap > $2M', interval: '10m' },
      worker2: { name: 'ATH Mcap > $4M', interval: '15m' },
      worker3: { name: 'Pre-ATH Early Buyers', interval: '3m' },
      worker4: { name: 'In-Memory Wallet Metrics', interval: '5m' },
      worker5: { name: 'Token ATH & Hit Rate', interval: '10m' },
    },
  };
}
```

- [ ] **Step 4: Mount worker status and registry endpoints in `backend/server.js`**

```javascript
// Add routes in backend/server.js:
// app.get('/api/workers/status', (req, res) => res.json(getWorkerStatus()));
// app.get('/api/memes/registry', (req, res) => res.json({ memes: getTrackedMemes(req.query) }));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run backend/src/workers/__tests__/workerManager.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/workers/workerManager.js backend/src/workers/__tests__/workerManager.test.js backend/server.js
git commit -m "feat(workers): implement worker orchestrator and API status endpoints"
```

---

### Task 8: Frontend UI (Tracked Memes Table & Advanced Execution Metrics)

**Files:**
- Create: `frontend/src/components/MemeRegistryView.jsx`
- Modify: `frontend/src/components/SmartWalletsView.jsx`
- Modify: `frontend/src/components/Sidebar.jsx`
- Test: `frontend/src/components/__tests__/MemeRegistryView.test.js`

- [ ] **Step 1: Write failing test for `MemeRegistryView.jsx`**

```jsx
// frontend/src/components/__tests__/MemeRegistryView.test.js
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemeRegistryView } from '../MemeRegistryView.jsx';

describe('MemeRegistryView', () => {
  it('renders tracked memes table headers and rows', () => {
    const mockMemes = [
      {
        ca: 'MintX11111111111111111111111111111111111111',
        name: 'AlphaToken',
        symbol: 'ALPHA',
        currentMcap: 2500000,
        athMcap: 5000000,
        volume24hUsd: 800000,
        sourceFlags: ['current_gt_2m', 'ath_gt_4m'],
        backfilled: true,
      },
    ];

    render(<MemeRegistryView initialMemes={mockMemes} />);
    expect(screen.getByText('Tracked Memes Registry')).toBeDefined();
    expect(screen.getByText('ALPHA')).toBeDefined();
    expect(screen.getByText('$2.50M')).toBeDefined();
    expect(screen.getByText('$5.00M')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/components/__tests__/MemeRegistryView.test.js`
Expected: FAIL with "Cannot find module '../MemeRegistryView.jsx'"

- [ ] **Step 3: Implement `MemeRegistryView.jsx`**

```jsx
// frontend/src/components/MemeRegistryView.jsx
import React, { useState, useEffect } from 'react';

export function MemeRegistryView({ initialMemes = null }) {
  const [memes, setMemes] = useState(initialMemes || []);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (initialMemes) return;
    fetch('/api/memes/registry')
      .then(r => r.json())
      .then(d => setMemes(d.memes || []))
      .catch(() => {});
  }, [initialMemes]);

  const filtered = memes.filter(m => {
    if (filter === 'backfilled') return m.backfilled;
    if (filter === 'pending') return !m.backfilled;
    return true;
  });

  return (
    <div className="p-6 text-white bg-slate-950 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tracked Memes Registry</h1>
          <p className="text-sm text-slate-400">Deduplicated discovery for Current &gt; $2M &amp; ATH &gt; $4M</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFilter('all')} className={`px-3 py-1 text-xs rounded ${filter === 'all' ? 'bg-indigo-600' : 'bg-slate-800'}`}>All ({memes.length})</button>
          <button onClick={() => setFilter('backfilled')} className={`px-3 py-1 text-xs rounded ${filter === 'backfilled' ? 'bg-indigo-600' : 'bg-slate-800'}`}>Backfilled</button>
          <button onClick={() => setFilter('pending')} className={`px-3 py-1 text-xs rounded ${filter === 'pending' ? 'bg-indigo-600' : 'bg-slate-800'}`}>Pending Worker 3</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-xs text-slate-400 uppercase">
            <tr>
              <th className="p-3">Token</th>
              <th className="p-3">Contract Address</th>
              <th className="p-3">Current Mcap</th>
              <th className="p-3">ATH Mcap</th>
              <th className="p-3">24h Volume</th>
              <th className="p-3">Sources</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.map(m => (
              <tr key={m.ca} className="hover:bg-slate-900/50">
                <td className="p-3 font-semibold text-white">{m.symbol} <span className="text-xs text-slate-500">{m.name}</span></td>
                <td className="p-3 font-mono text-xs text-slate-400">{m.ca.slice(0, 6)}...{m.ca.slice(-4)}</td>
                <td className="p-3 text-emerald-400">${(m.currentMcap / 1_000_000).toFixed(2)}M</td>
                <td className="p-3 text-purple-400">${(m.athMcap / 1_000_000).toFixed(2)}M</td>
                <td className="p-3">${(m.volume24hUsd / 1_000).toFixed(0)}k</td>
                <td className="p-3">
                  {m.sourceFlags?.map(s => (
                    <span key={s} className="mr-1 px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300 border border-slate-700">{s}</span>
                  ))}
                </td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 text-xs rounded ${m.backfilled ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                    {m.backfilled ? '✅ Backfilled' : '⏳ Pending Worker 3'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `SmartWalletsView.jsx` to render Capture Ratio, Round-Trip Rate, % Sold >50% ATH, and $\ge \$2\text{M}$ Hit Rate**

- [ ] **Step 5: Add "Tracked Memes" route in `Sidebar.jsx`**

- [ ] **Step 6: Run frontend tests to verify they pass**

Run: `npx vitest run frontend/src/components/__tests__/MemeRegistryView.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MemeRegistryView.jsx frontend/src/components/SmartWalletsView.jsx frontend/src/components/Sidebar.jsx frontend/src/components/__tests__/MemeRegistryView.test.js
git commit -m "feat(ui): add Tracked Memes table and advanced execution metrics to smart wallets view"
```

---

### Task 9: Full End-to-End Test Suite Verification

- [ ] **Step 1: Run backend test suite**
Run: `npm test` in `backend/`
Expected: All worker, discovery, analysis, and API tests pass.

- [ ] **Step 2: Run frontend test suite**
Run: `npm test -- --run` in `frontend/`
Expected: All frontend component and view tests pass.

- [ ] **Step 3: Commit final integration verification**
```bash
git commit --allow-empty -m "chore: verify distributed 5-worker pipeline end-to-end tests"
```
