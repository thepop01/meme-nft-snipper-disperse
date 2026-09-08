import { describe, expect, it } from 'vitest';
import { assetKey, eventId, EVENT_TYPES, validateEnvelope } from '../identity.js';

describe('tape identity', () => {
  const event = { eventId: 'e', assetKey: 'solana:pumpfun:A', type: EVENT_TYPES.TOKEN_CREATED,
    chainTs: 1, receivedAt: 2, source: 'pumpportal', schemaVersion: 1, payload: {} };
  it('creates stable canonical identities', () => {
    expect(assetKey('solana', 'pumpfun', 'A')).toBe('solana:pumpfun:A');
    expect(eventId({ source: 'x', signature: 's', type: 't' })).toBe(eventId({ source: 'x', signature: 's', type: 't' }));
  });
  it('rejects floating exact-unit fields', () => {
    expect(validateEnvelope(event)).toEqual({ ok: true });
    expect(validateEnvelope({ ...event, payload: { lamports: 0.1 } }).ok).toBe(false);
  });
});
