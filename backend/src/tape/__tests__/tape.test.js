import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { migrate } from '../db.js';
import { Tape } from '../tape.js';
import { EVENT_TYPES } from '../identity.js';

const event = (overrides = {}) => ({ eventId: `event-${Math.random()}`, assetKey: 'solana:pumpfun:A',
  type: EVENT_TYPES.TRADE_OBSERVED, chainTs: 100, receivedAt: 200, slot: 1,
  signature: `sig-${Math.random()}`, instructionIndex: 0, source: 'pumpportal', schemaVersion: 1,
  payload: { side: 'buy', lamports: 1 }, ...overrides });

describe('Tape', () => {
  let tape;
  beforeEach(async () => { const mem = newDb(); const { Pool } = mem.adapters.createPg(); const db = new Pool(); await migrate(db); tape = new Tape(db); });
  it('deduplicates append and reads causally', async () => {
    const duplicate = event({ signature: 'same', chainTs: 100 });
    await tape.append(duplicate); await tape.append({ ...duplicate });
    await tape.append(event({ signature: 'future', chainTs: 101 }));
    expect((await tape.eventsUntil('solana:pumpfun:A', 100)).map(row => row.signature)).toEqual(['same']);
  });
  it('filters types and preserves causal ordering', async () => {
    await tape.append(event({ signature: 'trade', chainTs: 100, type: EVENT_TYPES.TRADE_OBSERVED }));
    await tape.append(event({ signature: 'create', chainTs: 50, type: EVENT_TYPES.TOKEN_CREATED }));
    expect((await tape.eventsUntil('solana:pumpfun:A', 200, [EVENT_TYPES.TRADE_OBSERVED])).map(row => row.signature)).toEqual(['trade']);
  });
});

describe('idempotency on event_id', () => {
  let tape;
  beforeEach(async () => { const mem = newDb(); const { Pool } = mem.adapters.createPg(); const db = new Pool(); await migrate(db); tape = new Tape(db); });

  const scorerEvent = (asOf) => ({
    eventId: `score:solana:pumpfun:M:${asOf}`, assetKey: 'solana:pumpfun:M',
    type: 'score_evaluated', chainTs: asOf, receivedAt: asOf, slot: null,
    signature: null, instructionIndex: 0, source: 'scorer', schemaVersion: 1,
    payload: { memeScore: 70 },
  });

  it('stores successive scorer events even though signature is null', async () => {
    expect(await tape.append(scorerEvent(1_000))).toBe(true);
    expect(await tape.append(scorerEvent(2_000))).toBe(true);
    const rows = await tape.eventsUntil('solana:pumpfun:M', 5_000, ['score_evaluated']);
    expect(rows).toHaveLength(2);
  });

  it('rejects a replayed scorer event with the same event_id', async () => {
    expect(await tape.append(scorerEvent(3_000))).toBe(true);
    expect(await tape.append(scorerEvent(3_000))).toBe(false);
    const rows = await tape.eventsUntil('solana:pumpfun:M', 5_000, ['score_evaluated']);
    expect(rows).toHaveLength(1);
  });

  it('still dedupes a replayed chain event', async () => {
    const trade = {
      eventId: 'abc123', assetKey: 'solana:pumpfun:M', type: 'trade_observed',
      chainTs: 10, receivedAt: 10, slot: 5, signature: 'SIG1', instructionIndex: 0,
      source: 'pumpportal', schemaVersion: 1, payload: { side: 'buy' },
    };
    expect(await tape.append(trade)).toBe(true);
    expect(await tape.append(trade)).toBe(false);
  });
});
