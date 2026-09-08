import { MarketDataAdapter, PortfolioAdapter, TradeExecutionAdapter, normalizeTokenRef } from './contracts.js';
import { getToken, getTokens } from '../discovery/registry.js';
import { getPositions, getTrades } from '../engine/positions.js';
import { getFills, pnlSummary } from '../engine/accounting.js';
import { config } from '../config.js';

const RANGE_MS = { '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 3600_000, '4h': 4 * 3600_000, '1d': 86400_000 };

function withIdentity(token) {
  if (!token) return null;
  const ref = normalizeTokenRef({ chainId: token.chain || 'solana', tokenAddress: token.mint });
  return {
    ...token,
    tokenRef: ref,
    freshness: {
      market: { source: token.source || 'unknown', updatedAt: token.enrichedAt || null },
      risk: { source: token.safety?.provider || 'internal', updatedAt: token.analyzedAt || null },
      attention: { source: token.attentionSource || 'DexScreener', updatedAt: token.attentionUpdatedAt || null },
    },
  };
}

export class RegistryMarketDataAdapter extends MarketDataAdapter {
  async searchTokens(query = {}) {
    const needle = String(query.query || '').toLowerCase();
    return getTokens({ view: query.view || 'all', chain: query.chainId })
      .filter(token => !needle || `${token.name || ''} ${token.symbol || ''} ${token.mint}`.toLowerCase().includes(needle))
      .slice(0, Math.min(300, Number(query.limit) || 100)).map(withIdentity);
  }

  async getTokenOverview(input) {
    const ref = normalizeTokenRef(input);
    return withIdentity(getToken(ref.tokenAddress, ref.chainId));
  }

  async getChart(input, range = '1h') {
    const token = await this.getTokenOverview(input);
    if (!token) return [];
    const cutoff = Date.now() - (RANGE_MS[range] || Infinity);
    return (token.history || []).filter(point => point.ts >= cutoff && point.priceUsd > 0)
      .map(point => ({ time: point.ts, close: point.priceUsd, liquidityUsd: point.liquidityUsd, marketCapUsd: point.marketCapUsd }));
  }

  async getPools(input) {
    const token = await this.getTokenOverview(input);
    return token?.pairAddress ? [{ address: token.pairAddress, dex: token.dexId || token.source, liquidityUsd: token.liquidityUsd, url: token.poolUrl }] : [];
  }

  async getHolderMetrics(input) {
    const token = await this.getTokenOverview(input);
    return token ? { holderCount: token.holderCount ?? null, top10HolderPct: token.top10HolderPct ?? null, bundlerPct: token.bundlerPct ?? null, source: token.holderSource || 'analysis', updatedAt: token.analyzedAt || null } : null;
  }

  async getDeveloperMetrics(input) {
    const token = await this.getTokenOverview(input);
    return token ? { address: token.developer?.address || token.creator || null, createdCount: token.developer?.createdCount ?? token.creatorTokenCount ?? null, relatedTokenCount: token.developer?.relatedTokenCount ?? null, source: token.developer?.source || 'analysis', updatedAt: token.analyzedAt || null } : null;
  }
}

export class LocalTradeExecutionAdapter extends TradeExecutionAdapter {
  capabilities(chainId) {
    if (chainId !== 'solana') return { quickBuy: false, quickSell: false, serverTrigger: false, providerLimit: false, reason: 'Execution provider not configured' };
    return {
      quickBuy: true, quickSell: true,
      connectedWallet: !config.dryRun && !config.allowServerSigner,
      paper: config.dryRun,
      serverTrigger: config.dryRun || config.allowServerSigner,
      providerLimit: false,
      triggerPollMs: 5000,
      warning: 'Server trigger orders can gap past their trigger and require the backend to remain online.',
    };
  }
}

export class LocalPortfolioAdapter extends PortfolioAdapter {
  async syncWallet(wallet) {
    const walletAddress = String(wallet.address || wallet.walletAddress || '').toLowerCase();
    const positions = getPositions().filter(position => String(position.walletAddress || '').toLowerCase() === walletAddress);
    const fills = getFills({ walletAddress });
    return { walletAddress, positions, fills, pnl: pnlSummary({ walletAddress }), syncedAt: Date.now() };
  }
  async getBalances(wallet) { return (await this.syncWallet(wallet)).positions.filter(position => position.status === 'open').map(position => ({ tokenAddress: position.mint, quantity: position.tokenAmount })); }
  async getActivity(wallet) { const address = String(wallet.address || '').toLowerCase(); return getTrades().filter(trade => String(trade.walletAddress || '').toLowerCase() === address); }
  async reconcileFills(wallet) { return getFills({ walletAddress: wallet.address }); }
}

export const marketDataAdapter = new RegistryMarketDataAdapter();
export const executionAdapter = new LocalTradeExecutionAdapter();
export const portfolioAdapter = new LocalPortfolioAdapter();
