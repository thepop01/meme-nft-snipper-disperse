// Chain metadata for sender-wallet balance display.
export const CHAINS = [
  { id: 'eth',     name: 'Ethereum',  family: 'evm', symbol: 'ETH',
    rpc: 'https://eth.llamarpc.com',            explorer: 'https://etherscan.io' },
  { id: 'base',    name: 'Base',      family: 'evm', symbol: 'ETH',
    rpc: 'https://mainnet.base.org',            explorer: 'https://basescan.org' },
  { id: 'arb',     name: 'Arbitrum',  family: 'evm', symbol: 'ETH',
    rpc: 'https://arb1.arbitrum.io/rpc',        explorer: 'https://arbiscan.io' },
  { id: 'op',      name: 'Optimism',  family: 'evm', symbol: 'ETH',
    rpc: 'https://mainnet.optimism.io',         explorer: 'https://optimistic.etherscan.io' },
  { id: 'polygon', name: 'Polygon',   family: 'evm', symbol: 'POL',
    rpc: 'https://polygon-rpc.com',             explorer: 'https://polygonscan.com' },
  { id: 'bsc',     name: 'BSC',       family: 'evm', symbol: 'BNB',
    rpc: 'https://bsc-dataseed.binance.org',    explorer: 'https://bscscan.com' },
  { id: 'avax',    name: 'Avalanche', family: 'evm', symbol: 'AVAX',
    rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' },
  { id: 'sol',     name: 'Solana',    family: 'sol', symbol: 'SOL',
    rpc: 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io' },
  { id: 'monad',   name: 'Monad',     family: 'evm', symbol: 'MON',
    rpc: 'https://rpc.monad.xyz',              explorer: 'https://monadscan.com' },
];

export function getChain(id) {
  return CHAINS.find(c => c.id === id) || null;
}
