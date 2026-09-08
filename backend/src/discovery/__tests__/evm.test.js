import { describe, expect, it } from 'vitest';
import { EVM_CHAINS, normalizeGeckoPool } from '../evm.js';

function fixture({ liquidity = '12000', baseSymbol = 'MEME' } = {}) {
  const pool = {
    attributes: {
      address: '0xpool', name: `${baseSymbol} / WMON`, pool_created_at: '2026-07-19T08:57:25Z',
      base_token_price_usd: '0.00042', reserve_in_usd: liquidity, market_cap_usd: '42000',
      volume_usd: { m5: '2500', h1: '8000', h24: '32000' },
      transactions: { m5: { buys: 18, sells: 7 } },
    },
    relationships: {
      base_token: { data: { id: 'robinhood_0xbase' } },
      quote_token: { data: { id: 'robinhood_0xquote' } },
      dex: { data: { id: 'uniswap-v4-robinhood' } },
    },
  };
  const included = new Map([
    ['robinhood_0xbase', { attributes: { address: '0xBASE', name: 'Meme Coin', symbol: baseSymbol } }],
    ['robinhood_0xquote', { attributes: { address: '0xQUOTE', name: 'Wrapped MON', symbol: 'WMON' } }],
  ]);
  return { pool, included };
}

describe('GeckoTerminal EVM normalization', () => {
  it('registers relationship-based Robinhood token metadata', () => {
    const { pool, included } = fixture();
    const token = normalizeGeckoPool(pool, included, 'robinhood', EVM_CHAINS.robinhood);
    expect(token).toMatchObject({ mint: '0xbase', symbol: 'MEME', chain: 'robinhood', chainId: 4663, ecosystem: 'hood.run' });
    expect(token.txns.m5).toEqual({ buys: 18, sells: 7 });
  });

  it('rejects pools below the configured liquidity floor', () => {
    const { pool, included } = fixture({ liquidity: '100' });
    expect(normalizeGeckoPool(pool, included, 'robinhood', EVM_CHAINS.robinhood)).toBeNull();
  });

  it('rejects wrapped native tokens as the base asset', () => {
    const { pool, included } = fixture({ baseSymbol: 'WMON' });
    expect(normalizeGeckoPool(pool, included, 'robinhood', EVM_CHAINS.robinhood)).toBeNull();
  });
});
