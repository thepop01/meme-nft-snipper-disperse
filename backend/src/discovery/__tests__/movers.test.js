import { describe, expect, it } from 'vitest';
import { normalizeTrendingPool } from '../movers.js';

// A pool created well over a year ago (the Udin-style aged revival case).
const OLD_DATE = '2025-03-26T02:51:24Z';

function fixture({
  createdAt = OLD_DATE, liquidity = '50000', h1 = '40000', h24 = '80000',
  symbol = 'UDIN', address = 'AGEDmint111',
} = {}) {
  const pool = {
    attributes: {
      address: 'poolAddr', name: `${symbol} / SOL`, pool_created_at: createdAt,
      reserve_in_usd: liquidity, volume_usd: { h1, h24 },
    },
    relationships: { base_token: { data: { id: 'solana_base' } } },
  };
  const included = new Map([
    ['solana_base', { attributes: { address, name: 'Udin din din dun', symbol, image_url: null } }],
  ]);
  return { pool, included };
}

describe('normalizeTrendingPool', () => {
  it('registers an aged token with a strong volume surge', () => {
    const { pool, included } = fixture(); // heat = 40k*24/80k = 12 >> 2.5
    const t = normalizeTrendingPool(pool, included, { rank: 40 });
    expect(t).not.toBeNull();
    expect(t.source).toBe('revival');
    expect(t.mint).toBe('AGEDmint111');
    expect(t.revivalHeat).toBe(12);
    expect(t.revivedAgeDays).toBeGreaterThan(300);
  });

  it('rejects fresh launches (< 24h old)', () => {
    // 1h old — belongs to the pump.fun / raydium launch feeds, not revivals.
    const created = new Date(Date.now() - 3600_000).toISOString();
    const { pool, included } = fixture({ createdAt: created });
    expect(normalizeTrendingPool(pool, included, { rank: 5 })).toBeNull();
  });

  it('rejects illiquid pools', () => {
    const { pool, included } = fixture({ liquidity: '5000' });
    expect(normalizeTrendingPool(pool, included, { rank: 5 })).toBeNull();
  });

  it('rejects a cold aged pool with no surge, boost, or top ranking', () => {
    // heat = 10k*24/80k = 3... make it below threshold: h1 8000 => 2.4
    const { pool, included } = fixture({ h1: '8000', h24: '80000' });
    expect(normalizeTrendingPool(pool, included, { rank: 40 })).toBeNull();
  });

  it('accepts a cold aged pool when it is boosted', () => {
    const { pool, included } = fixture({ h1: '8000', h24: '80000' });
    const boostedMints = new Set(['AGEDmint111']);
    const t = normalizeTrendingPool(pool, included, { rank: 40, boostedMints });
    expect(t).not.toBeNull();
    expect(t.revivalBoosted).toBe(true);
  });

  it('accepts a cold aged pool when it ranks in the trending top 20', () => {
    const { pool, included } = fixture({ h1: '8000', h24: '80000' });
    const t = normalizeTrendingPool(pool, included, { rank: 3 });
    expect(t).not.toBeNull();
    expect(t.revivalRank).toBe(4);
  });

  it('returns null when the base token id is missing entirely', () => {
    const pool = {
      attributes: { pool_created_at: OLD_DATE, reserve_in_usd: '50000', volume_usd: { h1: '40000', h24: '80000' } },
      relationships: {},
    };
    expect(normalizeTrendingPool(pool, new Map(), { rank: 1 })).toBeNull();
  });
});
