import { describe, it, expect } from 'vitest';
import { NFT_CHAIN_CONFIG, getNftChain } from '../chains.js';

describe('nft chains', () => {
  it('returns robinhood rpc/explorer defaults', () => {
    const c = getNftChain('robinhood');
    expect(c.chainId).toBe(4663);
    expect(c.rpc).toBe('https://rpc.mainnet.chain.robinhood.com');
    expect(c.explorer).toBe('https://robinhoodchain.blockscout.com');
  });

  it('keeps ethereum intact', () => {
    const c = getNftChain('ethereum');
    expect(c.chainId).toBe(1);
    expect(c.rpc).toMatch(/^https?:\/\//);
    expect(c.explorer).toBe('https://etherscan.io');
  });

  it('returns null for unknown chains', () => {
    expect(getNftChain('nope')).toBeNull();
  });

  it('honours RPC_ROBINHOOD env override', () => {
    expect(NFT_CHAIN_CONFIG.robinhood).toBeDefined();
    expect(typeof NFT_CHAIN_CONFIG.robinhood.chainId).toBe('number');
  });
});
