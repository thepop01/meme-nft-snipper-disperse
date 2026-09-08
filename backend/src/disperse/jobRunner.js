import { load, save } from '../store.js';
import { emit, log } from '../bus.js';

const STORE = 'disperse-jobs';
const keyStore = new Map();

function loadJobs() { return load(STORE, []); }
function persist(jobs) { save(STORE, jobs); }

export function getJob(id) {
  return loadJobs().find(j => j.id === id) || null;
}

export function listJobs() {
  return loadJobs().map(({ ...j }) => j);
}

function upsert(job) {
  const jobs = loadJobs();
  const i = jobs.findIndex(j => j.id === job.id);
  const previous = i >= 0 ? jobs[i] : null;
  job.updatedAt = Date.now();
  if (previous && previous.status !== job.status) {
    job.audit ||= [];
    job.audit.push({ ts: job.updatedAt, event: `status:${previous.status}->${job.status}` });
  }
  if (['completed', 'partial', 'failed'].includes(job.status) && !job.completedAt) {
    job.completedAt = job.updatedAt;
  }
  if (i >= 0) jobs[i] = job; else jobs.unshift(job);
  persist(jobs);
  emit('disperse:job', { job });
  return job;
}

export function createJob(plan) {
  const planSnapshot = JSON.parse(JSON.stringify(plan));
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const recipients = [];
  planSnapshot.perSender.forEach((ps, si) => {
    ps.chunks.forEach((chunk, ci) => {
      chunk.recipients.forEach((r, ri) => {
        recipients.push({
          sender: ps.sender, senderIndex: si, chunkIndex: ci, indexInChunk: ri,
          address: r.address, amount: chunk.amounts[ri],
          status: 'pending', txHash: null, error: null,
        });
      });
    });
  });
  const job = {
    id, createdAt: Date.now(), status: 'planned',
    source: { chain: planSnapshot.sourceChain, asset: planSnapshot.asset, senders: planSnapshot.perSender.map(p => p.sender) },
    dest: { chain: planSnapshot.destChain, asset: planSnapshot.destAsset || planSnapshot.asset },
    plan: planSnapshot, recipients,
    fees: {
      bridgeUsd: planSnapshot.perSender.reduce((sum, sender) => sum + Number(sender.bridge?.feeUsd || 0), 0),
      transactions: [],
    },
    audit: [{ ts: Date.now(), event: 'planned' }],
  };
  return upsert(job);
}

function rollupStatus(job) {
  const statuses = job.recipients.map(r => r.status);
  if (statuses.every(s => s === 'sent')) return 'completed';
  if (statuses.some(s => s === 'sent') && statuses.some(s => s === 'failed')) return 'partial';
  if (statuses.every(s => s === 'failed')) return 'failed';
  return 'running';
}

function recomputeFromReceived(ps, amountMode, received) {
  const flatRecipients = ps.chunks.flatMap(c => c.recipients);
  const n = flatRecipients.length;
  if (amountMode === 'custom') {
    const plannedTotal = ps.chunks
      .flatMap(c => c.amounts)
      .reduce((a, b) => a + BigInt(b), 0n);
    return { chunks: ps.chunks, underfunded: plannedTotal > received };
  }
  const base = received / BigInt(n);
  const remainder = received - base * BigInt(n);
  const flat = flatRecipients.map((_, i) => (i === n - 1 ? base + remainder : base));
  const chunks = [];
  let idx = 0;
  for (const c of ps.chunks) {
    const size = c.recipients.length;
    chunks.push({ recipients: c.recipients, amounts: flat.slice(idx, idx + size).map(a => a.toString()) });
    idx += size;
  }
  return { chunks, underfunded: false };
}

