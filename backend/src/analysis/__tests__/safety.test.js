import { describe, expect, it } from 'vitest';
import { gmgnRiskChecks, isAnalyzable, top10ExcludingKnown } from '../safety.js';

describe('safety scope and holders', () => {
  it('only runs the Solana analyzer for Pump.fun tokens', () => {
    expect(isAnalyzable({ chain: 'solana', launchpad: 'pumpfun' })).toBe(true);
    expect(isAnalyzable({ chain: 'monad', launchpad: 'unknown' })).toBe(false);
  });
  it('excludes known system accounts by identity, not largest balance', () => {    const result = top10ExcludingKnown([
      { address: 'curve', amount: '900' }, { address: 'whale', amount: '50' }, { address: 'small', amount: '30' },
    ], address => address === 'curve');
    expect(result.top10Raw).toBe(80n);
    expect(top10ExcludingKnown([{ address: 'whale', amount: '900' }], () => false).top10Raw).toBe(900n);
  });
});

describe('gmgnRiskChecks', () => {
  it('returns no checks without GMGN evidence', () => {
    expect(gmgnRiskChecks({ mint: 'ABC', chain: 'solana' })).toEqual([]);
    expect(gmgnRiskChecks({ mint: 'ABC', smartWallets: 5 })).toEqual([]);
  });
  it('fails honeypots and near-certain rugs', () => {
    const checks = gmgnRiskChecks({ honeypot: true, rugRatio: 0.98 });
    expect(checks.find(c => c.id === 'gmgnHoneypot').status).toBe('fail');
    expect(checks.find(c => c.id === 'gmgnRug').status).toBe('fail');
  });
  it('warns on heavy bundling and concentration', () => {
    const checks = gmgnRiskChecks({ rugRatio: 0.2, bundlerPct: 45, top10HolderPct: 60 });
    expect(checks.find(c => c.id === 'gmgnBundlers').status).toBe('warn');
    expect(checks.find(c => c.id === 'gmgnConcentration').status).toBe('warn');
  });
  it('passes clean GMGN evidence', () => {
    const checks = gmgnRiskChecks({ rugRatio: 0.1, bundlerPct: 5, renouncedMint: true });
    expect(checks.some(c => c.status === 'fail' || c.status === 'warn')).toBe(false);
  });
});
