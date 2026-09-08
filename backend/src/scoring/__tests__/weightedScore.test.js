import { describe, expect, it } from 'vitest';
import { weightedScore } from '../weightedScore.js';

describe('weightedScore', () => {
  it('excludes disabled features and reports available evidence', () => {
    const result = weightedScore([{ key: 'yes', value: 1, weight: 1 }, { key: 'unknown', value: null, weight: 1 }, { key: 'disabled', value: 1, weight: 0 }]);
    expect(result).toMatchObject({ score: 100, coverage: 0.5, breakdown: { yes: { contribution: 1 } } });
    expect(result.breakdown.disabled).toBeUndefined();
  });
  it('returns unknown rather than zero when all enabled inputs are unavailable', () => {
    expect(weightedScore([{ key: 'x', value: null, weight: 1 }])).toEqual({ score: null, coverage: 0, breakdown: {} });
  });
});
