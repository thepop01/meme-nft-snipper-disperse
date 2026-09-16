import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertMeme,
  getTrackedMemes,
  getUnbackfilledMemes,
  markMemeBackfilled,
  resetMemeRegistry,
} from '../memeRegistry.js';

describe('memeRegistry shared store', () => {
  beforeEach(() => {
    resetMemeRegistry();
  });

  it('upserts and deduplicates tokens by CA merging sourceFlags without duplicates', () => {
    const ca = 'Mint1111111111111111111111111111111111111111';

    upsertMeme({
      ca,
      name: 'PepeSol',
      symbol: 'PEPE',
      chain: 'solana',
      currentMcap: 2_500_000,
      athMcap: 3_000_000,
      athTimestamp: 1700000000000,
      volume24hUsd: 500_000,
      source: 'current_gt_2m',
    });

    // Second upsert with higher ATH and another source tag
    upsertMeme({
      ca,
      athMcap: 4_500_000,
      athTimestamp: 1700003600000,
      source: 'ath_gt_4m',
    });

    // Third upsert with sourceFlags array containing duplicates and a new flag
    upsertMeme({
      ca,
      sourceFlags: ['current_gt_2m', 'ath_gt_4m', 'extra_signal'],
    });

    const memes = getTrackedMemes();
    expect(memes).toHaveLength(1);

    const token = memes[0];
    expect(token.ca).toBe(ca);
    expect(token.name).toBe('PepeSol');
    expect(token.symbol).toBe('PEPE');
    expect(token.chain).toBe('solana');
    expect(token.currentMcap).toBe(2_500_000);
    expect(token.athMcap).toBe(4_500_000);
    expect(token.athTimestamp).toBe(1700003600000);
    expect(token.volume24hUsd).toBe(500_000);
    expect(token.sourceFlags).toEqual(['current_gt_2m', 'ath_gt_4m', 'extra_signal']);
    expect(token.backfilled).toBe(false);
    expect(token.backfilledAt).toBeNull();
  });

  it('updating Mcap / ATH does not overwrite backfilled: true or backfilledAt', () => {
    const ca = 'MintBackfilled11111111111111111111111111111';

    upsertMeme({
      ca,
      name: 'AlphaToken',
      symbol: 'ALPHA',
      currentMcap: 2_100_000,
      athMcap: 4_200_000,
      source: 'current_gt_2m',
    });

    const marked = markMemeBackfilled(ca);
    expect(marked.backfilled).toBe(true);
    expect(marked.backfilledAt).toBeGreaterThan(0);
    const originalBackfilledAt = marked.backfilledAt;

    // Subsequent worker passes update Mcap, ATH, and attempt setting backfilled: false
    const updated = upsertMeme({
      ca,
      currentMcap: 3_000_000,
      athMcap: 6_000_000,
      backfilled: false,
    });

    expect(updated.backfilled).toBe(true);
    expect(updated.backfilledAt).toBe(originalBackfilledAt);
    expect(updated.currentMcap).toBe(3_000_000);
    expect(updated.athMcap).toBe(6_000_000);

    const fromRegistry = getTrackedMemes({ ca })[0];
    expect(fromRegistry.backfilled).toBe(true);
    expect(fromRegistry.backfilledAt).toBe(originalBackfilledAt);
  });

  it('filters unbackfilled memes with pagination and updates backfill status', () => {
    const ca1 = 'MintA11111111111111111111111111111111111111';
    const ca2 = 'MintB11111111111111111111111111111111111111';
    const ca3 = 'MintC11111111111111111111111111111111111111';

    upsertMeme({ ca: ca1, name: 'TokenA', athMcap: 5_000_000 });
    upsertMeme({ ca: ca2, name: 'TokenB', athMcap: 6_000_000 });
    upsertMeme({ ca: ca3, name: 'TokenC', athMcap: 7_000_000 });

    let unbackfilled = getUnbackfilledMemes();
    expect(unbackfilled).toHaveLength(3);

    // Limit pagination
    const limited = getUnbackfilledMemes(2);
    expect(limited).toHaveLength(2);

    // Mark one backfilled
    markMemeBackfilled(ca1);
    unbackfilled = getUnbackfilledMemes();
    expect(unbackfilled).toHaveLength(2);
    expect(unbackfilled.some(m => m.ca === ca1)).toBe(false);
    expect(unbackfilled.some(m => m.ca === ca2)).toBe(true);
    expect(unbackfilled.some(m => m.ca === ca3)).toBe(true);

    // Mark remaining backfilled
    markMemeBackfilled(ca2);
    markMemeBackfilled(ca3);
    expect(getUnbackfilledMemes()).toHaveLength(0);
  });

  it('handles markMemeBackfilled for invalid or nonexistent CA gracefully', () => {
    expect(markMemeBackfilled(null)).toBeNull();
    expect(markMemeBackfilled('')).toBeNull();
    expect(markMemeBackfilled('NonExistentCA')).toBeNull();
  });

  it('supports filtering in getTrackedMemes by source, chain, backfilled, and ca', () => {
    upsertMeme({
      ca: 'SolanaToken1',
      chain: 'solana',
      source: 'current_gt_2m',
    });
    upsertMeme({
      ca: 'RobinhoodToken1',
      chain: 'robinhood',
      source: 'ath_gt_4m',
    });

    markMemeBackfilled('SolanaToken1');

    // Filter by backfilled (boolean)
    expect(getTrackedMemes({ backfilled: true })).toHaveLength(1);
    expect(getTrackedMemes({ backfilled: true })[0].ca).toBe('SolanaToken1');
    expect(getTrackedMemes({ backfilled: false })).toHaveLength(1);
    expect(getTrackedMemes({ backfilled: false })[0].ca).toBe('RobinhoodToken1');

    // Filter by backfilled (string from query params)
    expect(getTrackedMemes({ backfilled: 'true' })).toHaveLength(1);
    expect(getTrackedMemes({ backfilled: 'false' })).toHaveLength(1);

    // Filter by source
    expect(getTrackedMemes({ source: 'current_gt_2m' })).toHaveLength(1);
    expect(getTrackedMemes({ source: 'ath_gt_4m' })).toHaveLength(1);
    expect(getTrackedMemes({ source: 'nonexistent_flag' })).toHaveLength(0);

    // Filter by chain
    expect(getTrackedMemes({ chain: 'solana' })).toHaveLength(1);
    expect(getTrackedMemes({ chain: 'robinhood' })).toHaveLength(1);

    // Filter by specific ca
    expect(getTrackedMemes({ ca: 'SolanaToken1' })).toHaveLength(1);
    expect(getTrackedMemes({ ca: 'Unknown' })).toHaveLength(0);

    // All memes unfiltered
    expect(getTrackedMemes()).toHaveLength(2);
  });

  it('handles edge cases in upsertMeme properly', () => {
    expect(upsertMeme(null)).toBeNull();
    expect(upsertMeme({})).toBeNull();
    expect(upsertMeme({ ca: '' })).toBeNull();

    // Default values for omitted fields
    const minimal = upsertMeme({ ca: 'MinimalCA' });
    expect(minimal.name).toBe('Unknown');
    expect(minimal.symbol).toBe('?');
    expect(minimal.chain).toBe('solana');
    expect(minimal.currentMcap).toBe(0);
    expect(minimal.athMcap).toBe(0);
    expect(minimal.volume24hUsd).toBe(0);
    expect(minimal.sourceFlags).toEqual([]);
    expect(minimal.backfilled).toBe(false);
    expect(minimal.backfilledAt).toBeNull();

    // ATH is not lowered if new athMcap is lower
    upsertMeme({ ca: 'MinimalCA', athMcap: 8_000_000, athTimestamp: 1000 });
    const afterLower = upsertMeme({ ca: 'MinimalCA', athMcap: 5_000_000, athTimestamp: 2000 });
    expect(afterLower.athMcap).toBe(8_000_000);
    expect(afterLower.athTimestamp).toBe(1000);

    // If currentMcap exceeds athMcap, athMcap expands to match currentMcap
    const afterHigherCurrent = upsertMeme({ ca: 'MinimalCA', currentMcap: 10_000_000 });
    expect(afterHigherCurrent.currentMcap).toBe(10_000_000);
    expect(afterHigherCurrent.athMcap).toBe(10_000_000);
  });
});
