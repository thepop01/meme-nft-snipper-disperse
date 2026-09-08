import { describe, expect, it } from 'vitest';
import { breadthFromWindow } from '../traction.js';

describe('breadthFromWindow', () => {
  it('only divides volume by trade count from the same window', () => {
    expect(breadthFromWindow(1000, 50)).toBe(20);
  });
  it('keeps missing or zero trade evidence unavailable', () => {
    expect(breadthFromWindow(1000, null)).toBeNull();
    expect(breadthFromWindow(1000, 0)).toBeNull();
  });
});
