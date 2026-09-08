# Product Redesign Implementation Plan

## Document Status

- **Project:** Bot dashboard redesign
- **Scope:** Wallet Management, Monad Disperse, Meme Finder trading terminal, and Mint Bot alignment
- **Primary frontend:** React/Vite application in `frontend/`
- **Primary backend:** Node.js application in `backend/`
- **Reference images:** `image/wallets.png`, `image/disperse.png`, and `image/mint.png`
- **Target delivery approach:** Incremental, independently testable releases

### Implementation update — 2026-07-23

The code-scoped initial-release work in this plan is implemented. The repository now includes:

- Durable backend-owned wallet/tag records, migration from browser groups, case-safe tags, merge/archive/bulk operations, reusable multi-tag resolution, and audit records.
- Shared wallet/tag selection and exact deduplicated previews across Wallets, Disperse, Mint Bot, and Meme Finder portfolio filters.
- Chain-aware Meme Finder adapters, dense sortable/expandable scanner rows, freshness states, charts, default strategies, extended custom-list rules, manual/pinned/excluded tokens, cadence enforcement, and match/score/price/risk alerts.
- Connected-wallet live quick trading behind two kill switches, quote simulation and receipt reconciliation, immutable fills, FIFO lots, partial-sell/fee-aware PnL, persistent trigger-order lifecycle/recovery, and provider capability reporting.
- Safer Disperse planning/execution, global amount allocation, sender exclusion, exact approvals, fail-closed contract verification, cross-chain retry protections, preflight balance/fee-reserve evidence, persistent history, explorer links, and editable job duplication.
- Shared operational Activity/audit history, provider health checks, Mint Bot status alignment, route-level code splitting, mobile/keyboard coverage, and Playwright critical-flow tests.

Verification baseline at this update:

- Backend: `npm test` in `backend/`.
- Frontend unit tests: `npm test` in `frontend/`.
- Browser flows: `npm run test:e2e` in `frontend/`.
- Frontend quality: `npm run lint` and `npm run build` in `frontend/`.

The following are release/operations gates, not claims that can be completed by repository code alone:

- Independent security review of signing, custody boundaries, RPC/provider configuration, and deployed contracts.
- Independently obtain and verify each `DISPERSE_BYTECODE_HASH_<CHAIN>` before setting `DISPERSE_DRY_RUN=false`.
- Supply production provider credentials/endpoints and validate rate limits, latency, and failover behavior.
- Run funded testnet acceptance, narrowly scoped live acceptance, and the planned paper/testnet soak period.
- Provider-native persistent limit orders remain capability-gated; the current Solana implementation is accurately labeled as a five-second server-watched trigger order and live use requires the separately reviewed server signer.

## 1. Objective

Redesign the existing dashboard into a consistent operational workspace with four connected product areas:

1. **Wallet Management** organizes wallets using reusable tags. Tags represent groups, and one wallet can belong to multiple groups.
2. **Monad Disperse** sends MON or supported ERC-20 tokens to individual wallets, pasted recipients, imported recipients, or tag-based wallet groups.
3. **Meme Finder** becomes a chain-aware discovery and trading terminal with curated strategies, custom lists, charts, Quick Buy/Sell, persistent Limit Buy/Sell, positions, orders, and PnL.
4. **Mint Bot** uses the same wallet and tag selectors and follows the same dashboard design and transaction-state language.

The redesign should follow the supplied Mint, Disperse, and Wallet Management references: compact navigation, dense searchable lists, restrained surfaces, clear actions, and strong operational status feedback.

## 2. Product Principles

- Keep signing non-custodial by default. A connected wallet signs transactions unless a separately reviewed signer service is introduced.
- Treat tags as reusable wallet groups instead of maintaining a second, duplicated group system.
- Identify every token with `(chainId, tokenAddress)`, never by address alone.
- Keep market-data providers and execution venues behind adapters.
- Calculate positions and PnL from confirmed fills and receipts, not submitted trade intent.
- Never label a browser-only price watcher as a persistent limit order.
- Expose the source and freshness of external market, holder, developer, and risk data.
- Make all strategy matches and risk labels explainable.
- Default automation to paper mode or explicit confirmation until live acceptance criteria pass.
- Preserve working backend behavior and evolve existing modules rather than building a parallel system.

