import { describe, expect, it } from 'vitest';
import { flowSeriesFrom, flowState } from '../flowState.js';

const bucket = (buySol, sellSol, partial = false) => ({ buySol, sellSol, buys: 2, sells: 2, partial });

describe('flow state', () => {
  it('does not call sparse or partial activity bullish', () => {
    const buckets = [{ buySol: 10, sellSol: 0, buys: 1, sells: 0, partial: false }, bucket(10, 0, true)];
    expect(flowState({ flowSeries: flowSeriesFrom(buckets, 4), buckets, athDistance: 0, athAgeMs: 0 }, { minTrades: 3, minVolLamports: 1 })).toEqual({ label: 'INSUFFICIENT', bullish: null });
  });
  it('uses ATH distance to separate recovering from stable highs', () => {
    const buckets = [bucket(6, 2), bucket(8, 2)];
    const flowSeries = flowSeriesFrom(buckets, 4);
    expect(flowState({ flowSeries, buckets, athDistance: 0.3, athAgeMs: 10 }, { minTrades: 3, minVolLamports: 1, athNearBand: 0.1 })).toMatchObject({ label: 'RECOVERING', bullish: true });
  });
});
