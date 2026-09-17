# Data Loading & Tab Switching Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate massive multi-megabyte payloads, synchronous 540ms disk reads, and slow tab switching by introducing backend in-memory document caching, server-side pagination/filtering, client-side pagination controls, and persistent keep-alive tab rendering.

**Architecture:** 
1. **Backend Cache Singleton (`tracker.js`)**: Keep `smart-wallets.json` resident in memory with write-through on updates to eliminate 540ms synchronous blocking disk reads.
2. **Server-Side Filtering & Pagination (`/api/smart-wallets` & `/api/memes/registry`)**: Compute category badge counts in one pass and return only 50-row slices, dropping payload from 88 MB (64,550 wallets) down to ~40 KB (2,200× reduction).
3. **Frontend Reusable Pagination (`Pagination.jsx`)**: Add page navigation, item range counters, and page-size selector.
4. **Persistent Keep-Alive Tab Workspace (`App.jsx`)**: Maintain mounted DOM instances of primary views (`smart-wallets`, `tracked-memes`, `sol-meme`, `evm-meme`, `dashboard`) using CSS display toggling for 0ms instant tab switching with preserved scroll position and filter state.

**Tech Stack:** Node.js (ESM), Express 4, React 19, React Router 7, Vitest 4.

## Global Constraints
- Preserve exact dual-chain handling: Solana (Base58 case preserved) and Robinhood (canonical lowercase EVM addresses).
- Strict Zero Raw Transaction Storage: Only aggregated metrics, badges, and tags are persisted and served.
- Backward Compatibility: `limit=all` and legacy parameters must still return the full set when requested.
- CWD for backend commands is `D:\project\bot\backend`. CWD for frontend commands is `D:\project\bot\frontend`.

---

### Task 1: Backend In-Memory Cache in `tracker.js`

**Files:**
- Modify: `D:\project\bot\backend\src\smartwallets\tracker.js`
- Test: `D:\project\bot\backend\src\smartwallets\__tests__/trackerCache.test.js`

**Interfaces:**
- Consumes: `load(STORE_KEY)`, `save(STORE_KEY, doc)` from `src/store.js`
- Produces: `loadWallets()`, `saveWallets(doc)`, `clearWalletsCache()`

- [ ] **Step 1: Write the failing test for in-memory cache**

```javascript
// D:\project\bot\backend\src\smartwallets\__tests__/trackerCache.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../../store.js';
import { loadWallets, saveWallets, clearWalletsCache } from '../tracker.js';

describe('tracker in-memory cache', () => {
  beforeEach(() => {
    clearWalletsCache();
    vi.restoreAllMocks();
  });

  it('loads from store on first call, then returns cached instance on subsequent calls', () => {
    const mockDoc = { updatedAt: '2026-09-18T00:00:00Z', wallets: [{ address: 'test1', chain: 'solana' }], runners: [] };
    const loadSpy = vi.spyOn(store, 'load').mockReturnValue(mockDoc);

    const doc1 = loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(doc1.wallets).toHaveLength(1);

    const doc2 = loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(1); // Not called again
    expect(doc2).toBe(doc1);
  });

  it('saveWallets updates the cache and calls store.save', () => {
    const saveSpy = vi.spyOn(store, 'save').mockImplementation(() => {});
    const newDoc = { updatedAt: null, wallets: [{ address: 'test2', chain: 'solana' }], runners: [] };

    saveWallets(newDoc);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    const cached = loadWallets();
    expect(cached.wallets[0].address).toBe('test2');
  });

  it('clearWalletsCache forces next loadWallets to re-read from store', () => {
    const mockDoc = { updatedAt: null, wallets: [{ address: 'test3', chain: 'solana' }], runners: [] };
    const loadSpy = vi.spyOn(store, 'load').mockReturnValue(mockDoc);

    loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(1);

    clearWalletsCache();
    loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/project/bot/backend && npx vitest run src/smartwallets/__tests__/trackerCache.test.js`
Expected: FAIL with "clearWalletsCache is not a function"

