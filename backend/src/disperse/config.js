const DISPERSE_CONTRACT = '0xD152f549545093347A162Dce210e7293f1452150';

function bytecodeHash(chain) {
  return process.env[`DISPERSE_BYTECODE_HASH_${chain.toUpperCase()}`]
    || process.env.DISPERSE_BYTECODE_HASH
    || null;
}

export const DISPERSE_CHAINS = [
  { id: 'eth', name: 'Ethereum', family: 'evm', chainId: 1, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_ETH || 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('eth'), maxRecipientsPerTx: 200, gasReserveWei: '3000000000000000',
    tokens: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    } },
  { id: 'base', name: 'Base', family: 'evm', chainId: 8453, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_BASE || 'https://mainnet.base.org', explorer: 'https://basescan.org',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('base'), maxRecipientsPerTx: 300, gasReserveWei: '300000000000000',
    tokens: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    } },
  { id: 'arb', name: 'Arbitrum', family: 'evm', chainId: 42161, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_ARB || 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('arb'), maxRecipientsPerTx: 300, gasReserveWei: '300000000000000',
    tokens: {
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    } },
  { id: 'op', name: 'Optimism', family: 'evm', chainId: 10, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_OP || 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('op'), maxRecipientsPerTx: 300, gasReserveWei: '300000000000000',
    tokens: {
      USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      USDT: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    } },
  { id: 'polygon', name: 'Polygon', family: 'evm', chainId: 137, symbol: 'POL', decimals: 18,
    rpc: process.env.RPC_POLYGON || 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('polygon'), maxRecipientsPerTx: 300, gasReserveWei: '30000000000000000',
    tokens: {
      USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    } },
  { id: 'bsc', name: 'BSC', family: 'evm', chainId: 56, symbol: 'BNB', decimals: 18,
    rpc: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('bsc'), maxRecipientsPerTx: 300, gasReserveWei: '2000000000000000',
    tokens: {
      USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    } },
  { id: 'avax', name: 'Avalanche', family: 'evm', chainId: 43114, symbol: 'AVAX', decimals: 18,
    rpc: process.env.RPC_AVAX || 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('avax'), maxRecipientsPerTx: 300, gasReserveWei: '20000000000000000',
    tokens: {
      USDC: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c4a86E', decimals: 6 },
      USDT: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    } },
  { id: 'monad', name: 'Monad', family: 'evm', chainId: 143, symbol: 'MON', decimals: 18,
    rpc: process.env.RPC_MONAD || 'https://rpc.monad.xyz', explorer: 'https://monadscan.com',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: bytecodeHash('monad'), maxRecipientsPerTx: 300, gasReserveWei: '1000000000000000000',
    tokens: {} },
  { id: 'sol', name: 'Solana', family: 'sol', symbol: 'SOL', decimals: 9,
    rpc: process.env.RPC_SOL || 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io',
    maxRecipientsPerTx: 20, gasReserveLamports: '10000000',
    tokens: {
      USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    } },
];

export const EVM_CHAIN_IDS = Object.fromEntries(
  DISPERSE_CHAINS.filter(c => c.family === 'evm').map(c => [c.chainId, c.id]),
);

export function getDisperseChain(id) {
  return DISPERSE_CHAINS.find(c => c.id === id) || null;
}

export function getToken(chainId, symbol) {
  const chain = getDisperseChain(chainId);
  if (!chain) return null;
  if (symbol === 'NATIVE') return { symbol: chain.symbol, address: 'NATIVE', decimals: chain.decimals };
  const t = chain.tokens?.[symbol];
  return t ? { symbol, address: t.address, decimals: t.decimals } : null;
}
