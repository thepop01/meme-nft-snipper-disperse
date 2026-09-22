import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));
vi.mock('../../alerts.js', () => ({ pushAlert: vi.fn() }));
vi.mock('../../analysis/safety.js', () => ({ assertTokenBuyable: vi.fn() }));
vi.mock('../../discovery/registry.js', () => ({ getToken: vi.fn() }));
vi.mock('../../trading/executor.js', () => ({ executeBuy: vi.fn() }));
vi.mock('../../discovery/enrich.js', () => ({
  fetchPricesBatch: vi.fn(),
  fetchPriceUsd: vi.fn(),
}));
vi.mock('../positions.js', () => ({
  openPosition: vi.fn(),
  closePosition: vi.fn(),
  getPositions: vi.fn(() => []),
}));

import { getToken } from '../../discovery/registry.js';

const TOKEN = {
  mint: 'M1', symbol: 'PEPE', name: 'Pepe', onCurve: false, decimals: 6, priceUsd: 0.002,
};

const buyParams = {
  side: 'buy', mint: 'M1', triggerPriceUsd: 0.001, solAmount: 0.1,
};

describe('limit-order submission safety', () => {
  let lo;

  beforeEach(async () => {
    for (const key of Object.keys(saved)) delete saved[key];
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    getToken.mockReturnValue({ ...TOKEN });
    lo = await import('../limitOrders.js');
  });

  afterEach(() => vi.useRealTimers());

  it('parks an ambiguous executor outcome and never retries on the next tick', async () => {
    const execBuy = vi.fn().mockRejectedValue(Object.assign(
      new Error('confirmation timeout'), { submissionOutcome: 'unknown', txSignature: 'sig-1' },
    ));
    await lo.createLimitOrder(buyParams);

    const tick = () => lo.runLimitTick({
      fetchPrices: async () => new Map([['M1', 0.0009]]), execBuy,
    });
    await tick();
    expect(lo.getLimitOrders()[0]).toMatchObject({ status: 'interrupted', attempts: 1 });

    await tick();
    expect(execBuy).toHaveBeenCalledTimes(1);
  });

  it('parks a submitted buy when position bookkeeping fails', async () => {
    const execBuy = vi.fn().mockResolvedValue({
      txSignature: 'sig-2', tokenAmount: 100, priceUsd: 0.0009, dryRun: false,
    });
    const openPos = vi.fn().mockRejectedValue(new Error('position store unavailable'));
    await lo.createLimitOrder(buyParams);

    await lo.runLimitTick({
      fetchPrices: async () => new Map([['M1', 0.0009]]), execBuy, openPos,
    });
    expect(lo.getLimitOrders()[0]).toMatchObject({ status: 'interrupted', attempts: 1 });

    await lo.runLimitTick({
      fetchPrices: async () => new Map([['M1', 0.0009]]), execBuy, openPos,
    });
    expect(execBuy).toHaveBeenCalledTimes(1);
  });
});
