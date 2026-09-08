export function bucketize(trades, windowMs, fromTs, toTs, nowTs) {
  const buckets = new Map();
  for (const trade of trades) {
    if (trade.chainTs < fromTs || trade.chainTs > toTs) continue;
    const start = Math.floor(trade.chainTs / windowMs) * windowMs;
    const bucket = buckets.get(start) ?? { buySol: 0, sellSol: 0, buys: 0, sells: 0, wallets: new Set() };
    if (trade.side === 'buy') { bucket.buySol += trade.solLamports; bucket.buys += 1; }
    else if (trade.side === 'sell') { bucket.sellSol += trade.solLamports; bucket.sells += 1; }
    else continue;
    bucket.wallets.add(trade.wallet);
    buckets.set(start, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([windowStart, bucket]) => ({
    windowStart, buySol: bucket.buySol, sellSol: bucket.sellSol, buys: bucket.buys,
    sells: bucket.sells, wallets: bucket.wallets.size, partial: windowStart + windowMs > nowTs,
  }));
}
