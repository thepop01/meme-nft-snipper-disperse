import { describe, expect, it } from 'vitest';
import { normalizeFomoLeaderboard, normalizeGmgnSmartMoney, normalizePumpLeaderboard } from '../finder.js';
describe('finder normalizers', () => {
  it('maps fomoapi.io leaderboard rows to chain-scoped wallets', () => { const out = normalizeFomoLeaderboard({ traders: [{ handle: 'degen_king', pnlUsd: 45320, wallets: { solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', evm: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0' } }] }); expect(out.map(w => w.chain).sort()).toEqual(['robinhood', 'solana']); expect(out[0].source).toBe('fomo-leaderboard'); const arb = out.find(w=>w.chain==='robinhood'); expect(arb.address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0'); expect(arb.score).toBe(45320); expect(arb.evidence.handle).toBe('degen_king'); });
  it('drops pump.fun rows without an address', () => { expect(normalizePumpLeaderboard([{ pnl: 100 }])).toEqual([]); });
it('normalizes gmgn smart-money per chain and drops bad addresses', () => {
  const sol = normalizeGmgnSmartMoney([{ address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', smart_degen_count: 7, symbol: 'BONK' }], 'solana');
  expect(sol).toEqual([{ address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', chain: 'solana', source: 'gmgn-smart-money', score: 7, evidence: { symbol: 'BONK' } }]);
  const evm = normalizeGmgnSmartMoney([{ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0', smart_degen_count: 3 }], 'robinhood');
  expect(evm[0].address).toBe('0x742d35cc6634c0532925a3b844bc9e7595f0beb0');
  expect(normalizeGmgnSmartMoney([{ address: 'not-an-address' }], 'solana')).toEqual([]);
});
});
