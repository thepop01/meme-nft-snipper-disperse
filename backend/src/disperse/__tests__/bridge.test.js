import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LIFI_NATIVE, toLifiToken, getQuote, pollStatus, mapQuote,
} from '../bridge.js';

describe('toLifiToken', () => {
  it('maps NATIVE to the zero address', () => {
    expect(toLifiToken('NATIVE', { symbol: 'ETH' })).toBe(LIFI_NATIVE);
  });
  it('passes through an ERC-20 address', () => {
    expect(toLifiToken('0xabc', {})).toBe('0xabc');
  });
});

describe('getQuote', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requests a quote with the right params and maps the response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        estimate: { toAmount: '990000', executionDuration: 120, gasCosts: [{ amountUSD: '1.2' }],
          feeCosts: [{ amountUSD: '0.3' }] },
        tool: 'across',
        transactionRequest: { to: '0xbridge', data: '0xdead', value: '0x0' },
        action: { fromToken: { address: '0x0000000000000000000000000000000000000000' } },
        estimate2: undefined,
      }),
    });
    const q = await getQuote({
      fromChainId: 1, toChainId: 8453, fromToken: LIFI_NATIVE, toToken: '0xusdc',
      fromAmount: '1000000', fromAddress: '0xme', toAddress: '0xme',
    });
    expect(q.toAmount).toBe('990000');
    expect(q.tool).toBe('across');
    expect(q.durationSec).toBe(120);
    expect(q.gasUsd).toBeCloseTo(1.2);
    expect(q.feeUsd).toBeCloseTo(0.3);
    expect(q.transactionRequest.to).toBe('0xbridge');
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/li\.quest\/v1\/quote/);
    expect(url).toMatch(/fromChain=1/);
    expect(url).toMatch(/toChain=8453/);
  });

  it('throws a friendly error when no route exists', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ message: 'No available quotes' }),
    });
    await expect(getQuote({
      fromChainId: 1, toChainId: 8453, fromToken: LIFI_NATIVE, toToken: '0xusdc',
      fromAmount: '1', fromAddress: '0xme', toAddress: '0xme',
    })).rejects.toThrow(/No available quotes|no route/i);
  });
});

describe('pollStatus', () => {
  it('maps a DONE status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'DONE', receiving: { amount: '988000' } }),
    });
    const s = await pollStatus({ tool: 'across', fromChainId: 1, toChainId: 8453, txHash: '0xh' });
    expect(s.status).toBe('DONE');
    expect(s.receivedAmount).toBe('988000');
  });

  it('maps a FAILED status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'FAILED' }),
    });
    const s = await pollStatus({ tool: 'x', fromChainId: 1, toChainId: 2, txHash: '0xh' });
    expect(s.status).toBe('FAILED');
  });
});
