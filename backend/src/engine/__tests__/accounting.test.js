import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = structuredClone(value); },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn() }));

const base = {
  chainId: 'solana', walletAddress: 'wallet', tokenAddress: 'mint', symbol: 'MEME',
  priceUsd: 1, dryRun: true,
};

describe('fill accounting', () => {
  let accounting;
  beforeEach(async () => {
    for (const key of Object.keys(saved)) delete saved[key];
    vi.resetModules();
    accounting = await import('../accounting.js');
  });

  it('consumes acquisition lots FIFO across a partial sell', () => {
    accounting.recordConfirmedFill({ ...base, side: 'buy', tokenQuantity: 10, quoteQuantitySol: 1, txSignature: 'buy1', filledAt: 1 });
    accounting.recordConfirmedFill({ ...base, side: 'buy', tokenQuantity: 10, quoteQuantitySol: 2, txSignature: 'buy2', filledAt: 2 });
    const sell = accounting.recordConfirmedFill({ ...base, side: 'sell', tokenQuantity: 15, quoteQuantitySol: 3, txSignature: 'sell1', filledAt: 3 });
    expect(sell.costBasisSol).toBeCloseTo(2);
    expect(sell.realizedPnlSol).toBeCloseTo(1);
    const lots = accounting.getLots();
    expect(lots[0].remainingQuantity).toBe(0);
    expect(lots[1].remainingQuantity).toBe(5);
  });

  it('includes fees in cost basis and net proceeds', () => {
    accounting.recordConfirmedFill({ ...base, side: 'buy', tokenQuantity: 10, quoteQuantitySol: 1, networkFeeSol: 0.01, txSignature: 'buy' });
    const sell = accounting.recordConfirmedFill({ ...base, side: 'sell', tokenQuantity: 10, quoteQuantitySol: 1.5, networkFeeSol: 0.02, txSignature: 'sell' });
    expect(sell.costBasisSol).toBeCloseTo(1.01);
    expect(sell.realizedPnlSol).toBeCloseTo(0.47);
    expect(accounting.pnlSummary().feesSol).toBeCloseTo(0.03);
  });

  it('is idempotent for the same confirmed transaction and side', () => {
    const first = accounting.recordConfirmedFill({ ...base, side: 'buy', tokenQuantity: 1, quoteQuantitySol: 1, txSignature: 'same' });
    const second = accounting.recordConfirmedFill({ ...base, side: 'buy', tokenQuantity: 1, quoteQuantitySol: 1, txSignature: 'same' });
    expect(second.id).toBe(first.id);
    expect(accounting.getFills()).toHaveLength(1);
  });
});
