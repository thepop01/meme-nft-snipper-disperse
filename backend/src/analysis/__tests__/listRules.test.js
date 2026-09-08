import { describe, it, expect } from 'vitest';
import { matchesRules, RULE_FIELDS } from '../listRules.js';

const token = {
  mint: 'M1', symbol: 'PEPE2', name: 'Pepe Two', source: 'pumpfun',
  liquidityUsd: 20000, volume24hUsd: 50000, marketCapUsd: 100000,
  safety: { score: 70 }, traction: { tractionScore: 55 },
  top10HolderPct: 30, holderCount: 400,
  createdAt: Date.now() - 10 * 60_000,
  socials: { twitter: 'https://x.com/x' },
};

describe('matchesRules', () => {
  it('empty rules match everything', () => {
    expect(matchesRules(token, {}).match).toBe(true);
  });

  it('AND-combines numeric thresholds and reports failing reasons', () => {
    const pass = matchesRules(token, { minLiquidityUsd: 10000, minSafetyScore: 60 });
    expect(pass.match).toBe(true);
    expect(pass.reasons).toEqual(['minLiquidityUsd', 'minSafetyScore']);

    const fail = matchesRules(token, { minLiquidityUsd: 50000, minSafetyScore: 60 });
    expect(fail.match).toBe(false);
  });

  it('checks every numeric rule direction', () => {
    expect(matchesRules(token, { maxLiquidityUsd: 10000 }).match).toBe(false);
    expect(matchesRules(token, { minTractionScore: 60 }).match).toBe(false);
    expect(matchesRules(token, { maxTop10HolderPct: 25 }).match).toBe(false);
    expect(matchesRules(token, { maxAgeMin: 5 }).match).toBe(false);
    expect(matchesRules(token, { minVolume24hUsd: 60000 }).match).toBe(false);
    expect(matchesRules(token, { minHolderCount: 500 }).match).toBe(false);
  });

  it('missing token data fails a rule that needs it', () => {
    const bare = { mint: 'M2', createdAt: Date.now() };
    expect(matchesRules(bare, { minSafetyScore: 10 }).match).toBe(false);
  });

  it('source and keyword include/exclude', () => {
    expect(matchesRules(token, { source: 'raydium' }).match).toBe(false);
    expect(matchesRules(token, { source: 'pumpfun' }).match).toBe(true);
    expect(matchesRules(token, { keywordsInclude: ['pepe', 'doge'] }).match).toBe(true);
    expect(matchesRules(token, { keywordsInclude: ['doge'] }).match).toBe(false);
    expect(matchesRules(token, { keywordsExclude: ['pepe'] }).match).toBe(false);
    expect(matchesRules(token, { keywordsExclude: ['doge'] }).match).toBe(true);
  });

  it('requireSocials passes with any social present', () => {
    expect(matchesRules(token, { requireSocials: true }).match).toBe(true);
    expect(matchesRules({ ...token, socials: {} }, { requireSocials: true }).match).toBe(false);
  });

  it('RULE_FIELDS lists every supported rule for the UI form', () => {
    expect(RULE_FIELDS.map(f => f.key)).toEqual([
      'minLiquidityUsd', 'maxLiquidityUsd', 'minSafetyScore', 'minTractionScore',
      'maxTop10HolderPct', 'maxAgeMin', 'minAgeMin', 'minMarketCapUsd',
      'maxMarketCapUsd', 'minVolume5mUsd', 'minVolume1hUsd', 'minVolume24hUsd',
      'minBuySellRatio', 'minPriceChange5mPct', 'minPriceChange1hPct',
      'maxPriceChange1hPct', 'maxBundlerPct', 'minSmartWallets', 'minWhales',
      'minSnipers', 'minFreshWallets', 'chain', 'source', 'chainsInclude',
      'chainsExclude', 'sourcesInclude', 'sourcesExclude', 'keywordsInclude',
      'keywordsExclude', 'minHolderCount', 'requireSocials', 'requireWebsite',
      'requireTwitter',
    ]);
  });
});
