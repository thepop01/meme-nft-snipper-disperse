import { describe, expect, it, vi } from 'vitest';
import { StructuralEvidenceCollector } from '../structuralEvidence.js';
import { manualClock } from '../clock.js';

describe('StructuralEvidenceCollector', () => {
  it('writes one holder and one funding tape event then de-duplicates the immutable snapshot', async () => {
    const appended = []; const tape = { append: vi.fn(async event => { appended.push(event); return true; }), launchesByCreatorCluster: async () => [] };
    const collector = new StructuralEvidenceCollector({ tape, clock: manualClock(10), concurrency: 1,
      rpc: { getMintInfo: async () => ({ rawSupply: 1000n }), getTokenLargestAccounts: async () => [{ address: 'holder', rawAmount: 100n }], getAccountAuthority: async address => ({ address }), rawBalanceOf: async () => 100n },
      resolvers: { isCurvePool: () => false, isAmmVault: () => false, isBurn: () => false, isKnownService: () => false },
      fundingSourceFor: async () => null, walletAge: async () => 1, richProfile: async () => ({ txCount: 1, fundingSources: 1, hasDefiHistory: false }),
      cfg: { version: 'evidence-v1', funderLookbackMs: 100, freshAgeMs: 100, freshBoundary: [1, 2], baseRates: { prior: 0.2 }, shrinkStrength: 5, devConfidentN: 8, rugWindowMs: 100 },
    });
    const asset = { assetKey: 'solana:pumpfun:A', mint: 'A', creationTs: 1, creator: 'dev', rawSupply: '1000', trades: [{ side: 'buy', wallet: 'w' }] };
    await collector.collect(asset); await collector.collect(asset);
    expect(appended.map(event => event.type)).toEqual(['holder_snapshot', 'funding_link']);
  });
});
