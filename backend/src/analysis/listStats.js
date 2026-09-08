// Since-curated / since-listed performance math.

export function pctChange(entryPrice, currentPrice) {
  if (!entryPrice || currentPrice == null) return null;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

// entries: [{ entryPrice, currentPrice, ts }]
export function computeStats(entries, { windowMs, now = Date.now() }) {
  const pcts = entries
    .filter(e => now - e.ts <= windowMs)
    .map(e => pctChange(e.entryPrice, e.currentPrice))
    .filter(p => p != null)
    .sort((a, b) => a - b);
  if (pcts.length === 0) {
    return { count: 0, medianPct: null, winRatePct: null, bestPct: null, worstPct: null };
  }
  const mid = Math.floor(pcts.length / 2);
  const medianPct = pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;
  return {
    count: pcts.length,
    medianPct,
    winRatePct: (pcts.filter(p => p > 0).length / pcts.length) * 100,
    bestPct: pcts[pcts.length - 1],
    worstPct: pcts[0],
  };
}
