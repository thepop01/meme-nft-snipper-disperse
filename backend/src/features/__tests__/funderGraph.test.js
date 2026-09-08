import { describe, expect, it } from 'vitest';
import { bundleClusters } from '../funderGraph.js';

describe('bundleClusters', () => {
  it('uses the largest non-service shared-funder component as the primary risk', async () => {
    const balances = { a: 300n, b: 250n, c: 100n, d: 50n };
    const result = await bundleClusters({ buyers: new Set(Object.keys(balances)), creationTs: 100, rawSupply: 1000n,
      rawBalanceOf: async wallet => balances[wallet], fundingSourceFor: async wallet => ({ a: 'f1', b: 'f1', c: 'cex', d: null }[wallet]),
      isKnownService: value => value === 'cex' }, { funderLookbackMs: 50 });
    expect(result).toMatchObject({ clusterCount: 3, maxSuspiciousComponentPct: 0.55, unionSuspiciousPct: 0.55, coverage: 1 });
  });
  it('keeps missing supply unavailable', async () => {
    expect((await bundleClusters({ buyers: new Set(['a']), creationTs: 0, rawSupply: null, rawBalanceOf: async () => 1n, fundingSourceFor: async () => null, isKnownService: () => false }, { funderLookbackMs: 1 })).maxSuspiciousComponentPct).toBeNull();
  });
});
