import { describe, it, expect } from 'vitest';
import { getExplorerUrls, parseFunderFromTx } from '../adapters/lineageRpc.js';

describe('Lineage RPC & Explorer adapter', () => {
  it('generates multi-explorer URLs for Robinhood and Solana', () => {
    const solAddr = '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX';
    const evmAddr = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';

    const solUrls = getExplorerUrls(solAddr, 'solana');
    expect(solUrls.solscan).toContain('solscan.io/account');

    const evmUrls = getExplorerUrls(evmAddr, 'robinhood');
    expect(evmUrls.blockscout).toContain('robinhoodchain.blockscout.com/address');
    expect(evmUrls.hoodscan).toContain('hoodscan.co/address');
    expect(evmUrls.robinscan).toContain('robinscan.xyz/address');
  });

  it('parses parent funder from transaction representation', () => {
    const solTx = {
      signer: 'parent_sol_wallet',
      recipient: 'child_sol_wallet',
      amountLamports: 2500000000, // 2.5 SOL
      signature: 'sig_123',
    };
    const parsed = parseFunderFromTx(solTx, 'solana');
    expect(parsed.parentAddress).toBe('parent_sol_wallet');
    expect(parsed.childAddress).toBe('child_sol_wallet');
    expect(parsed.amount).toBe(2.5);
    expect(parsed.txHash).toBe('sig_123');
  });
});
