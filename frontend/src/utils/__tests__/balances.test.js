import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchNativeBalances } from '../balances.js';

describe('fetchNativeBalances', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches EVM balances via eth_getBalance batch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 0, result: '0xde0b6b3a7640000' },
        { id: 1, result: '0x0' },
      ]),
    });
    const out = await fetchNativeBalances('eth', ['0xA', '0xB']);
    expect(out).toEqual({ '0xA': '1.0', '0xB': '0.0' });
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toHaveLength(2);
    expect(body[0].method).toBe('eth_getBalance');
  });

  it('fetches Solana balances via getBalance', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 0, result: { value: 2500000000 } },
      ]),
    });
    const out = await fetchNativeBalances('sol', ['So1Addr']);
    expect(out).toEqual({ So1Addr: '2.5' });
  });

  it('returns null balances on RPC failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down'));
    const out = await fetchNativeBalances('eth', ['0xA']);
    expect(out).toEqual({ '0xA': null });
  });

  it('throws on unknown chain', async () => {
    await expect(fetchNativeBalances('nope', ['x'])).rejects.toThrow(/Unknown chain/);
  });
});
