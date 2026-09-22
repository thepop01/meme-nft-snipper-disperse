import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock store to isolate registry and wallet persistence
vi.mock('../../store.js', () => {
  const mem = new Map();
  return {
    load: vi.fn((key, fallback) => mem.get(key) ?? fallback),
    save: vi.fn((key, value) => mem.set(key, value)),
  };
});

import { upsertMeme, getUnbackfilledMemes, resetMemeRegistry } from '../memeRegistry.js';
import { resetRateLimiter } from '../rateLimiter.js';
import { loadWallets } from '../../smartwallets/tracker.js';
import { earlyBuyerLimitForAth } from '../../smartwallets/tiers.js';
import {
  extractEarlyBuyers,
  processNextUnbackfilledMeme,
  processUnbackfilledMemesBatch,
  fetchEarlyBuyerTrades,
  fetchPumpFunTrades,
  fetchBirdeyeTrades,
  fetchGeckoTerminalRobinhoodTrades,
} from '../worker3EarlyBuyers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedMeme({ ca, athMcap, athTimestamp, backfilled = false }) {
  upsertMeme({
    ca,
    name: `Token-${ca.slice(0, 6)}`,
    symbol: ca.slice(0, 4).toUpperCase(),
    chain: 'solana',
    athMcap,
    athTimestamp,
    currentMcap: athMcap * 0.5,
    source: 'ath_gt_4m',
    ...(backfilled ? { backfilled: true, backfilledAt: Date.now() } : {}),
  });
}

