import { createHash } from 'node:crypto';

export function assetKey(chain, launchpad, mint) {
  return `${chain}:${launchpad}:${mint}`;
}

export const EVENT_TYPES = Object.freeze({
  TOKEN_CREATED: 'token_created',
  TRADE_OBSERVED: 'trade_observed',
  BASELINE_CLOSED: 'baseline_closed',
  MIGRATION_OBSERVED: 'migration_observed',
  HOLDER_SNAPSHOT: 'holder_snapshot',
  FUNDING_LINK: 'funding_link',
  MARKET_SNAPSHOT: 'market_snapshot',
  SELL_ROUTE_CHECK: 'sell_route_check',
  SCORE_EVALUATED: 'score_evaluated',
  ADMISSION_CHANGED: 'admission_changed',
});

const knownTypes = new Set(Object.values(EVENT_TYPES));
const amountKey = /lamports|raw|sol|amount|supply/i;

export function eventId({ source, signature, instructionIndex = 0, type }) {
  return createHash('sha1')
    .update(`${source}|${signature ?? ''}|${instructionIndex}|${type}`)
    .digest('hex');
}

function exactUnits(payload) {
  if (!payload || typeof payload !== 'object') return true;
  return Object.entries(payload).every(([key, value]) =>
    !amountKey.test(key) || typeof value !== 'number' || Number.isInteger(value));
}

export function validateEnvelope(event) {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'not-an-object' };
  if (!event.eventId || !event.assetKey) return { ok: false, reason: 'missing-identity' };
  if (!knownTypes.has(event.type)) return { ok: false, reason: 'unknown-type' };
  if (!Number.isFinite(event.receivedAt)) return { ok: false, reason: 'missing-receivedAt' };
  if (!Number.isInteger(event.schemaVersion)) return { ok: false, reason: 'missing-schemaVersion' };
  if (!exactUnits(event.payload)) return { ok: false, reason: 'float-amount' };
  return { ok: true };
}
