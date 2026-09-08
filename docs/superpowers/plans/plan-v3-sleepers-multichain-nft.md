# Plan: Sleeper Tokens, Multi-Chain & NFT Fixes — v3

**Date:** 2026-07-19
**Status:** Implemented (backend + frontend)
**Tests:** 134 passing (105 backend, 29 frontend)

---

## 1. Problem Statement

The original meme finder only watched tokens for 15 minutes after launch, then discarded them at 45 minutes. Tokens that "sleep" for hours or days before pumping were completely missed. Additionally, NFT drops showed stale/wrong data, the dashboard crashed, and the OpenSea API integration had multiple bugs.

---

## 2. What Was Built

### 2.1 Sleeper Token Detection

**Registry changes (`registry.js`):**

| Change | Before | After |
|---|---|---|
| Analysis schedule | 0, 1, 3, 8, 15 min | 0, 1, 3, 8, 15, **30, 60, 120, 240** min |
| Discard timeout | 45 min (all tokens) | 6h (zero-activity only) |
| Token states | watching, curated, discarded | watching, curated, **dormant**, discarded |
| Max tokens | 300 | 300 (dormant evicted before watching) |

**New dormant state:**
- Tokens that complete all passes but aren't curated move to `dormant` if they showed any activity (volume/liquidity > $1K)
- Dormant tokens receive live price updates every 45s via DexScreener
- No full analysis runs on dormant tokens (saves RPC calls)
- Spike detection can re-activate dormant tokens back to `watching`

**Spike detection (`refreshLoop.js`):**
- Every 45s tick checks all curated + dormant tokens
- Triggers re-analysis when volume jumps 3x or liquidity jumps 2x
- Re-activated dormant tokens get fresh safety + traction scoring
- `token:spike` events emitted for UI alerts

**Curation gate (unchanged):**
- Safety score >= 55
- Liquidity >= $5,000
- At least 2 analysis passes
- Not shrinking (liq/mcap growth > -30%)

### 2.2 NFT Drops Fixes

**Staleness fix (`drops.js:queryDrops`):**
- Reclassifies `status` at query time using current timestamp
- Eliminates 5-minute staleness window between refresh cycles
- Drops that ended 1 second ago now show as `ended` immediately

**classifyStatus reorder (`normalize.js`):**
- Time checks now run before sold-out check
- Upcoming drops with pre-populated supply no longer vanish
- Order: unknown → upcoming → ended → live (with sold-out sub-check)

**OpenSea API fixes (`drops.js`):**
- Removed BSC from `NFT_CHAINS` (not supported by OpenSea drops API)
- Changed type from `active` to `recently_minted` (valid API types)
- Added rate limiting: 1.2s stagger between requests
- Added 429 retry with `Retry-After` header support

**Normalizer fix (`normalize.js`):**
- Handles both `stages[]` array and `active_stage` singular shape
- Chain fallback from `raw.chain` prevents misassignment
- Added test for `active_stage` singular path

**Carried-forward drops reclassified:**
- Drops missing from a fetch cycle get `status` re-evaluated against current time
- Prevents stale "live" status persisting for days

### 2.3 Dashboard Fix

**Two undefined variable references (`DashboardView.jsx`):**
- Line 58: `mintLog` → `mintJobs`
- Line 99: `mints` → `mintJobs`

Both caused `ReferenceError` that crashed the entire component.

### 2.4 Meme Finder Sort

**New sort dropdown (`MemeFinderView.jsx`):**
- Options: Newest, Price change %, Liquidity, Market cap, Volume (24h), Safety score, Traction score
- Persists choice to `localStorage`
- Sort applied after filter logic in `filtered` useMemo

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend                          │
│  MemeFinderView (sort + filter + real-time updates) │
│  NFTMintBotView (drops browser, wallet panel)       │
│  DashboardView (overview, quick actions)            │
│  BotsView (bot CRUD)  SniperView (positions)        │
└──────────────────────┬──────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────┴──────────────────────────────┐
│                   Backend (port 4517)                 │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Discovery   │  │   Analysis   │  │   Engine   │  │
│  │  registry.js │  │ safety.js    │  │ botManager │  │
│  │  refreshLoop │  │ traction.js  │  │ positions  │  │
│  │  enrich.js   │  │ customLists  │  │ executor   │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                │                 │          │
│  ┌──────┴────────────────┴─────────────────┴──────┐  │
│  │              Token Lifecycle                    │  │
│  │  watching → curated                            │  │
│  │  watching → dormant (after passes, has activity)│  │
│  │  dormant  → watching (spike detected)          │  │
│  │  any      → discarded (rug/junk/timeout)       │  │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │   NFT Bot   │  │  Disperse    │  │   Bridge   │  │
│  │  drops.js   │  │  engine      │  │  LI.FI     │  │
│  │  normalize  │  │  validate    │  │  routes    │  │
│  │  mintRunner │  │  evm/solana  │  │  execute   │  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 4. Token Lifecycle Diagram

