# Complete Multi-Source Wallet Intelligence Plan (All 15 Sources)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate all 15 Solana and Robinhood/EVM smart wallet intelligence sources into our dual-chain 4-category wallet registry (Smart, Tracked, Whales, Lineage) with automated ingestion, cluster convergence detection, live webhooks, and 1-click terminal inspection.

**Architecture:** A modular adapter architecture under `backend/src/smartwallets/adapters/` with specialized parsers for each source, feeding into `finder.js` and `tracker.js`, evaluated by `classifyWalletCategory()`, and registered in `sources.js`.

**Tech Stack:** Node.js (Express), React (Vite, Lucide), Vitest, Supertest, PostgreSQL / atomic JSON store.

---

## Complete Source Directory & Phase Mapping

| Phase | Intelligence Sources | Chain | Type & Pricing | Role in Bot |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | **FOMO (`fomo.family`)**<br>**Kolscan (`kolscan.io`)**<br>**Nock Scout (`nockterminal.com`)** | Solana + EVM<br>Solana<br>Robinhood | **100% Free**<br>**Free**<br>**Free** | Top social traders & PnL leaderboards (Solana & Robinhood) |
| **Phase 2** | **MemeMoves (`mememoves.com`)**<br>**MadeOnSol (`madeonsol.com`)** | Solana<br>Solana | **Free**<br>**Free** | Multi-wallet cluster convergence & launch snipers |
| **Phase 3** | **Birdeye (`birdeye.so`)** | Solana | **Freemium** | Portfolio profiling and multi-token balance evaluation |
| **Phase 4** | **Cielo (`cielo.finance`)**<br>**HoodScan & RobinScan**<br>**Blockscout & Solscan** | Solana + EVM<br>Robinhood<br>Solana + RH | **Freemium**<br>**Free**<br>**Free** | Real-time buy/sell webhooks & on-chain funding lineage tracing |
| **Phase 5** | **Nansen (`nansen.ai`)**<br>**Dune Analytics (`dune.com`)** | Solana + EVM<br>Robinhood + Sol | **Freemium / Paid**<br>**Free / Freemium** | Smart Money DEX trades/holdings (API + CSV) & SQL leaderboards |
| **Phase 6** | **Unified Terminal UI & Guide** | Both Chains | **System UI** | 1-click terminal inspection links, multi-source filters, and guide |

---

## Phase 1: Free Social & PnL Leaderboards (FOMO, Kolscan, Nock Scout)

### Task 1: FOMO (`fomo.family`) Live Adapter
**Files:**
- Create: `backend/src/smartwallets/adapters/fomo.js`
- Test: `backend/src/smartwallets/__tests__/fomo.test.js`
- Modify: `backend/src/smartwallets/finder.js`

- [ ] **Step 1: Write test for FOMO parser**
Tests normalization of Solana and EVM traders from `fomoapi.io` / `fomo.family` payload, extracting handles (`@handle`), 30d realized PnL, win rate, and total trades.

- [ ] **Step 2: Implement `backend/src/smartwallets/adapters/fomo.js`**
Fetch from public feed / API endpoint with timeout and error handling.

- [ ] **Step 3: Connect in `finder.js` and add endpoint `POST /api/smart-wallets/scan/fomo`**

- [ ] **Step 4: Run tests and verify 100% pass**

---

### Task 2: Kolscan KOL Leaderboard Parser (Solana)
**Files:**
- Create: `backend/src/smartwallets/adapters/kolscan.js`
- Test: `backend/src/smartwallets/__tests__/kolscan.test.js`

- [ ] **Step 1: Write test for Kolscan leaderboard parser**
Verify parsing of top Solana meme KOLs and callers, tagging as `['kolscan', 'alpha_caller']`.

- [ ] **Step 2: Implement `kolscan.js` and add endpoint `POST /api/smart-wallets/scan/kolscan`**

- [ ] **Step 3: Verify test passes and commit**

---

### Task 3: Nock Scout Leaderboard Parser (Robinhood / EVM)
**Files:**
- Create: `backend/src/smartwallets/adapters/nock.js`
- Test: `backend/src/smartwallets/__tests__/nock.test.js`

- [ ] **Step 1: Write test for Nock Scout Robinhood leaderboard parser**
Verify extraction of EVM 0x addresses, copyable PnL score, and win rate.

- [ ] **Step 2: Implement `nock.js` and add endpoint `POST /api/smart-wallets/scan/nock`**

- [ ] **Step 3: Verify test passes and commit**

---

## Phase 2: Cluster Convergence & Sniper Detection (MemeMoves & MadeOnSol)

### Task 4: MemeMoves Cluster Convergence Engine
**Files:**
- Create: `backend/src/smartwallets/convergence.js`
- Create: `backend/src/smartwallets/adapters/mememoves.js`
- Test: `backend/src/smartwallets/__tests__/convergence.test.js`

- [ ] **Step 1: Write test for multi-wallet cluster convergence**
Given multiple smart/tracked wallets buying token `XYZ` within a 15-minute window, verify that `detectConvergence()` flags a cluster alert with count $\ge 2$ and token details.

- [ ] **Step 2: Implement `convergence.js`**
Evaluates recent trade tapes against our wallet database to detect simultaneous accumulation.

- [ ] **Step 3: Implement `mememoves.js` to ingest MemeMoves smart money rankings**

- [ ] **Step 4: Verify test passes and commit**

---

### Task 5: MadeOnSol Sniper & Deployer Safety Parser
**Files:**
- Create: `backend/src/smartwallets/adapters/madeonsol.js`
- Test: `backend/src/smartwallets/__tests__/madeonsol.test.js`

