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
import { loadWallets } from '../../smartwallets/tracker.js';
import {
  calculateFirstBuyersQuota,
  extractEarlyBuyers,
  processNextUnbackfilledMeme,
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
// calculateFirstBuyersQuota
// ---------------------------------------------------------------------------

describe('calculateFirstBuyersQuota', () => {
  it('returns 80 for ATH of 2M', () => {
    expect(calculateFirstBuyersQuota(2_000_000)).toBe(80);
  });

  it('returns 200 for ATH of 5M', () => {
    expect(calculateFirstBuyersQuota(5_000_000)).toBe(200);
  });

  it('returns at least 1 for very small ATH', () => {
    expect(calculateFirstBuyersQuota(10_000)).toBe(1);
  });

  it('returns at least 1 for 0', () => {
    expect(calculateFirstBuyersQuota(0)).toBe(1);
  });

  it('rounds correctly (0.5 threshold)', () => {
    // 12500 * 0.00004 = 0.5 => rounds to 1
    expect(calculateFirstBuyersQuota(12_500)).toBe(1);
    // 25000 * 0.00004 = 1.0 => 1
    expect(calculateFirstBuyersQuota(25_000)).toBe(1);
    // 37500 * 0.00004 = 1.5 => rounds to 2
    expect(calculateFirstBuyersQuota(37_500)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractEarlyBuyers — Quota Buyers (Rule 1)
// ---------------------------------------------------------------------------

describe('extractEarlyBuyers – quota buyers', () => {
  const athMcap = 5_000_000; // quota = 200
  const athTimestamp = 1_700_000_100_000;

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
    const smallQuotaAth = 25_000; // quota = 1
    const trades = [
      makeTrade({ wallet: 'A', timestamp: 1_700_000_000_000 }),
      makeTrade({ wallet: 'B', timestamp: 1_700_000_000_001 }),
    ];
    const result = extractEarlyBuyers(trades, smallQuotaAth, athTimestamp);
    expect(result).toEqual(['A']);
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
    // Use a small ATH so quota = 1. Fill the quota with wallet Q first.
    const smallAth = 25_000; // quota = 1
    const smallThreshold = smallAth * 0.25; // 6,250
    const trades = [
      makeTrade({ wallet: 'Q', timestamp: 1_700_000_000_000, entryMcap: 1_000, pnl: 100 }),
      makeTrade({
        wallet: 'V2',
        timestamp: 1_700_000_010_000,
        entryMcap: 7_000, // 28% of 25k — above the 25% threshold
        pnl: 500,
      }),
    ];
    const result = extractEarlyBuyers(trades, smallAth, athTimestamp);
    expect(result).toContain('Q');
    expect(result).not.toContain('V2');
  });

  it('excludes wallets with zero or negative PnL (beyond quota window)', () => {
    // Use a small ATH so quota = 1. Fill the quota with wallet Q first.
    const smallAth = 25_000; // quota = 1
    const trades = [
      makeTrade({ wallet: 'Q', timestamp: 1_700_000_000_000, entryMcap: 1_000, pnl: 100 }),
      makeTrade({
        wallet: 'V3',
        timestamp: 1_700_000_050_000,
        entryMcap: 500,
        pnl: 0, // zero PnL — not profitable
      }),
      makeTrade({
        wallet: 'V4',
        timestamp: 1_700_000_060_000,
        entryMcap: 500,
        pnl: -100, // negative PnL — not profitable
      }),
    ];
    const result = extractEarlyBuyers(trades, smallAth, athTimestamp);
    expect(result).toContain('Q');
    expect(result).not.toContain('V3');
    expect(result).not.toContain('V4');
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
    expect(fetcher).toHaveBeenCalledWith(ca);

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
});
