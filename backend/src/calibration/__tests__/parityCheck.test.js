import { describe, it, expect } from 'vitest';
import { compareFeatures, checkParity } from '../parityCheck.js';

describe('compareFeatures', () => {
  it('reports no differences for identical trees', () => {
    expect(compareFeatures({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  it('names the path of a changed leaf', () => {
    expect(compareFeatures({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }))
      .toEqual([{ path: 'b.c', live: 2, replay: 3 }]);
  });

  it('detects a key missing on either side', () => {
    expect(compareFeatures({ a: 1 }, {})).toEqual([{ path: 'a', live: 1, replay: undefined }]);
    expect(compareFeatures({}, { a: 1 })).toEqual([{ path: 'a', live: undefined, replay: 1 }]);
  });

  it('treats null and 0 as different — unknown is not zero', () => {
    expect(compareFeatures({ a: null }, { a: 0 }))
      .toEqual([{ path: 'a', live: null, replay: 0 }]);
  });

  it('catches a number that survived the tape as a string', () => {
    // The real JSONB failure mode the old check could not see.
    expect(compareFeatures({ ts: 1000 }, { ts: '1000' }))
      .toEqual([{ path: 'ts', live: 1000, replay: '1000' }]);
  });

  it('tolerates float noise within epsilon', () => {
    expect(compareFeatures({ a: 0.1 + 0.2 }, { a: 0.3 })).toEqual([]);
  });

  it('does not throw on BigInt values', () => {
    expect(() => compareFeatures({ a: 1n }, { a: 1n })).not.toThrow();
  });

  it('compares arrays element-wise — identical arrays are not reference diffs', () => {
    // extractAllFeatures returns root-level arrays (trades, buckets); the old
    // strict `a !== b` fallback failed parity on every real invocation.
    const trades = [{ wallet: 'w', side: 'buy' }, { wallet: 'x', side: 'sell' }];
    expect(compareFeatures({ trades }, { trades: [...trades] })).toEqual([]);
  });

  it('reports array length and element mismatches with paths', () => {
    expect(compareFeatures({ t: [1, 2] }, { t: [1] }))
      .toEqual([{ path: 't', live: 'array(2)', replay: 'array(1)' }]);
    expect(compareFeatures({ t: [1, 2] }, { t: [1, 3] }))
      .toEqual([{ path: 't[1]', live: 2, replay: 3 }]);
  });
});

describe('checkParity', () => {
  const features = { structural: { x: 1 }, dynamic: { y: 2 } };
  const tape = { eventsUntil: async () => [] };

  it('fails loudly when no live events are supplied — it cannot vacuously pass', async () => {
    const r = await checkParity(tape, 'a', 100, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_live_events');
  });

  it('passes when live and replay agree', async () => {
    const r = await checkParity(tape, 'a', 100, {
      liveEvents: [],
      extract: () => features,
      replay: async () => features,
    });
    expect(r.ok).toBe(true);
    expect(r.diffs).toEqual([]);
  });

  it('fails and reports the diverging path when they disagree', async () => {
    const r = await checkParity(tape, 'a', 100, {
      liveEvents: [],
      extract: () => ({ structural: { x: 1 } }),
      replay: async () => ({ structural: { x: 9 } }),
    });
    expect(r.ok).toBe(false);
    expect(r.diffs[0].path).toBe('structural.x');
  });

  it('treats a thrown extractor as a failure, not a silent pass', async () => {
    const r = await checkParity(tape, 'a', 100, {
      liveEvents: [],
      extract: () => { throw new Error('boom'); },
      replay: async () => features,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
});
