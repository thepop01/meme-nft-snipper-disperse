// NFT-side chain metadata (OpenSea chain names differ from disperse ids).
export const NFT_CHAIN_CONFIG = {
  ethereum:  { chainId: 1,        rpc: process.env.RPC_ETH || 'https://ethereum-rpc.publicnode.com',     explorer: 'https://etherscan.io' },
  base:      { chainId: 8453,     rpc: process.env.RPC_BASE || 'https://mainnet.base.org',               explorer: 'https://basescan.org' },
  arbitrum:  { chainId: 42161,    rpc: process.env.RPC_ARB || 'https://arb1.arbitrum.io/rpc',            explorer: 'https://arbiscan.io' },
  optimism:  { chainId: 10,       rpc: process.env.RPC_OP || 'https://mainnet.optimism.io',              explorer: 'https://optimistic.etherscan.io' },
  polygon:   { chainId: 137,      rpc: process.env.RPC_POLYGON || 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com' },
  bsc:       { chainId: 56,       rpc: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org',        explorer: 'https://bscscan.com' },
  avalanche: { chainId: 43114,    rpc: process.env.RPC_AVAX || 'https://api.avax.network/ext/bc/C/rpc',  explorer: 'https://snowtrace.io' },
  zora:      { chainId: 7777777,  rpc: process.env.RPC_ZORA || 'https://rpc.zora.energy',                explorer: 'https://explorer.zora.energy' },
  robinhood: { chainId: 4663,     rpc: process.env.RPC_ROBINHOOD || 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  megaeth:   { chainId: 634,      rpc: process.env.RPC_MEGAETH || 'https://rpc.megaeth.com',             explorer: 'https://megaeth.io/explorer' },
  shape:     { chainId: 360,      rpc: process.env.RPC_SHAPE || 'https://rpc.shape.network',             explorer: 'https://shape.network/explorer' },
  ape_chain: { chainId: 33139,    rpc: process.env.RPC_APE || 'https://rpc.apechain.com',                explorer: 'https://apescan.io' },
};

export function getNftChain(name) {
  return NFT_CHAIN_CONFIG[name] || null;
}
