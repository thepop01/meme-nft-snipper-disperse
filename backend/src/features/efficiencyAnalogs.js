export function efficiencyAnalogs(buckets) {
  const window = buckets.filter(bucket => !bucket.partial).at(-1);
  if (!window || window.buys + window.sells === 0) return { volPerTrade: null, volPerBuyer: null };
  return {
    volPerTrade: (window.buySol + window.sellSol) / (window.buys + window.sells),
    volPerBuyer: window.wallets > 0 ? window.buySol / window.wallets : null,
  };
}

export function mcapPerNewBuyer(previousSnapshot, tick, newBuyersThisWindow) {
  if (!previousSnapshot || !tick || tick.mcap == null || previousSnapshot.mcap == null || !newBuyersThisWindow) return null;
  return (tick.mcap - previousSnapshot.mcap) / newBuyersThisWindow;
}
