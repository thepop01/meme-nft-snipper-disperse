// Multi-Wallet Cluster Convergence Engine (MemeMoves principle)
// Detects when multiple verified smart or tracked wallets accumulate the same token
// simultaneously within a configurable time window.

import { log, emit } from '../bus.js';

export function detectClusterConvergence(trades = [], { minWallets = 2, windowMs = 15 * 60_000, now = Date.now() } = {}) {
  const cutoff = now - windowMs;
  const recent = trades.filter(t => (t.ts || 0) >= cutoff && t.token && t.wallet);

  // Group by token
  const byToken = new Map();
  for (const t of recent) {
    if (!byToken.has(t.token)) {
      byToken.set(t.token, []);
    }
    byToken.get(t.token).push(t);
  }

  const clusters = [];

  for (const [token, tokenTrades] of byToken.entries()) {
    // Unique wallets
    const walletMap = new Map();
    let totalUsd = 0;

    for (const t of tokenTrades) {
      if (!walletMap.has(t.wallet)) {
        walletMap.set(t.wallet, []);
      }
      walletMap.get(t.wallet).push(t);
      totalUsd += Number(t.amountUsd || t.amount || 0);
    }

    const uniqueWallets = Array.from(walletMap.keys());
    if (uniqueWallets.length >= minWallets) {
      const cluster = {
        token,
        clusterSize: uniqueWallets.length,
        totalAmountUsd: totalUsd,
        wallets: uniqueWallets,
        firstBuyAt: Math.min(...tokenTrades.map(t => t.ts || now)),
        lastBuyAt: Math.max(...tokenTrades.map(t => t.ts || now)),
        detectedAt: new Date(now).toISOString(),
      };
      clusters.push(cluster);

      // Emit live cluster convergence alert
      emit('cluster:convergence', cluster);
      log('info', `[convergence] 🔥 Multi-wallet cluster detected on ${token}: ${uniqueWallets.length} wallets ($${totalUsd.toFixed(0)})`);
    }
  }

  return clusters.sort((a, b) => b.clusterSize - a.clusterSize || b.totalAmountUsd - a.totalAmountUsd);
}
