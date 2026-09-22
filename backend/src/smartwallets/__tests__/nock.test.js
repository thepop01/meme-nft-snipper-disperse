import { describe, it, expect } from 'vitest';
import { normalizeNockPayload } from '../adapters/nock.js';

describe('Nock Scout adapter', () => {
  it('normalizes Nock Scout leaderboard into Robinhood EVM wallets', () => {
    const raw = {
      wallets: [
        {
          address: '0x742D35Cc6634C0532925A3B844Bc9E7595F0BEB0',
          copyable_pnl_usd: 19400,
          win_rate: 64.2,
          trades: 31,
          open_trades: 6,
          rank: 1,
        },
        {
          address: '0x1111222233334444555566667777888899990000',
          copyable_pnl_usd: 4800,
          win_rate: 58.0,
          trades: 12,
          open_trades: 2,
          rank: 2,
        }
      ]
    };

    const wallets = normalizeNockPayload(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].chain).toBe('robinhood');
    expect(wallets[0].address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
    expect(wallets[0].category).toBe('smart');
    expect(wallets[0].realizedProfitUsd).toBe(19400);
    expect(wallets[0].winRatePct).toBe(64.2);
    expect(wallets[0].source).toBe('nockscout');
    expect(wallets[0].tags).toContain('nock_scout');

    expect(wallets[1].chain).toBe('robinhood');
    expect(wallets[1].address).toBe('0x1111222233334444555566667777888899990000');
    expect(wallets[1].category).toBe('tracked');
  });

  it('handles empty or malformed inputs', () => {
    expect(normalizeNockPayload(null)).toEqual([]);
    expect(normalizeNockPayload({})).toEqual([]);
    expect(normalizeNockPayload({ wallets: [] })).toEqual([]);
  });
});
