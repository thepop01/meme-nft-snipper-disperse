import { describe, expect, it } from 'vitest';
import { admit } from '../admission.js';
import { CONFIG } from '../config.js';

const score = { status: 'scored', blockers: [], structural: { score: 90, breakdown: { capitalEfficiency: { value: 0.95 } } }, dynamic: { score: 55 }, memeScore: 71, evidenceCoverage: 71 };
describe('admission', () => {
  it('keeps a single exceptional metric provisional only while its TTL is live', () => {
    expect(admit(score, { asOf: 100, provisionalAt: 0, structural: { swapCount: 10 } }, CONFIG)).toBe('provisional');
    expect(admit(score, { asOf: CONFIG.admission.provisional.ttlMs, provisionalAt: 0, structural: { swapCount: 10 } }, CONFIG)).toBe('watching');
  });
});