## 3. Current Codebase Touchpoints

The implementation should extend the existing modules where possible.

### Frontend

- `frontend/src/App.jsx`: top-level view routing and shared wallet-group state
- `frontend/src/index.css`: current global styles and component classes
- `frontend/src/components/Sidebar.jsx`: primary navigation
- `frontend/src/components/WalletsView.jsx`: wallet management
- `frontend/src/components/DisperseView.jsx`: disperse workflow
- `frontend/src/components/MemeFinderView.jsx`: discovery, custom lists, and buy flow
- `frontend/src/components/NFTMintBotView.jsx`: Mint Bot
- `frontend/src/components/SniperView.jsx`: positions, bots, and execution-related views that may overlap the new terminal
- `frontend/src/components/ui/`: shared primitives, modals, toasts, and alerts
- `frontend/src/utils/sniperApi.js`: Meme Finder and trading API client
- `frontend/src/utils/disperseApi.js`: Disperse API client
- `frontend/src/utils/vault.js` and `frontend/src/utils/keys.js`: existing credential handling that requires a security review before expansion

### Backend

- `backend/src/discovery/`: token discovery and enrichment providers
- `backend/src/analysis/`: curated lists, list rules, safety, traction, attention, and statistics
- `backend/src/trading/executor.js`: trade execution
- `backend/src/engine/positions.js`: positions, trade history, automated exits, and current PnL fields
- `backend/src/engine/limitOrders.js`: server-watched trigger orders
- `backend/src/engine/botManager.js`: strategy/bot execution
- `backend/src/disperse/`: planning, validation, bridging, execution, and job tracking
- `backend/src/nft/`: discovery, mint scheduling, execution, gas, and routes
- `backend/src/store.js`: current persistence abstraction
- `backend/src/bus.js`: application events and logs
- `backend/src/alerts.js`: user-facing alerts

## 4. Target Information Architecture

```text
Dashboard
Wallets
  - All Wallets
  - Groups / Tags
  - Import / Export
Monad Disperse
Meme Finder
Mint Bot
Activity
Settings
```

Meme Finder owns discovery and manual trading. Existing sniper/bot automation may remain as a secondary view inside Meme Finder or as an advanced Automation area, but positions and orders must not be split across confusing duplicate pages.

## 5. Shared Design System

### 5.1 Visual direction

Derive the base design system from the supplied reference images:

- Compact persistent sidebar
- Light or dark neutral surfaces with Monad purple as the primary action color
- Dense tables and list rows suited to repeated operational use
- Restrained borders and shadows
- Clear selected, pending, success, warning, and failed states
- Small, predictable controls rather than oversized marketing components
- Responsive layouts that preserve data readability

### 5.2 Design tokens

Create tokens for:

- Background, surface, elevated surface, and border colors
- Primary Monad purple and hover/pressed states
- Positive, warning, negative, and neutral status colors
- Text hierarchy and muted text
- Spacing scale
- Typography scale
- Row heights and control heights
- Border radii no greater than the existing system unless required
- Focus rings and keyboard navigation states

### 5.3 Shared components

Build or consolidate:

- `AppShell`
- `Sidebar`
- `PageHeader`
- `NetworkSelector`
- `ExecutionWalletSelector`
- `AddressDisplay`
- `WalletSelector`
- `WalletTagSelector`
- `TagBadge`
- `DataTable`
- `BulkActionToolbar`
- `TokenIdentity`
- `StatusBadge`
- `TransactionStatus`
- `MetricCell`
- `ConfirmationModal`
- `EmptyState`
- `ErrorState`
- `SkeletonState`
- `Toast`

### 5.4 Responsive behavior

