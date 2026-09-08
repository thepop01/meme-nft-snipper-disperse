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
    expect(res.body.runners[0].tier.maxBuyMcap).toBe(500000);
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
});
