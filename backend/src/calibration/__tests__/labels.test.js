import { describe, it, expect } from 'vitest';
import { buildLabel } from '../labels.js';

const cfg = { policy: { evalHorizonMs: 6 * 3600_000, positiveReturn: 0.5, mcapTarget: 500_000,
  latencyMs: 0, entrySlippageFrac: 0.05, exitSlippageFrac: 0.05, feeFrac: 0.01,
  exitLadder: [[2, 0.5], [4, 0.25]], timeStopMs: 6 * 3600_000 } };

// Minimal fake tape: returns the events it was constructed with, filtered by type.
const fakeTape = (events) => ({
  eventsUntil: async (_key, asOf, types) => events.filter(e =>
    e.chainTs <= asOf && (!types || types.includes(e.type))),
});
const created = { type: 'token_created', chainTs: 0,
  payload: { rawSupply: '1000000000000000', decimals: 6 } };
const snap = (chainTs, priceUsd) => ({ type: 'market_snapshot', chainTs, payload: { priceUsd } });

describe('buildLabel y_rugged (§7.2)', () => {
  it('flags a collapse of 90%+ from the observed peak', async () => {
    const tape = fakeTape([created, snap(1_000, 0.001), snap(2_000, 0.010), snap(3_000, 0.0005)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(true);
  });

  it('does not flag a healthy rise that ends at its peak', async () => {
    const tape = fakeTape([created, snap(1_000, 0.001), snap(2_000, 0.005)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });

  it('sees a rug whose peak occurred BEFORE the alert', async () => {
    // Peak at t=500 (pre-alert), collapse at t=3000 (post-alert).
    const tape = fakeTape([created, snap(500, 0.010), snap(2_000, 0.002), snap(3_000, 0.0002)]);
    const label = await buildLabel(tape, 'k', { ts: 1_000, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(true);
  });

  it('does not flag when the low precedes the peak (recovery, not a rug)', async () => {
    const tape = fakeTape([created, snap(1_000, 0.0001), snap(2_000, 0.010)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });

  it('needs at least two price points before calling anything a rug', async () => {
    const tape = fakeTape([created, snap(2_000, 0.001)]);
    const label = await buildLabel(tape, 'k', { ts: 0, mcap: 10_000 }, cfg);
    expect(label.y_rugged).toBe(false);
  });
});

describe('buildLabel dead-token guard (§19.2)', () => {
  it('returns an explicit failed label and never -Infinity', async () => {
    const tape = fakeTape([created, snap(500, 0.001)]);   // nothing at/after the alert
    const label = await buildLabel(tape, 'k', { ts: 1_000, mcap: 10_000 }, cfg);
    expect(label.y_dead).toBe(true);
    expect(label.y_policy_net_return).toBe(-1);
    expect(label.y_peak_opportunity).toBeNull();
    for (const value of Object.values(label)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });
});
