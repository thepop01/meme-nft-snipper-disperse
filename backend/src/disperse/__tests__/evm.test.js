import { describe, it, expect, vi } from 'vitest';
import { ethers } from 'ethers';
import { computeGasReserveShortfall, chunkRecipients, verifyDisperseContract } from '../evm.js';

describe('chunkRecipients', () => {
  it('splits into chunks of at most maxPerTx, preserving order', () => {
    const recips = Array.from({ length: 5 }, (_, i) => ({ address: `0x${i}` }));
    const amounts = [1n, 2n, 3n, 4n, 5n];
    const chunks = chunkRecipients(recips, amounts, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].recipients.map(r => r.address)).toEqual(['0x0', '0x1']);
    expect(chunks[0].amounts).toEqual([1n, 2n]);
    expect(chunks[2].amounts).toEqual([5n]);
  });
});

describe('computeGasReserveShortfall', () => {
  it('returns 0n when native balance covers send total + reserve', () => {
    const short = computeGasReserveShortfall({
      isNativeAsset: true, nativeBalance: 10n, sendTotal: 5n, gasReserve: 2n,
    });
    expect(short).toBe(0n);
  });

  it('reports the shortfall for a native send that leaves no gas', () => {
    const short = computeGasReserveShortfall({
      isNativeAsset: true, nativeBalance: 6n, sendTotal: 5n, gasReserve: 2n,
    });
    expect(short).toBe(1n);
  });

  it('for a token send only requires the gas reserve in native', () => {
    expect(computeGasReserveShortfall({
      isNativeAsset: false, nativeBalance: 1n, sendTotal: 999n, gasReserve: 2n,
    })).toBe(1n);
    expect(computeGasReserveShortfall({
      isNativeAsset: false, nativeBalance: 5n, sendTotal: 999n, gasReserve: 2n,
    })).toBe(0n);
  });
});

describe('verifyDisperseContract', () => {
  it('passes when on-chain code hash matches the expected hash', async () => {
    const code = '0x6080604052';
    const provider = { getCode: vi.fn().mockResolvedValue(code) };
    const expected = ethers.keccak256(code);
    await expect(verifyDisperseContract(provider, '0xcontract', expected)).resolves.toBe(true);
  });

  it('throws when the address has no code', async () => {
    const provider = { getCode: vi.fn().mockResolvedValue('0x') };
    await expect(verifyDisperseContract(provider, '0xcontract', '0xabc'))
      .rejects.toThrow(/no contract/i);
  });

  it('throws on a bytecode hash mismatch', async () => {
    const provider = { getCode: vi.fn().mockResolvedValue('0x6080') };
    await expect(verifyDisperseContract(provider, '0xcontract', '0xdifferent'))
      .rejects.toThrow(/bytecode/i);
  });
});