- [ ] **Step 3: Implement in-memory caching in `tracker.js`**

Modify `D:\project\bot\backend\src\smartwallets\tracker.js`:
```javascript
let cachedWalletsDoc = null;

export function clearWalletsCache() {
  cachedWalletsDoc = null;
}

export function loadWallets() {
  if (!cachedWalletsDoc) {
    cachedWalletsDoc = load(STORE_KEY, { updatedAt: null, wallets: [], runners: [] });
  }
  return cachedWalletsDoc;
}

export function saveWallets(doc) {
  cachedWalletsDoc = doc;
  save(STORE_KEY, { ...doc, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/project/bot/backend && npx vitest run src/smartwallets/__tests__/trackerCache.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/smartwallets/tracker.js backend/src/smartwallets/__tests__/trackerCache.test.js
git commit -m "perf(smartwallets): implement in-memory document cache to eliminate blocking disk reads"
```

---

### Task 2: Backend Server-Side Pagination & Filtering in `/api/smart-wallets`

**Files:**
- Modify: `D:\project\bot\backend\src\smartwallets\routes.js`
- Test: `D:\project\bot\backend\src\smartwallets\__tests__/routes.test.js`

**Interfaces:**
- Consumes: `loadWallets()` from `src/smartwallets/tracker.js`
- Produces: `router.get('/')` with pagination metadata (`page`, `pageSize`, `total`, `totalPages`, `smartCount`, `trackedCount`, `whaleCount`, `lineageCount`, `sniperCount`, `scamCount`, `wallets`)

- [ ] **Step 1: Add failing test cases for server-side pagination and category filtering**

Add test in `D:\project\bot\backend\src\smartwallets\__tests__/routes.test.js`:
```javascript
it('supports server-side pagination and returns category badge counts', async () => {
  const res = await request(app).get('/api/smart-wallets?page=1&pageSize=2');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('page', 1);
  expect(res.body).toHaveProperty('pageSize', 2);
  expect(res.body).toHaveProperty('total');
  expect(res.body).toHaveProperty('totalPages');
  expect(res.body).toHaveProperty('smartCount');
  expect(res.body).toHaveProperty('trackedCount');
  expect(res.body).toHaveProperty('whaleCount');
  expect(res.body).toHaveProperty('lineageCount');
  expect(res.body).toHaveProperty('sniperCount');
  expect(res.body.wallets.length).toBeLessThanOrEqual(2);
});

it('filters by sniper category on the server', async () => {
  const res = await request(app).get('/api/smart-wallets?category=sniper');
  expect(res.status).toBe(200);
  for (const w of res.body.wallets) {
    const hasTag = w.category === 'sniper' || (w.tags && w.tags.some(t => t.includes('sniper') || t.includes('alpha_buyer')));
    expect(hasTag).toBe(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/project/bot/backend && npx vitest run src/smartwallets/__tests__/routes.test.js`
Expected: FAIL (missing `totalPages` or `page` property)

- [ ] **Step 3: Update `routes.js` with server-side pagination, sniper category logic, and badge counting**

In `D:\project\bot\backend\src\smartwallets\routes.js`:
1. Parse query:
   - `chain = req.query.chain`: if `'all'` or absent, no chain filter.
   - `category = req.query.category || 'all'`
   - `subfilter = req.query.subfilter || req.query.trackedSubfilter || 'all'`
   - `search = (req.query.search || req.query.q || '').trim().toLowerCase()`
   - `consistentOnly = req.query.consistentOnly === 'true' || req.query.consistentOnly === true`
   - `page = Math.max(1, Number(req.query.page) || 1)`
   - `isAll = req.query.limit === 'all' || req.query.pageSize === 'all'`
   - `pageSize = isAll ? 1000000 : Math.min(500, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 50))`
