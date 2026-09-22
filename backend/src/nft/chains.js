// NFT-side chain metadata (OpenSea chain names differ from disperse ids).
//
// Discovery and execution are deliberately separate. A chain can remain in
// this table so its drops can be displayed while still being manual-only for
// mint execution until an adapter has been reviewed and enabled.
export const NFT_SALE_ADAPTERS = Object.freeze({
  'opensea-rest': Object.freeze({
    id: 'opensea-rest',
    source: 'OpenSea REST drops/mint endpoint',
    requiresEndpointCalldata: true,
  }),
});

// These are the chains for which the reviewed OpenSea REST mint adapter is
// enabled. Other configured chains are discovery-only/manual-only.
const OPENSEA_REST_MINT_CHAINS = new Set([
  'ethereum', 'base', 'arbitrum', 'optimism', 'polygon',
  'bsc', 'avalanche', 'zora',
]);

const rawChainConfig = {
  ethereum:  { chainId: 1,       rpc: process.env.RPC_ETH || 'https://ethereum-rpc.publicnode.com',       explorer: 'https://etherscan.io' },
  base:      { chainId: 8453,     rpc: process.env.RPC_BASE || 'https://mainnet.base.org',                 explorer: 'https://basescan.org' },
  arbitrum:  { chainId: 42161,   rpc: process.env.RPC_ARB || 'https://arb1.arbitrum.io/rpc',              explorer: 'https://arbiscan.io' },
  optimism:  { chainId: 10,       rpc: process.env.RPC_OP || 'https://mainnet.optimism.io',                explorer: 'https://optimistic.etherscan.io' },
  polygon:   { chainId: 137,      rpc: process.env.RPC_POLYGON || 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com' },
  bsc:       { chainId: 56,       rpc: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org',          explorer: 'https://bscscan.com' },
  avalanche: { chainId: 43114,    rpc: process.env.RPC_AVAX || 'https://api.avax.network/ext/bc/C/rpc',    explorer: 'https://snowtrace.io' },
  zora:      { chainId: 7777777,  rpc: process.env.RPC_ZORA || 'https://rpc.zora.energy',                  explorer: 'https://explorer.zora.energy' },
  robinhood: { chainId: 4663,     rpc: process.env.RPC_ROBINHOOD || 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  megaeth:   { chainId: 634,      rpc: process.env.RPC_MEGAETH || 'https://rpc.megaeth.com',               explorer: 'https://megaeth.io/explorer' },
  shape:     { chainId: 360,      rpc: process.env.RPC_SHAPE || 'https://rpc.shape.network',              explorer: 'https://shape.network/explorer' },
  ape_chain: { chainId: 33139,    rpc: process.env.RPC_APE || 'https://rpc.apechain.com',                  explorer: 'https://apescan.io' },
};

export const NFT_CHAIN_CONFIG = Object.freeze(Object.fromEntries(
  Object.entries(rawChainConfig).map(([name, config]) => [name, Object.freeze({
    ...config,
    mintAdapter: OPENSEA_REST_MINT_CHAINS.has(name) ? 'opensea-rest' : null,
    discoveryOnly: !OPENSEA_REST_MINT_CHAINS.has(name),
    manualOnlyReason: OPENSEA_REST_MINT_CHAINS.has(name)
      ? null
      : 'No reviewed NFT sale adapter is enabled for this chain',
  })]),
));

export function getNftChain(name) {
  return NFT_CHAIN_CONFIG[name] || null;
}

export function getNftExecutionSupport(chainName, saleAdapter = 'opensea-rest') {
  const chain = getNftChain(chainName);
  if (!chain) return { supported: false, reason: `Unknown chain ${chainName}` };
  if (!NFT_SALE_ADAPTERS[saleAdapter]) {
    return { supported: false, reason: `Unsupported NFT sale adapter ${saleAdapter}` };
  }
  if (chain.mintAdapter !== saleAdapter) {
    return {
      supported: false,
      reason: chain.manualOnlyReason || `NFT minting is manual-only on ${chainName}`,
    };
  }
  return { supported: true, chain, adapter: NFT_SALE_ADAPTERS[saleAdapter] };
}

export function getNftSaleAdapter(drop = {}) {
  return drop.saleAdapter || drop.execution?.saleAdapter ||
    (drop.source === 'opensea-rest' ? 'opensea-rest' : null);
}
