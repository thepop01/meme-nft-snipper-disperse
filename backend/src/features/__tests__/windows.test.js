import { describe, expect, it } from 'vitest';
import { bucketize } from '../windows.js';

const trade = (chainTs, side, solLamports, wallet) => ({ chainTs, side, solLamports, wallet });

describe('bucketize', () => {
  it('aggregates buy/sell amounts, counts, and unique wallets in fixed windows', () => {
    const buckets = bucketize([trade(0, 'buy', 100, 'w1'), trade(1_000, 'buy', 200, 'w2'), trade(61_000, 'sell', 50, 'w1')], 60_000, 0, 120_000, 200_000);
    expect(buckets).toMatchObject([
      { windowStart: 0, buySol: 300, sellSol: 0, buys: 2, sells: 0, wallets: 2, partial: false },
      { windowStart: 60_000, sellSol: 50, sells: 1, wallets: 1, partial: false },
    ]);
  });
  it('flags only a current incomplete bucket and excludes out-of-range trades', () => {
    expect(bucketize([trade(125_000, 'buy', 10, 'w1')], 60_000, 0, 200_000, 130_000).at(-1).partial).toBe(true);
    expect(bucketize([trade(-1, 'buy', 1, 'a'), trade(999_999, 'buy', 1, 'b')], 60_000, 0, 120_000, 200_000)).toEqual([]);
  });
});
