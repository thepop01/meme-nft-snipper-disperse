import { describe, expect, it } from 'vitest';
import { efficiencyAnalogs, mcapPerNewBuyer } from '../efficiencyAnalogs.js';

describe('efficiency analogs', () => {
  it('uses only the latest completed active bucket', () => {
    expect(efficiencyAnalogs([{ partial: false, buySol: 10, sellSol: 2, buys: 2, sells: 1, wallets: 2 }, { partial: true, buySol: 99, sellSol: 0, buys: 1, sells: 0, wallets: 1 }])).toEqual({ volPerTrade: 4, volPerBuyer: 5 });
  });
  it('keeps unknown denominators unknown', () => {
    expect(mcapPerNewBuyer({ mcap: 10 }, { mcap: 20 }, 0)).toBeNull();
  });
});
