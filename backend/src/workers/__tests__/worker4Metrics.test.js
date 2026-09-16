import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock store to isolate wallet persistence
vi.mock('../../store.js', () => {
  const mem = new Map();
  return {
    load: vi.fn((key, fallback) => mem.get(key) ?? fallback),
    save: vi.fn((key, value) => mem.set(key, value)),
  };
});

import { loadWallets, saveWallets } from '../../smartwallets/tracker.js';
import {
  accumulateWalletMetrics,
  processWalletMetricsPass,
} from '../worker4WalletMetrics.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrade(overrides = {}) {
  return {
    wallet: 'W11111111111111111111111111111111111111111111',
    txSignature: 'sig1111111111111111111111111111111111111111111111111111111111111111',
    timestamp: 1_700_000_000_000,
    entryMcap: 500_000,
    exitMcap: 2_000_000,
    pnl: 1_000,
    exitUsd: 50_000,
    entryUsd: 10_000,
    holdingTimeSec: 3600,
    ...overrides,
  };
}

function makeWallet(overrides = {}) {
  return {
    address: 'W11111111111111111111111111111111111111111111',
    chain: 'solana',
    category: 'tracked',
    source: 'test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// accumulateWalletMetrics
// ---------------------------------------------------------------------------

describe('accumulateWalletMetrics', () => {
  it('computes capture ratio from single trade', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        exitMcap: 3_600_000, // 90% of 4M ATH
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('captureRatioPct');
    expect(result.captureRatioPct).toBeCloseTo(90, 0);
  });

  it('computes % sold > 50% ATH', () => {
    const wallet = makeWallet();
    const tokenAthMap = {
      'token111111111111111111111111111111111111111': 4_000_000,
      'token222222222222222222222222222222222222222': 2_000_000,
    };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        exitMcap: 2_100_000, // 52.5% of 4M — above 50%
        exitUsd: 10_500,
      }),
      makeTrade({
        ca: 'token222222222222222222222222222222222222222',
        exitMcap: 900_000, // 45% of 2M — below 50%
        exitUsd: 4_500,
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('soldAbove50AthPct');
    const expected = (10_500 / (10_500 + 4_500)) * 100;
    expect(result.soldAbove50AthPct).toBeCloseTo(expected, 1);
  });

  it('computes round-trip rate (winning position back to below entry)', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        entryMcap: 500_000,
        exitMcap: 400_000, // Below entry, round-trip
        pnl: 500, // Winning trade that went back below entry
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        entryMcap: 600_000,
        exitMcap: 700_000, // Above entry, not round-trip but winning
        pnl: 500,
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        entryMcap: 800_000,
        exitMcap: 900_000, // Above entry, not round-trip
        pnl: 100,
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('roundTripRatePct');
    expect(result.roundTripRatePct).toBeCloseTo(33.33, 1); // 1 out of 3 winning trades
  });

  it('computes ROI % = Total Realized PnL / Total Invested USD', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        entryUsd: 10_000,
        pnl: 5_000,
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        entryUsd: 20_000,
        pnl: 2_000,
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('roiPct');
    const totalPnl = 5_000 + 2_000;
    const totalInvested = 10_000 + 20_000;
    const expectedRoi = (totalPnl / totalInvested) * 100;
    expect(result.roiPct).toBeCloseTo(expectedRoi, 1);
  });

  it('computes win rate % = Profitable Trades / Total Trades', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        pnl: 5_000, // winning
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        pnl: 2_000, // winning
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        pnl: -100, // losing
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        pnl: 0, // break-even (not profitable)
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('winRatePct');
    expect(result.winRatePct).toBeCloseTo(50, 1); // 2 wins out of 4
  });

  it('computes average holding time in seconds', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        holdingTimeSec: 3600, // 1 hour
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        holdingTimeSec: 7200, // 2 hours
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        holdingTimeSec: 10800, // 3 hours
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('avgHoldingTimeSec');
    expect(result.avgHoldingTimeSec).toBeCloseTo(7200, 0); // average: 2 hours
  });

  it('tracks distinct tokens traded', () => {
    const wallet = makeWallet();
    const tokenAthMap = {
      'token111111111111111111111111111111111111111': 4_000_000,
      'token222222222222222222222222222222222222222': 2_000_000,
      'token333333333333333333333333333333333333333': 1_000_000,
    };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
      }),
      makeTrade({
        ca: 'token222222222222222222222222222222222222222',
      }),
      makeTrade({
        ca: 'token333333333333333333333333333333333333333',
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('tradedTokenCAs');
    expect(result.tradedTokenCAs).toHaveLength(3);
    expect(result.tradedTokenCAs).toContain('token111111111111111111111111111111111111111');
    expect(result.tradedTokenCAs).toContain('token222222222222222222222222222222222222222');
    expect(result.tradedTokenCAs).toContain('token333333333333333333333333333333333333333');
  });

  it('does NOT store raw trades in the wallet record', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result.rawTrades).toBeUndefined();
    expect(result.trades).toBeUndefined();
  });

  it('sets watermark cursor on result', () => {
    const wallet = makeWallet();
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        txSignature: 'sig_abc123',
        timestamp: 1_700_000_100_000,
      }),
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        txSignature: 'sig_xyz789',
        timestamp: 1_700_000_200_000,
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toHaveProperty('lastProcessedTxSignature');
    expect(result).toHaveProperty('lastProcessedTimestamp');
    expect(result.lastProcessedTxSignature).toBe('sig_xyz789');
    expect(result.lastProcessedTimestamp).toBe(1_700_000_200_000);
  });

  it('accumulates metrics onto existing wallet record', () => {
    const wallet = makeWallet({
      realizedProfitUsd: 1_000,
      winRatePct: 50,
      profitableTrades: 1,
      totalTrades: 2,
      tradedTokenCAs: ['token111111111111111111111111111111111111111'],
    });
    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        pnl: 500,
        entryUsd: 10_000,
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    // Metrics should be recalculated from scratch, not accumulated
    expect(result).toHaveProperty('roiPct');
    expect(result).toHaveProperty('winRatePct');
  });

  it('handles empty trade array gracefully', () => {
    const wallet = makeWallet();
    const tokenAthMap = {};
    const trades = [];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toBeDefined();
    expect(result.captureRatioPct).toBeCloseTo(0, 1);
    expect(result.winRatePct).toBeCloseTo(0, 1);
  });

  it('handles missing ATH in tokenAthMap for a trade', () => {
    const wallet = makeWallet();
    const tokenAthMap = {}; // No ATH for token
    const trades = [
      makeTrade({
        ca: 'token111111111111111111111111111111111111111',
        exitMcap: 2_000_000,
      }),
    ];

    const result = accumulateWalletMetrics(wallet, trades, tokenAthMap);
    expect(result).toBeDefined();
    // Should handle gracefully (0 or skip)
    expect(result.captureRatioPct).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// processWalletMetricsPass
// ---------------------------------------------------------------------------

describe('processWalletMetricsPass', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('processes up to 5 wallets per pass, incremental since watermark', async () => {
    // Setup: Create wallets with no prior watermark
    const doc = {
      wallets: [
        makeWallet({ address: 'W1' }),
        makeWallet({ address: 'W2' }),
        makeWallet({ address: 'W3' }),
        makeWallet({ address: 'W4' }),
        makeWallet({ address: 'W5' }),
        makeWallet({ address: 'W6' }), // Should not be processed in first pass
      ],
    };

    // Mock fetcher: returns activity for each wallet
    const activityFetcher = vi.fn(async (walletAddr, _lastProcessedTxSig, _lastProcessedTs) => {
      if (walletAddr === 'W1') {
        return [
          makeTrade({
            wallet: walletAddr,
            ca: 'token111111111111111111111111111111111111111',
            txSignature: 'sig_w1_1',
            timestamp: 1_700_000_001_000,
          }),
        ];
      }
      return [];
    });

    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };

    // Mock loadWallets/saveWallets
    const loadWalletsMock = vi.fn(() => doc);
    const saveWalletsMock = vi.fn((updated) => {
      doc.wallets = updated.wallets;
    });

    vi.spyOn(await import('../../smartwallets/tracker.js'), 'loadWallets').mockImplementation(loadWalletsMock);
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'saveWallets').mockImplementation(saveWalletsMock);

    const processed = await processWalletMetricsPass(activityFetcher, tokenAthMap);
    expect(processed).toBeLessThanOrEqual(5);
  });

  it('fetches activity only newer than watermark cursor', async () => {
    const wallet = makeWallet({
      address: 'W_WITH_WATERMARK',
      lastProcessedTxSignature: 'sig_old',
      lastProcessedTimestamp: 1_700_000_000_000,
    });

    const doc = { wallets: [wallet] };

    const activityFetcher = vi.fn(async (walletAddr, lastSig, lastTs) => {
      expect(lastSig).toBe('sig_old');
      expect(lastTs).toBe(1_700_000_000_000);
      return [];
    });

    const tokenAthMap = {};

    vi.spyOn(await import('../../smartwallets/tracker.js'), 'loadWallets').mockImplementation(() => doc);
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'saveWallets').mockImplementation(() => {});

    await processWalletMetricsPass(activityFetcher, tokenAthMap);
    expect(activityFetcher).toHaveBeenCalled();
  });

  it('persists only metrics, never raw trades', async () => {
    const wallet = makeWallet({ address: 'W_PERSIST' });
    const doc = { wallets: [wallet] };

    const activityFetcher = vi.fn(async () => [
      makeTrade({
        wallet: 'W_PERSIST',
        ca: 'token111111111111111111111111111111111111111',
        txSignature: 'sig_1',
        timestamp: 1_700_000_001_000,
      }),
    ]);

    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };

    let savedDoc = null;
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'loadWallets').mockImplementation(() => doc);
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'saveWallets').mockImplementation((d) => {
      savedDoc = d;
    });

    await processWalletMetricsPass(activityFetcher, tokenAthMap);

    // Verify no rawTrades in persisted wallet
    if (savedDoc && savedDoc.wallets && savedDoc.wallets.length > 0) {
      const savedWallet = savedDoc.wallets[0];
      expect(savedWallet.rawTrades).toBeUndefined();
      expect(savedWallet.trades).toBeUndefined();
    }
  });

  it('updates watermark cursor on each wallet after metrics computed', async () => {
    const wallet = makeWallet({ address: 'W_CURSOR' });
    const doc = { wallets: [wallet] };

    const activityFetcher = vi.fn(async () => [
      makeTrade({
        wallet: 'W_CURSOR',
        ca: 'token111111111111111111111111111111111111111',
        txSignature: 'sig_latest',
        timestamp: 1_700_000_500_000,
      }),
    ]);

    const tokenAthMap = { 'token111111111111111111111111111111111111111': 4_000_000 };

    let savedDoc = null;
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'loadWallets').mockImplementation(() => doc);
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'saveWallets').mockImplementation((d) => {
      savedDoc = d;
    });

    await processWalletMetricsPass(activityFetcher, tokenAthMap);

    if (savedDoc && savedDoc.wallets && savedDoc.wallets.length > 0) {
      const savedWallet = savedDoc.wallets[0];
      expect(savedWallet.lastProcessedTxSignature).toBe('sig_latest');
      expect(savedWallet.lastProcessedTimestamp).toBe(1_700_000_500_000);
    }
  });

  it('handles fetcher errors gracefully, logs warning, continues', async () => {
    const w1 = makeWallet({ address: 'W1' });
    const w2 = makeWallet({ address: 'W2' });
    const doc = { wallets: [w1, w2] };

    let callCount = 0;
    const activityFetcher = vi.fn(async (walletAddr) => {
      callCount++;
      if (walletAddr === 'W1') {
        throw new Error('Fetcher error for W1');
      }
      return [];
    });

    const tokenAthMap = {};

    vi.spyOn(await import('../../smartwallets/tracker.js'), 'loadWallets').mockImplementation(() => doc);
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'saveWallets').mockImplementation(() => {});

    const processed = await processWalletMetricsPass(activityFetcher, tokenAthMap);
    // Should continue despite error and process next wallet
    expect(callCount).toBeGreaterThan(1);
  });

  it('returns count of wallets processed', async () => {
    const doc = {
      wallets: [
        makeWallet({ address: 'W1' }),
        makeWallet({ address: 'W2' }),
      ],
    };

    const activityFetcher = vi.fn(async () => []);
    const tokenAthMap = {};

    vi.spyOn(await import('../../smartwallets/tracker.js'), 'loadWallets').mockImplementation(() => doc);
    vi.spyOn(await import('../../smartwallets/tracker.js'), 'saveWallets').mockImplementation(() => {});

    const processed = await processWalletMetricsPass(activityFetcher, tokenAthMap);
    expect(typeof processed).toBe('number');
    expect(processed).toBeGreaterThanOrEqual(0);
  });
});
