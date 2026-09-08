function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Creator history is shrunk toward a declared base rate so tiny samples never look decisive.
export async function devFingerprint(creatorWallet, tape, fundingSourceFor, baseRates, cfg) {
  if (!creatorWallet) return { known: false, coverage: 0 };
  const rootFunder = await fundingSourceFor(creatorWallet, 0, Infinity);
  const cluster = [creatorWallet, rootFunder].filter(Boolean);
  const past = await tape.launchesByCreatorCluster(cluster);
  if (!past.length) return { known: false, coverage: 0 };
  const isRug = launch => launch.maxMcap && launch.finalMcap < launch.maxMcap * 0.1
    && launch.collapseTs != null && launch.athTs != null && launch.collapseTs - launch.athTs < cfg.rugWindowMs;
  const count = past.length;
  const shrink = observed => (observed + baseRates.prior * cfg.shrinkStrength) / (count + cfg.shrinkStrength);
  return {
    known: true,
    launches: count,
    coverage: Math.min(1, count / cfg.devConfidentN),
    rugRate: shrink(past.filter(isRug).length),
    graduationRate: shrink(past.filter(launch => launch.migrationTs != null).length),
    medianAthMcap: median(past.map(launch => launch.maxMcap).filter(value => value != null)),
    medianDevFirstSellMs: median(past.map(launch => launch.devFirstSellTs != null ? launch.devFirstSellTs - launch.creationTs : null).filter(value => value != null)),
  };
}
