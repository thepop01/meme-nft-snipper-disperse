import { describe, it, expect } from 'vitest';
import { normalizeMadeOnSolPayload } from '../adapters/madeonsol.js';

describe('MadeOnSol adapter', () => {
  it('normalizes launch snipers into tracked candidate wallets', () => {
    const raw = {
      snipers: [
        {
          wallet: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX',
          token_symbol: 'PEPE2',
          token_mint: 'mint_xyz',
          snipe_block: 104250,
          profit_usd: 3500,
          successful_snipes: 14,
        },
        {
          wallet: 'EA3VfFSJKHyU7yuMYsgra4DjwXA3tbzAs1BV4iMcCu7t',
          token_symbol: 'DOGE3',
          profit_usd: 800,
          successful_snipes: 4,
        }
      ]
    };

    const wallets = normalizeMadeOnSolPayload(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].chain).toBe('solana');
    expect(wallets[0].address).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(wallets[0].category).toBe('tracked');
    expect(wallets[0].source).toBe('madeonsol');
    expect(wallets[0].tags).toContain('madeonsol_sniper');
    expect(wallets[0].tags).toContain('PEPE2');
    expect(wallets[0].realizedProfitUsd).toBe(3500);
  });

  it('handles empty payload gracefully', () => {
    expect(normalizeMadeOnSolPayload(null)).toEqual([]);
    expect(normalizeMadeOnSolPayload({})).toEqual([]);
  });
});
