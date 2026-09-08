import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

const crossPlan = () => ({
  crossChain: true, sourceChain: 'eth', destChain: 'base', family: 'evm',
  asset: 'ETH', destAsset: 'USDC', tokenAddress: '0xusdc', srcTokenAddress: 'NATIVE',
  isNativeAsset: false, destIsNative: false, amountMode: 'total',
  recipients: [{ address: '0xA' }, { address: '0xB' }], recipientCount: 2,
  perSender: [{
    sender: '0xS', decimals: 6, totalBaseUnits: '990000',
    bridge: { tool: 'across', toAddress: '0xS', fromAmount: '500000000000000000',
      estimatedReceived: '990000', status: 'pending', txHash: null },
    chunks: [{ recipients: [{ address: '0xA' }, { address: '0xB' }], amounts: ['495000', '495000'] }],
  }],
  validationErrors: [],
});

describe('jobRunner cross-chain', () => {
  let runner;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
    runner = await import('../jobRunner.js');
  });

  it('bridges, waits, recomputes amounts from actual received, then disperses', async () => {
    const job = runner.createJob(crossPlan());
    const execBridge = vi.fn().mockResolvedValue({ txHash: '0xbridge' });
    const pollBridge = vi.fn().mockResolvedValue({ status: 'DONE', receivedAmount: '1000000' });
    const execChunk = vi.fn().mockResolvedValue({ disperseHash: '0xdisp' });

    await runner.executeJob(job.id, { '0xS': '0xKEY' }, { execBridge, pollBridge, execChunk });

    const done = runner.getJob(job.id);
    expect(done.status).toBe('completed');
    const chunkArg = execChunk.mock.calls[0][0].chunk;
    expect(chunkArg.amounts).toEqual(['500000', '500000']);
    expect(done.recipients.every(r => r.status === 'sent')).toBe(true);
  });

  it('marks the job failed if the bridge fails', async () => {
    const job = runner.createJob(crossPlan());
    await runner.executeJob(job.id, { '0xS': '0xKEY' }, {
      execBridge: vi.fn().mockResolvedValue({ txHash: '0xb' }),
      pollBridge: vi.fn().mockResolvedValue({ status: 'FAILED' }),
      execChunk: vi.fn(),
    });
    expect(runner.getJob(job.id).status).toBe('failed');
  });

  it('pauses underfunded when custom totals exceed the received amount', async () => {
    const plan = crossPlan();
    plan.amountMode = 'custom';
    plan.perSender[0].chunks = [{
      recipients: [{ address: '0xA' }, { address: '0xB' }], amounts: ['600000', '600000'],
    }];
    const job = runner.createJob(plan);
    await runner.executeJob(job.id, { '0xS': '0xKEY' }, {
      execBridge: vi.fn().mockResolvedValue({ txHash: '0xb' }),
      pollBridge: vi.fn().mockResolvedValue({ status: 'DONE', receivedAmount: '1000000' }),
      execChunk: vi.fn(),
    });
    expect(runner.getJob(job.id).status).toBe('underfunded');
  });

  it('records an external bridge leg', () => {
    const job = runner.createJob(crossPlan());
    const updated = runner.recordExternalChunk(job.id, { sender: '0xS', bridge: true, txHash: '0xb' });
    expect(updated.plan.perSender[0].bridge.status).toBe('PENDING');
    expect(updated.plan.perSender[0].bridge.txHash).toBe('0xb');
  });

  it('does not rebroadcast a bridge that is already pending on retry', async () => {
    const plan = crossPlan();
    plan.perSender[0].bridge.status = 'PENDING';
    plan.perSender[0].bridge.txHash = '0xexisting';
    const job = runner.createJob(plan);
    const execBridge = vi.fn();
    await runner.retryJob(job.id, { '0xS': '0xKEY' }, {
      execBridge,
      pollBridge: vi.fn().mockResolvedValue({ status: 'DONE', receivedAmount: '990000' }),
      execChunk: vi.fn().mockResolvedValue({ disperseHash: '0xdisp' }),
    });
    expect(execBridge).not.toHaveBeenCalled();
    expect(runner.getJob(job.id).status).toBe('completed');
  });

  it('prepares externally bridged funds for destination signing', async () => {
    const job = runner.createJob(crossPlan());
    runner.recordExternalChunk(job.id, { sender: '0xS', bridge: true, txHash: '0xb' });
    const updated = await runner.refreshExternalBridge(job.id, {
      pollBridge: vi.fn().mockResolvedValue({ status: 'DONE', receivedAmount: '1000000' }),
    });
    expect(updated.status).toBe('awaiting-destination-signature');
    expect(updated.plan.perSender[0].chunks[0].amounts).toEqual(['500000', '500000']);
  });
});
