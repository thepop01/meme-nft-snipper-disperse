import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMemeFinderRouter } from '../routes.js';

const token = (assetKey, admission, memeScore) => ({
  assetKey, admission, score: { memeScore, version: 'v', evidenceCoverage: 80 },
});
const fixture = [
  token('solana:pumpfun:Q1', 'qualified', 90),
  token('solana:pumpfun:Q2', 'qualified', 80),
  token('solana:pumpfun:W1', 'watching', 40),
];
const app = (rows = fixture, getVerdict = () => null) => {
  const a = express();
  a.use('/api/memefinder', createMemeFinderRouter({ getTokens: () => rows, getVerdict }));
  return a;
};

describe('memefinder routes', () => {
  it('serves only qualified tokens, ranked by memeScore', async () => {
    const res = await request(app()).get('/api/memefinder/qualified');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.tokens.map(t => t.assetKey))
      .toEqual(['solana:pumpfun:Q1', 'solana:pumpfun:Q2']);
  });

  it('paginates and always reports the total', async () => {
    const res = await request(app()).get('/api/memefinder/qualified?page=2&pageSize=1');
    expect(res.body.page).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.tokens.map(t => t.assetKey)).toEqual(['solana:pumpfun:Q2']);
  });

  it('serves every token on the diagnostic feed', async () => {
    const res = await request(app()).get('/api/memefinder/all');
    expect(res.body.total).toBe(3);
  });

  it('serves a single token and 404s an unknown key', async () => {
    const ok = await request(app()).get('/api/memefinder/token/solana:pumpfun:Q1');
    expect(ok.status).toBe(200);
    expect(ok.body.assetKey).toBe('solana:pumpfun:Q1');
    const missing = await request(app()).get('/api/memefinder/token/solana:pumpfun:NOPE');
    expect(missing.status).toBe(404);
  });

  it('serves the verdict', async () => {
    const res = await request(app(fixture, () => ({ overall: 'PENDING' }))).get('/api/memefinder/verdict');
    expect(res.body.verdict).toEqual({ overall: 'PENDING' });
  });

  it('never labels coverage as confidence or probability', async () => {
    const res = await request(app()).get('/api/memefinder/qualified');
    expect(JSON.stringify(res.body)).not.toMatch(/confidence|probability/i);
  });
});