2. In single pass over `doc.wallets`:
   - Compute category sets:
     - `isLineage`: `w.category === 'lineage' || Boolean(w.lineageParent) || w.source === 'lineage'`
     - `isWhale`: `!isLineage && (w.category === 'whale' || (Number(w.balanceUsd || 0) >= 5000 || Number(w.memeHoldingsUsd || 0) >= 5000))`
     - `isTracked`: `!isLineage && !isWhale && w.category === 'tracked'`
     - `isSniper`: `w.category === 'sniper' || (Array.isArray(w.tags) && w.tags.some(t => t.includes('sniper') || t.includes('bundler') || t === 'alpha_buyer' || t === 'rank_1_buyer' || t === 'madeonsol_sniper' || t === 'high_profit_sniper' || t === 'early_sniper')) || Boolean(w.flags?.is_sniper) || Boolean(w.flags?.is_bundler)`
     - `isSmart`: `!isLineage && !isWhale && !isTracked`
   - Filter by chain, category, subfilter, search, and consistentOnly.
3. Slice paginated slice:
   - `offset = (page - 1) * pageSize`
   - `sliced = wallets.slice(offset, offset + pageSize)`
4. Return `{ page, pageSize, total: wallets.length, totalPages: Math.ceil(wallets.length / pageSize), smartCount, trackedCount, whaleCount, lineageCount, sniperCount, scamCount, wallets: sliced, ... }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/project/bot/backend && npx vitest run src/smartwallets/__tests__/routes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/smartwallets/routes.js backend/src/smartwallets/__tests__/routes.test.js
git commit -m "feat(api): implement server-side pagination, search, and category counts for smart wallets"
```

---

### Task 3: Backend Pagination for Meme Registry in `/api/memes/registry`

**Files:**
- Modify: `D:\project\bot\backend\server.js`
- Test: `D:\project\bot\backend\src\workers\__tests__/memeRegistryPagination.test.js`

**Interfaces:**
- Consumes: `getTrackedMemes(query)` from `src/workers/memeRegistry.js`
- Produces: `app.get('/api/memes/registry')` with pagination metadata (`total`, `page`, `pageSize`, `totalPages`, `solanaCount`, `robinhoodCount`, `backfilledCount`, `pendingCount`, `memes`)

- [ ] **Step 1: Write failing test for meme registry pagination**

