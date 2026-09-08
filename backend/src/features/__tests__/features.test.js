import { describe, expect, it, vi } from 'vitest';
import * as extract from '../extract.js';
import { supplyAwareMcap } from '../mcap.js';
import { bucketize } from '../windows.js';
import { initSnapshot, reduceSnapshot } from '../snapshots.js';
import { EVENT_TYPES } from '../../tape/identity.js';

describe('causal feature primitives', () => {
  it('uses actual supply for market cap', () => expect(supplyAwareMcap({ rawSupply: 1_000_000_000_000n, decimals: 6, priceUsd: 0.002 })).toBeCloseTo(2000));
  it('aggregates fixed windows and marks an incomplete window', () => {
    const buckets = bucketize([{ chainTs: 1, side: 'buy', solLamports: 2, wallet: 'a' }, { chainTs: 61_000, side: 'sell', solLamports: 1, wallet: 'a' }], 60_000, 0, 120_000, 70_000);
    expect(buckets).toMatchObject([{ buySol: 2, buys: 1, partial: false }, { sellSol: 1, sells: 1, partial: true }]);
  });
  it('creates immutable snapshots with an anchor that never rebases', () => {
    const initial = initSnapshot({ mcap: 100, ts: 1 }); const next = reduceSnapshot(initial, { mcap: 200, ts: 2 });
    expect(Object.isFrozen(next)).toBe(true); expect(initial.mcap).toBe(100); expect(next).toMatchObject({ anchorMcap: 100, ath: 200, gainVsAnchor: 1 });
  });
  it('reads causal tape events and delegates through the public shared extractor', async () => {
    const spy = vi.spyOn(extract, 'extractAllFeatures'); const tape = { eventsUntil: vi.fn(async () => [{ chain_ts: 0, type: EVENT_TYPES.TOKEN_CREATED, payload: {} }]) };
    const features = await extract.causalFeatures(tape, 'solana:pumpfun:A', 100, { windowMs: 60_000 });
    expect(tape.eventsUntil).toHaveBeenCalledWith('solana:pumpfun:A', 100); expect(spy).toHaveBeenCalledOnce(); expect(features.created).toEqual({}); spy.mockRestore();
  });
});
