import { describe, expect, it } from 'vitest';
import { isEvmAddress, isSolAddress, normalizeAddress, isAddressForChain } from '../addresses.js';

describe('addresses', () => {
  it('accepts a 40-hex 0x address and a base58 solana address', () => {
    expect(isEvmAddress('0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0')).toBe(true);
    expect(isEvmAddress('0x1234')).toBe(false);
    expect(isSolAddress('8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP')).toBe(true);
    expect(isSolAddress('0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0')).toBe(false);
  });

  it('normalizes robinhood addresses to lowercase and checks by chain', () => {
    expect(normalizeAddress('robinhood', '0xABCD00000000000000000000000000000000ABCD')).toBe('0xabcd00000000000000000000000000000000abcd');
    expect(normalizeAddress('solana', '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP')).toBe('8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP');
    expect(isAddressForChain('robinhood', '0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0')).toBe(true);
    expect(isAddressForChain('solana', '0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0')).toBe(false);
  });
});