function makeTrade(overrides = {}) {
  return {
    wallet: 'W11111111111111111111111111111111111111111111',
    timestamp: 1_700_000_000_000,
    entryMcap: 500_000,
    pnl: 1_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// earlyBuyerLimitForAth
// ---------------------------------------------------------------------------

describe('earlyBuyerLimitForAth', () => {
  it('calculates canonical quota numbers', () => {
    expect(earlyBuyerLimitForAth(2_000_000)).toBe(120);
    expect(earlyBuyerLimitForAth(5_000_000)).toBe(180);
    expect(earlyBuyerLimitForAth(10_000)).toBe(0);
    expect(earlyBuyerLimitForAth(0)).toBe(0);
    expect(earlyBuyerLimitForAth(1_000_000)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// extractEarlyBuyers — Quota Buyers (Rule 1)
// ---------------------------------------------------------------------------

describe('extractEarlyBuyers – quota buyers', () => {
  const athMcap = 5_000_000; // quota = 180
  const athTimestamp = 1_700_000_100_000;

  it('drops trades that have no profit evidence', () => {
    const trades = [makeTrade({ wallet: 'A', pnl: undefined, profitUsd: undefined, entryMcap: 100_000 })];
    expect(extractEarlyBuyers(trades, 5_000_000, 1_700_000_100_000)).toEqual([]);
  });

  it('returns the first N unique wallets that bought before ATH', () => {
    const trades = [
      makeTrade({ wallet: 'A', timestamp: 1_700_000_000_000 }),
      makeTrade({ wallet: 'B', timestamp: 1_700_000_050_000 }),
      makeTrade({ wallet: 'C', timestamp: 1_700_000_070_000 }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toHaveLength(3);
  });

  it('deduplicates wallets (first occurrence wins)', () => {
    const trades = [
      makeTrade({ wallet: 'A', timestamp: 1_700_000_000_000 }),
      makeTrade({ wallet: 'A', timestamp: 1_700_000_020_000 }),
      makeTrade({ wallet: 'B', timestamp: 1_700_000_030_000 }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toEqual(['A', 'B']);
  });

  it('excludes trades at or after ATH timestamp', () => {
    const trades = [
      makeTrade({ wallet: 'A', timestamp: 1_700_000_100_000 }), // exactly ATH
      makeTrade({ wallet: 'B', timestamp: 1_700_000_100_001 }), // after ATH
      makeTrade({ wallet: 'C', timestamp: 1_700_000_099_999 }), // before ATH
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toEqual(['C']);
  });

  it('caps at quota even if more qualify', () => {
    const smallQuotaAth = 25_000;
    const trades = [
      makeTrade({ wallet: 'A', timestamp: 1_700_000_000_000 }),
      makeTrade({ wallet: 'B', timestamp: 1_700_000_000_001 }),
    ];
    const result = extractEarlyBuyers(trades, smallQuotaAth, athTimestamp);
    expect(result).toEqual([]);

    const cappedResult = extractEarlyBuyers(trades, 5_000_000, athTimestamp, { maxQuota: 1 });
    expect(cappedResult).toEqual(['A']);
  });
});

// ---------------------------------------------------------------------------
// extractEarlyBuyers — Value Buyers (Rule 2)
// ---------------------------------------------------------------------------

describe('extractEarlyBuyers – value buyers', () => {
  const athMcap = 5_000_000;
  const athTimestamp = 1_700_000_100_000;

  it('includes a wallet that bought at <=25% of ATH with positive PnL before ATH', () => {
    const trades = [
      makeTrade({
        wallet: 'V1',
        timestamp: 1_700_000_050_000,
        entryMcap: 1_200_000, // 24% of 5M
        pnl: 500,
      }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toContain('V1');
  });

  it('excludes a wallet with entryMcap > 25% of ATH (beyond quota window)', () => {
    // Sub-$1M ATH returns empty list under canonical rules
    const smallAth = 25_000;
    const trades = [
      makeTrade({ wallet: 'Q', timestamp: 1_700_000_000_000, entryMcap: 1_000, pnl: 100 }),
      makeTrade({
        wallet: 'V2',
        timestamp: 1_700_000_010_000,
        entryMcap: 7_000,
        pnl: 500,
      }),
    ];
    const result = extractEarlyBuyers(trades, smallAth, athTimestamp);
    expect(result).toEqual([]);
  });

  it('excludes wallets with zero or negative PnL (beyond quota window)', () => {
    // Sub-$1M ATH returns empty list under canonical rules
    const smallAth = 25_000;
    const trades = [
      makeTrade({ wallet: 'Q', timestamp: 1_700_000_000_000, entryMcap: 1_000, pnl: 100 }),
      makeTrade({
        wallet: 'V3',
        timestamp: 1_700_000_050_000,
        entryMcap: 500,
        pnl: 0,
      }),
      makeTrade({
        wallet: 'V4',
        timestamp: 1_700_000_060_000,
        entryMcap: 500,
        pnl: -100,
      }),
    ];
    const result = extractEarlyBuyers(trades, smallAth, athTimestamp);
    expect(result).toEqual([]);
  });

  it('excludes value buyers that bought at or after ATH', () => {
    const trades = [
      makeTrade({
        wallet: 'V5',
        timestamp: 1_700_000_100_000, // at ATH
        entryMcap: 500_000,
        pnl: 1_000,
      }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).not.toContain('V5');
  });

  it('caps value buyer threshold at 50M for tokens with ATH > 200M', () => {
    const hugeAth = 400_000_000;
    const trades = [
      makeTrade({ wallet: 'Q1', timestamp: 1_700_000_000_000, entryMcap: 10_000, pnl: 10 }),
      makeTrade({ wallet: 'VAL_40M', timestamp: 1_700_000_050_000, entryMcap: 40_000_000, pnl: 500 }),
      makeTrade({ wallet: 'VAL_60M', timestamp: 1_700_000_060_000, entryMcap: 60_000_000, pnl: 500 }),
    ];

    const result = extractEarlyBuyers(trades, hugeAth, athTimestamp, { maxQuota: 1 });
    expect(result).toEqual(['Q1']);
  });
});

// ---------------------------------------------------------------------------
// extractEarlyBuyers — combination and edge cases
// ---------------------------------------------------------------------------

describe('extractEarlyBuyers – combinations and edge cases', () => {
  const athMcap = 5_000_000;
  const athTimestamp = 1_700_000_100_000;

  it('merges quota and value buyers without duplication', () => {
    const trades = [
      makeTrade({ wallet: 'A', timestamp: 1_700_000_000_000, entryMcap: 500_000, pnl: 1_000 }), // quota + value
      makeTrade({ wallet: 'B', timestamp: 1_700_000_010_000, entryMcap: 3_000_000, pnl: 100 }), // quota only
      makeTrade({ wallet: 'C', timestamp: 1_700_000_090_000, entryMcap: 200_000, pnl: 5_000 }), // value only (post-quota slots, but pre-ATH)
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    // No duplicates
    expect(new Set(result).size).toBe(result.length);
  });

  it('returns empty array when there are no trades', () => {
    expect(extractEarlyBuyers([], athMcap, athTimestamp)).toEqual([]);
  });

  it('returns empty array when all trades are after ATH', () => {
    const trades = [
      makeTrade({ wallet: 'X', timestamp: 1_700_000_200_000 }),
      makeTrade({ wallet: 'Y', timestamp: 1_700_000_300_000 }),
    ];
    expect(extractEarlyBuyers(trades, athMcap, athTimestamp)).toEqual([]);
  });

  it('handles trades missing wallet gracefully', () => {
    const trades = [
      makeTrade({ wallet: undefined, timestamp: 1_700_000_000_000 }),
      makeTrade({ wallet: 'GOOD', timestamp: 1_700_000_001_000 }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toEqual(['GOOD']);
  });

  it('value buyers also excluded if after ATH', () => {
    const trades = [
      makeTrade({
        wallet: 'LATE',
        timestamp: 1_700_000_150_000,
        entryMcap: 100_000,
        pnl: 99_999,
      }),
    ];
    expect(extractEarlyBuyers(trades, athMcap, athTimestamp)).toEqual([]);
  });

  it('accepts entryMcap via alternate field names (buyMcap, marketCapUsd)', () => {
    const trades = [
      makeTrade({
        wallet: 'ALT1',
        timestamp: 1_700_000_050_000,
        buyMcap: 1_000_000, // 20% of 5M
        pnl: 200,
      }),
      makeTrade({
        wallet: 'ALT2',
        timestamp: 1_700_000_060_000,
        marketCapUsd: 800_000, // 16% of 5M
        pnl: 300,
      }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toContain('ALT1');
    expect(result).toContain('ALT2');
  });

  it('accepts PnL via alternate field names (profitUsd, realizedProfitUsd)', () => {
    const trades = [
      makeTrade({
        wallet: 'P1',
        timestamp: 1_700_000_050_000,
        entryMcap: 500_000,
        profitUsd: 1_000,
      }),
      makeTrade({
        wallet: 'P2',
        timestamp: 1_700_000_060_000,
        entryMcap: 600_000,
        realizedProfitUsd: 2_000,
      }),
    ];
    const result = extractEarlyBuyers(trades, athMcap, athTimestamp);
    expect(result).toContain('P1');
    expect(result).toContain('P2');
  });
});

// ---------------------------------------------------------------------------
// processNextUnbackfilledMeme
// ---------------------------------------------------------------------------

describe('processNextUnbackfilledMeme', () => {
  beforeEach(() => {
    resetMemeRegistry();
    vi.restoreAllMocks();
  });

  it('processes one unbackfilled meme and returns ca + buyersCount', async () => {
    const ca = 'Proc11111111111111111111111111111111111111111';
    seedMeme({ ca, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });

    const fetcher = vi.fn(async () => [
      { wallet: 'A', timestamp: 1_700_000_000_000, entryMcap: 500_000, pnl: 1_000 },
      { wallet: 'B', timestamp: 1_700_000_050_000, entryMcap: 400_000, pnl: 2_000 },
    ]);

    const result = await processNextUnbackfilledMeme(fetcher);
    expect(result).toEqual({ ca, buyersCount: 2 });
    expect(fetcher).toHaveBeenCalledWith(ca, expect.objectContaining({ athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 }));

    // Should be marked as backfilled
    const pending = getUnbackfilledMemes(10);
    expect(pending.find(m => m.ca === ca)).toBeUndefined();

    // Wallets should have been saved
    const { wallets } = loadWallets();
    const addresses = wallets.map(w => w.address);
    expect(addresses).toContain('A');
    expect(addresses).toContain('B');
  });

  it('returns null when no unbackfilled memes remain', async () => {
    const fetcher = vi.fn();
    const result = await processNextUnbackfilledMeme(fetcher);
    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('marks meme backfilled even when no qualifying buyers found', async () => {
    const ca = 'NoBuy11111111111111111111111111111111111111111';
    seedMeme({ ca, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });

    // All trades are after ATH => no qualifying buyers
    const fetcher = vi.fn(async () => [
      { wallet: 'LATE', timestamp: 1_700_000_200_000 },
    ]);

    const result = await processNextUnbackfilledMeme(fetcher);
    expect(result).toEqual({ ca, buyersCount: 0 });

    // Should still be marked as backfilled
    const pending = getUnbackfilledMemes(10);
    expect(pending.find(m => m.ca === ca)).toBeUndefined();
  });

  it('handles fetcher errors gracefully and does not mark backfilled', async () => {
    const ca = 'Fail1111111111111111111111111111111111111111111';
    seedMeme({ ca, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });

    const fetcher = vi.fn(async () => {
      throw new Error('network error');
    });

    const result = await processNextUnbackfilledMeme(fetcher);
    expect(result).toBeNull();

    // Should NOT be marked backfilled since processing failed
    const pending = getUnbackfilledMemes(10);
    expect(pending.find(m => m.ca === ca)).toBeDefined();
  });

  it('does not mark meme backfilled when trade provider returns empty array', async () => {
    const ca = 'EmptyTrades11111111111111111111111111111111111';
    seedMeme({ ca, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });

    const fetcher = vi.fn(async () => []);

    const result = await processNextUnbackfilledMeme(fetcher);
    expect(result).toEqual({ ca, buyersCount: 0 });

    // Should NOT be marked backfilled after 1 attempt so it can be retried
    const pending = getUnbackfilledMemes(10);
    const target = pending.find(m => m.ca === ca);
    expect(target).toBeDefined();
    expect(target.backfillAttempts).toBe(1);
  });

  it('marks meme backfilled after attempt exhaustion to unblock head-of-line stalls', async () => {
    const ca = 'StalledToken1111111111111111111111111111111111';
    seedMeme({ ca, athMcap: 10_000_000, athTimestamp: 1_700_000_100_000 });

    const fetcher = vi.fn(async () => []);

    // First attempt: increments attempts to 1, remains unbackfilled
    await processNextUnbackfilledMeme(fetcher);
    let pending = getUnbackfilledMemes(10);
    expect(pending.find(m => m.ca === ca)).toBeDefined();

    // Second attempt: reaches attempt limit (>= 2), marks backfilled to unblock queue
    await processNextUnbackfilledMeme(fetcher);
    pending = getUnbackfilledMemes(10);
    expect(pending.find(m => m.ca === ca)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Timestamp Normalization (Seconds vs Milliseconds)
// ---------------------------------------------------------------------------

describe('Timestamp Normalization', () => {
  it('normalizes 10-digit second timestamps in trades against 13-digit ms athTimestamp', () => {
    // 1700000100 is seconds (~Nov 2023)
    const athTimestampMs = 1_700_000_100_000; // 13 digits
    const athMcap = 10_000_000;

    const trades = [
      // Trade at 1700000050 seconds (before ATH)
      makeTrade({ wallet: 'EARLY_SEC', timestamp: 1_700_000_050, entryMcap: 500_000, pnl: 500 }),
      // Trade at 1700000200 seconds (after ATH)
      makeTrade({ wallet: 'LATE_SEC', timestamp: 1_700_000_200, entryMcap: 500_000, pnl: 500 }),
    ];

    const earlyBuyers = extractEarlyBuyers(trades, athMcap, athTimestampMs);
    expect(earlyBuyers).toContain('EARLY_SEC');
    expect(earlyBuyers).not.toContain('LATE_SEC');
  });

  it('normalizes 10-digit second athTimestamp against 10-digit or 13-digit trade timestamps', () => {
    const athTimestampSec = 1_700_000_100; // 10 digits
    const athMcap = 10_000_000;

    const trades = [
      // Trade at 1700000050 seconds (before ATH)
      makeTrade({ wallet: 'EARLY_A', timestamp: 1_700_000_050, entryMcap: 500_000, pnl: 500 }),
      // Trade in milliseconds before ATH
      makeTrade({ wallet: 'EARLY_MS', timestamp: 1_700_000_050_000, entryMcap: 500_000, pnl: 500 }),
      // Trade after ATH
      makeTrade({ wallet: 'LATE_B', timestamp: 1_700_000_200_000, entryMcap: 500_000, pnl: 500 }),
    ];

    const earlyBuyers = extractEarlyBuyers(trades, athMcap, athTimestampSec);
    expect(earlyBuyers).toContain('EARLY_A');
    expect(earlyBuyers).toContain('EARLY_MS');
    expect(earlyBuyers).not.toContain('LATE_B');
  });
});

// ---------------------------------------------------------------------------
// processUnbackfilledMemesBatch
// ---------------------------------------------------------------------------

describe('processUnbackfilledMemesBatch', () => {
  beforeEach(() => {
    resetMemeRegistry();
    vi.restoreAllMocks();
  });

  it('processes multiple tokens concurrently up to batchSize', async () => {
    const ca1 = 'Batch1111111111111111111111111111111111111111';
    const ca2 = 'Batch2222222222222222222222222222222222222222';
    const ca3 = 'Batch3333333333333333333333333333333333333333';
    seedMeme({ ca: ca1, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });
    seedMeme({ ca: ca2, athMcap: 6_000_000, athTimestamp: 1_700_000_100_000 });
    seedMeme({ ca: ca3, athMcap: 7_000_000, athTimestamp: 1_700_000_100_000 });

    const fetcher = vi.fn(async (ca) => [
      { wallet: `buyer_${ca.slice(0, 6)}`, timestamp: 1_700_000_000_000, entryMcap: 100_000, pnl: 100 },
    ]);

    const results = await processUnbackfilledMemesBatch(2, fetcher);
    expect(results.length).toBe(2);
    expect(results.map(r => r.ca)).toEqual([ca3, ca2]);
    expect(results.every(r => r.buyersCount === 1)).toBe(true);

    // Highest ATH tokens (Token 3: 7M, Token 2: 6M) processed first, Token 1 (5M) remains pending
    const remaining = getUnbackfilledMemes(10);
    expect(remaining.length).toBe(1);
    expect(remaining[0].ca).toBe(ca1);
  });

  it('returns empty array when queue is empty', async () => {
    const fetcher = vi.fn();
    const results = await processUnbackfilledMemesBatch(3, fetcher);
    expect(results).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('continues batch processing even if one meme fails', async () => {
    const caGood = 'Good11111111111111111111111111111111111111111';
    const caBad = 'Bad111111111111111111111111111111111111111111';
    seedMeme({ ca: caGood, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });
    seedMeme({ ca: caBad, athMcap: 5_000_000, athTimestamp: 1_700_000_100_000 });

    const fetcher = vi.fn(async (ca) => {
      if (ca === caBad) throw new Error('Simulated API failure');
      return [{ wallet: 'buyer_good', timestamp: 1_700_000_000_000, entryMcap: 100_000, pnl: 50 }];
    });

    const results = await processUnbackfilledMemesBatch(2, fetcher);
    expect(results.length).toBe(1);
    expect(results[0].ca).toBe(caGood);

    // Bad one should still be unbackfilled
    const remaining = getUnbackfilledMemes(10);
    expect(remaining.find(m => m.ca === caBad)).toBeDefined();
    expect(remaining.find(m => m.ca === caGood)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchEarlyBuyerTrades
// ---------------------------------------------------------------------------

describe('fetchEarlyBuyerTrades', () => {
  it('returns an empty array cleanly when no API keys or providers fail', async () => {
    const origBirdeye = process.env.BIRDEYE_API_KEY;
    const origHelius = process.env.HELIUS_API_KEY;
    delete process.env.BIRDEYE_API_KEY;
    delete process.env.HELIUS_API_KEY;
    try {
      const res = await fetchEarlyBuyerTrades('So11111111111111111111111111111111111111112');
      expect(Array.isArray(res)).toBe(true);
    } finally {
      if (origBirdeye) process.env.BIRDEYE_API_KEY = origBirdeye;
      if (origHelius) process.env.HELIUS_API_KEY = origHelius;
    }
  });
});

// ---------------------------------------------------------------------------
// fetchPumpFunTrades
// ---------------------------------------------------------------------------

describe('fetchPumpFunTrades', () => {
  it('returns empty array for EVM or empty CA', async () => {
    expect(await fetchPumpFunTrades('')).toEqual([]);
    expect(await fetchPumpFunTrades('0x1234567890123456789012345678901234567890')).toEqual([]);
  });

  it('extracts creator as slot-0 early buyer when pump.fun returns valid coin data', async () => {
    const mockCoin = {
      mint: 'TestPumpMint11111111111111111111111111111111',
      creator: 'CreatorWallet1111111111111111111111111111111',
      created_timestamp: 1_700_000_000_000,
      ath_market_cap: 10_000_000,
      ath_market_cap_timestamp: 1_700_000_500_000,
      market_cap_usd: 5_000,
      complete: true,
      raydium_pool: 'Pool1111111111111111111111111111111111111111',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => mockCoin,
    }));

    try {
      const trades = await fetchPumpFunTrades('TestPumpMint11111111111111111111111111111111');
      expect(trades).toHaveLength(1);
      expect(trades[0].wallet).toBe('CreatorWallet1111111111111111111111111111111');
      expect(trades[0].isCreator).toBe(true);
      expect(trades.coinMetadata).toBeDefined();
      expect(trades.coinMetadata.athMcap).toBe(10_000_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles 404 cleanly when token is not on pump.fun', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
    }));

    try {
      const trades = await fetchPumpFunTrades('NonPumpToken1111111111111111111111111111111');
      expect(trades).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// fetchBirdeyeTrades pagination
// ---------------------------------------------------------------------------

describe('fetchBirdeyeTrades pagination', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('returns empty array when ca is invalid or EVM', async () => {
    expect(await fetchBirdeyeTrades('')).toEqual([]);
    expect(await fetchBirdeyeTrades('0xabcdef')).toEqual([]);
  });

  it('paginates across multiple pages and stops when hasNext is false or items < 50', async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.BIRDEYE_API_KEY;
    process.env.BIRDEYE_API_KEY = 'test_key';

    let pageCall = 0;
    globalThis.fetch = vi.fn(async (url) => {
      pageCall++;
      if (pageCall === 1) {
        // Page 1: 50 items
        const items = Array.from({ length: 50 }, (_, i) => ({
          owner: `Wallet_P1_${i}`,
          blockUnixTime: 1_700_000 + i,
          base: { price: 0.001 },
        }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { items, hasNext: true } }),
        };
      } else if (pageCall === 2) {
        // Page 2: 20 items (< 50 => end of stream)
        const items = Array.from({ length: 20 }, (_, i) => ({
          owner: `Wallet_P2_${i}`,
          blockUnixTime: 1_700_100 + i,
          base: { price: 0.002 },
        }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { items, hasNext: false } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: { items: [] } }) };
    });

    try {
      const trades = await fetchBirdeyeTrades('TestToken11111111111111111111111111111111', { maxPages: 5 });
      expect(trades).toHaveLength(70);
      expect(pageCall).toBe(2);
      expect(trades[0].wallet).toBe('Wallet_P1_0');
      expect(trades[50].wallet).toBe('Wallet_P2_0');
    } finally {
      globalThis.fetch = originalFetch;
      process.env.BIRDEYE_API_KEY = originalKey;
    }
  });
});

// ---------------------------------------------------------------------------
// Robinhood Chain (EVM) Trades & Backfill Processing
// ---------------------------------------------------------------------------

describe('Robinhood Chain (EVM) Early Buyers Support', () => {
  beforeEach(() => {
    resetMemeRegistry();
    resetRateLimiter();
    vi.restoreAllMocks();
  });

  it('fetchGeckoTerminalRobinhoodTrades returns empty array for empty CA', async () => {
    expect(await fetchGeckoTerminalRobinhoodTrades('')).toEqual([]);
  });

  it('fetchGeckoTerminalRobinhoodTrades resolves pool and maps trades', async () => {
    const originalFetch = globalThis.fetch;
    const tokenCa = '0xfe7e19cbce2f896c6c528bc355baf5a768291e18';
    const poolAddr = '0x225cc98f7d66b29fef96377becc7bf89582e2ab7b923a09aee9719fd80eb94ca';

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/tokens/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: `robinhood_${poolAddr}`,
                attributes: { address: poolAddr },
              },
            ],
          }),
        };
      }
      if (url.includes('/trades')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                attributes: {
                  tx_from_address: '0xA7523AC70A21079545ECF1AC343E3CAA1B90E9E6',
                  block_timestamp: '2026-09-17T09:40:04Z',
                  kind: 'buy',
                  volume_in_usd: '15.12',
                  price_from_in_usd: '0.0031',
                },
              },
              {
                attributes: {
                  tx_from_address: '0xB8523AC70A21079545ECF1AC343E3CAA1B90E9E7',
                  block_timestamp: '2026-09-17T09:42:04Z',
                  kind: 'sell',
                  volume_in_usd: '20.50',
                  price_to_in_usd: '0.0032',
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    try {
      const trades = await fetchGeckoTerminalRobinhoodTrades(tokenCa);
      expect(trades).toHaveLength(2);
      expect(trades[0].wallet).toBe('0xa7523ac70a21079545ecf1ac343e3caa1b90e9e6'); // lowercased
      expect(trades[0].isBuy).toBe(true);
      expect(trades[1].wallet).toBe('0xb8523ac70a21079545ecf1ac343e3caa1b90e9e7');
      expect(trades.source).toBe('geckoterminal');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchEarlyBuyerTrades routes EVM 0x contract addresses to Robinhood trade fetcher', async () => {
    const originalFetch = globalThis.fetch;
    const tokenCa = '0x1234567890abcdef1234567890abcdef12345678';
    let poolCalled = false;

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('/tokens/')) {
        poolCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                attributes: { address: '0xpool123' },
              },
            ],
          }),
        };
      }
      if (url.includes('/trades')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                attributes: {
                  tx_from_address: '0xearlybuyer1',
                  block_timestamp: '2026-09-17T09:00:00Z',
                  kind: 'buy',
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    try {
      const trades = await fetchEarlyBuyerTrades(tokenCa);
      expect(poolCalled).toBe(true);
      expect(trades).toHaveLength(1);
      expect(trades[0].wallet).toBe('0xearlybuyer1');
      expect(trades.source).toBe('geckoterminal');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('processNextUnbackfilledMeme backfills a Robinhood meme token with tagged EVM wallets', async () => {
    const ca = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    upsertMeme({
      ca,
      name: 'Robinhood Runner',
      symbol: 'RHR',
      chain: 'robinhood',
      athMcap: 10_000_000,
      athTimestamp: 1_789_600_000_000,
      currentMcap: 5_000_000,
    });

    const mockFetcher = vi.fn(async () => [
      {
        wallet: '0xBuyerOne00000000000000000000000000000000',
        timestamp: 1_789_500_000_000,
        entryMcap: 500_000,
        pnl: 100,
      },
      {
        wallet: '0xBuyerTwo00000000000000000000000000000000',
        timestamp: 1_789_550_000_000,
        entryMcap: 800_000,
        pnl: 200,
      },
    ]);

    const res = await processNextUnbackfilledMeme(mockFetcher, 'robinhood');
    expect(res).toEqual({ ca, buyersCount: 2 });

    const doc = loadWallets();
    const wallets = doc.wallets || [];
    const b1 = wallets.find(w => w.address === '0xbuyerone00000000000000000000000000000000');
    expect(b1).toBeDefined();
    expect(b1.chain).toBe('robinhood');
    expect(b1.tags).toContain('robinhood_early_buyer');
    expect(b1.source).toBe('worker3-robinhood-early-buyer');

    // Token marked as backfilled
    const unbackfilled = getUnbackfilledMemes(10, 'robinhood');
    expect(unbackfilled.find(m => m.ca === ca)).toBeUndefined();
  });
});

