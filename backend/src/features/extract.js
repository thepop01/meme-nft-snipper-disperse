import { EVENT_TYPES } from '../tape/identity.js';
import { bucketize } from './windows.js';
import { initSnapshot, reduceSnapshot } from './snapshots.js';
import { supplyAwareMcap } from './mcap.js';
import { capitalFormation } from './capitalFormation.js';
import { nonBotShare } from './nonBotShare.js';
import { flowSeriesFrom, flowState } from './flowState.js';
import { efficiencyAnalogs } from './efficiencyAnalogs.js';
import { cohortRetention } from './cohortRetention.js';
import { DerivativeTracker } from './derivatives.js';

// Prefer a reproducible calculation from raw supply and USD price.  A provider-supplied
// anchor is retained only as a backward-compatible, already-computed fallback.
export function migrationAnchorMcap(createdEvent, migrationEvent) {
  if (!migrationEvent) return null;
  const created = createdEvent?.payload ?? {};
  const migration = migrationEvent.payload ?? {};
  const computed = supplyAwareMcap({
    rawSupply: migration.rawSupply ?? created.rawSupply,
    decimals: migration.decimals ?? created.decimals,
    priceUsd: migration.priceUsd,
  });
  return computed ?? migration.anchorMcap ?? null;
}

// The one assembly function used by both production reads and replay.
export function extractAllFeatures(events, opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const nowTs = opts.nowTs ?? 0;
  const createdEvt = events.find(event => event.type === EVENT_TYPES.TOKEN_CREATED);
  const migrationEvt = events.find(event => event.type === EVENT_TYPES.MIGRATION_OBSERVED);
  const baselineEvt = events.find(event => event.type === EVENT_TYPES.BASELINE_CLOSED);
  const holderEvt = [...events].reverse().find(event => event.type === EVENT_TYPES.HOLDER_SNAPSHOT);
  const fundingEvt = [...events].reverse().find(event => event.type === EVENT_TYPES.FUNDING_LINK);
  const marketEvents = events.filter(event => event.type === EVENT_TYPES.MARKET_SNAPSHOT);
  const trades = events.filter(event => event.type === EVENT_TYPES.TRADE_OBSERVED).map(event => ({
    ...event.payload,
    chainTs: Number(event.chain_ts ?? event.chainTs),
    solLamports: event.payload.lamports,
  }));
  const fromTs = Number(createdEvt?.chain_ts ?? createdEvt?.chainTs ?? trades[0]?.chainTs ?? 0);
  const structural = {
    capitalFormation: capitalFormation(trades, createdEvt?.payload?.curveTargetSol),
    nonBotShare: nonBotShare(trades, opts.classifier),
    ...(holderEvt?.payload ?? {}),
    ...(fundingEvt?.payload?.devFingerprint ? { devFingerprint: fundingEvt.payload.devFingerprint } : {}),
  };
  const initialMcap = migrationAnchorMcap(createdEvt, migrationEvt);
  const migrationTs = Number(migrationEvt?.chain_ts ?? migrationEvt?.chainTs ?? 0);
  let snapshot = migrationEvt && initialMcap != null ? initSnapshot({ mcap: initialMcap, ts: migrationTs }) : null;
  const tracker = new DerivativeTracker(opts.emaAlpha ?? 0.3);
  if (snapshot) tracker.update(snapshot.mcap, 1);
  for (const event of marketEvents) {
    const payload = event.payload ?? {};
    const mcap = supplyAwareMcap({ rawSupply: payload.rawSupply ?? createdEvt?.payload?.rawSupply,
      decimals: payload.decimals ?? createdEvt?.payload?.decimals, priceUsd: payload.priceUsd });
    const ts = Number(event.chain_ts ?? event.chainTs);
    if (!snapshot || mcap == null || !Number.isFinite(ts) || ts < snapshot.ts) continue;
    const previous = snapshot;
    snapshot = reduceSnapshot(previous, { mcap, ts });
    tracker.update(mcap, ts - previous.ts);
  }
  const flowSeries = flowSeriesFrom(bucketize(trades, windowMs, fromTs, nowTs, nowTs), opts.flowSeriesLen ?? 4, opts.zeroSellDisplayCap ?? 4);
  const buckets = bucketize(trades, windowMs, fromTs, nowTs, nowTs);
  const rawBoughtByWallet = new Map();
  for (const trade of trades) if (trade.side === 'buy' && trade.chainTs >= fromTs && trade.chainTs <= fromTs + (opts.cohortEntryMs ?? 5 * 60_000)) {
    rawBoughtByWallet.set(trade.wallet, (rawBoughtByWallet.get(trade.wallet) ?? 0n) + BigInt(trade.rawTokens ?? 0));
  }
  const dynamic = {
    flowState: flowState({ flowSeries, athDistance: snapshot?.athDistance, athAgeMs: snapshot?.athAgeMs, buckets }, opts.flowConfig),
    efficiency: efficiencyAnalogs(buckets),
    retention: cohortRetention(trades, fromTs, opts.cohortEntryMs ?? 5 * 60_000, opts.cohortCheckMs ?? 15 * 60_000, rawBoughtByWallet),
    derivatives: snapshot ? tracker.state() : null,
    snapshot,
  };
  return {
    created: createdEvt?.payload ?? null,
    createdTs: fromTs,
    baseline: baselineEvt?.payload ?? null,
    trades,
    buckets,
    structural,
    dynamic,
    migrated: Boolean(migrationEvt),
    // Unknown supply/price must remain unknown; never initialize a fake 1B-supply anchor.
    snapshot,
  };
}

export async function causalFeatures(tape, assetKey, asOf, opts = {}) {
  const events = await tape.eventsUntil(assetKey, asOf);
  // Dynamic self-import deliberately resolves the public assembly reference, which makes the
  // parity guard catch any future attempt to fork live and replay extraction.
  const module = await import('./extract.js');
  return module.extractAllFeatures(events, { ...opts, nowTs: opts.nowTs ?? asOf });
}
