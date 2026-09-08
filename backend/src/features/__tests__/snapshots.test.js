import { describe, expect, it } from 'vitest';
import { initSnapshot, reduceSnapshot } from '../snapshots.js';

describe('immutable migration snapshots', () => {
  it('freezes the migration anchor and initial ATH', () => {
    const snapshot = initSnapshot({ mcap: 1000, ts: 100 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ anchorMcap: 1000, ath: 1000, athTs: 100 });
  });
  it('never mutates or rebases prior state', () => {
    const prior = initSnapshot({ mcap: 1000, ts: 100 });
    const high = reduceSnapshot(prior, { mcap: 2000, ts: 200 });
    const pullback = reduceSnapshot(high, { mcap: 1500, ts: 300 });
    expect(prior.mcap).toBe(1000);
    expect(high).not.toBe(prior);
    expect(pullback).toMatchObject({ anchorMcap: 1000, ath: 2000, athTs: 200, athDistance: 0.25, gainVsAnchor: 0.5 });
  });
});