- Desktop: fixed sidebar, multi-column terminal, persistent order ticket
- Tablet: collapsible sidebar and resizable/stacked terminal panels
- Mobile: bottom or drawer navigation, scanner-first view, token details and order ticket in full-screen sheets
- Tables: retain critical identity and action columns; move secondary metrics to row expansion on narrow screens

## 6. Wallet Management and Tag Groups

### 6.1 Data model

Use a many-to-many relationship:

```text
Wallet 1 --- * WalletTag * --- 1 Tag
```

Suggested records:

```ts
type Wallet = {
  id: string;
  name: string;
  address: string;
  chainIds: string[];
  signerType: 'connected' | 'external' | 'watch-only' | 'managed';
  status: 'active' | 'disabled' | 'error';
  createdAt: string;
  updatedAt: string;
};

type Tag = {
  id: string;
  name: string;
  normalizedName: string;
  color: string;
  description?: string;
  archivedAt?: string;
};

type WalletTag = {
  walletId: string;
  tagId: string;
};
```

If durable database persistence is not yet available, introduce a repository interface now and use the current store behind it. Do not make local browser state the long-term source of truth.

### 6.2 Wallet list

Implement a searchable table with:

- Selection checkbox
- Wallet name
- Shortened address with copy action
- Network support
- Native balance and selected token balances
- Tags
- Status
- Last activity
- Per-wallet action menu

### 6.3 Tag management

Support:

- Create a tag inline while editing one or many wallets
- Assign and remove multiple tags
- Filter by one or more tags
- View each tag's wallet count and aggregate balance
- Rename a tag
- Merge duplicate tags
- Archive/delete a tag without deleting wallets
- Prevent case-only duplicates using `normalizedName`
- Preview the exact wallets resolved by a tag

### 6.4 Bulk actions

- Add/remove tags
- Enable/disable wallets
- Export selected public addresses
- Add selection to a Disperse draft
- Select wallets for a Mint Bot job
- Archive wallets with confirmation

### 6.5 Security requirements

- Separate watch-only addresses from signing credentials.
- Never reveal stored private keys after import.
- Do not expand browser-based private-key storage as part of the redesign.
- Require an explicit security review before unattended live signing.
- Log wallet imports and destructive changes without logging secrets.

### 6.6 Acceptance criteria

- A wallet can have multiple tags.
- A tag dynamically resolves its current wallets.
- The same tag can be selected in Wallets, Disperse, Mint Bot, and portfolio filters.
- Removing a tag never removes the wallet.
- Duplicate tag names are prevented or merged intentionally.

## 7. Meme Finder Trading Terminal

### 7.1 Target layout

```text
+----------------+--------------------------------------+--------------------+
| Curated lists  | Scanner / token workspace            | Trade ticket       |
|                |                                      |                    |
| Default lists  | Search, filters, sortable token grid | Buy / Sell         |
| Custom lists   | Chart and market activity            | Quick / Limit      |
| Watchlist      | Token intelligence and risk          | Quote / route      |
| Alerts         |                                      | Submit             |
+----------------+--------------------------------------+--------------------+
| Positions | Orders | History | PnL | Watchlist | Activity                    |
+-------------------------------------------------------------------------------+
```

When no token is selected, the center panel prioritizes scanning. Selecting a token opens its chart and intelligence without losing the current list and filters.

### 7.2 Chain-aware provider architecture

Define these interfaces:

```ts
interface MarketDataAdapter {
  searchTokens(query: TokenQuery): Promise<TokenSummary[]>;
  getTokenOverview(token: TokenRef): Promise<TokenOverview>;
  getChart(token: TokenRef, range: ChartRange): Promise<Candle[]>;
  getPools(token: TokenRef): Promise<Pool[]>;
  getHolderMetrics(token: TokenRef): Promise<HolderMetrics>;
  getDeveloperMetrics(token: TokenRef): Promise<DeveloperMetrics>;
}

interface TradeExecutionAdapter {
  capabilities(chainId: string): ExecutionCapabilities;
  getQuote(request: QuoteRequest): Promise<TradeQuote>;
  simulate(request: TradeRequest): Promise<SimulationResult>;
  submitSwap(request: TradeRequest): Promise<SubmittedTrade>;
  createLimitOrder(request: LimitOrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
}

interface PortfolioAdapter {
  syncWallet(wallet: WalletRef): Promise<PortfolioSnapshot>;
  getBalances(wallet: WalletRef): Promise<AssetBalance[]>;
  getActivity(wallet: WalletRef): Promise<WalletActivity[]>;
  reconcileFills(wallet: WalletRef): Promise<Fill[]>;
}
```

