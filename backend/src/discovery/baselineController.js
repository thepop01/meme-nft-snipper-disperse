// Stage A: every launch is observed until its time window or swap cap closes.
export class BaselineController {
  constructor({ cfg, clock, onClose }) {
    this.cfg = cfg;
    this.clock = clock;
    this.onClose = onClose;
    this.open_ = new Map();
  }

  open(assetKey) {
    if (!this.open_.has(assetKey)) this.open_.set(assetKey, { openedTs: this.clock.now(), swaps: 0 });
  }

  isOpen(assetKey) { return this.open_.has(assetKey); }

  recordSwap(assetKey) {
    const state = this.open_.get(assetKey);
    if (!state) return undefined;
    state.swaps += 1;
    return state.swaps >= this.cfg.baselineMinSwaps ? this._close(assetKey, 'min_swaps') : undefined;
  }

  tick() {
    const now = this.clock.now();
    const closures = [];
    for (const [assetKey, state] of this.open_) {
      if (now - state.openedTs >= this.cfg.baselineWindowMs) closures.push(this._close(assetKey, 'window'));
    }
    return Promise.all(closures);
  }

  _close(assetKey, reason) {
    const state = this.open_.get(assetKey);
    if (!state) return undefined;
    this.open_.delete(assetKey);
    const now = this.clock.now();
    return this.onClose?.({
      assetKey, reason, swapsObserved: state.swaps,
      durationMs: now - state.openedTs, ts: now,
    });
  }
}
