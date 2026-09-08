// Smart-wallet finder sources (Solana + Robinhood/EVM).
// Primary: pump.fun leaderboard, fomo.family (via fomoapi.io), GMGN smart money.
// Extras under review: Cielo, Arkham, Birdeye.
//
// Design notes from docs/context for meme filter.md + strategy docs:
// - Prefer official API/CLI over scraping (Cloudflare blocks datacenter scraping).
// - GMGN access is backend-only via gmgn-cli --raw + GMGN_API_KEY env.
// - Tokens keyed by (chainId, tokenAddress); wallets keyed by (chain, address).
// - Discovery never buys; finder only records observations for the tracker.

export const SMART_WALLET_SOURCES = [
  {
    id: 'pumpfun-leaderboard',
    label: 'pump.fun leaderboard',
    chains: ['solana'],
    kind: 'leaderboard',
    // Public page: https://pump.fun/leaderboard (PnL windows 1D/1W/1M).
    // No stable public REST; use profile/swap/market APIs or SolanaTracker
    // PnL v2 (GET /v2/pnl/leaderboard) where configured. Scraping is fallback only.
    endpoint: 'https://pump.fun/leaderboard',
    apiHint: 'solanatracker /v2/pnl/leaderboard or pump.fun profile-api (reverse-engineered)',
  },
  {
    id: 'fomo-leaderboard',
    label: 'fomo.family leaderboard (fomoapi.io)',
    chains: ['solana', 'robinhood'],
    kind: 'leaderboard',
    // Independent REST layer for fomo.family social trading data.
    // GET /v2/leaderboard/{24h|7d|30d|all} returns handle + solana/evm wallets + pnlUsd.
    endpoint: 'https://api.fomoapi.io/v2/leaderboard/30d',
    docs: 'https://fomoapi.io/docs',
  },
  {
    id: 'gmgn-smart-money',
    label: 'GMGN smart money',
    chains: ['solana', 'robinhood'],
    kind: 'onchain-intelligence',
    // Backend-only via gmgn-cli --raw (GMGN_API_KEY in backend/.env).
    // Fields: smart_degen_count, rug_ratio, bundler_rate, top_10_holder_rate.
    endpoint: 'gmgn-cli (market trending --raw / trenches --raw)',
  },
  {
    id: 'cielo',
    label: 'Cielo (under review)',
    chains: ['solana', 'robinhood'],
    kind: 'wallet-labels',
    status: 'research',
  },
  {
    id: 'arkham',
    label: 'Arkham (under review)',
    chains: ['robinhood'],
    kind: 'wallet-labels',
    status: 'research',
  },
  {
    id: 'birdeye',
    label: 'Birdeye top traders (under review)',
    chains: ['solana'],
    kind: 'market-data',
    status: 'research',
  },
];

export function sourcesForChain(chain) {
  return SMART_WALLET_SOURCES.filter(s => s.chains.includes(chain));
}
