import { describe, expect, it } from 'vitest';
import { capitalFormation } from '../capitalFormation.js';

const SOL = 1_000_000_000;
const buy = (sol = 1) => ({ side: 'buy', solLamports: sol * SOL });
const sell = (sol = 1) => ({ side: 'sell', solLamports: sol * SOL });

describe('capitalFormation', () => {
  it('returns unknown for legacy creation events or too few buys', () => {
    expect(capitalFormation(Array.from({ length: 5 }, () => buy()), null)).toEqual({ primary: null, coverage: 0 });
    expect(capitalFormation(Array.from({ length: 4 }, () => buy()), '10')).toEqual({ primary: null, coverage: 0 });
    expect(capitalFormation([buy(), buy(), buy(), buy(), { side: 'buy', solLamports: null }], '10')).toEqual({ primary: null, coverage: 0 });
  });
  it('records every milestone in one chronological pass', () => {
    const feature = capitalFormation([buy(1), buy(2), sell(), buy(2), buy(3), buy(2)], '10');
    expect(feature.milestones).toEqual({
      swaps_to_25pct: 2,
      swaps_to_50pct: 3,
      swaps_to_75pct: 4,
      swaps_to_100pct: 5,
    });
    expect(feature.primary).toBeCloseTo(0.2);
    expect(feature.diagnostics).toMatchObject({ swapCount: 5, sellCount: 1, solRaisedLamports: 10 * SOL });
  });
  it('leaves unreached milestones null and caps progress at one', () => {
    const feature = capitalFormation(Array.from({ length: 5 }, () => buy(1)), '20');
    expect(feature.milestones).toMatchObject({ swaps_to_25pct: 5, swaps_to_50pct: null, swaps_to_100pct: null });
    expect(feature.primary).toBeCloseTo(0.05);
  });
});
