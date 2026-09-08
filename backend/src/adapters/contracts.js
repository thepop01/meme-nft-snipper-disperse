export function normalizeTokenRef(input) {
  const chainId = String(input?.chainId || input?.chain || '').trim().toLowerCase();
  let tokenAddress = String(input?.tokenAddress || input?.address || input?.mint || '').trim();
  if (!chainId || !tokenAddress) throw new Error('chainId and tokenAddress are required');
  if (tokenAddress.startsWith('0x')) tokenAddress = tokenAddress.toLowerCase();
  return Object.freeze({ chainId, tokenAddress, key: `${chainId}:${tokenAddress}` });
}

export class MarketDataAdapter {
  async searchTokens() { throw new Error('searchTokens is not implemented'); }
  async getTokenOverview() { throw new Error('getTokenOverview is not implemented'); }
  async getChart() { throw new Error('getChart is not implemented'); }
  async getPools() { throw new Error('getPools is not implemented'); }
  async getHolderMetrics() { throw new Error('getHolderMetrics is not implemented'); }
  async getDeveloperMetrics() { throw new Error('getDeveloperMetrics is not implemented'); }
}

export class TradeExecutionAdapter {
  capabilities() { return { quickBuy: false, quickSell: false, serverTrigger: false, providerLimit: false }; }
  async getQuote() { throw new Error('getQuote is not implemented'); }
  async simulate() { throw new Error('simulate is not implemented'); }
  async submitSwap() { throw new Error('submitSwap is not implemented'); }
  async createLimitOrder() { throw new Error('Provider-native limit orders are not supported'); }
  async cancelOrder() { throw new Error('Provider-native limit orders are not supported'); }
}

export class PortfolioAdapter {
  async syncWallet() { throw new Error('syncWallet is not implemented'); }
  async getBalances() { throw new Error('getBalances is not implemented'); }
  async getActivity() { throw new Error('getActivity is not implemented'); }
  async reconcileFills() { throw new Error('reconcileFills is not implemented'); }
}
