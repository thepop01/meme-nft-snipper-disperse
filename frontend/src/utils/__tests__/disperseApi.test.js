import { describe, it, expect, vi, beforeEach } from 'vitest';

function stubLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

describe('disperseApi', () => {
  let api;
  beforeEach(async () => {
    stubLocalStorage();
    vi.resetModules();
    ({ disperseApi: api } = await import('../disperseApi.js'));
  });

  it('POSTs a plan and returns the plan payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ plan: { recipientCount: 3 } }),
    });
    const out = await api.plan({ sourceChain: 'base' });
    expect(out.plan.recipientCount).toBe(3);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/disperse\/plan$/);
    expect(opts.method).toBe('POST');
  });

  it('throws with the server error message on non-ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'bad recipients' }),
    });
    await expect(api.plan({})).rejects.toThrow('bad recipients');
  });
});