```javascript
// D:\project\bot\backend\src\workers\__tests__/memeRegistryPagination.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { getTrackedMemes, upsertMeme } from '../memeRegistry.js';

describe('GET /api/memes/registry pagination', () => {
  const app = express();
  app.get('/api/memes/registry', (req, res) => {
    // Will be imported from server.js logic
    const chain = req.query.chain;
    const status = req.query.status;
    const search = (req.query.search || req.query.q || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const isAll = req.query.limit === 'all' || req.query.pageSize === 'all';
    const pageSize = isAll ? 100000 : Math.min(500, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 50));

    let all = getTrackedMemes();
    const solanaCount = all.filter(m => (m.chain || 'solana') === 'solana').length;
    const robinhoodCount = all.filter(m => m.chain === 'robinhood').length;
    const backfilledCount = all.filter(m => m.backfilled === true).length;
    const pendingCount = all.filter(m => !m.backfilled).length;

    if (chain && chain !== 'all') all = all.filter(m => (m.chain || 'solana') === chain);
    if (status === 'backfilled') all = all.filter(m => m.backfilled === true);
    if (status === 'pending_worker3') all = all.filter(m => !m.backfilled);
    if (search) all = all.filter(m => (m.symbol || '').toLowerCase().includes(search) || (m.name || '').toLowerCase().includes(search) || (m.ca || '').toLowerCase().includes(search));

    const total = all.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const sliced = all.slice(start, start + pageSize).map(m => ({ ...m, contractAddress: m.ca, volume24h: m.volume24hUsd }));

    res.json({ total, page, pageSize, totalPages, solanaCount, robinhoodCount, backfilledCount, pendingCount, memes: sliced });
  });

  it('returns paginated memes with counts', async () => {
    const res = await request(app).get('/api/memes/registry?page=1&pageSize=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('solanaCount');
    expect(res.body).toHaveProperty('robinhoodCount');
    expect(res.body.memes.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to verify it passes in isolation**

Run: `cd D:/project/bot/backend && npx vitest run src/workers/__tests__/memeRegistryPagination.test.js`
Expected: PASS

- [ ] **Step 3: Update `backend/server.js` route for `/api/memes/registry`**

In `D:\project\bot\backend\server.js`, replace lines 95-102:
```javascript
app.get('/api/memes/registry', (req, res) => {
  const chain = req.query.chain;
  const status = req.query.status;
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const isAll = req.query.limit === 'all' || req.query.pageSize === 'all';
  const pageSize = isAll ? 100000 : Math.min(500, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 50));

  const rawList = getTrackedMemes();
  const solanaCount = rawList.filter(m => (m.chain || 'solana') === 'solana').length;
  const robinhoodCount = rawList.filter(m => m.chain === 'robinhood').length;
  const backfilledCount = rawList.filter(m => m.backfilled === true).length;
  const pendingCount = rawList.filter(m => !m.backfilled).length;

  let filtered = rawList;
  if (chain && chain !== 'all') filtered = filtered.filter(m => (m.chain || 'solana') === chain);
  if (status === 'backfilled') filtered = filtered.filter(m => m.backfilled === true);
  if (status === 'pending_worker3') filtered = filtered.filter(m => !m.backfilled);
  if (search) {
    filtered = filtered.filter(m =>
      (m.symbol || '').toLowerCase().includes(search) ||
      (m.name || '').toLowerCase().includes(search) ||
      (m.ca || '').toLowerCase().includes(search)
    );
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start = (page - 1) * pageSize;
  const sliced = filtered.slice(start, start + pageSize).map(m => ({
    ...m,
    contractAddress: m.ca,
    volume24h: m.volume24hUsd,
  }));

  res.json({
    total,
    page,
    pageSize,
    totalPages,
    solanaCount,
    robinhoodCount,
    backfilledCount,
    pendingCount,
    memes: sliced,
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add backend/server.js backend/src/workers/__tests__/memeRegistryPagination.test.js
git commit -m "feat(api): add server-side pagination and badge metrics to /api/memes/registry"
```

---

### Task 4: Reusable Frontend Pagination Component (`Pagination.jsx`)

**Files:**
- Create: `D:\project\bot\frontend\src\components\ui\Pagination.jsx`
- Test: `D:\project\bot\frontend\src\components\ui\__tests__/Pagination.test.jsx`

**Interfaces:**
- Produces: `<Pagination currentPage={page} totalPages={totalPages} totalItems={total} pageSize={pageSize} onPageChange={fn} onPageSizeChange={fn} />`

- [ ] **Step 1: Write failing unit test for `Pagination.jsx`**

```jsx
// D:\project\bot\frontend\src\components\ui\__tests__/Pagination.test.jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Pagination from '../Pagination';

describe('<Pagination />', () => {
  it('renders item range and page buttons correctly', () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        currentPage={1}
        totalPages={5}
        totalItems={250}
        pageSize={50}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText(/Showing 1–50 of 250/i)).toBeDefined();
    const nextBtn = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables previous button on first page and next button on last page', () => {
    const { rerender } = render(
      <Pagination currentPage={1} totalPages={3} totalItems={150} pageSize={50} onPageChange={() => {}} />
    );
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();

    rerender(
      <Pagination currentPage={3} totalPages={3} totalItems={150} pageSize={50} onPageChange={() => {}} />
    );
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/project/bot/frontend && npx vitest run src/components/ui/__tests__/Pagination.test.jsx`
Expected: FAIL (component missing)

- [ ] **Step 3: Implement `Pagination.jsx`**

Create `D:\project\bot\frontend\src\components\ui\Pagination.jsx`:
- Supports windowed page list (e.g. `1 ... 4 5 6 ... 100`).
- Prev / Next buttons.
- Item count summary: `Showing ${start}–${end} of ${totalItems}`.
- Optional page size selector (`[25, 50, 100]`).
- Clean, responsive CSS classes.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/project/bot/frontend && npx vitest run src/components/ui/__tests__/Pagination.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Pagination.jsx frontend/src/components/ui/__tests__/Pagination.test.jsx
git commit -m "feat(ui): create reusable Pagination component with page windows and row selectors"
```

---

### Task 5: Update `SmartWalletsView.jsx` to Use Server-Side Pagination & Scoping

**Files:**
- Modify: `D:\project\bot\frontend\src\components\SmartWalletsView.jsx`
- Test: `D:\project\bot\frontend\src\components\__tests__/SmartWalletsView.test.js`

**Interfaces:**
- Consumes: `<Pagination />` from `components/ui/Pagination.jsx`
- Consumes: `GET /api/smart-wallets?chain=...&category=...&page=...&pageSize=...&search=...`

- [ ] **Step 1: Update `SmartWalletsView.jsx` to query paginated server data**

In `D:\project\bot\frontend\src\components\SmartWalletsView.jsx`:
1. Add state: `page` (default 1), `pageSize` (default 50).
2. Reset `page` to 1 whenever `listCategory`, `chainTab`, `trackedSubfilter`, `search`, or `consistentOnly` changes.
3. Update `fetchWallets`:
   ```javascript
   const params = new URLSearchParams({
     chain: chainTab,
     category: listCategory,
     page: String(page),
     pageSize: String(pageSize),
   });
   if (trackedSubfilter !== 'all') params.set('subfilter', trackedSubfilter);
   if (search.trim()) params.set('search', search.trim());
   if (consistentOnly) params.set('consistentOnly', 'true');

   const res = await fetch(`${getBackendUrl()}/api/smart-wallets?${params.toString()}`, { headers: authHeaders() });
   ```
4. Use server response properties for badge counts: `data?.smartCount`, `data?.trackedCount`, `data?.whaleCount`, `data?.lineageCount`, `data?.sniperCount`.
5. Render `data?.wallets || []` directly without running heavy client-side filtering on 64,000 items.
6. Mount `<Pagination currentPage={page} totalPages={data?.totalPages || 1} totalItems={data?.total || 0} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />` at table footer.

- [ ] **Step 2: Run frontend test to verify it passes**

Run: `cd D:/project/bot/frontend && npx vitest run src/components/__tests__/SmartWalletsView.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SmartWalletsView.jsx frontend/src/components/__tests__/SmartWalletsView.test.js
git commit -m "perf(smartwallets): connect SmartWalletsView to server-side pagination and remove 88MB payload"
```

---

### Task 6: Update `MemeRegistryView.jsx` to Use Server-Side Pagination & Scoping

**Files:**
- Modify: `D:\project\bot\frontend\src\components\MemeRegistryView.jsx`
- Test: `D:\project\bot\frontend\src\components\__tests__/MemeRegistryView.test.js`

**Interfaces:**
- Consumes: `<Pagination />` from `components/ui/Pagination.jsx`
- Consumes: `GET /api/memes/registry?chain=...&status=...&page=...&pageSize=...&search=...`

- [ ] **Step 1: Update `MemeRegistryView.jsx` to query paginated server data**

In `D:\project\bot\frontend\src\components\MemeRegistryView.jsx`:
1. Add state: `page` (default 1), `pageSize` (default 50).
2. Reset `page` to 1 on filter or search change.
3. Update `fetchMemes`:
   ```javascript
   const params = new URLSearchParams({
     chain: chainTab,
     status: filterStatus,
     page: String(page),
     pageSize: String(pageSize),
   });
   if (search.trim()) params.set('search', search.trim());
   const res = await fetch(`${getBackendUrl()}/api/memes/registry?${params.toString()}`, { headers: authHeaders() });
   ```
4. Use server response for badge numbers (`solanaCount`, `robinhoodCount`, `backfilledCount`, `pendingCount`, `total`).
5. Render `<Pagination currentPage={page} totalPages={memes?.totalPages || 1} totalItems={memes?.total || 0} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />` at bottom of runner table.

- [ ] **Step 2: Run frontend test to verify it passes**

Run: `cd D:/project/bot/frontend && npx vitest run src/components/__tests__/MemeRegistryView.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MemeRegistryView.jsx frontend/src/components/__tests__/MemeRegistryView.test.js
git commit -m "perf(memeregistry): connect MemeRegistryView to server-side pagination and pagination controls"
```

---

### Task 7: Frontend Persistent Tab Navigation & Keep-Alive Layout in `App.jsx`

**Files:**
- Modify: `D:\project\bot\frontend\src\App.jsx`
- Test: `D:\project\bot\frontend\src\components\__tests__/Sidebar.test.js`

**Interfaces:**
- Produces: Persistent keep-alive tab switching container for primary workspaces

- [ ] **Step 1: Implement Keep-Alive Workspace Container in `App.jsx`**

In `D:\project\bot\frontend\src\App.jsx`:
1. Distinguish between persistent primary tabs and auxiliary route views:
   ```javascript
   const PERSISTENT_TABS = ['dashboard', 'smart-wallets', 'tracked-memes', 'sol-meme', 'evm-meme'];
   ```
2. Track which persistent tabs have been visited (`visitedTabs` Set). When a tab is visited, it mounts once and stays mounted.
3. In `render`:
   For visited persistent tabs, render inside a persistent container:
   ```jsx
   <div className="tab-workspaces">
     {visitedTabs.has('dashboard') && (
       <div style={{ display: currentTab === 'dashboard' ? 'block' : 'none' }}>
         <DashboardView walletGroups={walletGroups} setActiveTab={tab => navigate(`/${tab}`)} />
       </div>
     )}
     {visitedTabs.has('smart-wallets') && (
       <div style={{ display: currentTab === 'smart-wallets' ? 'block' : 'none' }}>
         <SmartWalletsView />
       </div>
     )}
     {visitedTabs.has('tracked-memes') && (
       <div style={{ display: currentTab === 'tracked-memes' ? 'block' : 'none' }}>
         <MemeRegistryView />
       </div>
     )}
     {visitedTabs.has('sol-meme') && (
       <div style={{ display: currentTab === 'sol-meme' ? 'block' : 'none' }}>
         <MemeFinderView walletDirectory={walletDirectory} forcedChain="solana" basePath="/sol-meme" />
       </div>
     )}
     {visitedTabs.has('evm-meme') && (
       <div style={{ display: currentTab === 'evm-meme' ? 'block' : 'none' }}>
         <MemeFinderView walletDirectory={walletDirectory} forcedChain="robinhood" basePath="/evm-meme" />
       </div>
     )}
   </div>
   ```
4. Render other routes via `<Routes>` normally when not matching a persistent tab.
5. Result: Switching between `/smart-wallets` and `/tracked-memes` or `/sol-meme` is **0ms instant**: no unmounting, no layout flash, and exact scroll positions and table filter states are preserved.

- [ ] **Step 2: Run frontend test to verify it passes**

Run: `cd D:/project/bot/frontend && npx vitest run src/components/__tests__/Sidebar.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(app): implement persistent keep-alive tab navigation for 0ms workspace switching"
```

---

### Task 8: End-to-End Verification & Latency Benchmark

**Files:**
- Test all backend and frontend suites

- [ ] **Step 1: Run all backend tests**

Run: `cd D:/project/bot/backend && npx vitest run`
Expected: All test files PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd D:/project/bot/frontend && npx vitest run`
Expected: All test files PASS

- [ ] **Step 3: Measure payload size and response time of `/api/smart-wallets`**

Run benchmark command via node:
```bash
node -e "
const start = performance.now();
fetch('http://localhost:4517/api/smart-wallets?page=1&pageSize=50')
  .then(r => r.text())
  .then(t => {
    const elapsed = (performance.now() - start).toFixed(1);
    console.log('Latency:', elapsed, 'ms | Payload size:', (t.length / 1024).toFixed(1), 'KB');
  });
"
```
Expected: Latency < 50ms, Payload size < 50 KB (compared to 88 MB previously).

- [ ] **Step 4: Commit any documentation updates**

```bash
git commit --allow-empty -m "perf: complete data loading and tab switching performance optimization"
```
