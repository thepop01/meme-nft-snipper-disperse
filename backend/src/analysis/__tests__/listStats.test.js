import { describe, it, expect } from 'vitest';
import { pctChange, computeStats } from '../listStats.js';

describe('pctChange', () => {
  it('computes percent change', () => {
    expect(pctChange(1, 2)).toBe(100);
    expect(pctChange(2, 1)).toBe(-50);
  });
  it('returns null for missing/zero entry price', () => {
    expect(pctChange(0, 2)).toBeNull();
    expect(pctChange(null, 2)).toBeNull();
    expect(pctChange(1, null)).toBeNull();
  });
});

describe('computeStats', () => {
  const NOW = Date.now();
  const entries = [
    { entryPrice: 1, currentPrice: 2, ts: NOW - 3600_000 },      // +100
    { entryPrice: 1, currentPrice: 0.5, ts: NOW - 3600_000 },    // -50
    { entryPrice: 1, currentPrice: 1.2, ts: NOW - 3600_000 },    // +20
    { entryPrice: 1, currentPrice: 3, ts: NOW - 8 * 86400_000 }, // outside 7d
    { entryPrice: null, currentPrice: 3, ts: NOW },              // no stamp -> excluded
  ];

  it('computes median, win rate, best, worst within a window', () => {
    const s = computeStats(entries, { windowMs: 24 * 3600_000, now: NOW });
    expect(s.count).toBe(3);
    expect(s.medianPct).toBeCloseTo(20, 1);
    expect(s.winRatePct).toBeCloseTo(66.67, 1);
    expect(s.bestPct).toBe(100);
    expect(s.worstPct).toBe(-50);
  });

  it('empty window returns zeros', () => {
    const s = computeStats([], { windowMs: 1000, now: NOW });
    expect(s).toEqual({ count: 0, medianPct: null, winRatePct: null, bestPct: null, worstPct: null });
  });
});