Initial adapters should wrap the project's existing Solana discovery/execution code. Monad support should use the same normalized contracts when its selected market and execution providers are finalized.

### 7.3 Normalized token intelligence

Convert alerts like the supplied `horse on horse (hoh)` output into structured data.

Required groups:

| Group | Fields |
|---|---|
| Identity | Name, symbol, chain, token address, image, age |
| Links | DexScreener, GMGN, Jupiter/router, explorer, website, X/Twitter |
| Momentum | Migration speed/time, market cap at detection, 5m volume, buys, sells |
| Flow | Smart wallets, snipers, whales, fresh wallets |
| Distribution | Bundler percentage, top-10 holder percentage |
| Developer | Address, opened count, created count, related token history |
| Scoring | OFS/provider scores, internal potential, contributing factors |
| Freshness | Source and `updatedAt` for every provider-owned metric |

Implementation rules:

- Keep provider-specific scores such as `OFS` named as such unless their definition is verified.
- Distinguish `0` from unavailable data.
- Show why a potential/risk label was assigned.
- Mark stale fields visually.
- Never imply that a score guarantees safety or profit.

### 7.4 Scanner table

Add a dense, sortable token scanner with:

- Token name, symbol, image, chain, and address
- Age and migration status
- Price and 5m/1h/24h changes
- Market cap and liquidity
- 5m/1h/24h volume
- Buys, sells, and buy/sell ratio
- Smart wallets, whales, snipers, and fresh wallets
- Bundler percentage
- Top-10 holder concentration
- Developer history indicator
- Strategy score and risk state
- Watchlist control
- Quick Buy and Quick Sell actions

Provide search, chain/source filters, numeric range filters, saved sort, refresh state, stale-data indication, and row expansion.

### 7.5 Default curated strategies

Ship defaults as inspectable, editable templates:

1. **Fresh Launch Momentum**
   - New tokens within a configurable age window
   - Minimum liquidity and 5m volume
   - Positive transaction velocity and buy/sell ratio
   - Maximum concentration and bundler thresholds

2. **Quality Breakout**
   - Rising multi-window volume
   - Positive price acceleration
   - Improving or stable liquidity
   - No extreme distribution or developer flags

3. **Smart Money Interest**
   - Recent smart-wallet or whale activity
   - Minimum route depth/liquidity
   - Maximum concentration and price impact

4. **Migration Watch**
   - Near or recently completed migration
   - Increasing transaction count and volume
   - Viable buy and sell routes

5. **Liquidity-Safe Memes**
   - Higher liquidity floor
   - Lower bundler exposure
   - Lower top-10 concentration
   - Active two-sided trading

6. **Early Microcaps**
   - Small market-cap range
   - Minimum liquidity and transaction velocity
   - Fresh age window
   - Higher-risk label by default

7. **Reversal Watch**
   - Material short-window decline
   - Recovering volume and buys
   - Sufficient liquidity to exit

8. **Dev Risk Watch**
   - High developer token-creation count
   - High bundler or concentration values
   - Monitoring-only by default; never auto-trade

Each strategy displays:

- Rule values
- Matching token count
- Last evaluation time
- Why each token matched
- Missing/stale evidence
- Duplicate-to-custom action

### 7.6 Custom curated lists

Extend the current custom-list backend and UI to support:

- Rule-based lists
- Manual token lists
- Pinned tokens
- Permanent exclusions
- Included/excluded chains and sources
- Numeric ranges for age, market cap, liquidity, volume, holders, distribution, and price change
- Flow thresholds for smart wallets, whales, snipers, and fresh wallets
- Social/website requirements
- Sort order
- Refresh cadence
- Alerts for new matches, score changes, price moves, or risk changes

