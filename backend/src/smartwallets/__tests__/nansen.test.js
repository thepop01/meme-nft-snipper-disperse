import { describe, it, expect } from 'vitest';
import { getNansenProfilerUrl, normalizeNansenTrades, parseNansenCsv } from '../adapters/nansen.js';

describe('Nansen adapter', () => {
  it('generates Nansen profiler URLs', () => {
    const addr = '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX';
    expect(getNansenProfilerUrl(addr)).toBe(`https://app.nansen.ai/profiler?address=${addr}`);
  });

  it('normalizes Nansen smart money trades into internal wallet format', () => {
    const raw = {
      data: [
        {
          wallet_address: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX',
          chain: 'solana',
          token_symbol: 'BONK',
          value_usd: 12500,
          smart_money_labels: ['Smart Trader', 'Fund'],
          tx_hash: '5txHashNansen123'
        },
        {
          wallet_address: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
          chain: 'ethereum',
          token_symbol: 'PEPE',
          value_usd: 6000,
          smart_money_labels: ['30D Smart Trader'],
          tx_hash: '0xtxHashNansenEVM'
        }
      ]
    };

    const wallets = normalizeNansenTrades(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].chain).toBe('solana');
    expect(wallets[0].address).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(wallets[0].category).toBe('whale'); // >$5000 value
    expect(wallets[0].tags).toContain('nansen_smart_money');
    expect(wallets[0].tags).toContain('Smart Trader');

    expect(wallets[1].chain).toBe('robinhood');
    expect(wallets[1].address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
    expect(wallets[1].category).toBe('whale');
  });

  it('parses exported Nansen CSV text from web platform', () => {
    const csv = `Address,Label,Balance USD,30d PnL USD
6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX,Smart Degen,15000,8500
0x742d35cc6634c0532925a3b844bc9e7595f0beb0,Top Whale,45000,12000`;

    const wallets = parseNansenCsv(csv);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].address).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(wallets[0].chain).toBe('solana');
    expect(wallets[0].balanceUsd).toBe(15000);
    expect(wallets[0].category).toBe('whale');

    expect(wallets[1].address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
    expect(wallets[1].chain).toBe('robinhood');
    expect(wallets[1].balanceUsd).toBe(45000);
  });
});