async function runChunks(job, keys, deps, filter) {
  job.status = 'running';
  upsert(job);

  if (job.plan.crossChain) {
    for (const ps of job.plan.perSender) {
      if (ps.bridge.status === 'DONE' || ps.bridge.status === 'PENDING' || ps.bridge.status === 'SKIPPED') continue;
      try {
        const { txHash } = await deps.execBridge({
          plan: job.plan, sender: ps.sender, privateKey: keys[ps.sender], bridge: ps.bridge,
        });
        ps.bridge.txHash = txHash;
        ps.bridge.status = 'PENDING';
      } catch (err) {
        ps.bridge.status = 'FAILED';
        ps.bridge.error = err.message;
      }
      upsert(job);
    }
    for (const ps of job.plan.perSender) {
      if (ps.bridge.status !== 'PENDING') continue;
      const deadline = Date.now() + 60 * 60 * 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const s = await deps.pollBridge({ plan: job.plan, sender: ps.sender, bridge: ps.bridge });
        if (s.status === 'DONE') {
          ps.bridge.status = 'DONE';
          ps.bridge.receivedAmount = s.receivedAmount || ps.bridge.estimatedReceived;
          break;
        }
        if (s.status === 'FAILED') { ps.bridge.status = 'FAILED'; break; }
        if (Date.now() > deadline) { ps.bridge.status = 'STALLED'; break; }
        upsert(job);
        await new Promise(r => setTimeout(r, deps.pollIntervalMs ?? 15000));
      }
      upsert(job);
    }

    const bad = job.plan.perSender.find(p => !['DONE', 'SKIPPED'].includes(p.bridge.status));
    if (bad) {
      job.status = bad.bridge.status === 'STALLED' ? 'stalled' : 'failed';
      return upsert(job);
    }

    for (const ps of job.plan.perSender) {
      if (ps.bridge.status === 'SKIPPED') continue;
      const { chunks, underfunded } = recomputeFromReceived(
        ps, job.plan.amountMode, BigInt(ps.bridge.receivedAmount));
      if (underfunded) {
        job.status = 'underfunded';
        return upsert(job);
      }
      ps.chunks = chunks;
      ps.chunks.forEach((c, ci) => {
        c.recipients.forEach((r, ri) => {
          const row = job.recipients.find(
            x => x.sender === ps.sender && x.chunkIndex === ci && x.indexInChunk === ri);
          if (row) row.amount = c.amounts[ri];
        });
      });
    }
    upsert(job);
  }

  for (const ps of job.plan.perSender) {
    const key = keys[ps.sender];
    for (let ci = 0; ci < ps.chunks.length; ci++) {
      const chunk = ps.chunks[ci];
      const rows = job.recipients.filter(
        r => r.sender === ps.sender && r.chunkIndex === ci && filter(r));
      if (rows.length === 0) continue;
      try {
        const result = await deps.execChunk({
          plan: job.plan, sender: ps.sender, privateKey: key, chunkIndex: ci, chunk,
        });
        for (const r of rows) { r.status = 'sent'; r.txHash = result.disperseHash; r.error = null; }
        job.fees ||= { bridgeUsd: 0, transactions: [] };
        if (!job.fees.transactions.some(entry => entry.txHash === result.disperseHash)) {
          job.fees.transactions.push({
            chain: job.plan.crossChain ? job.plan.destChain : job.plan.sourceChain,
            txHash: result.disperseHash, networkFeeBaseUnits: result.networkFeeBaseUnits || null,
          });
        }
      } catch (err) {
        for (const r of rows) { r.status = 'failed'; r.error = err.message; }
        log('error', `Disperse chunk failed (${job.id})`, { error: err.message });
      }
      job.status = rollupStatus(job);
      upsert(job);
    }
  }
  job.status = rollupStatus(job);
  return upsert(job);
}

export async function executeJob(id, keys, deps) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  keyStore.set(id, keys);
  try {
    return await runChunks(job, keys, deps, () => true);
  } finally {
    keyStore.delete(id);
  }
}

export async function retryJob(id, keys, deps) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  keyStore.set(id, keys);
  try {
    if (job.plan.crossChain) {
      for (const ps of job.plan.perSender) {
        if (ps.bridge.status === 'STALLED' && ps.bridge.txHash) ps.bridge.status = 'PENDING';
        if (ps.bridge.status === 'FAILED' && ps.bridge.txHash) {
          throw new Error('A failed bridge leg cannot be rebroadcast automatically; create a new reviewed plan');
        }
      }
    }
    job.recipients.forEach(r => { if (r.status === 'failed') { r.status = 'pending'; r.error = null; } });
    upsert(job);
    return await runChunks(job, keys, deps, r => r.status === 'pending');
  } finally {
    keyStore.delete(id);
  }
}

