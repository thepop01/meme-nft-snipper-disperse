# Data Loading & Tab Switching Performance Optimization Design

## 1. Overview & Problem Statement

As the background intelligence pipeline populates tens of thousands of wallets and hundreds of meme runners across Solana and Robinhood, the web interface faces significant performance degradation:

1. **Massive 88 MB–125 MB Network Payloads**:
   * `backend/data/smart-wallets.json` currently holds over **64,550 wallets (125 MB on disk)**.
   * `SmartWalletsView.jsx` currently requests `GET /api/smart-wallets?limit=all`.
   * Serializing and transferring 88 MB of JSON over HTTP takes 1–3 seconds, parses slowly in V8, allocates 64,500+ JavaScript objects in React state, and attempts to render tens of thousands of `<tr>` elements into the DOM, freezing the browser.

2. **Synchronous 540ms Blocking Disk Reads on Every Request**:
   * `loadWallets()` in `backend/src/smartwallets/tracker.js` reads and parses `smart-wallets.json` from disk using synchronous `fs.readFileSync` on every single request.
   * Benchmarks show this blocks the Node.js event loop for ~540ms per call, stalling WebSocket feeds, worker timers, and concurrent HTTP requests.

3. **Total UI Tear-Down on Tab Switching**:
   * In `frontend/src/App.jsx`, standard React Router `<Routes>` completely unmounts the active component whenever the user navigates to another route (e.g. switching between `/smart-wallets`, `/tracked-memes`, `/sol-meme`, `/evm-meme`, and `/dashboard`).
   * When returning to an earlier tab, the component is re-instantiated from scratch, scroll position is lost, active filters and search terms are reset, and the full multi-megabyte network request is re-fired.

---

## 2. Goals & Success Criteria

* **Sub-50ms API Responses**: Server responds in under 50ms (typically <10ms) by reading from memory and returning paginated slices.
* **Payload Reduction**: Response payloads drop from **88 MB to ~40 KB (a 2,200× reduction)**.
* **0ms Tab Switching**: Switching between primary tabs (`/smart-wallets`, `/tracked-memes`, `/sol-meme`, `/evm-meme`, `/dashboard`) occurs with zero network wait, no layout thrashing, and full retention of scroll position, active sub-tabs, filters, and page numbers.
* **Clean Standard Pagination**: Standard pagination controls (e.g. 50 items per page with Prev, Next, page buttons, and total counts) keeping DOM element counts small (<100 rows) and rendering at 60 FPS.
* **Backward Compatibility**: Existing scripts or consumers relying on `limit=all` or default parameters continue to function without breaking.

---

## 3. Architecture & System Design

### 3.1 Backend: In-Memory Store Singleton (`tracker.js`)

Instead of reading a 125 MB file from disk on every invocation of `loadWallets()`, maintain an in-memory cached document singleton:

```javascript
let cachedWalletsDoc = null;

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

export function clearWalletsCache() {
  cachedWalletsDoc = null;
}
```

* **Read Overhead**: Reduced from 540ms of blocking disk I/O down to **0ms** (direct memory reference).
* **Write-Through**: Calls to `saveWallets()` or `upsertWallets()` update the in-memory cache immediately and atomically persist to disk.
* **Worker & Process Safety**: Tests or reset scripts can call `clearWalletsCache()` to force a reload from disk if needed.

---

### 3.2 Backend: Server-Side Filter & Pagination (`/api/smart-wallets`)

Enhance `backend/src/smartwallets/routes.js` to perform filtering, searching, and pagination in-memory:

#### Query Parameters:
* `chain`: `'solana' | 'robinhood' | 'all'` (default: `'all'`)
* `category`: `'smart' | 'tracked' | 'whale' | 'lineage' | 'sniper' | 'all'` (default: `'all'`)
* `subfilter`: `'all' | 'buying_mcap' | 'first_n_buyers' | 'both' | 'early_buyer'`
* `q` / `search`: Text search matching address, twitterUsername, lineageParent, symbol, or tags
* `consistentOnly`: `'true' | 'false'` (for smart category: `>=5` open trades & `>$100` PnL)
* `page`: Integer (1-based, default: `1`)
* `pageSize` / `limit`: Integer (default: `50`, capped at `500`; `'all'` supported for legacy/export)

#### Response Schema:
```json
{
  "page": 1,
  "pageSize": 50,
  "total": 53003,
  "totalPages": 1061,
  "smartCount": 11200,
  "trackedCount": 53003,
  "whaleCount": 18,
  "lineageCount": 12,
  "sniperCount": 267,
  "scamCount": 0,
  "wallets": [ ...50 items... ],
  "tiers": [ ... ],
  "earlyBuyerRules": { ... },
  "qualificationRules": { ... },
  "whaleRules": { ... },
  "storage": "json"
}
```

