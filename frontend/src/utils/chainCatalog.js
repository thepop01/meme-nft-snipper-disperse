import { UMI_CHAINS } from '../components/ui/ChainBar.jsx';

// ChainBar UI ids → disperse backend ids (backend/src/disperse/config.js). Null = unsupported.
export const CHAIN_BAR_TO_DISPERSE = {
  ethereum: 'eth',
  base: 'base',
  arbitrum: 'arb',
  optimism: 'op',
  polygon: 'polygon',
  bsc: 'bsc',
  avalanche: 'avax',
  solana: 'sol',
  monad: 'monad',
};

export const DISPERSE_SUPPORTED_LABELS =
  'Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Solana or Monad';

// ChainBar UI ids → wallet-balances backend names (POST /api/wallets/balances → getNftChain). Null = unsupported.
export const CHAIN_BAR_TO_BALANCES = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  polygon: 'polygon',
  bsc: 'bsc',
  avalanche: 'avalanche',
  zora: 'zora',
  apechain: 'ape_chain',
  robinhood: 'robinhood',
};

export const disperseChainFor = barId => CHAIN_BAR_TO_DISPERSE[barId] ?? null;
export const balanceChainFor = barId => CHAIN_BAR_TO_BALANCES[barId] ?? null;
export const chainLabelFor = (barId, fallback = barId) =>
  (UMI_CHAINS.find(c => c.id === barId)?.label ?? fallback);
