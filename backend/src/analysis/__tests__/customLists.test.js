import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));
vi.mock('../../alerts.js', () => ({ pushAlert: vi.fn() }));
import { pushAlert } from '../../alerts.js';
import { emit } from '../../bus.js';

const token = (over = {}) => ({
  mint: 'M1', symbol: 'PEPE', name: 'Pepe', source: 'pumpfun',
  liquidityUsd: 20000, priceUsd: 0.001, safety: { score: 70 },
  createdAt: Date.now(), ...over,
});

describe('customLists', () => {
  let lists;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.clearAllMocks();
    vi.resetModules();
    lists = await import('../customLists.js');
  });

  it('creates, updates, deletes lists', () => {
    const l = lists.createList({ name: 'High Liq', rules: { minLiquidityUsd: 10000 } });
    expect(l.id).toBeTruthy();
    expect(l.enabled).toBe(true);
    lists.updateList(l.id, { name: 'Higher Liq' });
    expect(lists.getLists()[0].name).toBe('Higher Liq');
    lists.deleteList(l.id);
    expect(lists.getLists()).toEqual([]);
  });

  it('evaluateToken adds a match with price stamp, alert, and WS event once', () => {
    const l = lists.createList({ name: 'HL', rules: { minLiquidityUsd: 10000 } });
    lists.evaluateToken(token());
    const [entry] = lists.getLists()[0].matched;
    expect(entry).toMatchObject({ mint: 'M1', listedPriceUsd: 0.001, exited: false });
    expect(entry.listedAt).toBeTruthy();
    expect(pushAlert).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith('token:listed', expect.objectContaining({ listId: l.id, mint: 'M1' }));

    lists.evaluateToken(token()); // re-evaluate: no duplicate
    expect(lists.getLists()[0].matched).toHaveLength(1);
    expect(pushAlert).toHaveBeenCalledOnce();
  });

  it('marks exited when criteria no longer hold, never removes', () => {
    lists.createList({ name: 'HL', rules: { minLiquidityUsd: 10000 } });
    lists.evaluateToken(token());
    lists.evaluateToken(token({ liquidityUsd: 500 }));
    const [entry] = lists.getLists()[0].matched;
    expect(entry.exited).toBe(true);
    lists.evaluateToken(token()); // criteria hold again
    expect(lists.getLists()[0].matched[0].exited).toBe(false);
  });

  it('disabled lists do not match', () => {
    const l = lists.createList({ name: 'HL', rules: {} });
    lists.updateList(l.id, { enabled: false });
    lists.evaluateToken(token());
    expect(lists.getLists()[0].matched).toEqual([]);
  });

  it('removeMatch removes one entry manually', () => {
    const l = lists.createList({ name: 'HL', rules: {} });
    lists.evaluateToken(token());
    lists.removeMatch(l.id, 'M1');
    expect(lists.getLists()[0].matched).toEqual([]);
  });

  it('trackedMints returns mints of all enabled lists', () => {
    lists.createList({ name: 'A', rules: {} });
    lists.evaluateToken(token());
    expect(lists.trackedMints()).toEqual(['M1']);
  });

  it('emits thresholded price alerts and resets the anti-spam baseline', () => {
    lists.createList({
      name: 'Moves', rules: {},
      alerts: { newMatches: false, riskChanges: false, priceMoves: true, priceMovePct: 10 },
    });
    lists.evaluateToken(token());
    lists.evaluateToken(token({ priceUsd: 0.00105 }));
    expect(pushAlert).not.toHaveBeenCalled();
    lists.evaluateToken(token({ priceUsd: 0.0012 }));
    expect(pushAlert).toHaveBeenCalledOnce();
    lists.evaluateToken(token({ priceUsd: 0.00125 }));
    expect(pushAlert).toHaveBeenCalledOnce();
  });

  it('batch evaluation honours the configured refresh cadence', () => {
    lists.createList({ name: 'Cadence', rules: {}, refreshCadenceSec: 60 });
    lists.evaluateTokens([token()], { now: 1_000_000 });
    lists.evaluateTokens([token({ priceUsd: 0.002 })], { now: 1_030_000 });
    expect(lists.getLists()[0].matched[0].lastPriceUsd).toBe(0.001);
    lists.evaluateTokens([token({ priceUsd: 0.002 })], { now: 1_061_000 });
    expect(lists.getLists()[0].matched[0].lastPriceUsd).toBe(0.002);
  });

  it('keeps pins and exclusions chain-aware for identical token addresses', () => {
    const list = lists.createList({ name: 'Manual', mode: 'manual', rules: {} });
    lists.pinToken(list.id, 'solana:M1');
    lists.evaluateToken(token({ chain: 'solana' }));
    lists.evaluateToken(token({ chain: 'monad' }));
    expect(lists.getLists()[0].matched.map(entry => entry.tokenKey)).toEqual(['solana:M1']);
    lists.excludeToken(list.id, 'solana:M1');
    expect(lists.getLists()[0].matched).toEqual([]);
    expect(lists.getLists()[0].excludedTokens).toContain('solana:M1');
  });
});
