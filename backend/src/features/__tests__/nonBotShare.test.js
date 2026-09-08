import { describe, expect, it } from 'vitest';
import { nonBotShare } from '../nonBotShare.js';

const trades = count => Array.from({ length: count }, (_, index) => ({ route: index % 2 ? 'manual' : 'bot' }));

describe('nonBotShare', () => {
  it('keeps an experimental classifier display-only', () => {
    expect(nonBotShare(trades(40), { version: 'v1', status: 'experimental', precision: 0.9, recall: 0.4 })).toEqual({
      share: null, sampleSize: 40, classifierVersion: 'v1', classifierStatus: 'experimental', precision: 0.9, recall: 0.4,
    });
  });
  it('marks a validated classifier insufficient below 30 trades', () => {
    expect(nonBotShare(trades(29), { version: 'v2', status: 'validated', isFrontendRouted: () => true })).toMatchObject({ share: null, evidence: 'insufficient', sampleSize: 29 });
  });
  it('reports manual share only with validated sufficient evidence', () => {
    const result = nonBotShare(trades(40), { version: 'v2', status: 'validated', precision: 0.95, recall: 0.6, isFrontendRouted: trade => trade.route === 'manual' });
    expect(result).toMatchObject({ share: 0.5, evidence: 'sufficient', sampleSize: 40, classifierVersion: 'v2' });
  });
});
