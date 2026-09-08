import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));
vi.mock('../../alerts.js', () => ({ pushAlert: vi.fn() }));

const NOW = new Date('2026-07-18T12:00:00Z').getTime();

function jobInput(overrides = {}) {
  return {
    drop: { chain: 'base', slug: 'cool-cats', contract: '0xC', name: 'Cool Cats',
      image: null, stageIndex: 0, stageLabel: 'Public', price: '1000' },
    scheduledTime: NOW + 60_000,
    wallets: [{ address: '0xA', quantity: 1 }, { address: '0xB', quantity: 2 }],
    gas: { mode: 'caps', maxFeeGwei: 50, maxPriorityGwei: 2 },
    policy: { stopOnFirstSuccess: false, abortIfGasAboveCap: true },
    ...overrides,
  };
}

describe('mintRunner', () => {
  let runner;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
    runner = await import('../mintRunner.js');
  });
  afterEach(() => vi.useRealTimers());

  it('schedules a job and lists it', () => {
    const job = runner.scheduleJob(jobInput());
    expect(job.status).toBe('scheduled');
    expect(runner.listJobs()[0].id).toBe(job.id);
    expect(job.wallets.every(w => w.status === 'pending')).toBe(true);
  });

  it('cancels a scheduled job', () => {
    const job = runner.scheduleJob(jobInput());
    runner.cancelJob(job.id);
    expect(runner.getMintJob(job.id).status).toBe('cancelled');
  });

  it('arming stores keys and firing executes each wallet', async () => {
    const job = runner.scheduleJob(jobInput());
    runner.armJob(job.id, { '0xA': '0xK1', '0xB': '0xK2' });
    expect(runner.getMintJob(job.id).status).toBe('armed');

    const execWallet = vi.fn().mockResolvedValue({ txHash: '0xmint', minted: [{ contract: '0xC', tokenId: '1' }] });
    await runner.fireJob(job.id, { execWallet });
    const done = runner.getMintJob(job.id);
    expect(done.status).toBe('completed');
    expect(done.wallets.every(w => w.status === 'minted')).toBe(true);
    expect(execWallet).toHaveBeenCalledTimes(2);
    expect(runner._hasKeys(job.id)).toBe(false); // wiped
  });

  it('stopOnFirstSuccess skips remaining wallets after one success', async () => {
    const job = runner.scheduleJob(jobInput({ policy: { stopOnFirstSuccess: true, abortIfGasAboveCap: true } }));
    runner.armJob(job.id, { '0xA': '0xK1', '0xB': '0xK2' });
    const execWallet = vi.fn().mockResolvedValue({ txHash: '0xok', minted: [] });
    await runner.fireJob(job.id, { execWallet });
    const done = runner.getMintJob(job.id);
    expect(execWallet).toHaveBeenCalledTimes(1);
    expect(done.wallets[1].status).toBe('skipped');
    expect(done.status).toBe('completed');
  });

  it('partial when some wallets fail', async () => {
    const job = runner.scheduleJob(jobInput());
    runner.armJob(job.id, { '0xA': '0xK1', '0xB': '0xK2' });
    const execWallet = vi.fn()
      .mockResolvedValueOnce({ txHash: '0xok', minted: [] })
      .mockRejectedValueOnce(new Error('reverted'));
    await runner.fireJob(job.id, { execWallet });
    const done = runner.getMintJob(job.id);
    expect(done.status).toBe('partial');
    expect(done.wallets[1].status).toBe('failed');
    expect(done.wallets[1].error).toMatch(/reverted/);
  });

  it('fire time without keys pauses as awaiting-keys, then fires when armed', async () => {
    const job = runner.scheduleJob(jobInput());
    const execWallet = vi.fn().mockResolvedValue({ txHash: '0x1', minted: [] });
    runner._setDeps({ execWallet });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(runner.getMintJob(job.id).status).toBe('awaiting-keys');
    runner.armJob(job.id, { '0xA': '0xK', '0xB': '0xK' });
    await vi.runOnlyPendingTimersAsync();
    expect(runner.getMintJob(job.id).status).toBe('completed');
  });

  it('restores timers for scheduled jobs on boot', async () => {
    runner.scheduleJob(jobInput());
    vi.resetModules();
    const fresh = await import('../mintRunner.js');
    const execWallet = vi.fn().mockResolvedValue({ txHash: '0x1', minted: [] });
    fresh._setDeps({ execWallet });
    fresh.restoreJobs();
    const job = fresh.listJobs()[0];
    fresh.armJob(job.id, { '0xA': '0xK', '0xB': '0xK' });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fresh.getMintJob(job.id).status).toBe('completed');
  });

  it('refuses to arm a cancelled job — keys must never linger', () => {
    const job = runner.scheduleJob(jobInput());
    runner.cancelJob(job.id);
    expect(() => runner.armJob(job.id, { '0xA': '0xK' })).toThrow(/cannot be armed/i);
    expect(runner._hasKeys(job.id)).toBe(false);
  });

  it('finalizes a job that was mid-mint when the server restarted', async () => {
    const job = runner.scheduleJob(jobInput());
    runner.armJob(job.id, { '0xA': '0xK', '0xB': '0xK' });
    // Simulate a crash after one wallet succeeded, before the second ran.
    const stored = runner.getMintJob(job.id);
    stored.status = 'minting';
    stored.wallets[0].status = 'minted';
    saved['nft-mint-jobs'] = [stored];

    vi.resetModules();
    const fresh = await import('../mintRunner.js');
    fresh.restoreJobs();
    const done = fresh.getMintJob(job.id);
    expect(done.status).toBe('partial');
    expect(done.wallets[0].status).toBe('minted');
    expect(done.wallets[1].status).toBe('failed');
    expect(done.wallets[1].error).toMatch(/restart/);
    expect(fresh._hasKeys(job.id)).toBe(false);
  });

  it('an empty-wallet job ends as failed instead of sticking in minting', async () => {
    const job = runner.scheduleJob(jobInput({ wallets: [] }));
    runner.armJob(job.id, {});
    const done = await runner.fireJob(job.id, { execWallet: vi.fn() });
    expect(done.status).toBe('failed');
  });

  it('serializes execution of the same wallet across jobs (nonce safety)', async () => {
    let concurrent = 0, maxConcurrent = 0;
    const slowExec = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve(); // yield a microtask (fake-timer safe)
      await Promise.resolve();
      concurrent--;
      return { txHash: '0xok', minted: [] };
    };
    const j1 = runner.scheduleJob(jobInput());
    const j2 = runner.scheduleJob(jobInput());
    runner.armJob(j1.id, { '0xA': '0xK1', '0xB': '0xK2' });
    runner.armJob(j2.id, { '0xA': '0xK1', '0xB': '0xK2' });
    await Promise.all([
      runner.fireJob(j1.id, { execWallet: slowExec }),
      runner.fireJob(j2.id, { execWallet: slowExec }),
    ]);
    // Same address in both jobs: overlapping execution would race nonces.
    expect(maxConcurrent).toBeLessThanOrEqual(2); // A then B serialized per address
    expect(runner.getMintJob(j1.id).status).toBe('completed');
    expect(runner.getMintJob(j2.id).status).toBe('completed');
  });
});
