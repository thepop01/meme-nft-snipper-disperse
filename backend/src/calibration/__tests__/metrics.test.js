import { describe, it, expect } from 'vitest';
import { precisionAtK, evPerAlert, assertProbabilities, brier, calibrationTable }
  from '../metrics.js';

// Canonical row: { assetKey, score, label } where label is a buildLabel() result.
const row = (score, netReturn, over = {}) => ({
  assetKey: `k${score}`, score,
  label: { y_policy_net_return: netReturn, y_policy_net_positive: netReturn >= 0.5,
           y_rugged: false, y_dead: false, ...over },
});

describe('evPerAlert (§19.4 — THE metric)', () => {
  it('averages the policy net return, not a hit rate', () => {
    // 3 losers at -1, 1 winner at +9 -> hit rate 25% but EV is +1.5
    const rows = [row(90, 9), row(80, -1), row(70, -1), row(60, -1)];
    expect(evPerAlert(rows)).toBeCloseTo(1.5, 10);
  });

  it('never returns NaN for well-formed labels', () => {
    expect(Number.isNaN(evPerAlert([row(1, 0.2)]))).toBe(false);
  });

  it('ignores unlabeled rows instead of poisoning the mean', () => {
    expect(evPerAlert([row(90, 1), { assetKey: 'x', score: 50, label: null }]))
      .toBeCloseTo(1, 10);
  });

  it('returns null when nothing is labeled', () => {
    expect(evPerAlert([])).toBeNull();
    expect(evPerAlert([{ assetKey: 'x', score: 1, label: null }])).toBeNull();
  });
});

describe('precisionAtK (§19.4)', () => {
  it('is the profitable fraction of the top K by score', () => {
    const rows = [row(90, 1), row(80, -1), row(70, 2), row(60, -1)];
    expect(precisionAtK(rows, 2)).toBe(0.5);
    expect(precisionAtK(rows, 4)).toBe(0.5);
  });

  it('reads y_policy_net_positive, not a bare truthy label object', () => {
    // A label object is always truthy; only the flag decides success.
    expect(precisionAtK([row(90, -1)], 1)).toBe(0);
  });

  it('returns null for an empty set rather than NaN', () => {
    expect(precisionAtK([], 10)).toBeNull();
  });
});

describe('probability gate (§19.4)', () => {
  const calibrated = [
    { probability: 0, isProbability: true, label: false },
    { probability: 1, isProbability: true, label: true },
  ];

  it('rejects a raw 0-100 memeScore', () => {
    expect(() => brier([{ probability: 75, isProbability: true, label: true }])).toThrow();
  });

  it('rejects unmarked inputs', () => {
    expect(() => assertProbabilities([{ probability: 0.5, label: true }])).toThrow();
  });

  it('accepts calibrated probabilities', () => {
    expect(brier(calibrated)).toBeCloseTo(0, 10);
    expect(calibrationTable(calibrated, 2)).toHaveLength(2);
  });
});
