import { describe, it, expect, vi } from 'vitest';
import { fetchMintTx, simulateMint, extractMintedTokenIds } from '../mintTx.js';

describe('fetchMintTx', () => {
  it('POSTs to the OpenSea mint endpoint and returns to/data/value', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: { to: '0xSale', input_data: '0xdeadbeef', value: '1000' },
      }),
    });
    const tx = await fetchMintTx('cool-cats', '0xMinter', 2);
    expect(tx).toEqual({ to: '0xSale', data: '0xdeadbeef', value: 1000n });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/drops\/cool-cats\/mint$/);
    expect(JSON.parse(opts.body)).toEqual({ minter: '0xMinter', quantity: 2 });
  });

  it('throws manual-only for unsupported drops (4xx)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ errors: ['unsupported sale'] }),
    });
    await expect(fetchMintTx('weird', '0xM', 1)).rejects.toThrow(/manual/i);
  });
});

describe('simulateMint', () => {
  it('returns eligible on successful eth_call', async () => {
    const provider = { call: vi.fn().mockResolvedValue('0x') };
    const out = await simulateMint(provider, { to: '0xS', data: '0xd', value: 0n }, '0xW');
    expect(out).toEqual({ result: 'eligible', reason: null });
  });

  it('returns not-eligible with the revert reason', async () => {
    const provider = { call: vi.fn().mockRejectedValue(Object.assign(new Error('execution reverted: not allowlisted'), { code: 'CALL_EXCEPTION' })) };
    const out = await simulateMint(provider, { to: '0xS', data: '0xd', value: 0n }, '0xW');
    expect(out.result).toBe('not-eligible');
    expect(out.reason).toMatch(/not allowlisted/);
  });

  it('returns unknown on RPC failure', async () => {
    const provider = { call: vi.fn().mockRejectedValue(new Error('ECONNRESET')) };
    const out = await simulateMint(provider, { to: '0xS', data: '0xd', value: 0n }, '0xW');
    expect(out.result).toBe('unknown');
  });
});

describe('extractMintedTokenIds', () => {
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  it('pulls ERC-721 token ids transferred TO the wallet', () => {
    const wallet = '0x1111111111111111111111111111111111111111';
    const receipt = { logs: [{
      topics: [TRANSFER,
        '0x' + '0'.repeat(64),
        '0x' + wallet.slice(2).padStart(64, '0'),
        '0x' + (42).toString(16).padStart(64, '0')],
      address: '0xNFT',
    }] };
    expect(extractMintedTokenIds(receipt, wallet)).toEqual([{ contract: '0xNFT', tokenId: '42' }]);
  });

  it('ignores transfers to other wallets', () => {
    const receipt = { logs: [{
      topics: [TRANSFER, '0x' + '0'.repeat(64), '0x' + 'f'.repeat(64), '0x' + '1'.padStart(64, '0')],
      address: '0xNFT',
    }] };
    expect(extractMintedTokenIds(receipt, '0x' + '1'.repeat(40))).toEqual([]);
  });
});
