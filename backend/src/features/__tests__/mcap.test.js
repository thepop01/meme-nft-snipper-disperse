import { describe, expect, it } from 'vitest';
import { supplyAwareMcap } from '../mcap.js';

describe('supplyAwareMcap', () => {
  it('computes raw supply times USD price at mint precision', () => {
    expect(supplyAwareMcap({ rawSupply: 1_000_000_000_000n, decimals: 6, priceUsd: 0.002 })).toBeCloseTo(2000);
  });
  it('does not guess a supply or price', () => {
    expect(supplyAwareMcap({ rawSupply: null, decimals: 6, priceUsd: 0.002 })).toBeNull();
    expect(supplyAwareMcap({ rawSupply: 1n, decimals: 6, priceUsd: null })).toBeNull();
  });
  it('accepts raw supply serialized on the tape', () => {
    expect(supplyAwareMcap({ rawSupply: '1000000000000', decimals: 6, priceUsd: 0.002 })).toBeCloseTo(2000);
  });
});
