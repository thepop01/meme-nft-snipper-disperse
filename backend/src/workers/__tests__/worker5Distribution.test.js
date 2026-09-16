import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock store to isolate ATH cache persistence
vi.mock('../../store.js', () => {
  const mem = new Map();
  return {
    load: vi.fn((key, fallback) => mem.get(key) ?? fallback),
    save: vi.fn((key, value) => mem.set(key, value)),
  };
});

import { loadWallets, saveWallets } from '../../smartwallets/tracker.js';
import {
  loadAthCache,
  persistAthCache,
  upsertTokenAth,
  getTokenAth,
  classifyWalletTokens,
  runWorker5Pass,
  resetTokenAthCache,
} from '../worker5TokenDistribution.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWallet(overrides = {}) {
  return {
    address: 'W11111111111111111111111111111111111111111111',
    chain: 'solana',
    category: 'tracked',
    source: 'test',
    tradedTokenCAs: [],
    tokensTradedGt2m: 0,
    tokensTradedLt2m: 0,
    hitRateGt2mPct: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worker 5 Token ATH Cache & Hit-Rate Classifier', () => {
  beforeEach(() => {
    resetTokenAthCache();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // upsertTokenAth and getTokenAth
  // =========================================================================

  describe('upsertTokenAth and getTokenAth', () => {
    it('upserts a token with ATH >= $2M and marks isGt2m = true', () => {
      const ca = 'token111111111111111111111111111111111111111';
      upsertTokenAth(ca, 'MEME', 5_000_000);

      const record = getTokenAth(ca);
      expect(record).toEqual({
        ca,
        symbol: 'MEME',
        athMcap: 5_000_000,
        isGt2m: true,
      });
    });

    it('upserts a token with ATH < $2M and marks isGt2m = false', () => {
      const ca = 'token222222222222222222222222222222222222222';
      upsertTokenAth(ca, 'SMALL', 1_500_000);

      const record = getTokenAth(ca);
      expect(record).toEqual({
        ca,
        symbol: 'SMALL',
        athMcap: 1_500_000,
        isGt2m: false,
      });
    });

    it('upserts a token exactly at $2M and marks isGt2m = true', () => {
      const ca = 'token333333333333333333333333333333333333333';
      upsertTokenAth(ca, 'EXACT', 2_000_000);

      const record = getTokenAth(ca);
      expect(record).toEqual({
        ca,
        symbol: 'EXACT',
        athMcap: 2_000_000,
        isGt2m: true,
      });
    });

    it('returns null for non-existent token', () => {
      const record = getTokenAth('nonexistent');
      expect(record).toBeNull();
    });

    it('updates existing token record', () => {
      const ca = 'token444444444444444444444444444444444444444';
      upsertTokenAth(ca, 'OLD', 1_000_000);
      let record = getTokenAth(ca);
      expect(record.athMcap).toBe(1_000_000);

      upsertTokenAth(ca, 'NEW', 3_000_000);
      record = getTokenAth(ca);
      expect(record).toEqual({
        ca,
        symbol: 'NEW',
        athMcap: 3_000_000,
        isGt2m: true,
      });
    });
  });

  // =========================================================================
  // classifyWalletTokens
  // =========================================================================

  describe('classifyWalletTokens', () => {
    it('classifies wallet with all tokens >= $2M', () => {
      const ca1 = 'token111111111111111111111111111111111111111';
      const ca2 = 'token222222222222222222222222222222222222222';

      upsertTokenAth(ca1, 'BIG1', 5_000_000);
      upsertTokenAth(ca2, 'BIG2', 3_000_000);

      const wallet = makeWallet({
        tradedTokenCAs: [ca1, ca2],
      });

      const result = classifyWalletTokens(wallet);
      expect(result.tokensTradedGt2m).toBe(2);
      expect(result.tokensTradedLt2m).toBe(0);
      expect(result.hitRateGt2mPct).toBeCloseTo(100, 1);
    });

    it('classifies wallet with all tokens < $2M', () => {
      const ca1 = 'token333333333333333333333333333333333333333';
      const ca2 = 'token444444444444444444444444444444444444444';

      upsertTokenAth(ca1, 'SMALL1', 1_000_000);
      upsertTokenAth(ca2, 'SMALL2', 1_500_000);

      const wallet = makeWallet({
        tradedTokenCAs: [ca1, ca2],
      });

      const result = classifyWalletTokens(wallet);
      expect(result.tokensTradedGt2m).toBe(0);
      expect(result.tokensTradedLt2m).toBe(2);
      expect(result.hitRateGt2mPct).toBeCloseTo(0, 1);
    });

    it('classifies wallet with mixed tokens and calculates correct hit rate', () => {
      const ca1 = 'token555555555555555555555555555555555555555';
      const ca2 = 'token666666666666666666666666666666666666666';
      const ca3 = 'token777777777777777777777777777777777777777';
      const ca4 = 'token888888888888888888888888888888888888888';

      upsertTokenAth(ca1, 'BIG', 5_000_000);
      upsertTokenAth(ca2, 'SMALL', 1_000_000);
      upsertTokenAth(ca3, 'MID', 3_000_000);
      upsertTokenAth(ca4, 'TINY', 500_000);

      const wallet = makeWallet({
        tradedTokenCAs: [ca1, ca2, ca3, ca4],
      });

      const result = classifyWalletTokens(wallet);
      expect(result.tokensTradedGt2m).toBe(2); // BIG, MID
      expect(result.tokensTradedLt2m).toBe(2); // SMALL, TINY
      expect(result.hitRateGt2mPct).toBeCloseTo(50, 1);
    });

    it('handles wallet with no traded tokens', () => {
      const wallet = makeWallet({
        tradedTokenCAs: [],
      });

      const result = classifyWalletTokens(wallet);
      expect(result.tokensTradedGt2m).toBe(0);
      expect(result.tokensTradedLt2m).toBe(0);
      expect(result.hitRateGt2mPct).toBe(0); // 0/0 -> 0
    });

    it('ignores unknown token CAs in wallet', () => {
      const ca1 = 'token999999999999999999999999999999999999999';
      const unknown = 'unknown1111111111111111111111111111111111111';

      upsertTokenAth(ca1, 'KNOWN', 3_000_000);

      const wallet = makeWallet({
        tradedTokenCAs: [ca1, unknown],
      });

      const result = classifyWalletTokens(wallet);
      expect(result.tokensTradedGt2m).toBe(1);
      expect(result.tokensTradedLt2m).toBe(0);
      expect(result.hitRateGt2mPct).toBeCloseTo(100, 1);
    });
  });

  // =========================================================================
  // runWorker5Pass
  // =========================================================================

  describe('runWorker5Pass', () => {
    it('fetches and upserts missing token ATHs', async () => {
      const ca1 = 'token_missing_1111111111111111111111111111111111111';
      const ca2 = 'token_missing_2222222222222222222222222222222222222';

      // Create wallets with traded tokens
      const wallet1 = makeWallet({
        address: 'W11111111111111111111111111111111111111111111',
        tradedTokenCAs: [ca1, ca2],
      });

      // Save to wallet store
      const doc = loadWallets();
      doc.wallets = [wallet1];
      saveWallets(doc);

      // Mock tokenAthFetcher that returns token ATH data
      const fetcher = vi.fn(async (cas) => [
        { ca: ca1, symbol: 'MISS1', athMcap: 5_000_000 },
        { ca: ca2, symbol: 'MISS2', athMcap: 1_000_000 },
      ]);

      const result = await runWorker5Pass(fetcher);

      // Verify fetcher was called with missing CAs
      expect(fetcher).toHaveBeenCalled();
      const calledWith = fetcher.mock.calls[0][0];
      expect(calledWith).toContain(ca1);
      expect(calledWith).toContain(ca2);

      // Verify tokens are now cached
      expect(getTokenAth(ca1)).toEqual({
        ca: ca1,
        symbol: 'MISS1',
        athMcap: 5_000_000,
        isGt2m: true,
      });
      expect(getTokenAth(ca2)).toEqual({
        ca: ca2,
        symbol: 'MISS2',
        athMcap: 1_000_000,
        isGt2m: false,
      });
    });

    it('limits fetch to 30 tokens per pass', async () => {
      const cas = Array.from({ length: 50 }, (_, i) =>
        `token_limited_${String(i).padStart(3, '0')}111111111111111111111111111`
      );

      const wallet = makeWallet({
        address: 'W22222222222222222222222222222222222222222222',
        tradedTokenCAs: cas,
      });

      const doc = loadWallets();
      doc.wallets = [wallet];
      saveWallets(doc);

      const fetcher = vi.fn(async (fetchCas) => {
        return fetchCas.map((ca, i) => ({
          ca,
          symbol: `SYM${i}`,
          athMcap: 2_000_000 + i * 100_000,
        }));
      });

      await runWorker5Pass(fetcher);

      // Verify fetcher was called with at most 30 items
      const calledWith = fetcher.mock.calls[0][0];
      expect(calledWith.length).toBeLessThanOrEqual(30);
    });

    it('recalculates wallet hit rates after fetching ATHs', async () => {
      const ca1 = 'token_for_hitrate_111111111111111111111111111';
      const ca2 = 'token_for_hitrate_222222222222222222222222222';

      const wallet = makeWallet({
        address: 'W33333333333333333333333333333333333333333333',
        tradedTokenCAs: [ca1, ca2],
        tokensTradedGt2m: 0,
        tokensTradedLt2m: 0,
        hitRateGt2mPct: 0,
      });

      const doc = loadWallets();
      doc.wallets = [wallet];
      saveWallets(doc);

      const fetcher = vi.fn(async (cas) => [
        { ca: ca1, symbol: 'HR1', athMcap: 5_000_000 },
        { ca: ca2, symbol: 'HR2', athMcap: 1_500_000 },
      ]);

      await runWorker5Pass(fetcher);

      // Load updated wallets and verify hit rate was recalculated
      const updated = loadWallets();
      const updatedWallet = updated.wallets.find(w => w.address === wallet.address);

      expect(updatedWallet.tokensTradedGt2m).toBe(1);
      expect(updatedWallet.tokensTradedLt2m).toBe(1);
      expect(updatedWallet.hitRateGt2mPct).toBeCloseTo(50, 1);
    });

    it('only fetches tokens not already in cache', async () => {
      const ca1 = 'token_cached_1111111111111111111111111111111111111'; // Already cached
      const ca2 = 'token_missing_1111111111111111111111111111111111111'; // Not cached

      // Pre-populate cache
      upsertTokenAth(ca1, 'CACHED', 4_000_000);

      const wallet = makeWallet({
        address: 'W44444444444444444444444444444444444444444444',
        tradedTokenCAs: [ca1, ca2],
      });

      const doc = loadWallets();
      doc.wallets = [wallet];
      saveWallets(doc);

      const fetcher = vi.fn(async (cas) => {
        return cas.map((ca, i) => ({
          ca,
          symbol: `SYM${i}`,
          athMcap: 2_000_000,
        }));
      });

      await runWorker5Pass(fetcher);

      // Verify fetcher was NOT called with already-cached ca1
      const calledWith = fetcher.mock.calls[0][0];
      expect(calledWith).not.toContain(ca1);
      expect(calledWith).toContain(ca2);
    });

    it('handles empty fetcher results gracefully', async () => {
      const ca1 = 'token_empty_fetch_111111111111111111111111111';

      const wallet = makeWallet({
        address: 'W55555555555555555555555555555555555555555555',
        tradedTokenCAs: [ca1],
      });

      const doc = loadWallets();
      doc.wallets = [wallet];
      saveWallets(doc);

      const fetcher = vi.fn(async () => []); // No results

      await runWorker5Pass(fetcher);

      // Token should still not be in cache
      expect(getTokenAth(ca1)).toBeNull();
    });

    it('returns information about tokens fetched', async () => {
      const ca1 = 'token_return_info_111111111111111111111111111';
      const ca2 = 'token_return_info_222222222222222222222222222';

      const wallet = makeWallet({
        address: 'W66666666666666666666666666666666666666666666',
        tradedTokenCAs: [ca1, ca2],
      });

      const doc = loadWallets();
      doc.wallets = [wallet];
      saveWallets(doc);

      const fetcher = vi.fn(async (cas) => [
        { ca: ca1, symbol: 'INFO1', athMcap: 5_000_000 },
        { ca: ca2, symbol: 'INFO2', athMcap: 1_000_000 },
      ]);

      const result = await runWorker5Pass(fetcher);

      expect(result).toHaveProperty('fetched');
      expect(result.fetched).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // resetTokenAthCache
  // =========================================================================

  describe('resetTokenAthCache', () => {
    it('clears cache and persistent store', () => {
      const ca = 'token_to_clear_111111111111111111111111111111111111';
      upsertTokenAth(ca, 'CLEAR', 3_000_000);

      expect(getTokenAth(ca)).not.toBeNull();

      resetTokenAthCache();

      expect(getTokenAth(ca)).toBeNull();
    });

    it('allows re-populating after reset', () => {
      const ca = 'token_repopulate_111111111111111111111111111111111';
      upsertTokenAth(ca, 'BEFORE', 3_000_000);

      resetTokenAthCache();

      upsertTokenAth(ca, 'AFTER', 4_000_000);
      const record = getTokenAth(ca);

      expect(record).toEqual({
        ca,
        symbol: 'AFTER',
        athMcap: 4_000_000,
        isGt2m: true,
      });
    });
  });
});
