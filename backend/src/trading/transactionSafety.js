import crypto from 'node:crypto';
import { load, save } from '../store.js';

const STORE = 'transaction-submissions';
const MAX_RECORDS = 2000;

// Shared submission outcome errors. A transaction can be accepted by an RPC
// even when the request that submitted it times out, so callers must never
// treat an unclassified send/confirmation failure as a safe retry.
export class PreSubmitError extends Error {
  constructor(message, { cause = null, idempotencyKey = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PreSubmitError';
    this.retryable = true;
    this.submissionOutcome = 'pre-submit';
    this.idempotencyKey = idempotencyKey;
  }
}

export class UnknownSubmissionError extends Error {
  constructor(message, { cause = null, txSignature = null, idempotencyKey = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UnknownSubmissionError';
    // The chain may have accepted the transaction. Automatic retry is unsafe.
    this.retryable = false;
    this.submissionOutcome = 'unknown';
    this.txSignature = txSignature || null;
    this.idempotencyKey = idempotencyKey || null;
  }
}

export class OnChainFailureError extends Error {
  constructor(message, { cause = null, txSignature = null, idempotencyKey = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OnChainFailureError';
    // The failed transaction did not perform the requested action, so a new
    // attempt is safe (subject to the caller's normal retry policy).
    this.retryable = true;
    this.submissionOutcome = 'failed';
    this.txSignature = txSignature || null;
    this.idempotencyKey = idempotencyKey || null;
  }
}

const PRE_SUBMIT_CODES = new Set([
  'INVALID_ARGUMENT', 'INVALID_TRANSACTION', 'SIGNATURE_FAILURE',
  'TRANSACTION_SIMULATION_FAILED', 'INSUFFICIENT_FUNDS',
]);

const PRE_SUBMIT_PATTERNS = [
  /signature verification failed/i,
  /transaction simulation failed/i,
  /invalid (?:raw )?transaction/i,
  /blockhash not found/i,
  /insufficient funds/i,
  /account .* not found/i,
];

/**
 * Return true only for errors that prove the node rejected the transaction
 * before accepting it. Transport/RPC/timeout failures deliberately return
 * false because their submission outcome cannot be established.
 */
export function isKnownPreSubmitError(error) {
  if (!error) return false;
  if (error.submissionOutcome === 'pre-submit') return true;
  if (PRE_SUBMIT_CODES.has(String(error.code || '').toUpperCase())) return true;
  const text = `${error.message || ''} ${error.reason || ''}`;
  return PRE_SUBMIT_PATTERNS.some(pattern => pattern.test(text));
}

function readRecords() {
  const records = load(STORE, []);
  return Array.isArray(records) ? records : [];
}

function writeRecords(records) {
  // Keep unresolved records and the most recent resolved records. Unresolved
  // records are deliberately retained so a restart cannot forget an
  // ambiguous submission and silently send it again.
  const unresolved = records.filter(record => ['prepared', 'submitted', 'unknown'].includes(record.status));
  const resolved = records
    .filter(record => !['prepared', 'submitted', 'unknown'].includes(record.status))
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  save(STORE, [...unresolved, ...resolved].slice(0, MAX_RECORDS));
}

// A prepared record can only be safely retried while this process is still
// executing its send call. If the process restarted, that call may have
// reached the RPC without returning a hash; park it as unknown rather than
// allowing a duplicate broadcast on the next invocation.
function parkPreparedAfterRestart() {
  const records = readRecords();
  let changed = false;
  const next = records.map(record => {
    if (record.status !== 'prepared') return record;
    changed = true;
    return {
      ...record,
      status: 'unknown',
      error: 'Process restarted before the submission hash was recorded; verify the wallet before retrying',
      updatedAt: Date.now(),
    };
  });
  if (changed) writeRecords(next);
}

function normalizeKey(key) {
  return String(key || '').trim();
}

// Mark records left in prepared state by a prior process as unknown before
// exposing any submission API in this process.
parkPreparedAfterRestart();

export function newIdempotencyKey(prefix = 'tx') {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function getSubmission(idempotencyKey) {
  const key = normalizeKey(idempotencyKey);
  if (!key) return null;
  return readRecords().find(record => record.idempotencyKey === key) || null;
}

/**
 * Persist the logical operation and signed transaction identity before any
 * network wait. Reusing a key for a different signed transaction is rejected
 * rather than weakening idempotency into a best-effort hint.
 */
export function beginSubmission({ idempotencyKey, txSignature, requestFingerprint, metadata = {} }) {
  const key = normalizeKey(idempotencyKey);
  if (!key) throw new Error('idempotencyKey is required for a guarded submission');
  const records = readRecords();
  const existing = records.find(record => record.idempotencyKey === key);
  if (existing) {
    if (existing.requestFingerprint && requestFingerprint
        && existing.requestFingerprint !== requestFingerprint
        && !['failed', 'pre-submit-failed'].includes(existing.status)) {
      throw new Error(`Idempotency key ${key} is already bound to a different transaction`);
    }
    return existing;
  }

  const now = Date.now();
  const record = {
    idempotencyKey: key,
    txSignature: txSignature || null,
    requestFingerprint: requestFingerprint || null,
    status: 'prepared',
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    metadata,
  };
  records.unshift(record);
  writeRecords(records);
  return record;
}

function updateSubmission(idempotencyKey, patch) {
  const key = normalizeKey(idempotencyKey);
  const records = readRecords();
  const index = records.findIndex(record => record.idempotencyKey === key);
  if (index < 0) return null;
  const next = { ...records[index], ...patch, idempotencyKey: key, updatedAt: Date.now() };
  records[index] = next;
  writeRecords(records);
  return next;
}

export function markSubmitted(idempotencyKey, txSignature) {
  return updateSubmission(idempotencyKey, { status: 'submitted', txSignature });
}

export function markUnknown(idempotencyKey, txSignature, error = null) {
  return updateSubmission(idempotencyKey, {
    status: 'unknown', txSignature: txSignature || null,
    error: error ? String(error.message || error) : null,
  });
}

export function markPreSubmitFailed(idempotencyKey, error = null) {
  return updateSubmission(idempotencyKey, {
    status: 'pre-submit-failed',
    error: error ? String(error.message || error) : null,
  });
}

export function markConfirmed(idempotencyKey, txSignature) {
  return updateSubmission(idempotencyKey, { status: 'confirmed', txSignature, error: null });
}

export function markOnChainFailed(idempotencyKey, txSignature, error = null) {
  return updateSubmission(idempotencyKey, {
    status: 'failed', txSignature,
    error: error ? String(error.message || error) : null,
  });
}

export function replaceFailedSubmission({ idempotencyKey, txSignature, requestFingerprint, metadata = {} }) {
  const key = normalizeKey(idempotencyKey);
  const records = readRecords();
  const existing = records.find(record => record.idempotencyKey === key);
  if (!existing) return beginSubmission({ idempotencyKey: key, txSignature, requestFingerprint, metadata });
  if (!['failed', 'pre-submit-failed'].includes(existing.status)) return existing;
  return updateSubmission(key, {
    txSignature, requestFingerprint, status: 'prepared',
    attempts: Number(existing.attempts || 0) + 1, metadata, error: null,
  });
}

export function fingerprintTransaction(serialized) {
  return crypto.createHash('sha256').update(Buffer.from(serialized)).digest('hex');
}

/**
 * Query the node before a key is reused. A null status is intentionally
 * treated as unknown: it does not prove that an RPC which timed out failed to
 * accept the transaction.
 */
export async function reconcileSubmission(connection, record) {
  if (!record?.txSignature) return { status: 'unknown', record };
  let response;
  try {
    response = await connection.getSignatureStatuses([record.txSignature], { searchTransactionHistory: true });
  } catch (error) {
    return { status: 'unknown', record, error };
  }
  const status = response?.value?.[0];
  if (!status) return { status: 'unknown', record };
  if (status.err) {
    const next = markOnChainFailed(record.idempotencyKey, record.txSignature, status.err);
    return { status: 'failed', record: next || { ...record, status: 'failed' }, error: status.err };
  }
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
    const next = markConfirmed(record.idempotencyKey, record.txSignature);
    return { status: 'confirmed', record: next || { ...record, status: 'confirmed' } };
  }
  return { status: 'pending', record };
}
