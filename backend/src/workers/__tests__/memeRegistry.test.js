import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertMeme,
  getTrackedMemes,
  getUnbackfilledMemes,
  markMemeBackfilled,
  resetMemeRegistry,
  canonicalizeCa,
} from '../memeRegistry.js';
import { save } from '../../store.js';

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

  it('canonicalizes EVM contract addresses to lowercase while preserving Solana Base58 case', () => {
    // EVM address in checksummed format
    const evmChecksum = '0x1F9840aADC5d4367d1214ab5c8f8b3400a40f12B';
    const evmLower = '0x1f9840aadc5d4367d1214ab5c8f8b3400a40f12b';

    upsertMeme({
      ca: evmChecksum,
      chain: 'robinhood',
      name: 'UniswapToken',
      symbol: 'UNI',
      currentMcap: 2_500_000,
      athMcap: 5_000_000,
    });

    // Subsequent upsert with lowercase address
    upsertMeme({
      ca: evmLower,
      chain: 'robinhood',
      currentMcap: 2_800_000,
      source: 'current_gt_2m',
    });

    const evmMemes = getTrackedMemes({ chain: 'robinhood' });
    expect(evmMemes).toHaveLength(1);
    expect(evmMemes[0].ca).toBe(evmLower);
    expect(evmMemes[0].currentMcap).toBe(2_800_000);
    expect(evmMemes[0].sourceFlags).toContain('current_gt_2m');

    // markMemeBackfilled works using checksummed address
    const marked = markMemeBackfilled(evmChecksum);
    expect(marked).not.toBeNull();
    expect(marked.ca).toBe(evmLower);
    expect(marked.backfilled).toBe(true);

    // Solana Base58 case-sensitivity: addresses with different casing are distinct mints
    const solanaUpper = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const solanaLower = 'dezxaz8z7pnrnrjjz3wxborgixca6xjnb7yab1ppb263';

    upsertMeme({ ca: solanaUpper, chain: 'solana', name: 'BonkUpper' });
    upsertMeme({ ca: solanaLower, chain: 'solana', name: 'BonkLower' });

    const solanaMemes = getTrackedMemes({ chain: 'solana' });
    expect(solanaMemes).toHaveLength(2);
    expect(solanaMemes.some(m => m.ca === solanaUpper)).toBe(true);
    expect(solanaMemes.some(m => m.ca === solanaLower)).toBe(true);
  });

  it('strictly preserves Solana case in markMemeBackfilled and does not match different casing', () => {
    const solanaUpper = 'SolanaUpperMint1111111111111111111111111';
    const solanaLower = 'solanauppermint1111111111111111111111111';

    upsertMeme({ ca: solanaLower, chain: 'solana', name: 'SolanaLowerToken' });

    // Attempting to mark using solanaUpper must NOT mark solanaLower
    const markedUpper = markMemeBackfilled(solanaUpper);
    expect(markedUpper).toBeNull();

    const lowerToken = getTrackedMemes({ ca: solanaLower })[0];
    expect(lowerToken.backfilled).toBe(false);

    // Marking with exact matching case works
    const markedLower = markMemeBackfilled(solanaLower);
    expect(markedLower).not.toBeNull();
    expect(markedLower.ca).toBe(solanaLower);
    expect(markedLower.backfilled).toBe(true);
  });

  it('deduplicates legacy mixed-case EVM records on loadRegistry', () => {
    const mixedCase = '0x1F9840aADC5d4367d1214ab5c8f8b3400a40f12B';
    const lowerCase = mixedCase.toLowerCase();

    // Directly seed store with duplicate legacy records having mixed and lowercase EVM addresses
    save('tracked-memes', {
      memes: [
        {
          ca: mixedCase,
          chain: 'robinhood',
          name: 'UniswapMixed',
          currentMcap: 2_000_000,
          athMcap: 3_000_000,
          sourceFlags: ['flag1'],
          backfilled: false,
        },
        {
          ca: lowerCase,
          chain: 'robinhood',
          name: 'UniswapLower',
          currentMcap: 2_500_000,
          athMcap: 4_000_000,
          sourceFlags: ['flag2'],
          backfilled: true,
          backfilledAt: 1234567,
        },
      ],
    });

    const memes = getTrackedMemes();
    expect(memes).toHaveLength(1);
    expect(memes[0].ca).toBe(lowerCase);
    expect(memes[0].currentMcap).toBe(2_500_000);
    expect(memes[0].athMcap).toBe(4_000_000);
    expect(memes[0].sourceFlags).toContain('flag1');
    expect(memes[0].sourceFlags).toContain('flag2');
    expect(memes[0].backfilled).toBe(true);
    expect(memes[0].backfilledAt).toBe(1234567);
  });

  it('maintains ATH and T_ATH integrity without drift on equal ATH periodic polls', () => {
    const ca = 'SolanaAthTestToken1111111111111111111111111';

    // 1. Worker 1 token reporting only currentMcap does NOT synthesize athMcap
    const w1Token = upsertMeme({
      ca,
      name: 'AthTest',
      currentMcap: 2_500_000,
      source: 'current_gt_2m',
    });
    expect(w1Token.currentMcap).toBe(2_500_000);
    expect(w1Token.athMcap).toBe(0);
    expect(w1Token.athTimestamp).toBe(0);

    // 2. Initial ATH recorded by Worker 2
    const initialAth = upsertMeme({
      ca,
      athMcap: 5_000_000,
      athTimestamp: 1000,
      source: 'ath_gt_4m',
    });
    expect(initialAth.athMcap).toBe(5_000_000);
    expect(initialAth.athTimestamp).toBe(1000);

    // 3. Periodic poll with equal ATH and later timestamp must NOT move T_ATH forward
    const equalPoll = upsertMeme({
      ca,
      athMcap: 5_000_000,
      athTimestamp: 2000,
    });
    expect(equalPoll.athMcap).toBe(5_000_000);
    expect(equalPoll.athTimestamp).toBe(1000); // Preserved! No drift!

    // 4. Poll with strictly higher ATH updates both athMcap and athTimestamp
    const higherAth = upsertMeme({
      ca,
      athMcap: 6_500_000,
      athTimestamp: 3000,
    });
    expect(higherAth.athMcap).toBe(6_500_000);
    expect(higherAth.athTimestamp).toBe(3000);

    // 5. Current market cap exceeding ATH elevates athMcap and updates athTimestamp
    const newCurrentHigh = upsertMeme({
      ca,
      currentMcap: 8_000_000,
      athTimestamp: 4000,
    });
    expect(newCurrentHigh.currentMcap).toBe(8_000_000);
    expect(newCurrentHigh.athMcap).toBe(8_000_000);
    expect(newCurrentHigh.athTimestamp).toBe(4000);
  });

  it('getUnbackfilledMemes filters only tokens with athMcap > 0 for Worker 3', () => {
    // Worker 1 token with currentMcap > 2M but no ATH yet
    upsertMeme({
      ca: 'Worker1NoAth1111111111111111111111111111111',
      name: 'NoAthToken',
      currentMcap: 3_000_000,
      source: 'current_gt_2m',
    });

    // Worker 2 token with known ATH
    upsertMeme({
      ca: 'Worker2WithAth11111111111111111111111111111',
      name: 'WithAthToken',
      currentMcap: 2_200_000,
      athMcap: 5_000_000,
      athTimestamp: 1000,
      source: 'ath_gt_4m',
    });

    let unbackfilled = getUnbackfilledMemes();
    // Worker1NoAth must be excluded because athMcap === 0
    expect(unbackfilled).toHaveLength(1);
    expect(unbackfilled[0].ca).toBe('Worker2WithAth11111111111111111111111111111');

    // When Worker 2 later populates ATH for Worker1NoAth, it becomes eligible for Worker 3
    upsertMeme({
      ca: 'Worker1NoAth1111111111111111111111111111111',
      athMcap: 4_500_000,
      athTimestamp: 1200,
    });

    unbackfilled = getUnbackfilledMemes();
    expect(unbackfilled).toHaveLength(2);
    expect(unbackfilled.some(m => m.ca === 'Worker1NoAth1111111111111111111111111111111')).toBe(true);
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
    expect(getTrackedMemes({ backfilled: false })[0].ca).toBe('robinhoodtoken1');

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

  it('handles edge cases and robust finite number parsing in upsertMeme', () => {
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

    // Robust finite number conversion on NaN, strings, Infinity
    const robust = upsertMeme({
      ca: 'MinimalCA',
      currentMcap: NaN,
      athMcap: Infinity,
      volume24hUsd: 'not_a_number',
    });
    expect(robust.currentMcap).toBe(0);
    expect(robust.athMcap).toBe(0);
    expect(robust.volume24hUsd).toBe(0);

    // ATH is not lowered if new athMcap is lower
    upsertMeme({ ca: 'MinimalCA', athMcap: 8_000_000, athTimestamp: 1000 });
    const afterLower = upsertMeme({ ca: 'MinimalCA', athMcap: 5_000_000, athTimestamp: 2000 });
    expect(afterLower.athMcap).toBe(8_000_000);
    expect(afterLower.athTimestamp).toBe(1000);

    // If currentMcap exceeds athMcap for a token with existing athMcap > 0, athMcap expands
    const afterHigherCurrent = upsertMeme({ ca: 'MinimalCA', currentMcap: 10_000_000 });
    expect(afterHigherCurrent.currentMcap).toBe(10_000_000);
    expect(afterHigherCurrent.athMcap).toBe(10_000_000);
  });
});