- [ ] **Step 1: Write test for MadeOnSol sniper ingestion and deployer check**
Verify that runner snipers are routed to `category: 'tracked'` with tag `'madeonsol_sniper'`.

- [ ] **Step 2: Implement `madeonsol.js` and add endpoint `POST /api/smart-wallets/scan/madeonsol`**

- [ ] **Step 3: Verify test passes and commit**

---

## Phase 3: Portfolios & Balance Profiling (Birdeye)

### Task 6: Birdeye Portfolio & Verified PnL Adapter
**Files:**
- Create: `backend/src/smartwallets/adapters/birdeye.js`
- Test: `backend/src/smartwallets/__tests__/birdeye.test.js`

- [ ] **Step 1: Write test for Birdeye portfolio parser**
Test querying `/v1/wallet/token_list` to calculate `balanceUsd` and `memeHoldingsUsd` for Whale qualification ($> \$5,000$).

- [ ] **Step 2: Implement `birdeye.js` with `BIRDEYE_API_KEY` (and free public fallback)**

- [ ] **Step 3: Add `POST /api/smart-wallets/enrich/birdeye/:address` endpoint**

- [ ] **Step 4: Verify test passes and commit**

---

## Phase 4: Live Alerts & On-chain Lineage (Cielo, HoodScan/RobinScan, Blockscout)

### Task 9: Cielo Real-time Webhook Receiver
**Files:**
- Create: `backend/src/smartwallets/adapters/cielo.js`
- Modify: `backend/src/smartwallets/routes.js`
- Test: `backend/src/smartwallets/__tests__/cielo.test.js`

- [ ] **Step 1: Write test for Cielo trade alert webhook**
Test parsing buy/sell alerts from Cielo and recording live hits against our tracked wallets.

- [ ] **Step 2: Implement `handleCieloWebhook()` in `cielo.js` and add `POST /api/smart-wallets/webhook/cielo`**

- [ ] **Step 3: Verify test passes and commit**

---

### Task 10: HoodScan, RobinScan, Blockscout & Solscan Lineage Funder Inspector
**Files:**
- Create: `backend/src/smartwallets/adapters/lineageRpc.js`
- Test: `backend/src/smartwallets/__tests__/lineageRpc.test.js`

- [ ] **Step 1: Write test for on-chain funder parent resolution**
Pulls initial funding tx from Solana (via RPC) and Robinhood (via Blockscout/HoodScan) to connect child wallets into `category: 'lineage'`.

- [ ] **Step 2: Implement `findFunderAccount(address, chain)`**

- [ ] **Step 3: Verify test passes and commit**

---

## Phase 5: Institutional Intelligence (Nansen & Dune)

### Task 11: Nansen REST API Connector & Web CSV Batch Importer
**Files:**
- Create: `backend/src/smartwallets/adapters/nansen.js`
- Test: `backend/src/smartwallets/__tests__/nansen.test.js`
- Modify: `backend/src/smartwallets/routes.js`

- [ ] **Step 1: Write test for Nansen Smart Money API calls**
Test payload creation for `/api/v1/smart-money/dex-trades` and `/api/v1/smart-money/holdings` with `NANSEN_API_KEY`.
Test CSV parser for free-tier users uploading Nansen web exports.

- [ ] **Step 2: Implement `nansen.js` and add `POST /api/smart-wallets/scan/nansen` and `POST /api/smart-wallets/import/csv`**

- [ ] **Step 3: Verify test passes and commit**

---

### Task 12: Dune Analytics 30d Realized PnL Query Ingestion
**Files:**
- Create: `backend/src/smartwallets/adapters/dune.js`
- Test: `backend/src/smartwallets/__tests__/dune.test.js`

- [ ] **Step 1: Write test for Dune query result normalizer**
Test parsing Dune 30d Robinhood Chain (ID 4663) and Solana alpha leaderboards.

- [ ] **Step 2: Implement `dune.js` and add `POST /api/smart-wallets/scan/dune`**

- [ ] **Step 3: Verify test passes and commit**

---

## Phase 6: Terminal UI, Direct Profilers & Guide

### Task 13: Direct Profiler Links in Terminal UI
**Files:**
- Modify: `frontend/src/components/SmartWalletsView.jsx`
- Modify: `frontend/src/components/__tests__/SmartWalletsView.test.js`

- [ ] **Step 1: Add 1-click external inspection buttons in every wallet row:**
  - **GMGN**: `gmgn.ai/sol/address/<addr>`
  - **Nansen Profiler**: `app.nansen.ai/profiler?address=<addr>`
  - **HoodScan / RobinScan / Blockscout**: Robinhood Chain explorers
  - **Solscan**: Solana explorer
- [ ] **Step 2: Add multi-source scan triggers dropdown in UI header:**
  - `Scan GMGN` | `Scan FOMO` | `Scan Kolscan` | `Scan Nansen` | `Scan Nock Scout`
- [ ] **Step 3: Display cluster convergence badge (`🔥 Multi-Wallet Cluster`) when MemeMoves convergence detected**

---

### Task 14: Dynamic Sources Registry & Guide Update
**Files:**
- Modify: `backend/src/smartwallets/sources.js`
- Modify: `guide.md`

- [ ] **Step 1: Update `sources.js` to register all 15 sources with pricing metadata (`free`, `freemium`, `paid`) and live API status**
- [ ] **Step 2: Update `guide.md` Section 6 with complete directory, pricing table, setup instructions, and rate limit best practices**
- [ ] **Step 3: Run full backend (`npm test`) and frontend (`npm test -- --run`) test suites**
