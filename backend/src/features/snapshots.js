export function initSnapshot(tick) {
  return Object.freeze({
    anchorMcap: tick.mcap, ath: tick.mcap, athTs: tick.ts, ts: tick.ts, mcap: tick.mcap,
    athDistance: 0, athAgeMs: 0, gainVsAnchor: 0,
  });
}

export function reduceSnapshot(previous, tick) {
  const isNewAth = tick.mcap > previous.ath;
  const ath = isNewAth ? tick.mcap : previous.ath;
  const athTs = isNewAth ? tick.ts : previous.athTs;
  return Object.freeze({ ...previous, ts: tick.ts, mcap: tick.mcap, ath, athTs,
    athDistance: 1 - tick.mcap / ath,
    athAgeMs: tick.ts - athTs,
    gainVsAnchor: tick.mcap / previous.anchorMcap - 1,
  });
}