Example rule set:

```text
Age < 30 minutes
AND Volume (5m) > $10,000
AND Buys / Sells > 1.25
AND Liquidity > $20,000
AND Top 10 holders < 35%
AND Bundlers < 20%
```

### 7.7 Token detail workspace

Include:

- Candlestick or line chart with 1m, 5m, 15m, 1h, 4h, and 1d ranges as supported
- Market summary
- Pool and route information
- Recent buys and sells
- Holder distribution
- Developer profile
- Strategy matches
- Risk/safety checks with evidence
- External links
- Watchlist notes and alerts

Use a proven charting library already compatible with React. Avoid custom financial chart logic.

## 8. Trading Workflows

### 8.1 Execution wallet selection

- Require one explicit execution wallet for an order.
- Allow wallet tags to filter or aggregate positions, but do not silently submit one order across every wallet in a tag.
- A future batch-trade mode must show per-wallet amounts, quotes, signatures, and outcomes.

### 8.2 Quick Buy

Controls:

- Selected wallet and available native balance
- Preset amounts and custom amount
- Slippage
- Priority fee/protected routing when supported
- Optional exit rules: take profit, stop loss, trailing stop, and maximum hold
- Quote route, price impact, expected output, minimum received, network fee, and quote expiry

Flow:

```text
Select amount -> request quote -> validate/simulate -> confirm -> sign
-> submit -> monitor receipt -> reconcile fill -> open/update position
```

### 8.3 Quick Sell

Controls:

- Available token balance
- 25%, 50%, 75%, 100%, and custom amount
- Slippage
- Expected proceeds, price impact, route, fees, and minimum received

Quick Sell must be disabled when the selected wallet has no sellable position or no supported route.

### 8.4 Limit Buy and Limit Sell

Form fields:

- Side
- Input/output asset
- Amount or position percentage
- Trigger/limit price
- Direction (`above` or `below`) when relevant
- Expiry
- Slippage/execution protections
- Optional exit rules for a filled buy

Order lifecycle:

```text
Draft -> Awaiting Signature -> Open -> Triggered -> Submitted
      -> Partially Filled -> Filled
      -> Cancelled | Expired | Failed
```

The current backend implements server-watched trigger orders. Keep that behavior accurately labeled, document that the backend must remain online, and surface its five-second polling/fill-gap tradeoff. Introduce provider-native persistent limit orders through the adapter only when supported.

### 8.5 Trade safety

Before submission:

- Confirm wallet and chain
- Refresh an expired quote
- Validate available balance
- Validate token allowance when applicable
- Simulate where supported
- Enforce user price-impact and slippage limits
- Show route and fees
- Warn on stale or missing risk data without presenting it as an execution guarantee

After submission:

- Persist the submitted transaction/order ID
- Monitor to a terminal state
- Reconcile actual amounts and fees
- Emit an activity event and alert
- Preserve failure details and retry eligibility

## 9. Positions, Orders, and PnL

### 9.1 Positions

Show:

- Token and chain
- Execution wallet
- Quantity
- Average entry price
- Current price
- Cost basis
- Current value
- Unrealized PnL amount and percentage
- Realized PnL
- Exit-rule status
- Quick Sell and Limit Sell actions

Allow filtering and aggregation by wallet tag while retaining wallet-level drill-down.

### 9.2 Orders

Show:

- Token and chain
- Wallet
- Buy/sell side
- Market/trigger/provider-limit type
- Trigger or limit price
- Original, filled, and remaining amount
- Status
- Created, triggered, filled, and expiry times
- Failure message
- Cancel action when legal
- Explorer or venue link

### 9.3 PnL accounting

Add immutable fill records and acquisition lots. Use FIFO as the initial, documented cost-basis method unless product requirements specify another method.

Calculate:

