# Meme Token Sniper, NFT Mint Bot & Disperse Engine

A multi-chain Web3 operations suite featuring an automated meme token discovery & sniping terminal, an OpenSea allowlist/public NFT minting engine, and a high-performance multi-wallet asset disperse system.

---

## Features

### 1. Meme Token Sniper & Discovery Terminal
- **Dynamic Scoring Engine**: Evaluates tokens based on liquidity, market cap, creator activity, funding graphs, and holder distribution.
- **Live Event Tape**: Ingests new pair creation, swap events, and liquidity movements into a SQLite-backed event tape.
- **Smart Wallet Tracker**: Identifies and monitors profitable smart wallets and copy-trade opportunities.
- **Trading Execution**: Fast swap execution with custom slippage, gas presets, and auto-slippage controls.

### 2. Multi-Chain NFT Mint Bot
- **OpenSea SeaDrop & Allowlist Reverse Engineering**: Server-side calldata fetching and transaction construction for rapid FCFS minting.
- **Multi-Chain Support**: Ethereum, Base, Polygon, Arbitrum, BSC, Optimism, and Sepolia testnets.
- **Automated Scheduling**: Scheduled mint triggers with automated gas bidding and multi-wallet distribution.

### 3. Disperse Engine
- **Batch Transfers**: Disperse native tokens (ETH/BNB) and ERC-20 tokens to hundreds of recipients in a single transaction or coordinated wallet batches.
- **Wallet Directory & Vault**: Local client-side encrypted wallet management and sender wallet presets.
- **Fee Optimization**: Gas estimation, multi-network RPC configuration, and status tracking.

---

## Project Structure

```
├── backend/            # Express.js API, SQLite event tape, scoring & runner services
│   ├── src/
│   │   ├── memefinder/ # Meme token ingestion & route handlers
│   │   ├── nft/        # NFT drop tracking & mint executor
│   │   ├── scoring/    # Token admission & scoring pipeline
│   │   ├── tape/       # SQLite database & transaction tape
│   │   └── wallets/    # Vault management
│   └── server.js
├── frontend/           # Vite + React UI terminal with modern cyber-trading dashboard
│   ├── src/
│   │   ├── components/ # Views: Sniper, Disperse, NFT Mint, Wallets, Terminal
│   │   └── utils/      # API clients, web3 helpers, and wallet store
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