export function recordExternalChunk(id, payload) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const { sender, chunkIndex, disperseHash, error, bridge, txHash, networkFeeBaseUnits } = payload;
  job.fees ||= { bridgeUsd: 0, transactions: [] };

  if (bridge) {
    const ps = job.plan.perSender.find(p => p.sender === sender);
    if (ps) {
      ps.bridge.txHash = txHash;
      ps.bridge.status = error ? 'FAILED' : 'PENDING';
      if (error) ps.bridge.error = error;
    }
    if (txHash && !job.fees.transactions.some(entry => entry.txHash === txHash)) {
      job.fees.transactions.push({ chain: job.plan.sourceChain, txHash, networkFeeBaseUnits: networkFeeBaseUnits || null, type: 'bridge' });
    }
    job.status = 'running';
    return upsert(job);
  }

  const rows = job.recipients.filter(r => r.sender === sender && r.chunkIndex === chunkIndex);
  for (const r of rows) {
    if (error) { r.status = 'failed'; r.error = error; }
    else { r.status = 'sent'; r.txHash = disperseHash; r.error = null; }
  }
  if (disperseHash && !job.fees.transactions.some(entry => entry.txHash === disperseHash)) {
    job.fees.transactions.push({
      chain: job.plan.crossChain ? job.plan.destChain : job.plan.sourceChain,
      txHash: disperseHash, networkFeeBaseUnits: networkFeeBaseUnits || null, type: 'disperse',
    });
  }
  job.status = rollupStatus(job);
  return upsert(job);
}

function applyReceivedAmounts(job, ps, receivedAmount) {
  const { chunks, underfunded } = recomputeFromReceived(
    ps, job.plan.amountMode, BigInt(receivedAmount));
  if (underfunded) return false;
  ps.chunks = chunks;
  ps.chunks.forEach((chunk, chunkIndex) => {
    chunk.recipients.forEach((recipient, indexInChunk) => {
      const row = job.recipients.find(row => row.sender === ps.sender
        && row.chunkIndex === chunkIndex && row.indexInChunk === indexInChunk);
      if (row) row.amount = chunk.amounts[indexInChunk];
    });
  });
  return true;
}

// Polls externally signed bridge legs once. The browser calls this endpoint
// until the destination funds are available, then signs the destination chunks.
export async function refreshExternalBridge(id, deps) {
  const job = getJob(id);
  if (!job || !job.plan.crossChain) throw new Error('Cross-chain job not found');
  for (const ps of job.plan.perSender) {
    if (ps.bridge.status !== 'PENDING') continue;
    const result = await deps.pollBridge({ plan: job.plan, sender: ps.sender, bridge: ps.bridge });
    if (result.status === 'DONE') {
      ps.bridge.status = 'DONE';
      ps.bridge.receivedAmount = result.receivedAmount || ps.bridge.estimatedReceived;
      if (!applyReceivedAmounts(job, ps, ps.bridge.receivedAmount)) {
        job.status = 'underfunded';
        return upsert(job);
      }
    } else if (['FAILED', 'REFUNDED'].includes(result.status)) {
      ps.bridge.status = 'FAILED';
      ps.bridge.error = result.error || `Bridge ${result.status.toLowerCase()}`;
    }
  }
  const active = job.plan.perSender.filter(ps => ps.bridge.status !== 'SKIPPED');
  if (active.some(ps => ps.bridge.status === 'FAILED')) job.status = 'failed';
  else if (active.every(ps => ps.bridge.status === 'DONE')) job.status = 'awaiting-destination-signature';
  else job.status = 'bridging';
  return upsert(job);
}

export function _hasKeys(id) { return keyStore.has(id); }
