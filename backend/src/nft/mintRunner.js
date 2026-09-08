// Durable mint job scheduler + state machine. Keys arrive via armJob and live
// only in memory; jobs re-arm their timers from disk on restoreJobs().
import { load, save } from '../store.js';
import { emit, log } from '../bus.js';
import { pushAlert } from '../alerts.js';

const STORE = 'nft-mint-jobs';
const keyStore = new Map();   // jobId -> { [address]: privateKey }
const timers = new Map();     // jobId -> Timeout
let deps = null;              // { execWallet } injected via routes / _setDeps

export function _setDeps(d) { deps = d; }
export function _hasKeys(id) { return keyStore.has(id); }

function loadJobs() { return load(STORE, []); }
function persist(jobs) { save(STORE, jobs); }

export function getMintJob(id) { return loadJobs().find(j => j.id === id) || null; }
export function listJobs() { return loadJobs(); }

function upsert(job) {
  const jobs = loadJobs();
  const i = jobs.findIndex(j => j.id === job.id);
  if (i >= 0) jobs[i] = job; else jobs.unshift(job);
  persist(jobs);
  emit('nft:job', { job });
  return job;
}

export function scheduleJob(input) {
  const job = {
    id: `mint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    status: 'scheduled',
    drop: input.drop,
    scheduledTime: input.scheduledTime,
    wallets: input.wallets.map(w => ({
      address: String(w.address).toLowerCase(), quantity: w.quantity,
      status: 'pending', txHash: null, error: null, gasUsed: null,
      minted: [], listing: null,
    })),
    gas: input.gas,
    policy: input.policy,
    audit: [{ ts: Date.now(), event: 'scheduled' }],
  };
  upsert(job);
  armTimer(job);
  return job;
}

function armTimer(job) {
  const delay = Math.max(0, job.scheduledTime - Date.now());
  clearTimeout(timers.get(job.id));
  timers.set(job.id, setTimeout(() => {
    onFireTime(job.id).catch(err =>
      log('error', `Mint job ${job.id} fire-time handler crashed: ${err.message}`));
  }, delay));
}

async function onFireTime(id) {
  const job = getMintJob(id);
  if (!job || job.status === 'cancelled') return;
  if (!keyStore.has(id)) {
    job.status = 'awaiting-keys';
    job.audit.push({ ts: Date.now(), event: 'awaiting-keys' });
    upsert(job);
    pushAlert({ type: 'nft', severity: 'critical', title: `Mint "${job.drop.name}" needs unlock`,
      body: 'Fire time reached without keys — unlock your wallet profile to mint now.' });
    return;
  }
  await fireJob(id, deps);
}

// Serialize execution per wallet across ALL jobs: two jobs firing the same
// EVM address concurrently would fetch independent nonces and collide.
const walletChains = new Map(); // lowercased address -> tail promise
async function withWalletLock(address, fn) {
  const key = String(address || '').toLowerCase();
  const prev = walletChains.get(key) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(fn);
  walletChains.set(key, task);
  try {
    return await task;
  } finally {
    if (walletChains.get(key) === task) walletChains.delete(key);
  }
}

export function armJob(id, keys) {
  const job = getMintJob(id);
  if (!job) throw new Error('Job not found');
  if (!['scheduled', 'armed', 'awaiting-keys'].includes(job.status)) {
    // Arming a cancelled/completed/minting job would store private keys with
    // nothing ever wiping them — reject instead.
    throw new Error(`Job cannot be armed while status is "${job.status}"`);
  }
  // Normalize addresses so checksummed /jobs wallets always match the keys map.
  const normalized = {};
  for (const [addr, pk] of Object.entries(keys || {})) normalized[String(addr).toLowerCase()] = pk;
  keyStore.set(id, normalized);
  if (job.status === 'awaiting-keys') {
    // fire immediately now that keys are here
    timers.set(id, setTimeout(() => fireJob(id, deps), 0));
    job.status = 'armed';
  } else if (job.status === 'scheduled') {
    job.status = 'armed';
  }
  job.audit.push({ ts: Date.now(), event: 'armed' });
  return upsert(job);
}

export function cancelJob(id) {
  const job = getMintJob(id);
  if (!job) throw new Error('Job not found');
  if (['scheduled', 'armed', 'awaiting-keys'].includes(job.status)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    keyStore.delete(id);
    job.status = 'cancelled';
    job.audit.push({ ts: Date.now(), event: 'cancelled' });
    upsert(job);
  }
  return job;
}

function rollup(job) {
  const s = job.wallets.map(w => w.status);
  if (s.length === 0) return 'failed'; // empty job must not stick in 'minting'
  if (s.every(x => x === 'minted' || x === 'skipped') && s.includes('minted')) return 'completed';
  if (s.includes('minted') && s.includes('failed')) return 'partial';
  if (s.every(x => x === 'failed')) return 'failed';
  return 'minting';
}

// deps.execWallet({ job, wallet, privateKey }) -> { txHash, minted:[{contract,tokenId}] }
export async function fireJob(id, runDeps) {
  const job = getMintJob(id);
  if (!job) throw new Error('Job not found');
  const keys = keyStore.get(id) || {};

  try {
    job.status = 'minting';
    job.audit.push({ ts: Date.now(), event: 'fired' });
    upsert(job);

    let succeeded = false;
    for (const wallet of job.wallets) {
      if (wallet.status !== 'pending') continue;
      if (succeeded && job.policy.stopOnFirstSuccess) {
        wallet.status = 'skipped';
        continue;
      }
      try {
        const result = await withWalletLock(wallet.address, () =>
          runDeps.execWallet({ job, wallet, privateKey: keys[String(wallet.address).toLowerCase()] }));
        wallet.status = 'minted';
        wallet.txHash = result.txHash;
        wallet.minted = result.minted || [];
        succeeded = true;
      } catch (err) {
        wallet.status = 'failed';
        wallet.error = err.message;
        log('error', `Mint wallet failed (${job.id})`, { error: err.message });
      }
      job.audit.push({ ts: Date.now(), event: `wallet:${wallet.address}:${wallet.status}` });
      upsert(job);
    }
    job.status = rollup(job);
    upsert(job);
    pushAlert({
      type: 'nft',
      severity: job.status === 'completed' ? 'info' : 'critical',
      title: `Mint "${job.drop.name}" ${job.status}`,
      body: job.wallets.map(w => `${w.address.slice(0, 6)}…: ${w.status}`).join(', '),
    });
  } finally {
    keyStore.delete(id);
    timers.delete(id);
  }
  return getMintJob(id);
}

// Re-arm timers for jobs that were scheduled when the server stopped.
export function restoreJobs() {
  for (const job of loadJobs()) {
    if (job.status === 'scheduled' || job.status === 'armed') {
      // keys never survive restart — armed degrades back to scheduled
      if (job.status === 'armed') { job.status = 'scheduled'; upsert(job); }
      armTimer(job);
      continue;
    }
    if (job.status === 'minting') {
      // Process died mid-mint: pending wallets can't be resumed safely
      // (keys are gone), so finalize the job instead of orphaning it.
      for (const w of job.wallets) {
        if (w.status === 'pending') {
          w.status = 'failed';
          w.error = 'interrupted by server restart';
        }
      }
      job.status = rollup(job);
      job.audit.push({ ts: Date.now(), event: 'finalized-after-restart' });
      upsert(job);
    }
  }
}
