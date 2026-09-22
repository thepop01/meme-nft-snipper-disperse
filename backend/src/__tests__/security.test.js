import { describe, expect, it } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import {
  createAuthMiddleware,
  createCorsOptions,
  maskRpcUrl,
  securityConfigFromEnv,
} from '../security.js';

function appFor(security, corsOrigins = []) {
  const app = express();
  app.use(requireCors(corsOrigins));
  app.use('/api', createAuthMiddleware(security));
  app.get('/api/status', (_req, res) => res.json({ ok: true }));
  return app;
}

function requireCors(corsOrigins) {
  return cors(createCorsOptions({ corsOrigins }));
}

describe('backend API security', () => {
  it('denies missing, query, and malformed tokens when protection is enabled', async () => {
    const app = appFor({ apiToken: 'correct-token', allowUnauthenticated: false });

    expect((await request(app).get('/api/status')).status).toBe(401);
    expect((await request(app).get('/api/status?token=correct-token')).status).toBe(401);
    expect((await request(app).get('/api/status').set('Authorization', 'Token correct-token')).status).toBe(401);
  });

  it('denies every request when production has no configured token', async () => {
    const app = appFor({ apiToken: '', allowUnauthenticated: false });
    const response = await request(app).get('/api/status');
    expect(response.status).toBe(401);
  });

  it('allows a valid bearer token and does not expose it in the response', async () => {
    const app = appFor({ apiToken: 'correct-token', allowUnauthenticated: false });
    const response = await request(app)
      .get('/api/status')
      .set('Authorization', 'Bearer correct-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(JSON.stringify(response.body)).not.toContain('correct-token');
  });

  it('only allows explicitly configured CORS origins', async () => {
    const app = appFor({ apiToken: 'correct-token', allowUnauthenticated: false }, ['https://console.example']);

    const allowed = await request(app)
      .get('/api/status')
      .set('Origin', 'https://console.example')
      .set('Authorization', 'Bearer correct-token');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://console.example');

    const denied = await request(app)
      .get('/api/status')
      .set('Origin', 'https://attacker.example')
      .set('Authorization', 'Bearer correct-token');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('fails closed in production without a token and permits only explicit local dev mode', () => {
    expect(securityConfigFromEnv({ NODE_ENV: 'production', HOST: '127.0.0.1' }).allowUnauthenticated).toBe(false);
    expect(securityConfigFromEnv({ NODE_ENV: 'development', HOST: '127.0.0.1' }).allowUnauthenticated).toBe(true);
    expect(securityConfigFromEnv({ NODE_ENV: 'development', HOST: '0.0.0.0' }).allowUnauthenticated).toBe(false);
  });

  it('masks URL secrets without placing them in a status URL', () => {
    const masked = maskRpcUrl('https://rpc.example.test/v1/abcdefghijklmnopqrstuv?api-key=super-secret&cluster=mainnet#fragment');
    expect(masked).not.toContain('super-secret');
    expect(masked).not.toContain('fragment');
    expect(masked).toContain('api-key=***');
    expect(masked).toContain('cluster=mainnet');
  });
});
