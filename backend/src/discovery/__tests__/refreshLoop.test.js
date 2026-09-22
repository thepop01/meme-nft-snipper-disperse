import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));
vi.mock('../../alerts.js', () => ({ pushAlert: vi.fn() }));

const registryTokens = new Map();
vi.mock('../registry.js', () => ({
  getCuratedTokens: () => [...registryTokens.values()].filter(t => t.state === 'curated'),
  getTokens: () => [...registryTokens.values()],
  getTokenByMint: (m) => registryTokens.get(m) || null,
  getTokenByKey: (k) => registryTokens.get(k) || null,
  applyMarketPatch: vi.fn((mint, patch) => {
    const t = registryTokens.get(mint);
    if (!t) return null;
    Object.assign(t, patch);
    t.peakLiquidityUsd = Math.max(t.peakLiquidityUsd ?? 0, patch.liquidityUsd ?? 0);
    return t;
  }),
  flagRugged: vi.fn((mint, reason) => {
    const t = registryTokens.get(mint);
    if (t) { t.rugged = true; t.ruggedReason = reason; }
    return t;
  }),
}));
vi.mock('../../analysis/customLists.js', () => ({
  trackedMints: () => ['LISTED1'],
  evaluateToken: vi.fn(),
  evaluateTokens: vi.fn(),
}));
vi.mock('../../engine/positions.js', () => ({ getPositions: () => [{ mint: 'POS1' }] }));

import { flagRugged } from '../registry.js';

describe('refreshLoop', () => {
  let loop;
  beforeEach(async () => {
    registryTokens.clear();
    vi.clearAllMocks();
    vi.resetModules();
    loop = await import('../refreshLoop.js');
  });

  it('collects curated + listed + position descriptors without duplicates', () => {
    registryTokens.set('CUR1', { mint: 'CUR1', state: 'curated' });
    registryTokens.set('LISTED1', { mint: 'LISTED1', state: 'watching' });
    const descriptors = loop.collectRefreshMints();
    expect(descriptors.map(d => d.mint).sort()).toEqual(['CUR1', 'LISTED1', 'POS1']);
    expect(descriptors.every(d => d.chain === 'solana')).toBe(true);
  });

  it('runRefreshTick patches tokens from DexScreener pairs (chunks of 30)', async () => {
    for (let i = 0; i < 35; i++) registryTokens.set(`C${i}`, { mint: `C${i}`, state: 'curated', peakLiquidityUsd: 0 });
    const fetchPrices = vi.fn(async (descriptors) => descriptors.map(d => ({
      mint: d.mint, chain: d.chain, priceUsd: 1, liquidityUsd: 5000, marketCapUsd: 10000, volume24hUsd: 200,
    })));
    await loop.runRefreshTick({ fetchPrices });
    expect(fetchPrices).toHaveBeenCalledTimes(2); // 30 + 5 (position/list mints not in registry are skipped after lookup)
    expect(fetchPrices.mock.calls[0][0]).toHaveLength(30);
  });

  it('flags a rug when liquidity drops 70% from peak', async () => {
    registryTokens.set('CUR1', { mint: 'CUR1', state: 'curated', peakLiquidityUsd: 10000 });
    const fetchPrices = vi.fn(async (descriptors) => descriptors.map(d => ({
      mint: d.mint, chain: d.chain, priceUsd: 0.1, liquidityUsd: 2000, marketCapUsd: 1000, volume24hUsd: 10,
    })));
    await loop.runRefreshTick({ fetchPrices });
    expect(flagRugged).toHaveBeenCalledWith('CUR1', expect.stringMatching(/liquidity/i));
  });

  it('skips a tick while the previous one is running', async () => {
    registryTokens.set('CUR1', { mint: 'CUR1', state: 'curated', peakLiquidityUsd: 0 });
    let release;
    const fetchPrices = vi.fn(() => new Promise(r => { release = () => r([]); }));
    const p1 = loop.runRefreshTick({ fetchPrices });
    const p2 = loop.runRefreshTick({ fetchPrices });
    release();
    await Promise.all([p1, p2]);
    expect(fetchPrices).toHaveBeenCalledTimes(1);
  });

  it('compares an immutable prior snapshot when detecting a volume spike', () => {
    expect(loop.detectSpikeBetween({ volumeUsd: 100 }, { volumeUsd: 400 }, { volumeRatio: 3 })).toBe(true);
    const same = { volumeUsd: 400 };
    expect(loop.detectSpikeBetween(same, same, { volumeRatio: 3 })).toBe(false);
  });
});
