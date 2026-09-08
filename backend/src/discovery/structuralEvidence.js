import { assetKey, eventId, EVENT_TYPES, validateEnvelope } from '../tape/identity.js';
import { top10ExLp } from '../features/topHolders.js';
import { bundleClusters } from '../features/funderGraph.js';
import { freshWalletFeature } from '../features/freshWallets.js';
import { devFingerprint } from '../features/devFingerprint.js';

// Bounded, dependency-injected structural evidence collection.  It deliberately records
// unknown RPC facts as unavailable instead of fabricating a safe value.
export class StructuralEvidenceCollector {
  constructor({ tape, rpc, resolvers, fundingSourceFor, walletAge, richProfile, cfg, clock, concurrency = 4 }) {
    this.tape = tape; this.rpc = rpc; this.resolvers = resolvers;
    this.fundingSourceFor = fundingSourceFor; this.walletAge = walletAge; this.richProfile = richProfile;
    this.cfg = cfg; this.clock = clock; this.concurrency = concurrency;
    this.active = 0; this.pending = []; this.queued = new Set(); this.completed = new Set();
  }

  collect(input) {
    if (this.queued.has(input.assetKey) || this.completed.has(input.assetKey)) return Promise.resolve(false);
    this.queued.add(input.assetKey);
    return new Promise((resolve, reject) => { this.pending.push({ input, resolve, reject }); this._drain(); });
  }

  _drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift(); this.active += 1;
      this._collect(job.input).then(value => { this.completed.add(job.input.assetKey); job.resolve(value); }, error => job.reject(error)).finally(() => {
        this.active -= 1; this.queued.delete(job.input.assetKey); this._drain();
      });
    }
  }

  async _append(asset, type, payload, signature) {
    const envelope = { assetKey: asset.assetKey, source: 'structural-evidence', schemaVersion: 1, type,
      chainTs: this.clock.now(), receivedAt: this.clock.now(), slot: null, signature, instructionIndex: 0, payload };
    envelope.eventId = eventId(envelope);
    if (!validateEnvelope(envelope).ok) return false;
    return this.tape.append(envelope);
  }

  async _collect(asset) {
    const buyers = new Set(asset.trades.filter(trade => trade.side === 'buy' && trade.wallet).map(trade => trade.wallet));
    const resolvers = typeof this.resolvers === 'function' ? this.resolvers(asset) : this.resolvers;
    const holder = await top10ExLp(this.rpc, asset.mint, resolvers);
    const cluster = await bundleClusters({ buyers, creationTs: asset.creationTs, rawBalanceOf: wallet => this.rpc.rawBalanceOf(wallet, asset.mint),
      rawSupply: asset.rawSupply, fundingSourceFor: this.fundingSourceFor, isKnownService: resolvers.isKnownService }, this.cfg);
    const fresh = await freshWalletFeature(buyers, this.walletAge, this.richProfile, this.cfg);
    const dev = await devFingerprint(asset.creator, this.tape, this.fundingSourceFor, this.cfg.baseRates, this.cfg);
    await this._append(asset, EVENT_TYPES.HOLDER_SNAPSHOT, { ...holder, ...cluster, freshWallets: fresh, collectorVersion: this.cfg.version }, `holders:${asset.assetKey}:${this.clock.now()}`);
    await this._append(asset, EVENT_TYPES.FUNDING_LINK, { creator: asset.creator ?? null, devFingerprint: dev, buyers: buyers.size, collectorVersion: this.cfg.version }, `funding:${asset.assetKey}:${this.clock.now()}`);
    return { holder, cluster, fresh, dev };
  }
}

export function structuralAssetFromFeatures(assetKeyValue, mint, features) {
  return {
    assetKey: assetKeyValue, mint, creationTs: features.createdTs, creator: features.created?.creator ?? null,
    rawSupply: features.created?.rawSupply ?? null, trades: features.trades,
  };
}
