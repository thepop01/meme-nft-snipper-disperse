import { describe, expect, it } from 'vitest';
import { computeKpis } from '../KpiStrip.jsx';

describe('computeKpis', () => {
  it('counts fresh launches and curated from real tokens', () => {
    const now = Date.now();
    const kpis = computeKpis([
      { createdAt: now - 10 * 60_000, volume5mUsd: 100, state: 'curated' },
      { createdAt: now - 2 * 3600_000, volume5mUsd: 0, state: 'watching' },
    ]);
    expect(kpis.newLaunches1h).toBe(1);
    expect(kpis.curated).toBe(1);
    expect(kpis.active5m).toBe(1);
    expect(kpis.total).toBe(2);
  });

  it('handles an empty feed without NaN', () => {
    expect(computeKpis([])).toEqual({ newLaunches1h: 0, active5m: 0, curated: 0, total: 0 });
  });
});
