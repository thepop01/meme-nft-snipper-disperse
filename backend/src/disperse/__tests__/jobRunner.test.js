import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

const fakePlan = () => ({
  crossChain: false, sourceChain: 'base', destChain: 'base', family: 'evm',
  asset: 'NATIVE', tokenAddress: 'NATIVE', isNativeAsset: true, amountMode: 'equal',
  recipients: [{ address: '0xA' }, { address: '0xB' }],
  recipientCount: 2,
  perSender: [{
    sender: '0xSender', decimals: 18, totalBaseUnits: '2',
    chunks: [{ recipients: [{ address: '0xA' }, { address: '0xB' }], amounts: ['1', '1'] }],
  }],
  validationErrors: [],
});

describe('jobRunner', () => {
  let runner;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
    runner = await import('../jobRunner.js');
  });

  it('creates a job in planned status', () => {
    const job = runner.createJob(fakePlan());
    expect(job.status).toBe('planned');
    expect(job.recipients).toHaveLength(2);
    expect(job.recipients.every(r => r.status === 'pending')).toBe(true);
    expect(runner.getJob(job.id)).toBeTruthy();
  });

  it('runs to completed when every chunk succeeds', async () => {
    const job = runner.createJob(fakePlan());
    const execChunk = vi.fn().mockResolvedValue({ disperseHash: '0xhash' });
    await runner.executeJob(job.id, { '0xSender': '0xKEY' }, { execChunk });
    const done = runner.getJob(job.id);
    expect(done.status).toBe('completed');
    expect(done.recipients.every(r => r.status === 'sent')).toBe(true);
    expect(done.recipients[0].txHash).toBe('0xhash');
    expect(execChunk).toHaveBeenCalledTimes(1);
  });

  it('marks failed when a chunk fails and records the error', async () => {
    const job = runner.createJob(fakePlan());
    const execChunk = vi.fn().mockRejectedValue(new Error('rpc boom'));
    await runner.executeJob(job.id, { '0xSender': '0xKEY' }, { execChunk });
    const res = runner.getJob(job.id);
    expect(res.status).toBe('failed');
    expect(res.recipients.every(r => r.status === 'failed')).toBe(true);
    expect(res.recipients[0].error).toMatch(/boom/);
  });

  it('wipes keys from memory after execution', async () => {
    const job = runner.createJob(fakePlan());
    await runner.executeJob(job.id, { '0xSender': '0xKEY' },
      { execChunk: vi.fn().mockResolvedValue({ disperseHash: '0xh' }) });
    expect(runner._hasKeys(job.id)).toBe(false);
  });

  it('retry re-runs only failed recipients', async () => {
    const job = runner.createJob(fakePlan());
    const failing = vi.fn().mockRejectedValue(new Error('down'));
    await runner.executeJob(job.id, { '0xSender': '0xKEY' }, { execChunk: failing });
    expect(runner.getJob(job.id).status).toBe('failed');

    const ok = vi.fn().mockResolvedValue({ disperseHash: '0xretry' });
    await runner.retryJob(job.id, { '0xSender': '0xKEY' }, { execChunk: ok });
    const res = runner.getJob(job.id);
    expect(res.status).toBe('completed');
    expect(res.recipients[0].txHash).toBe('0xretry');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
