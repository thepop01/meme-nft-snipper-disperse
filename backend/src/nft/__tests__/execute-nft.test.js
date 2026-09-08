import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('makeExecWallet (dry run)', () => {
  beforeEach(() => vi.resetModules());

  it('simulates without broadcasting when NFT_DRY_RUN is on', async () => {
    process.env.NFT_DRY_RUN = 'true';
    const { makeExecWallet } = await import('../execute.js');
    const execWallet = makeExecWallet();
    const result = await execWallet({
      job: { drop: { chain: 'base', slug: 'cool-cats', price: '1000' },
        gas: { mode: 'caps', maxFeeGwei: 50, maxPriorityGwei: 2 },
        policy: {} },
      wallet: { address: '0xA', quantity: 1 },
      privateKey: '0xK',
    });
    expect(result.txHash).toMatch(/^0xDRYRUN/);
    expect(result.minted).toEqual([]);
  });
});
