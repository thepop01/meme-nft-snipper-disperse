import { describe, expect, it } from 'vitest';
import { cohortRetention } from '../cohortRetention.js';

describe('cohort retention', () => {
  it('does not confuse a partial sale with a full exit', () => {
    const trades = Array.from({ length: 5 }, (_, index) => ({ side: 'buy', wallet: `w${index}`, chainTs: 1, rawTokens: '10' }));
    trades.push({ side: 'sell', wallet: 'w0', chainTs: 2, rawTokens: '1' }, { side: 'sell', wallet: 'w1', chainTs: 2, rawTokens: '10' });
    const bought = new Map(Array.from({ length: 5 }, (_, index) => [`w${index}`, 10n]));
    expect(cohortRetention(trades, 0, 10, 20, bought)).toMatchObject({ cohortSize: 5, fullyExited: 1, partiallySold: 1, remainingTokenPct: 0.78 });
  });
});

describe('cohort basis includes post-window buys (§12.3.5)', () => {
  const t0 = 0, entryMs = 5 * 60_000, checkMs = 15 * 60_000;
  // Five wallets enter in-window so the cohort clears its minimum size.
  const entry = ['w1', 'w2', 'w3', 'w4', 'w5'].map(wallet => ({
    wallet, side: 'buy', chainTs: 60_000, rawTokens: '100' }));
  const basis = new Map(['w1', 'w2', 'w3', 'w4', 'w5'].map(w => [w, 100n]));

  it('counts a wallet that added then sold its ORIGINAL amount as still holding', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'buy', chainTs: 10 * 60_000, rawTokens: '100' },  // adds after window
      { wallet: 'w1', side: 'sell', chainTs: 12 * 60_000, rawTokens: '100' }, // sells half its stack
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    expect(r.fullyExited).toBe(0);        // still holds 100 of 200
    expect(r.partiallySold).toBe(1);
  });

  it('includes the added tokens in remainingTokenPct', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'buy', chainTs: 10 * 60_000, rawTokens: '100' },
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    // 600 held of 600 bought
    expect(r.remainingTokenPct).toBeCloseTo(1, 10);
  });

  it('still marks a genuine full exit', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'sell', chainTs: 12 * 60_000, rawTokens: '100' },
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    expect(r.fullyExited).toBe(1);
  });

  it('ignores buys after the check horizon', () => {
    const trades = [...entry,
      { wallet: 'w1', side: 'buy', chainTs: 60 * 60_000, rawTokens: '900' },
    ];
    const r = cohortRetention(trades, t0, entryMs, checkMs, basis);
    expect(r.remainingTokenPct).toBeCloseTo(1, 10);   // the late buy is out of scope
  });
});
