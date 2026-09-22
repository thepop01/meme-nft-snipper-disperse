import { describe, expect, it } from 'vitest';
import {
  tierForAth,
  qualifiesEarlyBuy,
  earlyBuyerLimitForAth,
  isSmartWallet,
  isWhaleWallet,
  classifyWalletCategory,
  isTradeProfitable,
  EARLY_BUYER_RULES,
  MIN_RUNNER_ATH,
} from '../tiers.js';
import {
  selectEarlyBuyers,
  selectEarlyBuyersByMcap,
  selectAthEarlyBuyers,
  selectEarlyBuyersDual,
  connectLineageWallet,
  connectWhaleWallet,
  findRunners,
} from '../tracker.js';

describe('smart wallet tiers', () => {
  it('rejects runner ATH < 1M (changed from 500k to 1M)', () => {
    expect(MIN_RUNNER_ATH).toBe(1_000_000);
    expect(tierForAth(500_000)).toBeNull();
    expect(tierForAth(800_000)).toBeNull();
    expect(qualifiesEarlyBuy({ athMcap: 500_000, buyMcap: 50_000 })).toBe(false);
    expect(earlyBuyerLimitForAth(500_000)).toBe(0);
    expect(earlyBuyerLimitForAth(800_000)).toBe(0);
  });

  it('maps ATH 1M -> buy below 250k (25% of 1M)', () => {
    expect(tierForAth(1_000_000)?.maxBuyMcap).toBe(250_000);
    expect(qualifiesEarlyBuy({ athMcap: 1_000_000, buyMcap: 240_000 })).toBe(true);
    expect(qualifiesEarlyBuy({ athMcap: 1_000_000, buyMcap: 260_000 })).toBe(false);
  });

  it('maps ATH 5M -> buy below 1.25M (25% of 5M)', () => {
    expect(tierForAth(5_000_000)?.maxBuyMcap).toBe(1_250_000);
    expect(qualifiesEarlyBuy({ athMcap: 5_000_000, buyMcap: 1_200_000 })).toBe(true);
    expect(qualifiesEarlyBuy({ athMcap: 5_000_000, buyMcap: 1_300_000 })).toBe(false);
  });

  it('maps ATH 10M -> buy below 2.5M (25% of 10M)', () => {
    expect(tierForAth(10_000_000)?.maxBuyMcap).toBe(2_500_000);
    expect(qualifiesEarlyBuy({ athMcap: 10_000_000, buyMcap: 2_400_000 })).toBe(true);
    expect(qualifiesEarlyBuy({ athMcap: 10_000_000, buyMcap: 2_600_000 })).toBe(false);
  });

  it('maps ATH 50M+ -> buy below 12.5M (25% of 50M)', () => {
    expect(tierForAth(80_000_000)?.maxBuyMcap).toBe(12_500_000);
    expect(qualifiesEarlyBuy({ athMcap: 80_000_000, buyMcap: 10_000_000 })).toBe(true);
    expect(qualifiesEarlyBuy({ athMcap: 80_000_000, buyMcap: 13_000_000 })).toBe(false);
  });

  it('verifies trade profitability check (isTradeProfitable)', () => {
    expect(isTradeProfitable({ profitUsd: 150 })).toBe(true);
    expect(isTradeProfitable({ profitUsd: -50 })).toBe(false);
    expect(isTradeProfitable({ isProfitable: false })).toBe(false);
    expect(isTradeProfitable({ won: true })).toBe(true);
    expect(isTradeProfitable({ won: false })).toBe(false);
    expect(isTradeProfitable({ sellPrice: 0.05, buyPrice: 0.01 })).toBe(true);
    expect(isTradeProfitable({ sellPrice: 0.01, buyPrice: 0.05 })).toBe(false);
  });

  it('returns false when a trade has no profit evidence', () => {
    expect(isTradeProfitable({})).toBe(false);
    expect(isTradeProfitable({ wallet: 'abc' })).toBe(false);
  });

  it('Method 1: selectEarlyBuyersByMcap filters by buying mcap <= 25% ATH and checks profitability', () => {
    const res = selectEarlyBuyersByMcap({
      athMcap: 5_000_000,
      buys: [
        { wallet: 'wallet_profit_early', buyMcap: 1_000_000, profitUsd: 500 },
        { wallet: 'wallet_loss_early', buyMcap: 1_000_000, profitUsd: -200, isProfitable: false },
        { wallet: 'wallet_late', buyMcap: 2_500_000, profitUsd: 500 },
      ],
      requireProfitable: true,
    });
    expect(res.buyers.map(b => b.address)).toEqual(['wallet_profit_early']);
    expect(res.buyers[0].qualificationMethod).toBe('buying_mcap');
    expect(res.buyers[0].source).toBe('early-buy-mcap');
  });

  it('Method 2: selectAthEarlyBuyers selects first N buyers for ATH >= 1M and checks profitability', () => {
    const buys = [
      { wallet: 'w1', ts: 100, buyMcap: 100_000, profitUsd: 200 },
      { wallet: 'w2', ts: 200, buyMcap: 120_000, profitUsd: -100, isProfitable: false },
      { wallet: 'w3', ts: 300, buyMcap: 150_000, profitUsd: 400 },
    ];
    const res = selectAthEarlyBuyers({
      athMcap: 2_000_000,
      buys,
      requireProfitable: true,
    });
    // w2 was not profitable -> only w1 and w3 added
    expect(res.buyers.map(b => b.address)).toEqual(['w1', 'w3']);
    expect(res.buyers[0].qualificationMethod).toBe('first_n_buyers');
  });

  it('Dual method: keeps both buying mcap and first N buyers', () => {
    const buys = [
      { wallet: 'common_wallet', ts: 100, buyMcap: 200_000, profitUsd: 300 }, // both mcap and first N
      { wallet: 'mcap_only_wallet', ts: 9000, buyMcap: 220_000, profitUsd: 150 }, // mcap qualifies
    ];
    const res = selectEarlyBuyersDual({
      athMcap: 1_000_000,
      buys,
      requireProfitable: true,
    });
    expect(res.mcapBuyers.length).toBe(2);
    expect(res.firstNBuyers.length).toBe(2);
    const common = res.allBuyers.find(b => b.address === 'common_wallet');
    expect(common.methods).toContain('buying_mcap');
    expect(common.methods).toContain('first_n_buyers');
  });

  it('findRunners keeps 4-month (120-day) >=1M ATH only', () => {
    const now = Date.now();
    const runners = findRunners([
      { mint: 'r1', chain: 'solana', symbol: 'R1', marketCapUsd: 2_000_000, createdAt: now - 1000 },
      { mint: 's1', chain: 'solana', symbol: 'S1', marketCapUsd: 1_000_000, createdAt: now - 1000 },
      { mint: 't1', chain: 'solana', symbol: 'T1', marketCapUsd: 800_000, createdAt: now - 1000 }, // below 1M
      { mint: 'o1', chain: 'robinhood', symbol: 'O1', marketCapUsd: 60_000_000, createdAt: now - 150 * 24 * 3600 * 1000 },
    ], now);
    expect(runners.map(r => r.mint)).toEqual(['r1', 's1']);
  });

  it('calculates early buyer quota: 0 for <1M, 100 for 1M, +20 for each additional 1M', () => {
    expect(earlyBuyerLimitForAth(500_000)).toBe(0);
    expect(earlyBuyerLimitForAth(800_000)).toBe(0);
    expect(earlyBuyerLimitForAth(1_000_000)).toBe(100);
    expect(earlyBuyerLimitForAth(1_800_000)).toBe(100);
    expect(earlyBuyerLimitForAth(2_000_000)).toBe(120); // 100 + 1*20
    expect(earlyBuyerLimitForAth(3_000_000)).toBe(140); // 100 + 2*20
    expect(earlyBuyerLimitForAth(5_000_000)).toBe(180); // 100 + 4*20
    expect(earlyBuyerLimitForAth(10_000_000)).toBe(280); // 100 + 9*20
    expect(earlyBuyerLimitForAth(50_000_000)).toBe(1080); // 100 + 49*20
  });

  it('connectLineageWallet sets up lineage wallet with parent link and whale tags', () => {
    const parent = '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX';
    const child = '71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t';
    const wallet = connectLineageWallet({
      parentAddress: parent,
      childAddress: child,
      chain: 'solana',
      amount: 25.5,
      txHash: '5txHash123',
    });

    expect(wallet.category).toBe('lineage');
    expect(wallet.source).toBe('lineage');
    expect(wallet.lineageParent).toBe(parent);
    expect(wallet.lineageAmount).toBe(25.5);
    expect(wallet.lineageTx).toBe('5txHash123');
    expect(wallet.tags).toContain('lineage');
    expect(wallet.tags).toContain('whale_funded');
  });

  it('isSmartWallet requires at least 5 open trades and realized PnL > $100', () => {
    expect(isSmartWallet({ openTrades: 5, realizedProfitUsd: 101 })).toBe(true);
    expect(isSmartWallet({ openTrades: 12, realizedProfitUsd: 5000 })).toBe(true);
    expect(isSmartWallet({ openTrades: 4, realizedProfitUsd: 5000 })).toBe(false);
    expect(isSmartWallet({ openTrades: 0, realizedProfitUsd: 100000 })).toBe(false);
    expect(isSmartWallet({ openTrades: 5, realizedProfitUsd: 100 })).toBe(false);
  });

  it('isWhaleWallet checks balanceUsd >= 5000 or memeHoldingsUsd >= 5000', () => {
    expect(isWhaleWallet({ balanceUsd: 5000 })).toBe(true);
    expect(isWhaleWallet({ memeHoldingsUsd: 5000 })).toBe(true);
    expect(isWhaleWallet({ balanceUsd: 10000, memeHoldingsUsd: 0 })).toBe(true);
    expect(isWhaleWallet({ balanceUsd: 4999.99, memeHoldingsUsd: 4999.99 })).toBe(false);
  });

  it('classifyWalletCategory categorizes into lineage, whale, smart, or tracked', () => {
    expect(classifyWalletCategory({ lineageParent: 'parentAddr' })).toBe('lineage');
    expect(classifyWalletCategory({ balanceUsd: 6000 })).toBe('whale');
    expect(classifyWalletCategory({ memeHoldingsUsd: 5000 })).toBe('whale');
    expect(classifyWalletCategory({ openTrades: 6, realizedProfitUsd: 500 })).toBe('smart');
    expect(classifyWalletCategory({ openTrades: 2, realizedProfitUsd: 50 })).toBe('tracked');
  });

  it('classifies snipers after whales and before smart wallets', () => {
    expect(classifyWalletCategory({ category: 'sniper' })).toBe('sniper');
    expect(classifyWalletCategory({ tags: ['alpha_buyer'] })).toBe('sniper');
    expect(classifyWalletCategory({ flags: { is_bundler: true } })).toBe('sniper');
    expect(classifyWalletCategory({ category: 'whale', tags: ['sniper'], balanceUsd: 9000 })).toBe('whale');
    expect(classifyWalletCategory({ category: 'lineage', tags: ['sniper'], lineageParent: 'p' })).toBe('lineage');
    expect(classifyWalletCategory({})).toBe('tracked');
  });

  it('publishes one early-buyer rules object', () => {
    expect(EARLY_BUYER_RULES).toEqual({
      minAth: 1_000_000,
      baseQuota: 100,
      perMillionBonus: 20,
      athPct: 0.25,
      methods: ['buying_mcap', 'first_n_buyers'],
      lookbackDays: 120,
    });
  });

  it('connectWhaleWallet creates a whale category record', () => {
    const whale = connectWhaleWallet({
      address: '71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t',
      chain: 'solana',
      balanceUsd: 15000,
      memeHoldingsUsd: 8000,
    });
    expect(whale.category).toBe('whale');
    expect(whale.balanceUsd).toBe(15000);
    expect(whale.memeHoldingsUsd).toBe(8000);
    expect(whale.tags).toContain('whale');
  });
});