```
                    ┌──────────────┐
                    │   New Token  │
                    │  (launched)  │
                    └──────┬───────┘
                           │ registerToken()
                           ▼
                    ┌──────────────┐
                    │   watching   │◄──── spike re-activation
                    │              │
                    │ Passes: 0-8  │
                    │ (0-4 hours)  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ curated  │ │ dormant  │ │discarded │
        │          │ │          │ │          │
        │ Score≥55 │ │ Has life │ │ Rug/junk │
        │ Liq≥$5K  │ │ No curation│ │ Zero act │
        │ Passes≥2 │ │ Passes done│ │ 6h timeout│
        └──────────┘ └─────┬────┘ └──────────┘
                           │
                    spike detected
                    (3x vol or 2x liq)
                           │
                           ▼
                    ┌──────────────┐
                    │  watching    │
                    │  (re-analyze)│
                    └──────────────┘
```

---

## 5. File Reference

### Backend (modified)

| File | Changes |
|---|---|
| `backend/src/discovery/registry.js` | Extended PASS_SCHEDULE, DORMANT state, dormant lifecycle, trim order |
| `backend/src/discovery/refreshLoop.js` | Spike detection, VOLUME_SPIKE_MULT, LIQ_SPIKE_MULT, dormant re-activation |
| `backend/src/nft/drops.js` | Reclassify at query time, removed BSC, `recently_minted` type, rate limiting |
| `backend/src/nft/normalize.js` | Time checks before sold-out, `active_stage` singular support |
| `backend/src/nft/routes.js` | Use `NFT_CHAINS` instead of `NFT_CHAIN_CONFIG` for chain list |

### Frontend (modified)

| File | Changes |
|---|---|
| `frontend/src/components/DashboardView.jsx` | Fixed `mintLog`/`mints` → `mintJobs` |
| `frontend/src/components/MemeFinderView.jsx` | Sort dropdown with 7 options, localStorage persistence |

### Tests

| File | Changes |
|---|---|
| `backend/src/nft/__tests__/drops.test.js` | `staggerMs: 0`, `recently_minted` type mocks |
| `backend/src/nft/__tests__/normalize.test.js` | `active_stage` test, upcoming-with-supply test |

---

## 6. Test Results

```
Backend:  23 files, 105 tests — all passing
Frontend:  6 files,  29 tests — all passing
Total:    29 files, 134 tests — all passing
```

---

## 7. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Max 300 tokens in registry | Old dormant tokens evicted under pressure | Dormant evicted before watching; custom lists provide unlimited tracking |
| Spike detection is threshold-based | May miss slow organic growth | Custom lists handle gradual criteria matching |
| Traction re-scored on spike only | Dormant tokens have stale traction between spikes | Acceptable — traction only matters at curation moment |
| No cross-chain meme tracking | Only Solana tokens | EVM tools handle other chains separately |
| OpenSea free tier: 60 req/min | 7 chains × 2 types = 14 calls per refresh | 1.2s stagger keeps under limit |

---

## 8. What Users Can Do Now

1. **Catch sleeper tokens** — Tokens that sleep for hours/days before pumping are detected via spike triggers
2. **View dormant tokens** — "All" tab shows dormant tokens with activity
3. **Sort meme tokens** — By price change, liquidity, market cap, volume, safety, traction
4. **NFT drops always fresh** — Status reclassified at query time, no stale data
5. **Dashboard works** — No more crashes from undefined variables
6. **Custom lists for long-term tracking** — Rules-based monitoring independent of registry lifecycle
