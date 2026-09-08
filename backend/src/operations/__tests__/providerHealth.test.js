import { describe, expect, it, vi } from 'vitest';
import { getProviderHealth } from '../providerHealth.js';

describe('provider health', () => {
  it('normalizes healthy HTTP and JSON-RPC probes', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'ok' }) })
      .mockResolvedValueOnce({ ok: true });
    const health = await getProviderHealth({ fetchImpl, force: true });
    expect(health.ok).toBe(true);
    expect(health.providers.map(provider => provider.status)).toEqual(['healthy', 'healthy']);
  });

  it('reports provider errors without failing the whole request', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: { message: 'RPC unavailable' } }) })
      .mockResolvedValueOnce({ ok: false, status: 429 });
    const health = await getProviderHealth({ fetchImpl, force: true });
    expect(health.ok).toBe(false);
    expect(health.providers[0]).toMatchObject({ status: 'degraded', error: 'RPC unavailable' });
    expect(health.providers[1]).toMatchObject({ status: 'degraded', error: 'HTTP 429' });
  });
});
