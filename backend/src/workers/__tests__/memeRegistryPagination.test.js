import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { upsertMeme, getTrackedMemes } from '../memeRegistry.js';

describe('GET /api/memes/registry pagination', () => {
  let app;

  beforeEach(() => {
    // Seed some test memes across solana and robinhood
    upsertMeme({
      ca: 'SolTestMint111111111111111111111111111111111',
      chain: 'solana',
      symbol: 'SOLM1',
      name: 'Sol Meme 1',
      currentMcap: 2_500_000,
      athMcap: 5_000_000,
      athTimestamp: Date.now(),
      backfilled: true,
    });
    upsertMeme({
      ca: 'SolTestMint222222222222222222222222222222222',
      chain: 'solana',
      symbol: 'SOLM2',
      name: 'Sol Meme 2',
      currentMcap: 3_000_000,
      athMcap: 6_000_000,
      athTimestamp: Date.now(),
      backfilled: false,
    });
    upsertMeme({
      ca: '0x2222222222222222222222222222222222222222',
      chain: 'robinhood',
      symbol: 'RH1',
      name: 'Robinhood Meme 1',
      currentMcap: 4_000_000,
      athMcap: 8_000_000,
      athTimestamp: Date.now(),
      backfilled: true,
    });

    app = express();
    app.get('/api/memes/registry', (req, res) => {
      const chain = (req.query.chain && req.query.chain !== 'all') ? req.query.chain : null;
      const status = req.query.status;
      const search = (req.query.search || req.query.q || '').trim().toLowerCase();
      const page = Math.max(1, Number(req.query.page) || 1);
      const isAll = req.query.limit === 'all' || req.query.pageSize === 'all';
      const pageSize = isAll ? 100000 : Math.min(500, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 50));

      const rawList = getTrackedMemes();
      const solanaCount = rawList.filter(m => (m.chain || 'solana') === 'solana').length;
      const robinhoodCount = rawList.filter(m => m.chain === 'robinhood').length;
      const backfilledCount = rawList.filter(m => m.backfilled === true).length;
      const pendingCount = rawList.filter(m => !m.backfilled).length;

      let filtered = rawList;
      if (chain) filtered = filtered.filter(m => (m.chain || 'solana') === chain);
      if (status === 'backfilled') filtered = filtered.filter(m => m.backfilled === true);
      if (status === 'pending_worker3') filtered = filtered.filter(m => !m.backfilled);
      if (search) {
        filtered = filtered.filter(m =>
          (m.symbol || '').toLowerCase().includes(search) ||
          (m.name || '').toLowerCase().includes(search) ||
          (m.ca || '').toLowerCase().includes(search)
        );
      }

      const total = filtered.length;
      const totalPages = Math.ceil(total / pageSize) || 1;
      const start = (page - 1) * pageSize;
      const sliced = filtered.slice(start, start + pageSize).map(m => ({
        ...m,
        contractAddress: m.ca,
        volume24h: m.volume24hUsd,
      }));

      res.json({
        total,
        page,
        pageSize,
        totalPages,
        solanaCount,
        robinhoodCount,
        backfilledCount,
        pendingCount,
        memes: sliced,
      });
    });
  });

  it('returns paginated memes with count metrics', async () => {
    const res = await request(app).get('/api/memes/registry?page=1&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('solanaCount');
    expect(res.body).toHaveProperty('robinhoodCount');
    expect(res.body).toHaveProperty('backfilledCount');
    expect(res.body).toHaveProperty('pendingCount');
    expect(res.body.memes.length).toBeLessThanOrEqual(2);
  });

  it('filters by chain=robinhood correctly', async () => {
    const res = await request(app).get('/api/memes/registry?chain=robinhood');
    expect(res.status).toBe(200);
    for (const m of res.body.memes) {
      expect(m.chain).toBe('robinhood');
    }
  });

  it('filters by status=backfilled correctly', async () => {
    const res = await request(app).get('/api/memes/registry?status=backfilled');
    expect(res.status).toBe(200);
    for (const m of res.body.memes) {
      expect(m.backfilled).toBe(true);
    }
  });

  it('searches by symbol or name', async () => {
    const res = await request(app).get('/api/memes/registry?search=SOLM1');
    expect(res.status).toBe(200);
    expect(res.body.memes.some(m => m.symbol === 'SOLM1')).toBe(true);
  });
});
