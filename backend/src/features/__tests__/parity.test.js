import { describe, expect, it, vi } from 'vitest';
import * as extract from '../extract.js';

describe('feature extractor parity', () => {
  it('routes causal reads through the public live extractor reference', async () => {
    const spy = vi.spyOn(extract, 'extractAllFeatures');
    await extract.causalFeatures({ eventsUntil: async () => [] }, 'solana:pumpfun:A', 100, { windowMs: 60_000 });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
  it('exports one assembly entry point', () => {
    expect(Object.keys(extract).filter(key => /extract.*Features/i.test(key))).toEqual(['extractAllFeatures']);
  });
});
