import { describe, expect, it } from 'vitest';
import { pickAlphaCalls } from '../AlphaCallsTable.jsx';

describe('pickAlphaCalls', () => {
  it('returns top curated tokens with reasons, never fabricates', () => {
    const calls = pickAlphaCalls([
      { mint: 'A', chain: 'solana', state: 'curated', traction: { tractionScore: 80 }, safety: { score: 70 } },
      { mint: 'B', chain: 'solana', state: 'watching', traction: { tractionScore: 99 }, safety: { score: 99 } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].mint).toBe('A');
  });

  it('sorts by traction and respects the limit', () => {
    const mk = (mint, tractionScore) => ({ mint, state: 'curated', traction: { tractionScore } });
    const calls = pickAlphaCalls([mk('A', 10), mk('B', 90), mk('C', 50)], 2);
    expect(calls.map(c => c.mint)).toEqual(['B', 'C']);
  });

  it('prioritizes early runner breakout calls', () => {
    const calls = pickAlphaCalls([
      { mint: 'A', state: 'curated', traction: { tractionScore: 80 } },
      { mint: 'B', state: 'curated', earlySignal: { isEarlySignal: true }, traction: { tractionScore: 50 } },
    ]);
    expect(calls[0].mint).toBe('B');
  });
});
