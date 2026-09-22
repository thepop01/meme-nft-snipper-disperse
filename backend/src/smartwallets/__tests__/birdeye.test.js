import { describe, it, expect } from 'vitest';
import { parseBirdeyePortfolio } from '../adapters/birdeye.js';

describe('Birdeye adapter', () => {
  it('computes wallet balance and meme holdings for whale qualification', () => {
    const raw = {
      data: {
        totalUsd: 14200,
        items: [
          { symbol: 'SOL', valueUsd: 2000, uiAmount: 12.5 },
          { symbol: 'USDC', valueUsd: 1500, uiAmount: 1500 },
          { symbol: 'BONK', valueUsd: 6500, uiAmount: 150000000 },
          { symbol: 'WIF', valueUsd: 4200, uiAmount: 2100 }
        ]
      }
    };

    const parsed = parseBirdeyePortfolio('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX', raw);
    expect(parsed.address).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(parsed.balanceUsd).toBe(14200);
    // Meme holdings = 6500 (BONK) + 4200 (WIF) = 10700 (excluding SOL & USDC)
    expect(parsed.memeHoldingsUsd).toBe(10700);
    expect(parsed.isWhale).toBe(true);
  });

  it('handles empty or malformed portfolio response', () => {
    const parsed = parseBirdeyePortfolio('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX', null);
    expect(parsed.balanceUsd).toBe(0);
    expect(parsed.memeHoldingsUsd).toBe(0);
    expect(parsed.isWhale).toBe(false);
  });
});
