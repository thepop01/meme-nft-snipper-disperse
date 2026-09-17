import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSmartWalletsRouter } from '../routes.js';
function app(tokens = []) {
  const a = express();
  a.use(express.json());
  a.use('/api/smart-wallets', createSmartWalletsRouter({ getTokens: () => tokens }));
  return a;
}
describe('smart-wallets routes', () => {
  it('lists runners with tier labels', async () => {
    const now = Date.now();
    const res = await request(app([{ mint: 'R1', chain: 'solana', symbol: 'R1', marketCapUsd: 2000000, createdAt: now - 1000 }])).get('/api/smart-wallets/runners');
    expect(res.status).toBe(200);
    expect(res.body.runners[0].tier.maxBuyMcap).toBe(250000);
  });
  it('rejects wallet upsert without address', async () => {
    const res = await request(app()).post('/api/smart-wallets').send({ wallets: [] });
    expect(res.status).toBe(400);
  });
  it('accepts a valid wallet and normalizes it', async () => {
    const res = await request(app()).post('/api/smart-wallets').send({ wallets: [{ address: '0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0', chain: 'robinhood', source: 'fomo-leaderboard', score: '10' }] });
    expect(res.status).toBe(201);
    const saved = res.body.wallets.find(w => w.address === '0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
    expect(saved).toBeTruthy();
    expect(saved.score).toBe(10);
  });
  it('rejects null elements with 400, not 500', async () => {
    const res = await request(app()).post('/api/smart-wallets').send({ wallets: [null] });
    expect(res.status).toBe(400);
  });

  it('supports lineage wallet creation and marks as lineage category', async () => {
    const parent = '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX';
    const child = '71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t';
    const res = await request(app()).post('/api/smart-wallets/lineage').send({
      parentAddress: parent,
      childAddress: child,
      chain: 'solana',
      amount: 15.0,
      txHash: 'txLineageTest123',
    });
    expect(res.status).toBe(201);
    expect(res.body.wallet.category).toBe('lineage');
    expect(res.body.wallet.lineageParent).toBe(parent);
    expect(res.body.wallet.lineageAmount).toBe(15);
  });

  it('supports whale wallet creation via POST /whale', async () => {
    const whaleAddr = 'EA3VfFSJKHyU7yuMYsgra4DjwXA3tbzAs1BV4iMcCu7t';
    const res = await request(app()).post('/api/smart-wallets/whale').send({
      address: whaleAddr,
      chain: 'solana',
      balanceUsd: 12500,
      memeHoldingsUsd: 6000,
      tags: ['top_holder'],
    });
    expect(res.status).toBe(201);
    expect(res.body.wallet.category).toBe('whale');
    expect(res.body.wallet.balanceUsd).toBe(12500);
    expect(res.body.wallet.memeHoldingsUsd).toBe(6000);
    expect(res.body.wallet.tags).toContain('whale');
  });

  it('filters wallets by category and returns all 4 counts and whaleRules', async () => {
    const res = await request(app()).get('/api/smart-wallets?category=tracked');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('smartCount');
    expect(res.body).toHaveProperty('trackedCount');
    expect(res.body).toHaveProperty('whaleCount');
    expect(res.body).toHaveProperty('lineageCount');
    expect(res.body).toHaveProperty('earlyBuyerRules');
    expect(res.body).toHaveProperty('whaleRules');
    expect(res.body.whaleRules.minUsd).toBe(5000);
  });

  it('promotes a tracked wallet to smart', async () => {
    const child = '71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t';
    const res = await request(app()).post(`/api/smart-wallets/promote/solana/${child}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.category).toBe('smart');
  });

  it('ingests early buyers using ATH formula (ATH >= 1M)', async () => {
    const buys = [
      { wallet: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP', ts: 1000, buyMcap: 200_000, profitUsd: 150 },
      { wallet: 'EA3VfFSJKHyU7yuMYsgra4DjwXA3tbzAs1BV4iMcCu7t', ts: 1100, buyMcap: 240_000, profitUsd: 300 },
    ];
    const res = await request(app()).post('/api/smart-wallets/early-buyers').send({
      token: { mint: 'testCoinMint', symbol: 'TEST' },
      buys,
      athMcap: 1_200_000,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.quota).toBe(100);
    expect(res.body.count).toBe(2);
    expect(res.body.buyers[0].category).toBe('tracked');
  });

  it('preserves execution metrics (avg buy, avg sell, holding time) on POST /', async () => {
    const res = await request(app()).post('/api/smart-wallets').send({
      wallets: [{
        address: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP',
        chain: 'solana',
        category: 'smart',
        avgBuyPrice: 0.00045,
        avgBuyMcap: 220000,
        avgSellPrice: 0.0012,
        avgHoldingTimeSec: 3600,
        qualificationMethod: 'buying_mcap',
        methods: ['buying_mcap', 'first_n_buyers'],
      }],
    });
    expect(res.status).toBe(201);
    const saved = res.body.wallets.find(w => w.address === '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP');
    expect(saved).toBeTruthy();
    expect(saved.avgBuyPrice).toBe(0.00045);
    expect(saved.avgBuyMcap).toBe(220000);
    expect(saved.avgSellPrice).toBe(0.0012);
    expect(saved.avgHoldingTimeSec).toBe(3600);
    expect(saved.methods).toContain('buying_mcap');
    expect(saved.methods).toContain('first_n_buyers');
  });

  it('handles backfill request via POST /backfill', async () => {
    const res = await request(app()).post('/api/smart-wallets/backfill').send({ maxLiveQueries: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.totalWallets).toBe('number');
  });

  it('supports server-side pagination and returns category badge counts', async () => {
    const res = await request(app()).get('/api/smart-wallets?page=1&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('pageSize', 2);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('smartCount');
    expect(res.body).toHaveProperty('trackedCount');
    expect(res.body).toHaveProperty('whaleCount');
    expect(res.body).toHaveProperty('lineageCount');
    expect(res.body).toHaveProperty('sniperCount');
    expect(res.body.wallets.length).toBeLessThanOrEqual(2);
  });

  it('filters by sniper category on the server', async () => {
    // Add a sniper wallet first
    await request(app()).post('/api/smart-wallets').send({
      wallets: [{
        address: '0x1111111111111111111111111111111111111111',
        chain: 'robinhood',
        category: 'sniper',
        tags: ['alpha_buyer', 'sniper_bot'],
      }],
    });
    const res = await request(app()).get('/api/smart-wallets?category=sniper');
    expect(res.status).toBe(200);
    expect(res.body.wallets.length).toBeGreaterThanOrEqual(1);
    const found = res.body.wallets.find(w => w.address === '0x1111111111111111111111111111111111111111');
    expect(found).toBeDefined();
    expect(res.body.sniperCount).toBeGreaterThanOrEqual(1);
  });
});