- Realized PnL
- Unrealized PnL
- Total PnL
- Fees and network costs
- PnL by token
- PnL by wallet
- PnL by wallet tag
- PnL by day/week/month/custom period
- Win rate
- Average win and loss
- Largest gain and loss
- Equity curve

The existing `positions.js` calculations should be migrated toward fill-based reconciliation. Token amount, cost basis, and proceeds must come from confirmed transaction results, including partial sells and fees.

## 10. Monad Disperse Redesign

### 10.1 Page layout

Desktop uses a two-column workflow:

```text
Recipients and transfer setup        Transaction summary
--------------------------------     -------------------
Network and asset                    Sender
Sender wallet                        Recipient count
Amount mode                          Total transfer
Recipient sources                    Estimated gas
Recipient table                      Balance remaining
                                      Review / Execute
```

On mobile, the summary becomes a collapsible sticky footer or full-screen review step.

### 10.2 Supported recipient sources

- Individual managed wallets
- One or more tags/groups
- Pasted addresses
- CSV upload
- Existing job duplication

### 10.3 Recipient resolution

When groups overlap:

- Deduplicate by normalized address and chain
- Preserve source metadata so the UI can explain which tags included a recipient
- Exclude the sender by default
- Allow manual exclusions after group resolution
- Re-resolve when tag membership changes until the draft is locked for review

### 10.4 Amount modes

- Equal amount per recipient
- Custom amount per recipient
- CSV-provided amounts

Support native MON first and configured ERC-20 tokens through the existing EVM planning/execution layer.

### 10.5 Review and execution

The final review must show:

- Monad network/chain ID
- Sender wallet
- Asset and decimals
- Deduplicated recipient count
- Per-recipient amount or custom total
- Total transfer amount
- Estimated network fee
- Required token approval, if any
- Available and estimated remaining balance
- Validation failures and warnings

Execution states:

```text
Draft -> Validating -> Awaiting Signature -> Submitted -> Confirming
      -> Completed | Partially Failed | Failed
```

### 10.6 History

Persist:

- Job ID and timestamps
- Sender, chain, and asset
- Recipient snapshot
- Amount mode and totals
- Transaction hashes
- Per-recipient or per-batch outcome
- Fees
- Failure details
- Final status

Allow duplicating any completed or failed job into a new editable draft.

### 10.7 Acceptance criteria

- Multiple selected tags resolve to one deduplicated list.
- Users can inspect and edit the resolved list before signing.
- Insufficient balance includes estimated fees in validation.
- Partial failure is distinct from full success/failure.
- Every submitted transaction has an explorer link and terminal status.

## 11. Mint Bot Alignment

- Apply the shared app shell and reference-derived list treatment.
- Replace isolated wallet selection with the shared wallet/tag selector.
- Show the resolved wallet count and exact wallets before task submission.
- Keep active, queued, completed, and failed jobs in one operational table.
- Reuse transaction statuses, alerts, confirmation modals, and activity history.
- Preserve current discovery and execution behavior unless separately changed by an NFT-specific requirement.
- Show unsupported contracts/chains explicitly instead of allowing an ambiguous mint attempt.

## 12. Backend and Persistence Work

### 12.1 Repository boundaries

Introduce repositories/services for:

- Wallets and tags
- Strategies and curated lists
- Watchlists and alerts
- Orders and fills
- Positions and portfolio snapshots
- Disperse drafts/jobs
- Mint jobs
- Activity/audit records

The frontend must consume backend-owned records for workflows that need to survive refresh or browser closure.

### 12.2 API additions

Plan versioned endpoints for:

- Wallet/tag CRUD and bulk membership updates
- Group resolution preview
- Strategy templates and user strategies
- Curated-list CRUD, pins, and exclusions
- Token search/details/chart/intelligence
- Quote, simulation, submission, and transaction status
- Positions, orders, fills, and PnL summaries
- Disperse draft validation and job execution
- Unified activity history

### 12.3 Realtime events

Extend the current event/WebSocket mechanism for:

- Market/token updates
- Strategy match changes
- Quote expiry
- Order status
- Position/PnL updates
- Disperse job progress
- Mint job progress
- Provider/RPC health

