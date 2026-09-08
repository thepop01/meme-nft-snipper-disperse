import { describe, expect, it } from 'vitest';
import { causalFeatures, extractAllFeatures, migrationAnchorMcap } from '../extract.js';
import { EVENT_TYPES } from '../../tape/identity.js';

const event = (chainTs, type, payload) => ({ chain_ts: chainTs, type, payload });

describe('shared causal extractor', () => {
  it('assembles creation, trades, censoring, and a supply-aware migration snapshot', () => {
    const events = [
      event(0, EVENT_TYPES.TOKEN_CREATED, { creator: 'dev', rawSupply: '1000000000000', decimals: 6 }),
      event(1_000, EVENT_TYPES.TRADE_OBSERVED, { side: 'buy', wallet: 'w1', lamports: 100 }),
      event(2_000, EVENT_TYPES.BASELINE_CLOSED, { reason: 'window', swapsObserved: 1 }),
      event(5_000, EVENT_TYPES.MIGRATION_OBSERVED, { priceUsd: 0.002 }),
    ];
    const features = extractAllFeatures(events, { nowTs: 60_000, windowMs: 60_000 });
    expect(features.created.creator).toBe('dev');
    expect(features.buckets[0]).toMatchObject({ buys: 1, buySol: 100 });
    expect(features.baseline).toMatchObject({ reason: 'window', swapsObserved: 1 });
    expect(features.snapshot?.anchorMcap).toBeCloseTo(2000);
  });
  it('keeps unknown migration market cap unavailable rather than guessing it', () => {
    expect(migrationAnchorMcap(event(0, EVENT_TYPES.TOKEN_CREATED, { rawSupply: '1', decimals: 0 }), event(1, EVENT_TYPES.MIGRATION_OBSERVED, {}))).toBeNull();
  });
  it('reduces supply-aware market snapshots causally after migration', () => {
    const events = [
      event(0, EVENT_TYPES.TOKEN_CREATED, { rawSupply: '1000000000000', decimals: 6 }),
      event(1_000, EVENT_TYPES.MIGRATION_OBSERVED, { priceUsd: 0.001 }),
      event(2_000, EVENT_TYPES.MARKET_SNAPSHOT, { priceUsd: 0.002, rawSupply: '1000000000000', decimals: 6, source: 'pumpportal' }),
    ];
    const features = extractAllFeatures(events, { nowTs: 3_000 });
    expect(features.snapshot).toMatchObject({ anchorMcap: 1000, mcap: 2000, ath: 2000 });
    expect(features.dynamic.snapshot).toBe(features.snapshot);
  });
  it('registers Phase 3 structural families in the one extractor', () => {
    const created = event(0, EVENT_TYPES.TOKEN_CREATED, { curveTargetSol: '10' });
    const buys = Array.from({ length: 30 }, (_, index) => event(index + 1, EVENT_TYPES.TRADE_OBSERVED, {
      side: 'buy', wallet: `w${index}`, lamports: 1_000_000_000, rawTokens: '1', route: index % 2 ? 'manual' : 'bot',
    }));
    const classifier = { version: 'routes-v1', status: 'validated', precision: 0.95, recall: 0.5, isFrontendRouted: trade => trade.route === 'manual' };
    const features = extractAllFeatures([created, ...buys], { nowTs: 100, classifier });
    expect(features.structural.capitalFormation).toMatchObject({ coverage: 1, diagnostics: { swapCount: 30 } });
    expect(features.structural.nonBotShare).toMatchObject({ share: 0.5, evidence: 'sufficient', classifierVersion: 'routes-v1' });
  });
  it('reads no later events than the causal as-of time', async () => {
    const tape = { eventsUntil: async (assetKey, asOf) => { expect([assetKey, asOf]).toEqual(['solana:pumpfun:A', 1234]); return [event(0, EVENT_TYPES.TOKEN_CREATED, {})]; } };
    expect((await causalFeatures(tape, 'solana:pumpfun:A', 1234)).created).toEqual({});
  });
});
