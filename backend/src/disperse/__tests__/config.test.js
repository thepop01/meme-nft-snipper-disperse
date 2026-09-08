import { describe, it, expect } from 'vitest';
import {
  DISPERSE_CHAINS, getDisperseChain, getToken, EVM_CHAIN_IDS,
} from '../config.js';

describe('disperse config', () => {
  it('includes the 8 chains (7 EVM + Solana)', () => {
    const ids = DISPERSE_CHAINS.map(c => c.id);
    for (const id of ['eth', 'base', 'arb', 'op', 'polygon', 'bsc', 'avax', 'sol']) {
      expect(ids).toContain(id);
    }
  });

  it('every EVM chain has an rpc, numeric chainId, disperse contract, chunk limit, gas reserve', () => {
    for (const c of DISPERSE_CHAINS.filter(c => c.family === 'evm')) {
      expect(c.rpc).toMatch(/^https?:\/\//);
      expect(typeof c.chainId).toBe('number');
      expect(c.disperseContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(c.maxRecipientsPerTx).toBeGreaterThan(0);
      expect(BigInt(c.gasReserveWei)).toBeGreaterThan(0n);
    }
  });

  it('maps EVM chainId numbers back to chain ids', () => {
    expect(EVM_CHAIN_IDS[1]).toBe('eth');
    expect(EVM_CHAIN_IDS[8453]).toBe('base');
    expect(EVM_CHAIN_IDS[143]).toBe('monad');
  });

  it('looks up chains and native pseudo-token', () => {
    expect(getDisperseChain('eth').symbol).toBe('ETH');
    expect(getDisperseChain('nope')).toBeNull();
    expect(getToken('eth', 'NATIVE')).toEqual({ symbol: 'ETH', address: 'NATIVE', decimals: 18 });
  });

  it('returns known tokens with addresses and decimals', () => {
    const usdc = getToken('eth', 'USDC');
    expect(usdc.address).toMatch(/^0x/);
    expect(usdc.decimals).toBe(6);
    expect(getToken('eth', 'NOPE')).toBeNull();
  });
});
