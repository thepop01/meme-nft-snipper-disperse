import { describe, it, expect } from 'vitest';
import { normalizeKolscanPayload } from '../adapters/kolscan.js';

describe('Kolscan adapter', () => {
  it('normalizes Kolscan KOL callers into Solana wallets with kol tags', () => {
    const raw = {
      kols: [
        {
          name: 'SolanaLegend',
          twitter: 'sollegend_eth',
          address: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP',
          pnl_sol: 450.2,
          pnl_usd: 67500,
          winrate: 72.0,
          calls_count: 35,
          followers: 120000,
        },
        {
          name: 'MemeCaller',
          address: 'EA3VfFSJKHyU7yuMYsgra4DjwXA3tbzAs1BV4iMcCu7t',
          pnl_usd: 1200,
          winrate: 60.0,
          calls_count: 10,
        }
      ]
    };

    const wallets = normalizeKolscanPayload(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].chain).toBe('solana');
    expect(wallets[0].address).toBe('8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP');
    expect(wallets[0].twitterUsername).toBe('sollegend_eth');
    expect(wallets[0].realizedProfitUsd).toBe(67500);
    expect(wallets[0].winRatePct).toBe(72.0);
    expect(wallets[0].source).toBe('kolscan');
    expect(wallets[0].tags).toContain('kolscan');
    expect(wallets[0].tags).toContain('alpha_caller');

    expect(wallets[1].chain).toBe('solana');
    expect(wallets[1].realizedProfitUsd).toBe(1200);
  });

  it('handles empty or malformed inputs', () => {
    expect(normalizeKolscanPayload(null)).toEqual([]);
    expect(normalizeKolscanPayload({})).toEqual([]);
    expect(normalizeKolscanPayload({ kols: [] })).toEqual([]);
  });
});
