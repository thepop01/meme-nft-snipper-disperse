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
import { getPositions } from '../positions.js';
import { pushAlert } from '../../alerts.js';

const TOKEN = { mint: 'M1', symbol: 'PEPE', name: 'Pepe', onCurve: false, decimals: 6, priceUsd: 0.002 };

describe('limitOrders', () => {
  let lo;

  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    getToken.mockReturnValue({ ...TOKEN });
    lo = await import('../limitOrders.js');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const buyParams = (over = {}) => ({
    side: 'buy', mint: 'M1', triggerPriceUsd: 0.001, solAmount: 0.1, ...over,
  });

  describe('createLimitOrder', () => {
    it('creates a buy order with auto direction below when trigger < current price', async () => {
      const order = await lo.createLimitOrder(buyParams());
      expect(order.status).toBe('open');
      expect(order.direction).toBe('below');
      expect(order.symbol).toBe('PEPE');
      expect(saved['limit-orders']).toHaveLength(1);
    });

    it('auto-derives above direction for a breakout buy', async () => {
      const order = await lo.createLimitOrder(buyParams({ triggerPriceUsd: 0.005 }));
      expect(order.direction).toBe('above');
    });

    it('rejects an already-triggered order', async () => {
      // trigger above current with explicit below direction = instantly satisfied
      await expect(lo.createLimitOrder(buyParams({ triggerPriceUsd: 0.005, direction: 'below' })))
        .rejects.toThrow(/already/);
    });

    it('validates inputs', async () => {
      await expect(lo.createLimitOrder(buyParams({ triggerPriceUsd: -1 }))).rejects.toThrow(/positive/);
      await expect(lo.createLimitOrder(buyParams({ solAmount: 0 }))).rejects.toThrow(/solAmount/);
      await expect(lo.createLimitOrder({ side: 'buy', triggerPriceUsd: 1 })).rejects.toThrow(/mint/);
    });

    it('creates a sell order tied to an open position, direction above for TP', async () => {
      getPositions.mockReturnValue([{ id: 'p1', status: 'open', mint: 'M1', symbol: 'PEPE', currentPriceUsd: 0.002, entryPriceUsd: 0.001 }]);
      const order = await lo.createLimitOrder({ side: 'sell', positionId: 'p1', triggerPriceUsd: 0.004, fraction: 0.5 });
      expect(order.direction).toBe('above');
      expect(order.mint).toBe('M1');
    });

    it('rejects a sell order for a missing position', async () => {
      getPositions.mockReturnValue([]);
      await expect(lo.createLimitOrder({ side: 'sell', positionId: 'nope', triggerPriceUsd: 0.004 }))
        .rejects.toThrow(/Position/);
    });
  });

  describe('runLimitTick', () => {
    it('does not fill while the trigger has not crossed', async () => {
      await lo.createLimitOrder(buyParams());
      const execBuy = vi.fn();
      await lo.runLimitTick({ fetchPrices: async () => new Map([['M1', 0.0015]]), execBuy });
      expect(execBuy).not.toHaveBeenCalled();
      const order = lo.getLimitOrders()[0];
      expect(order.status).toBe('open');
      expect(order.lastPriceUsd).toBe(0.0015);
    });

    it('fills a buy order when price drops to the trigger and opens a position', async () => {
      await lo.createLimitOrder(buyParams());
      const execBuy = vi.fn(async () => ({ txSignature: 'paper-x', tokenAmount: 100, priceUsd: 0.0009, dryRun: true }));
      const openPos = vi.fn(async () => ({ id: 'pos-1' }));
      await lo.runLimitTick({ fetchPrices: async () => new Map([['M1', 0.0009]]), execBuy, openPos });

      expect(execBuy).toHaveBeenCalledWith(
        expect.objectContaining({ mint: 'M1', priceUsd: 0.0009 }),
        expect.objectContaining({ solAmount: 0.1 }),
      );
      const order = lo.getLimitOrders()[0];
      expect(order.status).toBe('filled');
      expect(order.positionId).toBe('pos-1');
      expect(pushAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    });

    it('fills a sell order via closePosition with fraction and reason', async () => {
      getPositions.mockReturnValue([{ id: 'p1', status: 'open', mint: 'M1', symbol: 'PEPE', currentPriceUsd: 0.002, entryPriceUsd: 0.001 }]);
      await lo.createLimitOrder({ side: 'sell', positionId: 'p1', triggerPriceUsd: 0.004, fraction: 0.5 });
      const closePos = vi.fn(async () => ({}));
      await lo.runLimitTick({ fetchPrices: async () => new Map([['M1', 0.0041]]), closePos });
      expect(closePos).toHaveBeenCalledWith('p1', 0.5, expect.stringContaining('limit-sell'));
      expect(lo.getLimitOrders()[0].status).toBe('filled');
    });

    it('cancels a sell order whose position closed before the trigger', async () => {
      getPositions.mockReturnValue([{ id: 'p1', status: 'open', mint: 'M1', currentPriceUsd: 0.002, entryPriceUsd: 0.001 }]);
      await lo.createLimitOrder({ side: 'sell', positionId: 'p1', triggerPriceUsd: 0.004 });
      getPositions.mockReturnValue([]); // position closed meanwhile
      const closePos = vi.fn();
      await lo.runLimitTick({ fetchPrices: async () => new Map([['M1', 0.005]]), closePos });
      expect(closePos).not.toHaveBeenCalled();
      expect(lo.getLimitOrders()[0].status).toBe('cancelled');
    });

    it('expires orders past expiresAt', async () => {
      await lo.createLimitOrder(buyParams({ expiresHours: 1 }));
      await lo.runLimitTick({
        fetchPrices: async () => new Map(),
        now: Date.now() + 2 * 3600_000,
      });
      expect(lo.getLimitOrders()[0].status).toBe('expired');
    });

    it('retries failed executions and marks failed after 3 attempts', async () => {
      await lo.createLimitOrder(buyParams());
      const execBuy = vi.fn(async () => { throw new Error('rpc down'); });
      const tick = () => lo.runLimitTick({ fetchPrices: async () => new Map([['M1', 0.0009]]), execBuy });

      await tick();
      expect(lo.getLimitOrders()[0].status).toBe('open');
      expect(lo.getLimitOrders()[0].attempts).toBe(1);
      await tick();
      await tick();
      expect(lo.getLimitOrders()[0].status).toBe('failed');
      expect(lo.getLimitOrders()[0].error).toBe('rpc down');
      expect(pushAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
    });

    it('skips tokens with no price yet', async () => {
      await lo.createLimitOrder(buyParams());
      const execBuy = vi.fn();
      await lo.runLimitTick({ fetchPrices: async () => new Map(), execBuy });
      expect(execBuy).not.toHaveBeenCalled();
      expect(lo.getLimitOrders()[0].status).toBe('open');
    });
  });

  describe('cancelLimitOrder', () => {
    it('cancels an open order', async () => {
      const order = await lo.createLimitOrder(buyParams());
      const cancelled = lo.cancelLimitOrder(order.id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('throws for unknown or non-open orders', async () => {
      expect(() => lo.cancelLimitOrder('nope')).toThrow(/not found/);
      const order = await lo.createLimitOrder(buyParams());
      lo.cancelLimitOrder(order.id);
      expect(() => lo.cancelLimitOrder(order.id)).toThrow(/not found/);
    });
  });
});
