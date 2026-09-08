import { describe, expect, it } from 'vitest';
import { top10ExLp } from '../topHolders.js';

describe('top10ExLp', () => {
  it('excludes only authority-resolved system accounts, never the biggest normal holder', async () => {
    const rpc = { getMintInfo: async () => ({ rawSupply: 1000n }), getTokenLargestAccounts: async () => [
      { address: 'curve', rawAmount: 800n }, { address: 'whale', rawAmount: 100n }, { address: 'user', rawAmount: 50n },
    ], getAccountAuthority: async address => ({ address }) };
    const resolvers = { isCurvePool: info => info.address === 'curve', isAmmVault: () => false, isBurn: () => false };
    expect(await top10ExLp(rpc, 'mint', resolvers)).toEqual({ top10ExLpPct: 0.15, resolvedExclusions: true });
  });
});
