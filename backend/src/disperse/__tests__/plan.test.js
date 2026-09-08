import { describe, it, expect } from 'vitest';
import { buildPlan } from '../plan.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const D = '0x4444444444444444444444444444444444444444';

function evmDeps({ nativeBalance = 10n ** 18n, tokenBalance = 10n ** 12n, decimals = 6 } = {}) {
  return {
    fetchBalances: async () => ({ nativeBalance, tokenBalance, decimals }),
  };
}

describe('buildPlan (same-chain EVM)', () => {
  it('builds a native equal-mode plan with chunks and totals', async () => {
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: `${B}\n${C}`,
      amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps());
    expect(plan.crossChain).toBe(false);
    expect(plan.isNativeAsset).toBe(true);
    expect(plan.recipients).toHaveLength(2);
    expect(plan.perSender[0].chunks.length).toBeGreaterThanOrEqual(1);
    expect(BigInt(plan.perSender[0].totalBaseUnits)).toBe(2000000000000000n);
  });

  it('rejects when native balance cannot cover send + gas reserve', async () => {
    await expect(buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: B,
      amountMode: 'equal', perRecipient: '1000',
    }, evmDeps({ nativeBalance: 1n }))).rejects.toThrow(/insufficient|shortfall|gas/i);
  });

  it('rejects an unknown chain', async () => {
    await expect(buildPlan({
      sourceChain: 'nope', destChain: 'nope', asset: 'NATIVE',
      senders: [A], recipientsText: A, amountMode: 'equal', perRecipient: '1',
    }, evmDeps())).rejects.toThrow(/chain/i);
  });

  it('rejects when there are no valid recipients', async () => {
    await expect(buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: 'garbage', amountMode: 'equal', perRecipient: '1',
    }, evmDeps())).rejects.toThrow(/recipient/i);
  });

  it('excludes sender addresses from the recipient set by default', async () => {
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: `${A}\n${B}`,
      amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps());
    expect(plan.recipients.map(r => r.address.toLowerCase())).toEqual([B.toLowerCase()]);
    expect(plan.validationErrors.some(error => /sender excluded/i.test(error.message))).toBe(true);
  });

  it('assigns each recipient once and does not multiply total mode across senders', async () => {
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A, B], recipientsText: `${C}\n${D}`,
      amountMode: 'total', total: '1',
    }, evmDeps({ nativeBalance: 2n * 10n ** 18n }));
    const rows = plan.perSender.flatMap(sender => sender.chunks.flatMap(chunk => chunk.recipients));
    const total = plan.perSender.reduce((sum, sender) => sum + BigInt(sender.totalBaseUnits), 0n);
    expect(rows.map(row => row.address).sort()).toEqual([C, D].sort());
    expect(total).toBe(10n ** 18n);
  });

  it('flags cross-chain as unsupported in this plan (deferred to bridge plan)', async () => {
    await expect(buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: A, amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps())).rejects.toThrow(/cross-chain/i);
  });
});
