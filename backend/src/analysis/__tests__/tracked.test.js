import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

const saved = {};
vi.mock('fs', () => ({
  readFileSync: (path) => {
    if (path.includes('tracked.json') && saved.tracked) return JSON.stringify(saved.tracked);
    throw new Error('ENOENT');
  },
  writeFileSync: (path, data) => {
    if (path.includes('tracked.json')) saved.tracked = JSON.parse(data);
  },
  mkdirSync: () => {},
}));

describe('tracked tier', () => {
  let tracked;

  beforeEach(async () => {
    saved.tracked = null;
    vi.resetModules();
    tracked = await import('../tracked.js');
  });

  it('promotes a token to tracked', () => {
    const token = { mint: 'abc123', symbol: 'TEST', priceUsd: 0.001, liquidityUsd: 15000, traction: { tractionScore: 50 } };
    const entry = tracked.promoteToTracked(token, 'survived');
    expect(entry).not.toBeNull();
    expect(entry.mint).toBe('abc123');
    expect(entry.reason).toBe('survived');
    expect(tracked.getTracked()).toHaveLength(1);
  });

  it('does not promote a duplicate', () => {
    const token = { mint: 'abc123', symbol: 'TEST', priceUsd: 0.001, liquidityUsd: 15000, traction: { tractionScore: 50 } };
    tracked.promoteToTracked(token, 'survived');
    const dup = tracked.promoteToTracked(token, 'manual');
    expect(dup).toBeNull();
    expect(tracked.getTracked()).toHaveLength(1);
  });

  it('manualTrack pins a token', () => {
    const token = { mint: 'abc123', symbol: 'TEST', priceUsd: 0.001, liquidityUsd: 5000, traction: null };
    const entry = tracked.manualTrack(token);
    expect(entry.manual).toBe(true);
    expect(entry.reason).toBe('manual');
  });

  it('untrack removes a token', () => {
    const token = { mint: 'abc123', symbol: 'TEST', priceUsd: 0.001, liquidityUsd: 5000, traction: null };
    tracked.promoteToTracked(token, 'manual');
    expect(tracked.untrack('abc123')).toBe(true);
    expect(tracked.getTracked()).toHaveLength(0);
    expect(tracked.untrack('abc123')).toBe(false);
  });

  it('evaluatePromotion promotes curated tokens', () => {
    const token = {
      mint: 'curated1', symbol: 'CURE', state: 'curated',
      priceUsd: 0.01, liquidityUsd: 20000, traction: { tractionScore: 70 },
      createdAt: Date.now(),
    };
    tracked.evaluatePromotion(token);
    expect(tracked.getTracked()).toHaveLength(1);
    expect(tracked.getTrackedByMint('curated1').reason).toBe('curated');
  });

  it('evaluatePromotion promotes high-traction tokens', () => {
    const token = {
      mint: 'traction1', symbol: 'TRAC', state: 'watching',
      priceUsd: 0.005, liquidityUsd: 8000, traction: { tractionScore: 65 },
      createdAt: Date.now(),
    };
    tracked.evaluatePromotion(token);
    expect(tracked.getTracked()).toHaveLength(1);
    expect(tracked.getTrackedByMint('traction1').reason).toBe('traction');
  });

  it('evaluatePromotion promotes survived 6h + liq > $10k', () => {
    const token = {
      mint: 'survived1', symbol: 'SURV', state: 'watching',
      priceUsd: 0.002, liquidityUsd: 12000, traction: { tractionScore: 30 },
      createdAt: Date.now() - 7 * 3600_000, // 7h old
    };
    tracked.evaluatePromotion(token);
    expect(tracked.getTracked()).toHaveLength(1);
    expect(tracked.getTrackedByMint('survived1').reason).toBe('survived');
  });

  it('evaluatePromotion skips low-traction young tokens', () => {
    const token = {
      mint: 'low1', symbol: 'LOW', state: 'watching',
      priceUsd: 0.001, liquidityUsd: 5000, traction: { tractionScore: 30 },
      createdAt: Date.now() - 3600_000, // 1h old
    };
    tracked.evaluatePromotion(token);
    expect(tracked.getTracked()).toHaveLength(0);
  });

  it('evaluatePromotion skips discarded tokens', () => {
    const token = {
      mint: 'disc1', symbol: 'DISC', state: 'discarded',
      priceUsd: 0, liquidityUsd: 0, traction: { tractionScore: 80 },
      createdAt: Date.now(),
    };
    tracked.evaluatePromotion(token);
    expect(tracked.getTracked()).toHaveLength(0);
  });

  it('updateTrackedMarket updates volume history', () => {
    const token = { mint: 'abc123', symbol: 'TEST', priceUsd: 0.001, liquidityUsd: 5000, traction: null };
    tracked.promoteToTracked(token, 'manual');
    const wake = tracked.updateTrackedMarket('abc123', {
      priceUsd: 0.002, liquidityUsd: 6000, volume24hUsd: 50000,
    });
    const entry = tracked.getTrackedByMint('abc123');
    expect(entry.volumeHistory).toHaveLength(1);
    expect(entry.volumeHistory[0].v).toBe(50000);
    expect(entry.priceHistory30m).toHaveLength(1);
  });

  it('getTrackedCadence categorizes tokens by quiet time', () => {
    const now = Date.now();
    // Normal tracked (active recently)
    tracked.promoteToTracked({ mint: 'active', symbol: 'ACT', priceUsd: 0.001, liquidityUsd: 5000, traction: null }, 'manual');
    const entry = tracked.getTrackedByMint('active');
    entry.lastActivityAt = now - 3600_000; // 1h ago → normal

    // Quiet tracked (no activity for 48h+)
    tracked.promoteToTracked({ mint: 'quiet', symbol: 'QUI', priceUsd: 0.001, liquidityUsd: 5000, traction: null }, 'manual');
    const quiet = tracked.getTrackedByMint('quiet');
    quiet.lastActivityAt = now - 50 * 3600_000; // 50h ago → slow

    const cadence = tracked.getTrackedCadence();
    expect(cadence.normal).toContain('active');
    expect(cadence.slow).toContain('quiet');
  });

  it('rejects tokens with marketCapUsd < 4000', () => {
    const token = { mint: 'sub4k', symbol: 'SUB', marketCapUsd: 3500, liquidityUsd: 10000, state: 'curated' };
    const res = tracked.promoteToTracked(token, 'curated');
    expect(res).toBeNull();
    expect(tracked.getTrackedByMint('sub4k')).toBeNull();
  });

  it('rejects tokens that peaked >= 50k and fell below 5k', () => {
    const token = { mint: 'peak50k', symbol: 'DROP', peakMarketCapUsd: 60000, marketCapUsd: 4500, liquidityUsd: 10000 };
    const res = tracked.promoteToTracked(token, 'manual');
    expect(res).toBeNull();
  });

  it('rejects tokens that peaked >= 300k and fell below 10k', () => {
    const token = { mint: 'peak300k', symbol: 'DROP2', peakMarketCapUsd: 350000, marketCapUsd: 8000, liquidityUsd: 10000 };
    const res = tracked.promoteToTracked(token, 'manual');
    expect(res).toBeNull();
  });

  it('evicts tracked tokens live if market cap collapses or falls below 4k', () => {
    const token = { mint: 'liveCollapse', symbol: 'LIVE', marketCapUsd: 55000, liquidityUsd: 10000 };
    tracked.promoteToTracked(token, 'manual');
    expect(tracked.getTrackedByMint('liveCollapse')).not.toBeNull();

    // Live update crashes below 5k after peaking > 50k
    tracked.updateTrackedMarket('liveCollapse', { marketCapUsd: 4200, liquidityUsd: 2000 });
    expect(tracked.getTrackedByMint('liveCollapse')).toBeNull();
  });
});
