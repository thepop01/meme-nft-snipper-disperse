import { describe, it, expect, beforeEach, vi } from 'vitest';

const throttleCalls = vi.hoisted(() => []);

vi.mock('../rateLimiter.js', () => ({
  executeWithThrottle: vi.fn(async (sourceName, asyncFn) => {
    throttleCalls.push(sourceName);
    return asyncFn();
  }),
}));

import {
  fetchPumpFunHistoricalCoins,
  fetchGeckoTerminalSolanaPools,
  normalizePumpFunCoin,
  runHistoricalSolanaHarvest,
} from '../historicalDiscovery.js';
import { getTrackedMemes, resetMemeRegistry, upsertMeme } from '../memeRegistry.js';

describe('Historical Solana Runner Discovery', () => {
  beforeEach(() => {
    resetMemeRegistry();
    throttleCalls.length = 0;
    vi.restoreAllMocks();
  });

  it('normalizes qualifying pump.fun coin with current mcap >= $2M', () => {
    const coin = {
      mint: 'PumpRunner1111111111111111111111111111111111',
      name: 'Pump Runner',
      symbol: 'PRUN',
      usd_market_cap: 2_500_000,
      ath_market_cap: 3_000_000,
      ath_market_cap_timestamp: 1789600000000,
      created_timestamp: 1789500000000,
    };
    const normalized = normalizePumpFunCoin(coin);
    expect(normalized).toEqual(expect.objectContaining({
      ca: 'PumpRunner1111111111111111111111111111111111',
      name: 'Pump Runner',
      symbol: 'PRUN',
      chain: 'solana',
      currentMcap: 2_500_000,
      athMcap: 3_000_000,
      athTimestamp: 1789600000000,
      source: 'pumpfun',
    }));
  });

  it('normalizes qualifying pump.fun coin with ATH >= $4M even if current mcap is lower', () => {
    const coin = {
      mint: 'PumpAth1111111111111111111111111111111111111',
      name: 'Pump ATH',
      symbol: 'PATH',
      usd_market_cap: 800_000,
      ath_market_cap: 5_500_000,
      ath_market_cap_timestamp: 1789600000000,
      created_timestamp: 1789500000000,
    };
    const normalized = normalizePumpFunCoin(coin);
    expect(normalized).toEqual(expect.objectContaining({
      ca: 'PumpAth1111111111111111111111111111111111111',
      athMcap: 5_500_000,
      athTimestamp: 1789600000000,
      currentMcap: 800_000,
    }));
  });

  it('rejects coin with neither current mcap >= $2M nor ATH >= $4M', () => {
    const coin = {
      mint: 'LowCoin1111111111111111111111111111111111111',
      name: 'Low Coin',
      symbol: 'LOW',
      usd_market_cap: 500_000,
      ath_market_cap: 1_200_000,
      ath_market_cap_timestamp: 1789600000000,
    };
    expect(normalizePumpFunCoin(coin)).toBeNull();
  });

  it('filters out tokens older than maxAge cutoff unless they have recent activity/ATH', () => {
    const oldTs = Date.now() - 365 * 24 * 3600 * 1000; // 1 year ago
    const cutoff = Date.now() - 180 * 24 * 3600 * 1000; // 6 months ago

    const oldDeadCoin = {
      mint: 'DeadOld1111111111111111111111111111111111111',
      usd_market_cap: 100_000,
      ath_market_cap: 5_000_000,
      ath_market_cap_timestamp: oldTs,
      created_timestamp: oldTs,
    };
    expect(normalizePumpFunCoin(oldDeadCoin, cutoff)).toBeNull();

    // But if current mcap is currently high, it qualifies as active runner
    const oldAliveCoin = {
      mint: 'AliveOld111111111111111111111111111111111111',
      usd_market_cap: 3_000_000,
      ath_market_cap: 6_000_000,
      ath_market_cap_timestamp: oldTs,
      created_timestamp: oldTs,
    };
    expect(normalizePumpFunCoin(oldAliveCoin, cutoff)).not.toBeNull();
  });

  it('runHistoricalSolanaHarvest ingests pump.fun and gecko runners into registry without losing backfilled status', async () => {
    // Pre-populate an existing token that is backfilled
    upsertMeme({
      ca: 'Existing111111111111111111111111111111111111',
      symbol: 'EXIST',
      chain: 'solana',
      currentMcap: 2_100_000,
      athMcap: 4_500_000,
      athTimestamp: 1789000000000,
      backfilled: true,
      backfilledAt: 1789000050000,
    });

    const mockPumpCoins = [
      {
        mint: 'Existing111111111111111111111111111111111111',
        symbol: 'EXIST',
        name: 'Existing Token',
        usd_market_cap: 2_600_000,
        ath_market_cap: 4_500_000,
        ath_market_cap_timestamp: 1789000000000,
        created_timestamp: 1788000000000,
      },
      {
        mint: 'NewRunner11111111111111111111111111111111111',
        symbol: 'NEW',
        name: 'New Token',
        usd_market_cap: 4_000_000,
        ath_market_cap: 8_000_000,
        ath_market_cap_timestamp: 1789600000000,
        created_timestamp: 1789500000000,
      },
    ];

    const stats = await runHistoricalSolanaHarvest({
      customPumpFetcher: async () => mockPumpCoins.map(c => normalizePumpFunCoin(c)).filter(Boolean),
      customGeckoFetcher: async () => [],
    });

    expect(stats.totalIngested).toBe(2);
    expect(stats.newMemes).toBe(1);

    const memes = getTrackedMemes();
    const existing = memes.find(m => m.ca === 'Existing111111111111111111111111111111111111');
    expect(existing.backfilled).toBe(true); // preserved
    expect(existing.currentMcap).toBe(2_600_000); // updated
    expect(existing.sourceFlags).toContain('pumpfun');

    const newRunner = memes.find(m => m.ca === 'NewRunner11111111111111111111111111111111111');
    expect(newRunner.backfilled).toBe(false);
    expect(newRunner.athMcap).toBe(8_000_000);
  });
});
