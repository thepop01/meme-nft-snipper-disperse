import { describe, expect, it } from 'vitest';
import { queryWallets } from '../query.js';

const rows = [
  { address: 'smart1', chain: 'solana', category: 'smart', openTrades: 6, realizedProfitUsd: 500, winRatePct: 70, totalTrades: 8 },
  { address: 'early1', chain: 'solana', category: 'tracked', qualificationMethod: 'pre_ath_early_buyer', earlyBuyerInfo: { athMcap: 15_000_000, symbol: 'RUN' }, realizedProfitUsd: 50, totalTrades: 2 },
  { address: 'snip1', chain: 'robinhood', category: 'sniper', tags: ['alpha_buyer'], realizedProfitUsd: 10 },
  { address: 'quiet', chain: 'solana', realizedProfitUsd: 0 },
];

describe('queryWallets', () => {
  it('paginates after search and subfilter', () => {
    const result = queryWallets(rows, { subfilter: 'early_buyer', search: 'early1', page: 1, pageSize: 1 });
    expect(result.total).toBe(1);
    expect(result.wallets.map(w => w.address)).toEqual(['early1']);
    expect(result.sniperCount).toBe(1);
  });

  it('puts an unclassified wallet in tracked, not smart', () => {
    const result = queryWallets(rows, { chain: 'solana', category: 'tracked' });
    expect(result.wallets.map(w => w.address)).toEqual(['early1', 'quiet']);
    expect(result.smartCount).toBe(1);
  });
});
