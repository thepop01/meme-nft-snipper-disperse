import { describe, expect, it } from 'vitest';
import { tierForAth, qualifiesEarlyBuy } from '../tiers.js';
import { selectEarlyBuyers, findRunners } from '../tracker.js';

describe('smart wallet tiers', () => {
  it('maps ATH 1M -> buy below 500k', () => {
    expect(tierForAth(1_000_000)?.maxBuyMcap).toBe(500_000);
    expect(qualifiesEarlyBuy({ athMcap: 1_200_000, buyMcap: 400_000 })).toBe(true);
    expect(qualifiesEarlyBuy({ athMcap: 1_200_000, buyMcap: 600_000 })).toBe(false);
  });

  it('maps ATH 5M -> buy below 1M', () => {
    expect(tierForAth(5_000_000)?.maxBuyMcap).toBe(1_000_000);
  });

  it('maps ATH 10M -> buy below 2M', () => {
    expect(tierForAth(10_000_000)?.maxBuyMcap).toBe(2_000_000);
  });

  it('maps ATH 10-50M -> buy below 5M', () => {
    expect(tierForAth(25_000_000)?.maxBuyMcap).toBe(5_000_000);
  });

  it('maps ATH 50M+ -> buy below 10M', () => {
    expect(tierForAth(80_000_000)?.maxBuyMcap).toBe(10_000_000);
  });

  it('rejects sub-1M ATH', () => {
    expect(tierForAth(900_000)).toBeNull();
  });

  it('selectEarlyBuyers filters by tier', () => {
    const { tier, buyers } = selectEarlyBuyers({
      athMcap: 5_000_000,
      buys: [{ wallet: 'a', buyMcap: 900_000 }, { wallet: 'b', buyMcap: 2_000_000 }],
    });
    expect(tier?.maxBuyMcap).toBe(1_000_000);
    expect(buyers.map(b => b.wallet)).toEqual(['a']);
  });

  it('findRunners keeps 30-day >=1M ATH only', () => {
    const now = Date.now();
    const runners = findRunners([
      { mint: 'r1', chain: 'solana', symbol: 'R1', marketCapUsd: 2_000_000, createdAt: now - 1000 },
      { mint: 's1', chain: 'solana', symbol: 'S1', marketCapUsd: 500_000, createdAt: now - 1000 },
      { mint: 'o1', chain: 'robinhood', symbol: 'O1', marketCapUsd: 60_000_000, createdAt: now - 40 * 24 * 3600 * 1000 },
    ], now);
    expect(runners.map(r => r.mint)).toEqual(['r1']);
  });
});
