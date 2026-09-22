import { describe, it, expect } from 'vitest';
import { normalizeDuneRows } from '../adapters/dune.js';

describe('Dune adapter', () => {
  it('normalizes community Dune query rows into smart and tracked wallets', () => {
    const raw = {
      result: {
        rows: [
          {
            trader_address: '0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0',
            chain: 'robinhood',
            total_realized_profit_usd: 35000,
            win_rate_pct: 71.5,
            trade_count: 55,
            open_trades: 7,
          },
          {
            trader_address: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX',
            chain: 'solana',
            total_realized_profit_usd: 5400,
            win_rate_pct: 62.0,
            trade_count: 22,
            open_trades: 1,
          }
        ]
      }
    };

    const wallets = normalizeDuneRows(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].chain).toBe('robinhood');
    expect(wallets[0].address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
    expect(wallets[0].category).toBe('smart');
    expect(wallets[0].realizedProfitUsd).toBe(35000);
    expect(wallets[0].source).toBe('dune-analytics');
    expect(wallets[0].tags).toContain('dune_leaderboard');

    expect(wallets[1].chain).toBe('solana');
    expect(wallets[1].category).toBe('tracked');
  });

  it('handles empty query rows', () => {
    expect(normalizeDuneRows(null)).toEqual([]);
    expect(normalizeDuneRows({})).toEqual([]);
  });
});
