import { describe, expect, it } from 'vitest';
import { DerivativeTracker } from '../derivatives.js';

describe('smoothed derivatives', () => {
  it('reports normalized per-minute changes and rejects invalid intervals', () => {
    const tracker = new DerivativeTracker(1);
    tracker.update(100, 1);
    expect(tracker.update(200, 60_000)).toMatchObject({ velocity: 1, acceleration: 1 });
    expect(tracker.update(300, 0)).toMatchObject({ velocity: 1, acceleration: 1 });
  });
});
