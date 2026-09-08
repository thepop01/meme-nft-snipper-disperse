import { describe, expect, it, vi } from 'vitest';
import { BaselineController } from '../baselineController.js';
import { manualClock } from '../clock.js';
import { handlePumpMessage, makeBaselineCloser, routePumpMessage } from '../pumpfun.js';
import { EVENT_TYPES } from '../../tape/identity.js';

function fakeTape() { const appended = []; return { appended, append: vi.fn(async event => { appended.push(event); return true; }) }; }
describe('PumpPortal tape ingestion', () => {
  it('maps creation, trade and migration messages to validated tape events', async () => {
    const tape = fakeTape(); const clock = manualClock(10);
    await handlePumpMessage(tape, { txType: 'create', mint: 'A', solAmount: 0.1, signature: 'c', blockTime: 1, curveTargetSol: 85, rawSupply: '1000000000000', decimals: 6 }, { clock });
    await handlePumpMessage(tape, { txType: 'buy', mint: 'A', solAmount: 0.1, signature: 'b', blockTime: 2 }, { clock });
    await handlePumpMessage(tape, { txType: 'migrate', mint: 'A', signature: 'm', blockTime: 3, priceUsd: 0.002, rawSupply: '1000000000000', decimals: 6 }, { clock });
    expect(tape.appended.map(event => event.type)).toEqual([EVENT_TYPES.TOKEN_CREATED, EVENT_TYPES.TRADE_OBSERVED, EVENT_TYPES.MIGRATION_OBSERVED]);
    expect(tape.appended[0]).toMatchObject({ schemaVersion: 2, payload: { curveTargetSol: '85', rawSupply: '1000000000000', decimals: 6 } });
    expect(tape.appended[1].payload.lamports).toBe(100000000);
    expect(tape.appended[2].payload).toMatchObject({ pool: null, priceUsd: 0.002, rawSupply: '1000000000000', decimals: 6 });
  });
  it('opens trade collection then writes censoring evidence and unsubscribes', async () => {
    const tape = fakeTape(); const clock = manualClock(0); const subs = { subscribeTrades: vi.fn(), unsubscribeTrades: vi.fn() };
    const budget = { registerLaunch: vi.fn(), recordBuy: vi.fn(), isHot: () => false };
    const baseline = new BaselineController({ cfg: { baselineWindowMs: 1000, baselineMinSwaps: 2 }, clock, onClose: () => {} });
    baseline.onClose = makeBaselineCloser(tape, subs, budget);
    await routePumpMessage({ tape, baseline, subs, budget, clock }, { txType: 'create', mint: 'A', signature: 'c', blockTime: 1 });
    await routePumpMessage({ tape, baseline, subs, budget, clock }, { txType: 'buy', mint: 'A', signature: 'b1', blockTime: 2 });
    await routePumpMessage({ tape, baseline, subs, budget, clock }, { txType: 'buy', mint: 'A', signature: 'b2', blockTime: 3 });
    expect(subs.subscribeTrades).toHaveBeenCalledWith('A'); expect(tape.appended.at(-1).type).toBe(EVENT_TYPES.BASELINE_CLOSED); expect(subs.unsubscribeTrades).toHaveBeenCalledWith('A');
  });
  it('sends a hot asset once to the optional structural collector at the stage-B threshold', async () => {
    const tape = fakeTape(); const clock = manualClock(0); const subs = { subscribeTrades: vi.fn(), unsubscribeTrades: vi.fn() };
    const budget = { registerLaunch: vi.fn(), recordBuy: vi.fn(), isHot: () => true, isStructuralEligible: () => true };
    const baseline = new BaselineController({ cfg: { baselineWindowMs: 1000, baselineMinSwaps: 30 }, clock, onClose: () => {} });
    const collector = { collect: vi.fn(async () => true) }; const structuralState = new Map();
    await routePumpMessage({ tape, baseline, subs, budget, structuralEvidence: collector, structuralState, clock }, { txType: 'create', mint: 'A', signature: 'c', blockTime: 1 });
    await routePumpMessage({ tape, baseline, subs, budget, structuralEvidence: collector, structuralState, clock }, { txType: 'buy', mint: 'A', solAmount: 0.1, signature: 'b', blockTime: 2 });
    expect(collector.collect).toHaveBeenCalledWith(expect.objectContaining({ mint: 'A', trades: [expect.objectContaining({ side: 'buy' })] }));
  });
  it('records supply-aware market evidence at the same stage-B gate', async () => {
    const tape = fakeTape(); const clock = manualClock(0); const subs = { subscribeTrades: vi.fn(), unsubscribeTrades: vi.fn() };
    const budget = { registerLaunch: vi.fn(), recordBuy: vi.fn(), isHot: () => true, isStructuralEligible: () => true };
    const baseline = new BaselineController({ cfg: { baselineWindowMs: 1000, baselineMinSwaps: 30 }, clock, onClose: () => {} });
    const structuralState = new Map();
    await routePumpMessage({ tape, baseline, subs, budget, structuralState, clock }, { txType: 'create', mint: 'A', signature: 'c', blockTime: 1, rawSupply: '1000000000000', decimals: 6 });
    await routePumpMessage({ tape, baseline, subs, budget, structuralState, clock }, { txType: 'buy', mint: 'A', signature: 'b', blockTime: 2, priceUsd: 0.002 });
    expect(tape.appended.at(-1)).toMatchObject({ type: EVENT_TYPES.MARKET_SNAPSHOT, payload: { priceUsd: 0.002, rawSupply: '1000000000000', decimals: 6, source: 'pumpportal' } });
  });
});
