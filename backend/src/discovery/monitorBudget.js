// Stage B/C: gate-selected hot monitoring plus a random, identical-depth control cohort.
export class MonitorBudget {
  constructor({ cfg, rng }) {
    this.cfg = cfg;
    this.rng = rng;
    this.buys = new Map();
    this.hot = new Set();
    this.control = new Set();
  }

  registerLaunch(assetKey) {
    if (this.rng() < this.cfg.controlSampleRate) this.control.add(assetKey);
  }

  recordBuy(assetKey) {
    const buys = (this.buys.get(assetKey) ?? 0) + 1;
    this.buys.set(assetKey, buys);
    if (buys >= this.cfg.stageBMinBuys && !this.control.has(assetKey) && this.hot.size < this.cfg.hotLimit) {
      this.hot.add(assetKey);
    }
  }

  isHot(assetKey) { return this.hot.has(assetKey) || this.control.has(assetKey); }
  isControl(assetKey) { return this.control.has(assetKey); }
  // Controls and gate-selected tokens become structurally eligible at the same
  // observed-buy threshold; selection must not alter RPC evidence depth.
  isStructuralEligible(assetKey) { return (this.buys.get(assetKey) ?? 0) >= this.cfg.stageBMinBuys && this.isHot(assetKey); }
}
