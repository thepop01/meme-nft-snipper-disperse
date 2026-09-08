// Freshness is age-only. Low-history is optional, distinct evidence and never changes freshCount.
export async function freshWalletFeature(buyers, walletAge, richProfile, cfg) {
  let freshCount = 0;
  const boundary = [];
  for (const wallet of buyers) {
    const age = await walletAge(wallet);
    if (age == null) continue;
    if (age < cfg.freshAgeMs) freshCount += 1;
    else if (age < cfg.freshAgeMs * 2) boundary.push(wallet);
  }
  const feature = { freshCount, freshShare: buyers.size ? freshCount / buyers.size : null };
  const [lower, upper] = cfg.freshBoundary;
  if (freshCount >= lower && freshCount <= upper && boundary.length) {
    const profiles = await Promise.all(boundary.map(richProfile));
    const lowHistory = profiles.filter(profile => profile && profile.txCount < 10 && profile.fundingSources === 1 && !profile.hasDefiHistory).length;
    feature.lowHistoryShare = lowHistory / boundary.length;
  }
  return feature;
}
