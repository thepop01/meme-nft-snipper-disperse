# Meme Token Sniper, NFT Mint Bot & Disperse Engine

A high-assurance multi-chain Web3 operations suite featuring an automated meme token discovery & sniping terminal with tri-state safety gates, an OpenSea REST allowlist/public NFT minting engine, and a high-performance multi-wallet asset disperse system.

---

## Features

### 1. Meme Token Sniper & Discovery Terminal
- **Tri-State Admission Engine (`pass`, `fail`, `unknown`)**: Evaluates tokens with a strict fail-closed safety gate. Required checks (`mintOwner`, `mintAuthority`, `freezeAuthority`, `sellRoute`, and Token-2022 extensions) must explicitly pass before qualification or buy execution.
- **SPL Token-2022 Deep TLV Inspection**: Inspects on-chain TLV extension blocks directly to detect and block malicious transfer hooks, permanent delegates, non-transferable flags, and hidden transfer fee extensions.
- **Two-Phase Durable Transaction Submission**: Tracks transaction lifecycle states (`prepared` -> `submitted` -> `confirmed` / `failed` / `unknown`) with pre-submit error classification and signature reconciliation, preventing double-spend and duplicate rebroadcasts upon RPC transport drops.
- **Dynamic Scoring & Event Tape**: Ingests new pair creation, swap events, and liquidity movements into a SQLite-backed event tape with structured observation windows (1, 3, 8, and 15 minutes).
- **Smart & Tracked Wallet Intelligence Terminal**: 4-tier onchain wallet intelligence (Smart Degens, Tracked Candidates, >$5k Whales, Lineage Funder Trees) across Solana and Robinhood Chain with a unified 7-column execution metric layout (PnL, Win Rate, Buy/Win, Avg Buy Mcap, Avg Sell Mcap, Avg Holding Time).
- **ATH ≥ $1M Runner & 25% ATH Early Buyer Engine**: Dual-method early buyer ingestion (`buying_mcap` ≤ 25% ATH and `first_n_buyers` quota) with mandatory closed trade profitability gates, one-click Tracked-to-Smart promotion, and automated/manual execution metrics backfill (`node backend/scripts/backfill-metrics.js`).

### 2. Multi-Chain NFT Mint Bot
- **OpenSea REST Sale Adapters & Simulation**: Safe server-side drop execution supporting verified OpenSea REST sale adapters. Every transaction is pre-simulated (`provider.call`) with native-value caps, gas fee caps, and target address validation before broadcast.
- **Execution Support Classification**: Explicitly flags drops as `discover-and-execute`, `discover-only`, or `manual-only`. Unreviewed or custom sale contracts are blocked from automated execution.
- **Secure Backend Execution**: Browser-side client signing from local storage is deprecated and disabled for safety; scheduled mints run through durable server-side jobs with full audit trails.
- **Multi-Chain Support**: Ethereum, Base, Polygon, Arbitrum, BSC, Optimism, Avalanche C-Chain, and Zora.

### 3. Disperse Engine
- **Batch Transfers**: Disperse native tokens (ETH/BNB/SOL) and ERC-20 tokens to hundreds of recipients in a single transaction or coordinated wallet batches.
- **Wallet Directory & Vault**: Local client-side encrypted wallet management and sender wallet presets.
- **Fee Optimization**: Gas estimation, multi-network RPC configuration, and status tracking.

### 4. API & Network Security Boundaries
- **Timing-Safe Authentication**: Constant-time Bearer token authentication (`crypto.timingSafeEqual`) on REST endpoints and WebSocket subprotocols (`Sec-WebSocket-Protocol: bearer.<token>`).
- **CORS Allowlist Enforcement**: Strict origin matching against configured origins (wildcards prohibited).
- **Credential Masking**: Automatic stripping of sensitive keys and credentials from logged RPC endpoints.

---

## Project Structure

```
├── backend/            # Express.js API, SQLite event tape, scoring & runner services
│   ├── src/
│   │   ├── analysis/   # Safety checks, Token-2022 parsing, clone detection, lists
│   │   ├── discovery/  # Solana & EVM feeds, baseline controllers, RPC observers
│   │   ├── engine/     # Bot manager, limit orders, positions, accounting
│   │   ├── memefinder/ # Meme token ingestion & route handlers
│   │   ├── nft/        # NFT drop tracking, OpenSea adapters, simulation & executor
│   │   ├── tape/       # SQLite database & transaction tape
│   │   ├── trading/    # Swap executor, transaction safety & idempotency
│   │   └── wallets/    # Vault management & repository
│   └── server.js
├── frontend/           # Vite + React UI terminal with modern cyber-trading dashboard
│   ├── src/
│   │   ├── components/ # Views: Sniper, Disperse, NFT Mint, Wallets, Terminal
│   │   └── utils/      # API clients, web3 helpers, and wallet store
│   └── server.js       # Production static preview server
├── docs/               # Architecture specs, review reports, and design plans
├── scripts/            # Strategy analysis and automation scripts
└── docker-compose.yml  # Container orchestration for backend & frontend
```

---

## Getting Started

### Prerequisites
- Node.js (>= 18.x)
- npm or yarn

### 1. Clone & Configure

```bash
git clone https://github.com/thepop01/meme-nft-snipper-disperse.git
cd meme-nft-snipper-disperse
```

Copy example environment configurations:
```bash
# Backend configuration
cp backend/.env.example backend/.env

# Optional root configuration
cp .env.example .env
```

### 2. Backend Setup

```bash
cd backend
npm install
npm start
```
*Backend runs on `http://localhost:3001` by default.*

### 3. Frontend Setup

```bash
cd ../frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---

## Testing

```bash
# Run backend tests
cd backend
npm test

# Run frontend tests
cd frontend
npm test
```

---

## Security Note

- **Never commit your `.env` or private keys to version control.**
- Keys handled by the local vault are stored client-side or in local encrypted stores as configured. Always use testnets or burner wallets before mainnet deployments.

---

## License

MIT