All event consumers must recover by refetching current server state after reconnecting.

### 12.4 Audit requirements

Record:

- Strategy evaluation inputs and result
- User trade intent
- Quote and simulation summary
- Signing/submission timestamps
- Actual receipt/fill
- Limit-order trigger and attempt history
- Disperse recipient snapshot and result
- Wallet/tag membership changes
- User-visible failure reason

Never record secrets or full private-key material.

## 13. Testing Strategy

### 13.1 Unit tests

- Tag name normalization and merge behavior
- Group resolution and recipient deduplication
- Strategy-rule evaluation
- Missing versus zero signal values
- Risk/potential explanation generation
- Quote expiration and trade validation
- Limit-order state transitions
- Position-lot and FIFO PnL calculations
- Partial sell and fee accounting
- Disperse totals and balance validation

### 13.2 Integration tests

- Wallet/tag API and UI flows
- Existing custom-list endpoints with extended rules
- Market-data normalization from provider fixtures
- Quote -> submit -> receipt -> fill -> position lifecycle
- Trigger order -> execution -> fill/failure lifecycle
- Reconnect and state refetch
- Disperse validation -> execution -> job status lifecycle
- Mint task creation using a tag group

### 13.3 End-to-end tests

- Create wallets, create a tag, and bulk-assign wallets
- Use that tag in Monad Disperse and verify deduplication
- Open a default strategy and inspect why a token matched
- Duplicate and edit a curated strategy
- Quick Buy in paper/test mode and verify the position/PnL view
- Place/cancel a limit order and verify the order history
- Quick Sell part of a position and verify lot/PnL reconciliation
- Create a Mint Bot task with a tag group

### 13.4 Failure cases

- Wallet rejects signature
- Wrong network
- Quote expires before signing
- Price moves past limits
- RPC/provider timeout
- Backend restarts while trigger orders are open
- Token market data becomes stale
- No sell route exists
- Partial fill or partial sell
- Insufficient balance after fee estimation
- Duplicate and invalid Disperse recipients
- Partial Disperse failure

### 13.5 Visual and accessibility checks

- Desktop widths: 1280, 1440, and 1920
- Mobile widths: 360, 390, and 430
- No overlapping terminal panels or truncated button labels
- Keyboard-accessible tables, tabs, dialogs, and order controls
- Visible focus states
- Screen-reader labels for icon-only actions
- Color is not the only status indicator
- Loading, empty, error, disconnected, and stale-data states are visually verified

## 14. Delivery Phases

### Phase 0: Audit and design foundation

1. Map existing UI/API contracts and identify reusable functionality.
2. Extract visual rules from all reference images.
3. Add design tokens and shared app shell.
4. Consolidate status, modal, table, address, and selector components.
5. Add frontend smoke tests for every primary route.

**Exit:** Existing functionality runs inside the redesigned shell without regressions.

### Phase 1: Wallets and tags

1. Add durable wallet/tag records and APIs.
2. Build wallet table, tag filters, group view, and bulk actions.
3. Add shared wallet/tag selectors.
4. Migrate current `walletGroups` local state without losing existing user data.

**Exit:** Tags are the single reusable group model across the application.

### Phase 2: Meme Finder scanner and strategies

1. Normalize token/provider data.
2. Redesign scanner and token detail workspace.
3. Ship default strategy templates.
4. Extend custom lists with pins, exclusions, ranges, and alerts.
5. Add explainability and freshness states.

**Exit:** Users can discover, filter, save, and explain tokens without trading.

### Phase 3: Portfolio and paper trading

1. Add fills and position-lot records.
2. Build Positions, Orders, History, and PnL tabs.
3. Reconcile wallet activity.
4. Implement Quick Buy/Sell in dry-run or test mode.
5. Validate PnL against deterministic fixtures.

**Exit:** Paper/test trades produce accurate positions, orders, and PnL.

### Phase 4: Live quick trading

