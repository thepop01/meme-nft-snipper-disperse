import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('makeBridgeDeps (dry run)', () => {
  beforeEach(() => vi.resetModules());

  it('returns a simulated bridge hash and instant DONE in dry run', async () => {
    process.env.DISPERSE_DRY_RUN = 'true';
    const { makeBridgeDeps } = await import('../execute.js');
    const { execBridge, pollBridge } = makeBridgeDeps();
    const bridge = { estimatedReceived: '990000', transactionRequest: { to: '0xb' } };
    const sent = await execBridge({ plan: { sourceChain: 'eth' }, sender: '0xS', privateKey: '0xK', bridge });
    expect(sent.txHash).toMatch(/^0xDRYRUN/);
    const status = await pollBridge({ plan: { sourceChain: 'eth' }, sender: '0xS', bridge });
    expect(status.status).toBe('DONE');
    expect(status.receivedAmount).toBe('990000');
  });
});
