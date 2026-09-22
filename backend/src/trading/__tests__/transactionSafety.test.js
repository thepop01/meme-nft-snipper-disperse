import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));

describe('transaction submission safety', () => {
  let safety;

  beforeEach(async () => {
    for (const key of Object.keys(saved)) delete saved[key];
    vi.resetModules();
    safety = await import('../transactionSafety.js');
  });

  it('persists the intent before a hash and confirmation are available', () => {
    const prepared = safety.beginSubmission({
      idempotencyKey: 'buy:order-1',
      requestFingerprint: 'signed-payload-a',
      metadata: { route: 'Jupiter' },
    });
    expect(prepared.status).toBe('prepared');
    expect(prepared.txSignature).toBeNull();
    expect(safety.getSubmission('buy:order-1').status).toBe('prepared');

    const submitted = safety.markSubmitted('buy:order-1', 'sig-1');
    expect(submitted.status).toBe('submitted');
    expect(submitted.txSignature).toBe('sig-1');
    expect(saved['transaction-submissions'][0]).toMatchObject({
      idempotencyKey: 'buy:order-1', txSignature: 'sig-1', status: 'submitted',
    });
  });

  it('records an unknown send outcome and refuses a second submission', async () => {
    safety.beginSubmission({ idempotencyKey: 'buy:order-2', requestFingerprint: 'payload' });
    safety.markUnknown('buy:order-2', null, new Error('RPC timeout'));

    const result = await safety.reconcileSubmission(
      { getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }) },
      safety.getSubmission('buy:order-2'),
    );
    expect(result.status).toBe('unknown');
    expect(safety.getSubmission('buy:order-2').status).toBe('unknown');
    expect(safety.getSubmission('buy:order-2').error).toBe('RPC timeout');
  });

  it('parks an un-hashed prepared intent as unknown rather than retrying it', async () => {
    safety.beginSubmission({ idempotencyKey: 'buy:order-prepared', requestFingerprint: 'payload' });
    await expect(safety.reconcileSubmission(
      { getSignatureStatuses: vi.fn() }, safety.getSubmission('buy:order-prepared'),
    )).resolves.toMatchObject({ status: 'unknown' });
  });

  it('reconciles a submitted hash before allowing a retry', async () => {
    safety.beginSubmission({ idempotencyKey: 'buy:order-3', requestFingerprint: 'payload' });
    safety.markSubmitted('buy:order-3', 'sig-3');
    const connection = {
      getSignatureStatuses: vi.fn().mockResolvedValue({
        value: [{ err: null, confirmationStatus: 'confirmed' }],
      }),
    };

    const result = await safety.reconcileSubmission(connection, safety.getSubmission('buy:order-3'));
    expect(result.status).toBe('confirmed');
    expect(safety.getSubmission('buy:order-3')).toMatchObject({
      status: 'confirmed', txSignature: 'sig-3',
    });
    expect(connection.getSignatureStatuses).toHaveBeenCalledWith(
      ['sig-3'], { searchTransactionHistory: true },
    );
  });

  it('classifies explicit pre-submit rejection as retryable', () => {
    expect(safety.isKnownPreSubmitError({ code: 'INSUFFICIENT_FUNDS' })).toBe(true);
    expect(safety.isKnownPreSubmitError(new Error('RPC timeout'))).toBe(false);
    expect(new safety.PreSubmitError('rejected').retryable).toBe(true);
    expect(new safety.UnknownSubmissionError('timeout').retryable).toBe(false);
  });

  it('does not bind one idempotency key to a different signed payload', () => {
    safety.beginSubmission({ idempotencyKey: 'buy:order-4', requestFingerprint: 'payload-a' });
    expect(() => safety.beginSubmission({
      idempotencyKey: 'buy:order-4', requestFingerprint: 'payload-b',
    })).toThrow(/different transaction/);
  });
});
