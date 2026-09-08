import { describe, expect, it } from 'vitest';
import { selectTopGainers, GAINER_TABS } from '../TopGainersPanel.jsx';
import { selectNewPairs } from '../NewPairsPanel.jsx';

const tokens = [
  { mint: 'A', symbol: 'AAA', priceChange: { m5: 400, h1: 100, h24: 50 }, priceUsd: 0.001, marketCapUsd: 100000 },
  { mint: 'B', symbol: 'BBB', priceChange: { m5: 10, h1: 300, h24: 20 }, priceUsd: 0.002, marketCapUsd: 200000 },
  { mint: 'C', symbol: 'CCC', priceChange: { m5: null, h1: null, h24: null }, priceUsd: 0.003, marketCapUsd: 300000 },
  { mint: 'D', symbol: 'DDD', createdAt: Date.now() - 2 * 60_000, liquidityUsd: 12000, marketCapUsd: 45000 },
  { mint: 'E', symbol: 'EEE', createdAt: Date.now() - 60 * 60_000, liquidityUsd: 18000, marketCapUsd: 72000 },
];

describe('selectTopGainers', () => {
  it('ranks by the active tab window and skips missing data', () => {
    expect(selectTopGainers(tokens, '5m', 5).map(t => t.mint)).toEqual(['A', 'B']);
    expect(selectTopGainers(tokens, '1h', 5).map(t => t.mint)).toEqual(['B', 'A']);
  });

  it('exposes the reference tab set', () => {
    expect(GAINER_TABS).toEqual(['5m', '1h', '6h', '24h']);
  });
});

describe('selectNewPairs', () => {
  it('returns newest first with a limit', () => {
    const pairs = selectNewPairs(tokens, 1);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].mint).toBe('D');
  });
});