1. Add executable quotes and simulation.
2. Implement connected-wallet signing.
3. Track transaction receipts and actual fills.
4. Add live-mode safeguards, limits, and kill switch.

**Exit:** Quick Buy/Sell passes testnet and narrowly scoped live acceptance tests.

### Phase 5: Limit orders

1. Redesign current trigger-order UI and accurate labeling.
2. Persist and recover open orders across backend restarts.
3. Add provider-native limit-order adapters where supported.
4. Add cancel, expiry, retry, and fill reconciliation.

**Exit:** Orders reach correct terminal states without relying on an open browser tab.

### Phase 6: Monad Disperse

1. Apply redesigned setup/review layout.
2. Connect tag-based recipient resolution.
3. Add deduplication, exclusions, CSV/custom amounts, and preflight summary.
4. Improve progress, partial-failure reporting, and history.

**Exit:** Audited testnet disperse succeeds for native MON and supported ERC-20 flows.

### Phase 7: Mint Bot alignment

1. Apply shared design system.
2. Connect shared wallet/tag selector.
3. Unify job status and activity feedback.

**Exit:** Mint tasks can safely resolve wallet groups and report per-wallet outcomes.

### Phase 8: Hardening and release

1. Complete security review.
2. Run performance tests for large wallet/token lists.
3. Run accessibility and responsive visual checks.
4. Add provider health monitoring and operational alerts.
5. Complete paper/testnet soak periods before broad live trading.

**Exit:** All release acceptance criteria below pass.

## 15. Release Acceptance Criteria

### Shared experience

- All primary pages use one consistent shell and visual system.
- Navigation and critical workflows work on desktop and mobile.
- Loading, empty, error, stale, disconnected, and transaction states are implemented.

### Wallets

- Wallets support multiple tags.
- Tags are reusable in all applicable workflows.
- Tag membership is durable and case-safe.
- Security-sensitive data is not exposed in the UI or logs.

### Meme Finder

- The scanner supports chain-aware identity, filtering, sorting, and stale-data states.
- Default strategies are editable templates with explicit match reasons.
- Users can create custom curated lists with pins and exclusions.
- Supplied alert fields map into structured token intelligence.
- Positions, orders, history, and PnL are available in the terminal.
- Quick Buy/Sell uses live validation, quotes, signing, and receipt tracking.
- Limit orders are persistent server/provider orders and accurately described.
- PnL reconciles from actual fills and relevant fees.

### Monad Disperse

- MON and configured ERC-20 flows support individual and tag-based recipients.
- Overlapping groups are deduplicated.
- Users see the final recipient set, totals, fees, and balance before signing.
- Job history records partial and complete results.

### Mint Bot

- Mint tasks use the shared wallet/tag selector.
- Resolved wallets are previewed before execution.
- Job status and per-wallet outcomes use shared activity components.

### Operations and safety

- Open jobs and orders survive browser refresh and backend restart where promised.
- Provider failures and stale data are visible.
- Live trading has explicit enablement and risk limits.
- Automated actions have an audit trail.
- Unit, integration, end-to-end, and failure-recovery tests pass.

## 16. Out of Scope for the Initial Release

- Silent multi-wallet trade execution from a tag selection
- Custodial private-key management without a separate security design
- Claims of support for every chain or DEX
- Guaranteed safety/profit scores
- Custom-built charting or pricing engines where established providers/libraries exist
- Provider-native limit orders on chains/venues that do not support them
- Tax reporting beyond exported fill and PnL records

## 17. Recommended First Implementation Slice

The first code slice should prove the cross-product foundation without enabling new live risk:

1. Add the redesigned shell and shared tokens/components.
2. Add durable wallet tags and migrate current wallet groups.
3. Redesign Wallet Management around tags.
4. Redesign Meme Finder scanner with default strategies and structured alert fields.
5. Add read-only Positions, Orders, and PnL tabs using current backend data.
6. Connect tags to Monad Disperse recipient preview.
7. Verify desktop/mobile layouts and existing test suites.

This slice produces immediate UX value, validates the shared data model, and creates the foundation required before expanding live trade execution.
