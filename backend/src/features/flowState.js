// Post-migration flow is evaluated only over completed, sufficiently active buckets.
export function flowSeriesFrom(buckets, n, zeroSellDisplayCap = 4) {
  return buckets.filter(bucket => !bucket.partial).slice(-n).map(bucket =>
    bucket.sellSol === 0 ? (bucket.buySol > 0 ? zeroSellDisplayCap : 1) : bucket.buySol / bucket.sellSol);
}

export function flowState({ flowSeries, athDistance, athAgeMs, buckets }, cfg = {}) {
  const minTrades = cfg.minTrades ?? 3;
  const minVolLamports = cfg.minVolLamports ?? 100_000_000;
  const athNearBand = cfg.athNearBand ?? 0.1;
  const active = buckets.slice(-flowSeries.length).filter(bucket => !bucket.partial &&
    bucket.buys + bucket.sells >= minTrades && bucket.buySol + bucket.sellSol >= minVolLamports);
  if (active.length < 2 || flowSeries.length < 2) return { label: 'INSUFFICIENT', bullish: null };

  const last = flowSeries.at(-1);
  const previous = flowSeries.at(-2);
  const allPositive = flowSeries.every(value => value > 1);
  if (last < 1 && previous < 1) return { label: 'SELL_PRESSURE', bullish: false };
  // athAgeMs is intentionally accepted as part of the snapshot contract. A stale ATH cannot
  // be labelled stable-at-highs simply because a sparse zero-sell bucket has a large ratio.
  if (athDistance > athNearBand && last > 1 && last >= previous) return { label: 'RECOVERING', bullish: true };
  if (athDistance <= athNearBand && allPositive && athAgeMs != null) return { label: 'STABLE_AT_HIGHS', bullish: true };
  if (allPositive) return { label: 'STABLE', bullish: true };
  return { label: 'MIXED', bullish: null };
}
