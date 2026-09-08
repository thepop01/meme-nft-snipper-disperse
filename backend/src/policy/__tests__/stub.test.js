import { describe, it, expect, vi } from 'vitest';
import { policyDecision, recordShadowDecision } from '../stub.js';

const cfg = { policy: { maxEntryDecayFrac: 0.05 } };
const score = (over = {}) => ({
  admission: 'qualified', blockers: [], version: 'meme-score-v2.0.0',
  alert: { ts: 1_000, mcap: 100_000 }, ...over,
});
const token = (over = {}) => ({ assetKey: 'solana:pumpfun:M', mcap: 100_000, ...over });

describe('policyDecision entry decay (§20)', () => {
  it('skips when the price already ran above the alert by more than the limit', () => {
    // +20% vs a 5% limit: the move already happened.
    const d = policyDecision(score(), token({ mcap: 120_000 }), cfg);
    expect(d.action).toBe('shadow_skip');
    expect(d.reason).toBe('entry_decay');
  });

  it('enters when the price is flat', () => {
    expect(policyDecision(score(), token({ mcap: 100_000 }), cfg).action).toBe('shadow_enter');
  });

  it('enters when the price moved DOWN — the decay guard is one-sided', () => {
    const d = policyDecision(score(), token({ mcap: 80_000 }), cfg);
    expect(d.action).toBe('shadow_enter');
  });

  it('enters at exactly the limit boundary', () => {
    expect(policyDecision(score(), token({ mcap: 105_000 }), cfg).action).toBe('shadow_enter');
  });

  it('skips just past the limit boundary', () => {
    expect(policyDecision(score(), token({ mcap: 105_001 }), cfg).action).toBe('shadow_skip');
  });

  it('skips when mcap is unavailable rather than assuming no decay', () => {
    expect(policyDecision(score(), token({ mcap: null }), cfg).reason).toBe('mcap_unavailable');
    expect(policyDecision(score({ alert: { ts: 1, mcap: null } }), token(), cfg).reason)
      .toBe('mcap_unavailable');
  });
});

describe('policyDecision gating', () => {
  it('skips anything not qualified', () => {
    for (const a of ['watching', 'provisional', 'rejected', 'unscored', 'expired']) {
      const d = policyDecision(score({ admission: a }), token(), cfg);
      expect(d.action).toBe('shadow_skip');
      expect(d.reason).toBe('not_qualified');
    }
  });

  it('skips when a blocker is present', () => {
    const d = policyDecision(score({ blockers: [{ code: 'FARM' }] }), token(), cfg);
    expect(d.reason).toBe('blocker');
  });

  it('never returns a live trading action', () => {
    const d = policyDecision(score(), token(), cfg);
    expect(d.action).toBe('shadow_enter');
    expect(JSON.stringify(d)).not.toMatch(/buy|sell|execute|sendTransaction/i);
  });
});

describe('recordShadowDecision', () => {
  it('marks the row as shadow and returns the decision', async () => {
    const store = { append: vi.fn(async () => {}) };
    const d = await recordShadowDecision(store, { action: 'shadow_enter', assetKey: 'x' });
    expect(store.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shadow_enter', shadow: true }));
    expect(d.action).toBe('shadow_enter');
  });
});
