import { describe, it, expect } from 'vitest';
import { evaluateEarlyCaller, isEarlyRunnerCandidate } from '../earlyCaller.js';

describe('Early Meme Caller Engine', () => {
  it('identifies an ideal early runner launch (40k MCap, 7k 5m Vol, good liquidity and buy flow)', () => {
    const token = {
      marketCapUsd: 40_000,
      volume5mUsd: 7_200,
      liquidityUsd: 5_500,
      txns: {
        m5: { buys: 28, sells: 10 },
      },
      freezeAuthority: null,
      mintAuthority: null,
      smartWallets: 2,
    };

    const res = evaluateEarlyCaller(token);
    expect(res.isEarlySignal).toBe(true);
    expect(res.confidence).toBe('HIGH');
    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.signals.some(s => s.includes('Sweet spot early MCap'))).toBe(true);
    expect(res.signals.some(s => s.includes('5m volume surge'))).toBe(true);
    expect(res.signals.some(s => s.includes('Smart money detected'))).toBe(true);
    expect(isEarlyRunnerCandidate(token)).toBe(true);
  });

  it('rejects a token with high mcap (> $150k)', () => {
    const token = {
      marketCapUsd: 800_000,
      volume5mUsd: 20_000,
      liquidityUsd: 50_000,
      txns: {
        m5: { buys: 50, sells: 20 },
      },
    };

    const res = evaluateEarlyCaller(token);
    expect(res.isEarlySignal).toBe(false);
    expect(res.signals.some(s => s.includes('MCap too high'))).toBe(true);
  });

  it('rejects a token with low 5m volume (< $5k)', () => {
    const token = {
      marketCapUsd: 38_000,
      volume5mUsd: 1_200,
      liquidityUsd: 5_000,
      txns: {
        m5: { buys: 12, sells: 4 },
      },
    };

    const res = evaluateEarlyCaller(token);
    expect(res.isEarlySignal).toBe(false);
  });

  it('rejects a token with negative order flow (sell-heavy dump)', () => {
    const token = {
      marketCapUsd: 42_000,
      volume5mUsd: 8_000,
      liquidityUsd: 4_500,
      txns: {
        m5: { buys: 4, sells: 19 },
      },
    };

    const res = evaluateEarlyCaller(token);
    expect(res.isEarlySignal).toBe(false);
  });
});
