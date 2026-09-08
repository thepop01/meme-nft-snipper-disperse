class UnionFind {
  constructor() { this.parents = new Map(); }
  find(value) {
    if (!this.parents.has(value)) this.parents.set(value, value);
    const parent = this.parents.get(value);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }
  union(a, b) { this.parents.set(this.find(a), this.find(b)); }
}

// The primary risk is the largest suspicious component—not the union of all
// multi-wallet components, which would overstate unrelated activity.
export async function bundleClusters({ buyers, creationTs, rawBalanceOf, rawSupply, fundingSourceFor, isKnownService }, cfg) {
  if (rawSupply == null || BigInt(rawSupply) <= 0n || !buyers?.size) {
    return { clusterCount: 0, maxSuspiciousComponentPct: null, unionSuspiciousPct: null, coverage: 0 };
  }
  const unionFind = new UnionFind();
  const funderOf = new Map();
  for (const wallet of buyers) {
    const funder = await fundingSourceFor(wallet, creationTs - cfg.funderLookbackMs, creationTs);
    const root = funder && !isKnownService(funder) ? funder : `self:${wallet}`;
    funderOf.set(wallet, root);
    unionFind.union(wallet, root);
  }

  const clusters = new Map();
  for (const wallet of buyers) {
    const root = unionFind.find(funderOf.get(wallet));
    const cluster = clusters.get(root) ?? { wallets: 0, raw: 0n, funder: root };
    cluster.wallets += 1;
    cluster.raw += BigInt(await rawBalanceOf(wallet));
    clusters.set(root, cluster);
  }
  const suspicious = [...clusters.values()].filter(cluster => cluster.wallets > 1 && !isKnownService(cluster.funder));
  const asShare = raw => Number(raw) / Number(BigInt(rawSupply));
  return {
    clusterCount: clusters.size,
    maxSuspiciousComponentPct: suspicious.reduce((max, cluster) => Math.max(max, asShare(cluster.raw)), 0),
    unionSuspiciousPct: suspicious.reduce((total, cluster) => total + asShare(cluster.raw), 0),
    coverage: 1,
  };
}
