import { describe, it, expect } from 'vitest';
import { detectClusterConvergence } from '../convergence.js';
import { normalizeMemeMovesPayload } from '../adapters/mememoves.js';

describe('MemeMoves Cluster Convergence', () => {
  it('detects when multiple smart wallets accumulate the same token within a time window', () => {
    const now = Date.now();
    const trades = [
      { token: 'mint_bonk', wallet: 'wallet_alpha', amountUsd: 1500, ts: now - 60_000 },
      { token: 'mint_bonk', wallet: 'wallet_beta', amountUsd: 2500, ts: now - 30_000 },
      { token: 'mint_bonk', wallet: 'wallet_gamma', amountUsd: 800, ts: now - 10_000 },
      { token: 'mint_other', wallet: 'wallet_delta', amountUsd: 300, ts: now - 5_000 },
    ];

    const clusters = detectClusterConvergence(trades, { minWallets: 2, windowMs: 15 * 60_000 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].token).toBe('mint_bonk');
    expect(clusters[0].clusterSize).toBe(3);
    expect(clusters[0].totalAmountUsd).toBe(4800);
    expect(clusters[0].wallets).toEqual(['wallet_alpha', 'wallet_beta', 'wallet_gamma']);
  });

  it('ignores single wallet accumulations below minWallets threshold', () => {
    const now = Date.now();
    const trades = [
      { token: 'mint_solo', wallet: 'wallet_solo', amountUsd: 5000, ts: now - 10_000 },
    ];
    const clusters = detectClusterConvergence(trades, { minWallets: 2, windowMs: 15 * 60_000 });
    expect(clusters).toHaveLength(0);
  });

  it('normalizes MemeMoves external leaderboard payload', () => {
    const raw = {
      tokens: [
        {
          mint: 'So11111111111111111111111111111111111111112',
          symbol: 'CONVERGE',
          accumulating_wallets: [
            { address: '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX', buys: 3, pnl_usd: 12000 },
            { address: '71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t', buys: 2, pnl_usd: 4000 }
          ],
          cluster_score: 85
        }
      ]
    };
    const wallets = normalizeMemeMovesPayload(raw);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].address).toBe('6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX');
    expect(wallets[0].tags).toContain('mememoves_cluster');
  });
});