* Computes total counts across each category in a single pass to display badge counts on all 5 tabs.
* Returns only the requested page slice of 50 wallets.
* Payload size: ~40 KB instead of 88 MB.

---

### 3.3 Backend: Pagination for Meme Registry (`/api/memes/registry`)

Enhance `app.get('/api/memes/registry')` in `backend/server.js`:
* Accepts `chain`: `'solana' | 'robinhood' | 'all'`
* Accepts `status`: `'all' | 'backfilled' | 'pending_worker3'`
* Accepts `search`: token name, symbol, or mint address
* Accepts `page`: 1-based integer (default 1)
* Accepts `pageSize`: integer (default 50, or `'all'`)
* Returns `{ total, page, pageSize, totalPages, solanaCount, robinhoodCount, backfilledCount, pendingCount, memes: [...] }`.

---

### 3.4 Frontend: Keep-Alive Persistent Tab Navigation (`App.jsx`)

To solve the tab switching penalty, update `frontend/src/App.jsx` with a persistent workspace container pattern:

1. **Tab Keep-Alive Layout**:
   * Primary frequently-toggled workspaces are kept mounted once initialized:
     * `/smart-wallets` (`SmartWalletsView`)
     * `/tracked-memes` (`MemeRegistryView`)
     * `/sol-meme` (`MemeFinderView` Solana)
     * `/evm-meme` (`MemeFinderView` Robinhood)
     * `/dashboard` (`DashboardView`)
   * Active tab is rendered with standard visibility (`display: block` or normal flow).
   * Inactive tabs are hidden via CSS (`display: none`).
2. **State & Scroll Retention**:
   * Because the component remains mounted in memory:
     * Scroll position is maintained when switching back.
     * Table search queries, active category tabs (e.g. *Whale Wallets* vs. *Smart Wallets*), subfilters, and active page numbers remain intact.
     * No loading spinners or blank screens appear when toggling between tabs.
3. **Manual & Background Refresh**:
   * Each view retains its header refresh button for explicitly reloading data on demand.
   * Background WebSocket events continue to receive updates without triggering full component remounts.

---

### 3.5 Frontend: Reusable Pagination Component (`Pagination.jsx`)

Create `frontend/src/components/ui/Pagination.jsx`:
* **Props**:
  * `currentPage`: number
  * `totalPages`: number
  * `totalItems`: number
  * `pageSize`: number
  * `onPageChange`: `(newPage: number) => void`
  * `onPageSizeChange`: `(newPageSize: number) => void` (optional, options: `[25, 50, 100]`)
* **UI Controls**:
  * Item range indicator: `Showing 1–50 of 53,003 items`
  * Navigation: `[Previous]` `1` `...` `4` `[5]` `6` `...` `1061` `[Next]`
  * Page size selector dropdown
  * Keyboard accessibility and disabled state on first/last page boundaries.

---

## 4. Integration into Views

### 4.1 `SmartWalletsView.jsx`
* Instead of loading all 64,500 wallets upfront and filtering in a client-side `useMemo`:
  * Maintain query state: `page`, `pageSize` (default 50), `listCategory`, `chainTab`, `trackedSubfilter`, `search`, `consistentOnly`.
  * Trigger `fetchWallets({ page, pageSize, category, chain, ... })` on filter or page change (with 250ms debounce on search text).
  * Display the server-returned badges and pagination controls at the bottom of the table.

### 4.2 `MemeRegistryView.jsx`
* Maintain query state: `page`, `pageSize` (default 50), `chainTab`, `filterStatus`, `search`.
* Render `<Pagination />` at the bottom of the runner list.

---

## 5. Testing Strategy

1. **Backend Unit & Integration Tests**:
   * `backend/src/smartwallets/__tests__/routes.test.js`:
     * Verify `GET /api/smart-wallets` with `page=1&pageSize=10` returns only 10 items, correct `total`, `totalPages`, and badge counts.
     * Verify category, chain, and search filters slice correctly on the server.
     * Verify `loadWallets()` uses the in-memory cache and `clearWalletsCache()` resets it.
   * `backend/src/workers/__tests__/memeRegistry.test.js`:
     * Verify pagination query parameters on registry filtering.
2. **Frontend Unit Tests**:
   * `frontend/src/components/ui/__tests__/Pagination.test.jsx`:
     * Test page button generation, ellipsis handling for large page counts, page changes, and boundary states.
   * `frontend/src/components/__tests__/SmartWalletsView.test.js`:
     * Test integration with paginated responses and page change events.
   * `frontend/src/components/__tests__/MemeRegistryView.test.js`:
     * Test integration with paginated responses.
3. **End-to-End Verification**:
   * Verify tab switching between `/smart-wallets` and `/tracked-memes` is instantaneous (<5ms) with zero layout shift.
   * Verify network tab transfers <50 KB on tab loads.
