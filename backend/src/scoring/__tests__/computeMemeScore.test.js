import { describe, expect, it } from 'vitest';
import { computeMemeScore } from '../computeMemeScore.js';

const token = { assetKey: 'solana:pumpfun:A', chain: 'solana', launchpad: 'pumpfun', asOf: 100, migrated: false };
const dynamic = { flowState: { bullish: true }, retention: { remainingTokenPct: 1 }, derivatives: { velocity: 0.01 }, snapshot: { athDistance: 0 } };

describe('meme scorer', () => {
  it('rejects the 51.9 percent farm regression fixture', () => {
    const score = computeMemeScore(token, { capitalEfficiency: 0.5, maxSuspiciousComponentPct: 0.519 }, dynamic);
    expect(score.blockers.some(blocker => blocker.code === 'FARM')).toBe(true);
  });
  it('does not turn experimental bot evidence into BOT_FLOW and lowers coverage', () => {
    const withBot = computeMemeScore(token, { capitalEfficiency: 0.5, nonBotShare: 0.6 }, dynamic);
    const noBot = computeMemeScore(token, { capitalEfficiency: 0.5, nonBotShare: { share: null, classifierStatus: 'experimental' } }, dynamic);
    expect(noBot.blockers.some(blocker => blocker.code === 'BOT_FLOW')).toBe(false);
    expect(noBot.structural.coverage).toBeLessThan(withBot.structural.coverage);
  });
  it('leaves unsupported chains unscored without invoking a profile', () => {
    expect(computeMemeScore({ ...token, chain: 'monad' }, {}, {})).toMatchObject({ status: 'unscored', assetKey: token.assetKey });
  });
});
