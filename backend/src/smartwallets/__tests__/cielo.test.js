import { describe, it, expect } from 'vitest';
import { handleCieloWebhookPayload } from '../adapters/cielo.js';

describe('Cielo webhook adapter', () => {
  it('parses incoming Cielo buy/sell webhook into live trade record', () => {
    const raw = {
      data: {
        wallet: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX',
        chain: 'solana',
        action: 'swap',
        token_bought: { symbol: 'BONK', mint: 'mint_bonk_123' },
        amount_usd: 3500,
        tx_hash: '5txHashCielo123',
        timestamp: 1789487000
      }
    };

    const trade = handleCieloWebhookPayload(raw);
    expect(trade).toBeTruthy();
    expect(trade.wallet).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(trade.chain).toBe('solana');
    expect(trade.token).toBe('mint_bonk_123');
    expect(trade.symbol).toBe('BONK');
    expect(trade.amountUsd).toBe(3500);
    expect(trade.txHash).toBe('5txHashCielo123');
  });

  it('rejects invalid or missing webhook payload', () => {
    expect(handleCieloWebhookPayload(null)).toBeNull();
    expect(handleCieloWebhookPayload({})).toBeNull();
  });
});
