import { describe, expect, it } from 'vitest';
import { selectEvictable } from '../registry.js';

describe('selectEvictable', () => {
  it('applies capacity only to evictable records', () => {
    const keep = selectEvictable([
      { mint: 'curated', state: 'curated' }, { mint: 'tracked', tracked: true }, { mint: 'position', hasOpenPosition: true },
      { mint: 'low', safety: { score: 1 } }, { mint: 'high', safety: { score: 10 } },
    ], 1).map(token => token.mint);
    expect(keep).toEqual(expect.arrayContaining(['curated', 'tracked', 'position', 'high']));
    expect(keep).not.toContain('low');
  });
});
