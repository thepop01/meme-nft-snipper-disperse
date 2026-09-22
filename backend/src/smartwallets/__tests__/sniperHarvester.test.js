import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeGmgnSniperPayload,
  harvestMadeOnSolSnipers,
  harvestPumpFunSlot0Snipers,
  harvestGmgnMemeSnipers,
  harvestRobinhoodDexSnipers,
  runDualChainSniperHarvest,
} from '../sniperHarvester.js';
import { loadWallets, saveWallets } from '../tracker.js';

describe('Dual-Chain Sniper Harvester (Phase 2)', () => {
  const SOL_MINT = '6p6xgHyF7AeQHyiaACeccN6Wn94nXguPFqWvUxpump';
  const SOL_SNIPER_1 = 'cATq48AALCiD2hECKZDgKHp3VoSHbXc4aDxSzgQLbc3';
  const SOL_SNIPER_2 = '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX';

  const RH_CA = '0x117cc2133c37b721f49de2a7a74833232b3b4c0c';
  const RH_POOL = '0xddcbba3666f578e3f09516f21ff85bfee859ab5e';
  const RH_SNIPER_1 = '0x4337038429b76948ee97eb2d8115513277c3abf5';

  beforeEach(() => {
    saveWallets({
      updatedAt: new Date().toISOString(),
      wallets: [],
      runners: [],
    });
  });

  describe('normalizeGmgnSniperPayload', () => {
    it('returns empty array on invalid payload', () => {
      expect(normalizeGmgnSniperPayload(SOL_MINT, null)).toEqual([]);
      expect(normalizeGmgnSniperPayload(SOL_MINT, {})).toEqual([]);
      expect(normalizeGmgnSniperPayload(SOL_MINT, 'error')).toEqual([]);
    });

    it('extracts snipers and computes profit and tags', () => {
      const payload = {
        data: {
          snipers: [
            {
              address: SOL_SNIPER_1,
              realized_pnl: 15400.5,
              snipe_cost: 250,
              holding_time_seconds: 45,
            },
          ],
        },
      };

      const snipers = normalizeGmgnSniperPayload(SOL_MINT, payload);
      expect(snipers).toHaveLength(1);
      expect(snipers[0]).toMatchObject({
        address: SOL_SNIPER_1,
        chain: 'solana',
        category: 'tracked',
        source: 'gmgn_sniper',
        realizedProfitUsd: 15400.5,
      });
      expect(snipers[0].tags).toContain('sniper');
      expect(snipers[0].tags).toContain('gmgn_sniper');
      expect(snipers[0].tags).toContain('profitable_sniper');
      expect(snipers[0].evidence.mint).toBe(SOL_MINT);
      expect(snipers[0].evidence.snipeCostUsd).toBe(250);
    });

    it('extracts snipers from GMGN CLI list format and handles Robinhood EVM tokens', () => {
      const payload = {
        list: [
          {
            address: RH_SNIPER_1.toUpperCase(),
            realized_profit: 41757.9,
            buy_volume_cur: 2929.9,
            start_holding_at: 1788804947,
            end_holding_at: 1788805000,
          },
        ],
      };

      const snipers = normalizeGmgnSniperPayload(RH_CA, payload, 'robinhood');
      expect(snipers).toHaveLength(1);
      expect(snipers[0]).toMatchObject({
        address: RH_SNIPER_1.toLowerCase(),
        chain: 'robinhood',
        category: 'tracked',
        source: 'gmgn_sniper',
        realizedProfitUsd: 41757.9,
      });
      expect(snipers[0].tags).toContain('sniper');
      expect(snipers[0].tags).toContain('gmgn_sniper');
      expect(snipers[0].tags).toContain('profitable_sniper');
      expect(snipers[0].evidence.snipeCostUsd).toBe(2929.9);
      expect(snipers[0].evidence.holdingTimeSeconds).toBe(53);
    });
  });

  describe('harvestMadeOnSolSnipers', () => {
    it('paginates and aggregates snipers from MadeOnSol alpha leaderboard', async () => {
      const mockFetcher = vi.fn().mockImplementation(({ offset }) => {
        if (offset === 0) {
          return Promise.resolve([
            { address: SOL_SNIPER_1, chain: 'solana', tags: ['sniper', 'madeonsol_sniper'] },
          ]);
        }
        if (offset === 50) {
          return Promise.resolve([
            { address: SOL_SNIPER_2, chain: 'solana', tags: ['sniper', 'madeonsol_sniper'] },
          ]);
        }
        return Promise.resolve([]);
      });

      const snipers = await harvestMadeOnSolSnipers({
        limit: 50,
        maxPages: 3,
        customFetcher: mockFetcher,
      });

      expect(snipers).toHaveLength(2);
      expect(snipers.map(s => s.address)).toContain(SOL_SNIPER_1);
      expect(snipers.map(s => s.address)).toContain(SOL_SNIPER_2);
    });
  });

  describe('harvestPumpFunSlot0Snipers', () => {
    it('extracts slot-0 bundle snipers from pump.fun runner memes', async () => {
      const memes = [
        {
          ca: SOL_MINT,
          chain: 'solana',
          symbol: 'TESTPUMP',
          sourceFlags: ['pumpfun'],
        },
      ];

      const mockTradesFetcher = vi.fn().mockResolvedValue([
        { wallet: SOL_SNIPER_1, timestamp: 1726000000000, pnl: 5 },
        { wallet: SOL_SNIPER_2, timestamp: 1726000001000, pnl: 2 },
      ]);

      const snipers = await harvestPumpFunSlot0Snipers(memes, {
        maxPerMeme: 2,
        customTradesFetcher: mockTradesFetcher,
      });

      expect(snipers).toHaveLength(2);
      expect(snipers[0].address).toBe(SOL_SNIPER_1);
      expect(snipers[0].tags).toContain('slot0_bundle_sniper');
      expect(snipers[0].tags).toContain('pumpfun_sniper');
      expect(snipers[1].tags).toContain('slot0_bundle_sniper');
    });
  });

  describe('harvestRobinhoodDexSnipers', () => {
    it('extracts earliest DEX buyer wallets for Robinhood runner memes', async () => {
      const memes = [
        {
          ca: RH_CA,
          chain: 'robinhood',
          symbol: 'RH_RUNNER',
          poolAddress: RH_POOL,
        },
      ];

      const mockTradesFetcher = vi.fn().mockResolvedValue([
        {
          wallet: RH_SNIPER_1,
          kind: 'buy',
          timestamp: 1789670000000,
          volumeUsd: 300,
        },
        {
          wallet: '0x0000000000000000000000000000000000000000', // Invalid or burn
          kind: 'sell',
        },
      ]);

      const snipers = await harvestRobinhoodDexSnipers(memes, {
        maxPerMeme: 5,
        customTradesFetcher: mockTradesFetcher,
      });

      expect(snipers).toHaveLength(1);
      expect(snipers[0].address).toBe(RH_SNIPER_1.toLowerCase());
      expect(snipers[0].chain).toBe('robinhood');
      expect(snipers[0].tags).toContain('robinhood_dex_sniper');
      expect(snipers[0].tags).toContain('slot0_dex_sniper');
    });
  });

  describe('harvestGmgnMemeSnipers', () => {
    it('harvests snipers across both Solana and Robinhood runner memes', async () => {
      const memes = [
        { ca: SOL_MINT, chain: 'solana', symbol: 'TESTSOL' },
        { ca: RH_CA, chain: 'robinhood', symbol: 'TESTRH' },
      ];

      const mockFetcher = vi.fn().mockImplementation((ca) => {
        if (ca === SOL_MINT) {
          return Promise.resolve([
            { address: SOL_SNIPER_1, chain: 'solana', tags: ['sniper', 'gmgn_sniper'] },
          ]);
        }
        if (ca === RH_CA) {
          return Promise.resolve([
            { address: RH_SNIPER_1.toUpperCase(), chain: 'robinhood', tags: ['sniper', 'gmgn_sniper'] },
          ]);
        }
        return Promise.resolve([]);
      });

      const snipers = await harvestGmgnMemeSnipers(memes, {
        maxMemes: 5,
        customGmgnFetcher: mockFetcher,
      });

      expect(snipers).toHaveLength(2);
      expect(snipers.map(s => s.address)).toContain(SOL_SNIPER_1);
      expect(snipers.map(s => s.address)).toContain(RH_SNIPER_1.toLowerCase());
    });
  });

  describe('runDualChainSniperHarvest and Strict Zero Raw Tx Storage', () => {
    it('executes master harvest and writes only aggregated metrics to store without raw tx logs', async () => {
      const mockMadeOnSol = vi.fn().mockResolvedValue([
        { address: SOL_SNIPER_1, chain: 'solana', category: 'tracked', tags: ['sniper', 'madeonsol_sniper'] },
      ]);

      const mockPumpTrades = vi.fn().mockResolvedValue([
        { wallet: SOL_SNIPER_2, timestamp: 1726000000000, pnl: 10 },
      ]);

      const mockGmgn = vi.fn().mockResolvedValue([
        { address: SOL_SNIPER_1, chain: 'solana', category: 'tracked', tags: ['sniper', 'gmgn_sniper'] },
      ]);

      const mockRobinhoodTrades = vi.fn().mockResolvedValue([
        { wallet: RH_SNIPER_1, kind: 'buy', timestamp: 1789670000000, volumeUsd: 500 },
      ]);

      const result = await runDualChainSniperHarvest({
        memes: [
          { ca: SOL_MINT, chain: 'solana', symbol: 'TESTPUMP', sourceFlags: ['pumpfun'] },
          { ca: RH_CA, chain: 'robinhood', symbol: 'RH_RUNNER', poolAddress: RH_POOL },
        ],
        maxMadeOnSolPages: 1,
        customMadeOnSolFetcher: mockMadeOnSol,
        customPumpTradesFetcher: mockPumpTrades,
        customGmgnFetcher: mockGmgn,
        customRobinhoodTradesFetcher: mockRobinhoodTrades,
      });

      expect(result.totalHarvested).toBeGreaterThanOrEqual(3);
      expect(result.totalStoreWallets).toBeGreaterThanOrEqual(3);

      const store = loadWallets();
      expect(store.wallets.length).toBeGreaterThanOrEqual(3);

      // CRITICAL REQUIREMENT: STRICT ZERO RAW TRANSACTION STORAGE
      for (const w of store.wallets) {
        expect(w.transactions).toBeUndefined();
        expect(w.rawTxs).toBeUndefined();
        expect(w.trades).toBeUndefined();
        expect(w.swaps).toBeUndefined();
        expect(w.txLogs).toBeUndefined();
      }
    });
  });
});
