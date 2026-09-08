import { describe, expect, it } from 'vitest';
import { EVM_CHAINS } from '../evm.js';
import { GMGN_CHAINS } from '../gmgn.js';

describe('terminal chain matrix (solana + robinhood only)', () => {
  it('pins robinhood to chain id 4663', () => {
    expect(EVM_CHAINS.robinhood.chainId).toBe(4663);
    expect(GMGN_CHAINS.robinhood.chainId).toBe(4663);
  });

  it('covers exactly solana and robinhood in GMGN discovery', () => {
    expect(Object.keys(GMGN_CHAINS).sort()).toEqual(['robinhood', 'solana']);
  });
});
