import { describe, expect, it } from 'vitest';
import { devFingerprint } from '../devFingerprint.js';

describe('devFingerprint', () => {
  it('returns unknown without history and shrinks observed outcomes to the base rate', async () => {
    const unknown = await devFingerprint('dev', { launchesByCreatorCluster: async () => [] }, async () => 'root', { prior: 0.2 }, { shrinkStrength: 5, devConfidentN: 8, rugWindowMs: 100 });
    expect(unknown).toEqual({ known: false, coverage: 0 });
    const tape = { launchesByCreatorCluster: async () => [{ maxMcap: 100, finalMcap: 5, collapseTs: 20, athTs: 10, migrationTs: 15, devFirstSellTs: 12, creationTs: 0 }] };
    const result = await devFingerprint('dev', tape, async () => 'root', { prior: 0.2 }, { shrinkStrength: 5, devConfidentN: 8, rugWindowMs: 100 });
    expect(result).toMatchObject({ known: true, launches: 1, rugRate: 2 / 6, graduationRate: 2 / 6, medianAthMcap: 100, medianDevFirstSellMs: 12 });
  });
});
