import { describe, expect, it } from 'vitest';
import { freshWalletFeature } from '../freshWallets.js';

describe('freshWalletFeature', () => {
  it('keeps low-history evidence separate from freshness', async () => {
    const result = await freshWalletFeature(new Set(['a', 'b', 'c']), async wallet => ({ a: 5, b: 15, c: 30 }[wallet]),
      async wallet => ({ txCount: wallet === 'b' ? 4 : 40, fundingSources: 1, hasDefiHistory: false }), { freshAgeMs: 10, freshBoundary: [1, 2] });
    expect(result).toEqual({ freshCount: 1, freshShare: 1 / 3, lowHistoryShare: 1 });
  });
});
