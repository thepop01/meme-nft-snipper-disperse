import { describe, it, expect, vi } from 'vitest';
import { getGasSnapshot, computeTxFees, DUST_BUFFER_WEI } from '../gas.js';

describe('getGasSnapshot', () => {
  it('reads base fee and priority estimate from the provider', async () => {
    const provider = {
      getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: 20n * 10n ** 9n }),
      send: vi.fn().mockResolvedValue('0x3b9aca00'), // 1 gwei
    };
    const snap = await getGasSnapshot(provider);
    expect(snap.baseFeeWei).toBe(20n * 10n ** 9n);
    expect(snap.priorityFeeWei).toBe(1n * 10n ** 9n);
  });
});

describe('computeTxFees (caps mode)', () => {
  const snap = { baseFeeWei: 20n * 10n ** 9n, priorityFeeWei: 1n * 10n ** 9n };

  it('uses network fees when under the caps', () => {
    const fees = computeTxFees({
      mode: 'caps', snap, maxFeeGwei: 100, maxPriorityGwei: 5,
      gasLimit: 200_000n, balanceWei: 10n ** 18n, mintCostWei: 0n,
    });
    // maxFee = 2*base + priority, clamped by cap
    expect(fees.maxFeePerGas).toBe(41n * 10n ** 9n);
    expect(fees.maxPriorityFeePerGas).toBe(1n * 10n ** 9n);
    expect(fees.aboveCap).toBe(false);
  });

  it('flags aboveCap when base fee exceeds the user cap', () => {
    const fees = computeTxFees({
      mode: 'caps', snap: { baseFeeWei: 200n * 10n ** 9n, priorityFeeWei: 1n * 10n ** 9n },
      maxFeeGwei: 50, maxPriorityGwei: 2,
      gasLimit: 200_000n, balanceWei: 10n ** 18n, mintCostWei: 0n,
    });
    expect(fees.aboveCap).toBe(true);
    expect(fees.maxFeePerGas).toBe(50n * 10n ** 9n); // clamped to cap
  });

  it('never lets priority fee exceed the total fee cap', () => {
    const fees = computeTxFees({
      mode: 'caps', snap: { baseFeeWei: 1n * 10n ** 9n, priorityFeeWei: 30n * 10n ** 9n },
      maxFeeGwei: 5, maxPriorityGwei: 30, // priority >= maxFee would be rejected
      gasLimit: 200_000n, balanceWei: 10n ** 18n, mintCostWei: 0n,
    });
    expect(fees.maxPriorityFeePerGas).toBeLessThanOrEqual(fees.maxFeePerGas);
    expect(fees.maxFeePerGas).toBe(5n * 10n ** 9n);
  });
});

describe('computeTxFees (all-in mode)', () => {
  it('spends the remaining balance after mint cost and dust buffer', () => {
    const balance = 10n ** 16n;      // 0.01 ETH
    const mintCost = 4n * 10n ** 15n; // 0.004 ETH
    const gasLimit = 200_000n;
    const fees = computeTxFees({
      mode: 'all-in', snap: { baseFeeWei: 1n * 10n ** 9n, priorityFeeWei: 1n * 10n ** 8n },
      gasLimit, balanceWei: balance, mintCostWei: mintCost,
    });
    const budget = balance - mintCost - DUST_BUFFER_WEI;
    expect(fees.maxFeePerGas).toBe(budget / gasLimit);
    expect(fees.aboveCap).toBe(false);
  });

  it('throws when balance cannot even cover the mint cost', () => {
    expect(() => computeTxFees({
      mode: 'all-in', snap: { baseFeeWei: 1n, priorityFeeWei: 1n },
      gasLimit: 100_000n, balanceWei: 100n, mintCostWei: 200n,
    })).toThrow(/insufficient/i);
  });
});
