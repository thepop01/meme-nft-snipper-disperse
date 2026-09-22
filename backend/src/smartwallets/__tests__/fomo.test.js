import { describe, it, expect } from 'vitest';
import { normalizeFomoPayload, calculateHoldingsUsd } from '../adapters/fomo.js';

describe('FOMO adapter', () => {
  it('normalizes FOMO leaderboard rows into Solana and Robinhood wallets', () => {
    const raw = {
      traders: [
        { 
          handle: 'sol_whale', 
          pnl_usd: 14500, 
          win_rate: 68.5, 
          trades_count: 42, 
          wallets: { solana: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX' } 
        },
        { 
          handle: 'evm_degen', 
          pnl_usd: 8200, 
          win_rate: 55.0, 
          trades_count: 18, 
          wallets: { evm: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0' } 
        }
      ]
    };
    const wallets = normalizeFomoPayload(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].chain).toBe('solana');
    expect(wallets[0].address).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(wallets[0].twitterUsername).toBe('sol_whale');
    expect(wallets[0].realizedProfitUsd).toBe(14500);
    expect(wallets[0].winRatePct).toBe(68.5);
    expect(wallets[0].totalTrades).toBe(42);
    expect(wallets[0].source).toBe('fomo-leaderboard');

    expect(wallets[1].chain).toBe('robinhood');
    expect(wallets[1].address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
    expect(wallets[1].twitterUsername).toBe('evm_degen');
    expect(wallets[1].realizedProfitUsd).toBe(8200);
    expect(wallets[1].source).toBe('fomo-leaderboard');
  });

  it('calculates portfolio balance and qualifies whales holding >= $5,000', () => {
    const holdings = [
      { token: { symbol: 'BONK', networkId: 1399811149 }, valueUsd: 3200 },
      { token: { symbol: 'PONS', networkId: 4663 }, valueUsd: 2500 },
    ];
    const { balanceUsd, memeHoldingsUsd } = calculateHoldingsUsd(holdings);
    expect(balanceUsd).toBe(5700);
    expect(memeHoldingsUsd).toBe(5700);

    const userPayload = {
      handle: 'mega_whale',
      pnlUsd: 50000,
      trades: 120,
      holdings,
      wallets: { solana: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX' }
    };

    const wallets = normalizeFomoPayload(userPayload);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].category).toBe('whale');
    expect(wallets[0].balanceUsd).toBe(5700);
    expect(wallets[0].tags).toContain('whale');
    expect(wallets[0].tags).toContain('top_holder');
  });

  it('handles empty or malformed payloads gracefully', () => {
    expect(normalizeFomoPayload(null)).toEqual([]);
    expect(normalizeFomoPayload({})).toEqual([]);
    expect(normalizeFomoPayload({ traders: [] })).toEqual([]);
    expect(calculateHoldingsUsd(null)).toEqual({ balanceUsd: 0, memeHoldingsUsd: 0 });
  });
});
