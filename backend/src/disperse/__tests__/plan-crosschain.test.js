import { describe, it, expect, vi } from 'vitest';
import { buildPlan } from '../plan.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';

const deps = () => ({
  fetchBalances: async () => ({ nativeBalance: 10n ** 18n, tokenBalance: null, decimals: 18 }),
  getQuote: vi.fn().mockResolvedValue({
    tool: 'across', toAmount: '990000', durationSec: 120, gasUsd: 1.2, feeUsd: 0.3,
    approvalAddress: '0xbridge', transactionRequest: { to: '0xbridge', data: '0x', value: '0x0' },
  }),
});

describe('buildPlan (cross-chain)', () => {
  it('attaches a bridge section and plans the destination disperse from the quote', async () => {
    const d = deps();
    const plan = await buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE', destAsset: 'USDC',
      senders: [A], recipientsText: `${B}\n${C}`,
      amountMode: 'total', total: '0.5',
    }, d);

    expect(plan.crossChain).toBe(true);
    expect(plan.sourceChain).toBe('eth');
    expect(plan.destChain).toBe('base');
    expect(plan.destAsset).toBe('USDC');
    expect(plan.perSender[0].bridge.tool).toBe('across');
    expect(plan.perSender[0].bridge.toAddress).toBe(A);
    expect(plan.perSender[0].bridge.estimatedReceived).toBe('990000');
    expect(plan.perSender[0].chunks[0].amounts).toEqual(['495000', '495000']);
    expect(d.getQuote).toHaveBeenCalledOnce();
  });

  it('rejects when LI.FI returns no route', async () => {
    const d = deps();
    d.getQuote = vi.fn().mockRejectedValue(new Error('No route from LI.FI (404)'));
    await expect(buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE', destAsset: 'USDC',
      senders: [A], recipientsText: B, amountMode: 'total', total: '0.5',
    }, d)).rejects.toThrow(/no route/i);
  });

  it('requires destAsset for a cross-chain plan', async () => {
    await expect(buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: A, amountMode: 'total', total: '0.5',
    }, deps())).rejects.toThrow(/destination asset/i);
  });
});
