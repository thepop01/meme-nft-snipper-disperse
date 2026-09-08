import { describe, expect, it } from 'vitest';
import { isPresent, valueOrUnavailable } from '../missingData.js';

describe('missing data helpers', () => {
  it('distinguishes zero from unavailable data', () => {
    expect(isPresent(0)).toBe(true);
    expect(isPresent(null)).toBe(false);
    expect(isPresent(Number.NaN)).toBe(false);
    expect(valueOrUnavailable(0)).toBe(0);
    expect(valueOrUnavailable(undefined)).toBe('unavailable');
  });
});
