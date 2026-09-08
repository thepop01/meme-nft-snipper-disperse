// Multi-chain meme pool discovery via GeckoTerminal free API.
// EVM terminal is Robinhood-only for now (chain 4663, ecosystem hood.run).
// https://docs.geckoterminal.com/api
import { emit, log } from '../bus.js';
import { registerToken } from './registry.js';

const BASE_URL = 'https://api.geckoterminal.com/api/v2';

// Supported chains and their GeckoTerminal network slugs.
// EVM terminal scope: Robinhood only. Add new EVM chains here when the
// product expands beyond Robinhood.
export const EVM_CHAINS = {
  robinhood: { networkSlug: 'robinhood', chainId: 4663, minLiquidityUsd: 5_000, ecosystem: 'hood.run' },
};

const POLL_INTERVAL_MS = 60_000; // 1 minute
let timers = {};

/**
 * Start polling GeckoTerminal for new pools on all configured EVM chains.
 */
export function startEvmFeeds() {
  for (const [chain, config] of Object.entries(EVM_CHAINS)) {
    startChainFeed(chain, config);
  }
}

/**
 * Stop all EVM feeds.
 */
export function stopEvmFeeds() {
  for (const [chain] of Object.entries(EVM_CHAINS)) {
    if (timers[chain]) {
      clearInterval(timers[chain]);
      delete timers[chain];
    }
  }
}

function startChainFeed(chain, config) {
  const seenPools = new Set();
  let page = 1;

  async function poll() {
    try {
      const url = `${BASE_URL}/networks/${config.networkSlug}/new_pools?page=${page}&include=base_token,quote_token,dex`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) {
        log('warn', `GeckoTerminal ${chain} returned ${res.status}`);
        return;
      }
      const data = await res.json();
      const pools = data?.data || [];
      const includedById = new Map((data?.included || []).map(item => [item.id, item]));

      for (const pool of pools) {
        const attrs = pool.attributes || {};
        const poolAddress = attrs.address;
        if (!poolAddress || seenPools.has(poolAddress)) continue;
        seenPools.add(poolAddress);
        const token = normalizeGeckoPool(pool, includedById, chain, config);
        if (token) registerToken(token);
      }

      log('info', `GeckoTerminal ${chain}: processed ${pools.length} new pools, ${seenPools.size} total seen`);
    } catch (err) {
      log('warn', `GeckoTerminal ${chain} poll failed: ${err.message}`);
    }
  }

  // Initial poll
  poll();
  // Recurring poll
  timers[chain] = setInterval(poll, POLL_INTERVAL_MS);
  timers[chain].unref?.();
}

// Stablecoins and wrapped native tokens to skip
const SKIP_SYMBOLS = new Set([
  'USDC', 'USDC.E', 'USDT', 'DAI', 'FRAX', 'LUSD', 'BUSD', 'TUSD', 'USDP',
  'WBTC', 'WBETH', 'STETH', 'WETH', 'WSTETH', 'RETH', 'CBETH',
  'SOETH', 'WBNB', 'WMATIC', 'WAVAX', 'WFTM', 'WMON',
]);

function isStablecoin(symbol) {
  return SKIP_SYMBOLS.has((symbol || '').toUpperCase());
}

export function normalizeGeckoPool(pool, includedById, chain, config) {
  const attrs = pool?.attributes || {};
  const baseId = pool?.relationships?.base_token?.data?.id;
  const quoteId = pool?.relationships?.quote_token?.data?.id;
  const dexId = pool?.relationships?.dex?.data?.id || null;
  const base = includedById.get(baseId)?.attributes || {};
  const quote = includedById.get(quoteId)?.attributes || {};
  const address = base.address || baseId?.replace(`${config.networkSlug}_`, '');
  if (!address || isStablecoin(base.symbol)) return null;

  const liquidityUsd = attrs.reserve_in_usd != null ? Number(attrs.reserve_in_usd) : null;
  if (liquidityUsd != null && liquidityUsd < config.minLiquidityUsd) return null;

  const created = attrs.pool_created_at ? Date.parse(attrs.pool_created_at) : NaN;
  return {
    mint: address.toLowerCase(),
    symbol: base.symbol || attrs.name?.split('/')[0]?.trim() || '?',
    name: base.name || base.symbol || 'Unknown',
    imageUrl: base.image_url || null,
    source: `gecko-${chain}`,
    ecosystem: config.ecosystem,
    chain,
    chainId: config.chainId,
    creator: null,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    onCurve: false,
    dexId,
    pairAddress: attrs.address,
    priceUsd: attrs.base_token_price_usd != null ? Number(attrs.base_token_price_usd) : null,
    priceChange: attrs.price_change_percentage || {},
    liquidityUsd,
    marketCapUsd: attrs.market_cap_usd != null ? Number(attrs.market_cap_usd) : null,
    volume5mUsd: attrs.volume_usd?.m5 != null ? Number(attrs.volume_usd.m5) : null,
    volume1hUsd: attrs.volume_usd?.h1 != null ? Number(attrs.volume_usd.h1) : null,
    volume24hUsd: attrs.volume_usd?.h24 != null ? Number(attrs.volume_usd.h24) : null,
    txns: attrs.transactions || {},
    quoteToken: quote.symbol || 'UNKNOWN',
    quoteAddress: quote.address || quoteId?.replace(`${config.networkSlug}_`, '') || null,
    poolUrl: `https://www.geckoterminal.com/${config.networkSlug}/pools/${attrs.address}`,
  };
}
