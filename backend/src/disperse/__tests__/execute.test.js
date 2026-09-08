import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('makeExecChunk (dry run)', () => {
  beforeEach(() => vi.resetModules());

  it('returns a simulated hash without sending when dry run is on', async () => {
    process.env.DISPERSE_DRY_RUN = 'true';
    const { makeExecChunk } = await import('../execute.js');
    const execChunk = makeExecChunk();
    const result = await execChunk({
      plan: { sourceChain: 'base', family: 'evm', isNativeAsset: true, tokenAddress: 'NATIVE' },
      sender: '0xS', privateKey: '0xKEY', chunkIndex: 0,
      chunk: { recipients: [{ address: '0xA' }], amounts: ['1'] },
    });
    expect(result.disperseHash).toMatch(/^0xDRYRUN/);
  });
});
