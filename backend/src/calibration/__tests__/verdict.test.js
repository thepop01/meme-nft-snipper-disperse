import { describe, it, expect } from 'vitest';
import { evaluateCohort, evaluateVerdict } from '../verdict.js';

const cal = { bootstrapSamples: 400, confidence: 0.95, minQualifiedAlerts: 10,
              rugCeilingFrac: 0.30, maxMedianFillDecayFrac: 0.05 };
// Deterministic RNG so a verdict never changes between runs.
const rng = () => { let s = 7; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };
const rows = (n, net) => Array.from({ length: n }, () => ({
  label: { y_policy_net_return: net, y_policy_net_positive: net >= 0.5, y_rugged: false } }));

const cohort = (over = {}) => ({
  rows: rows(20, 0.8), medianFillDecay: 0.02,
  parity: { ok: true }, extended: false, ...over,
});

describe('evaluateCohort (§19.5)', () => {
  it('returns INSUFFICIENT below N and does not judge', () => {
    const r = evaluateCohort(cohort({ rows: rows(3, 0.8) }), { cal, rng: rng() });
    expect(r.verdict).toBe('INSUFFICIENT');
    expect(r.reasons).toContain('n_below_minimum');
  });

  it('returns GO when all five conditions hold', () => {
    const r = evaluateCohort(cohort(), { cal, rng: rng() });
    expect(r.verdict).toBe('GO');
    expect(r.ci.lower).toBeGreaterThan(0);
  });

  it('returns NO_GO when the CI is entirely below zero', () => {
    const r = evaluateCohort(cohort({ rows: rows(20, -0.6) }), { cal, rng: rng() });
    expect(r.verdict).toBe('NO_GO');
    expect(r.ci.upper).toBeLessThan(0);
  });

  it('returns EXTEND when the CI straddles zero on a heavy-tailed sample', () => {
    const heavy = [...rows(18, -1), ...rows(2, 12)];
    const r = evaluateCohort(cohort({ rows: heavy }), { cal, rng: rng() });
    expect(r.verdict).toBe('EXTEND');
    expect(r.targetN).toBe(cal.minQualifiedAlerts * 2);
  });

  it('extends only ONCE — a straddling CI after extension is NO_GO', () => {
    const heavy = [...rows(18, -1), ...rows(2, 12)];
    const r = evaluateCohort(cohort({ rows: heavy, extended: true }), { cal, rng: rng() });
    expect(r.verdict).toBe('NO_GO');
    expect(r.reasons).toContain('extension_exhausted');
  });

  it('blocks GO when the rug rate exceeds the ceiling', () => {
    const rugged = rows(20, 0.8).map(r => ({ label: { ...r.label, y_rugged: true } }));
    const r = evaluateCohort(cohort({ rows: rugged }), { cal, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('rug_rate_above_ceiling');
  });

  it('blocks GO when median fill decay exceeds the policy assumption', () => {
    const r = evaluateCohort(cohort({ medianFillDecay: 0.20 }), { cal, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('fill_decay_above_policy');
  });

  it('blocks GO on an unresolved parity failure', () => {
    const r = evaluateCohort(cohort({ parity: { ok: false } }), { cal, rng: rng() });
    expect(r.verdict).not.toBe('GO');
    expect(r.reasons).toContain('parity_failures_unresolved');
  });

  it('is reproducible across runs', () => {
    const a = evaluateCohort(cohort(), { cal, rng: rng() });
    const b = evaluateCohort(cohort(), { cal, rng: rng() });
    expect(a).toEqual(b);
  });
});

describe('evaluateVerdict (§19.5 per-cohort independence)', () => {
  it('judges cohorts independently and allows a partial pass', () => {
    const out = evaluateVerdict({
      'pump-curve': cohort(),
      'post-migration': cohort({ rows: rows(20, -0.6) }),
    }, { cal });
    expect(out.cohorts['pump-curve'].verdict).toBe('GO');
    expect(out.cohorts['post-migration'].verdict).toBe('NO_GO');
    expect(out.overall).toBe('PARTIAL');
  });

  it('reports GO overall only when every cohort is GO', () => {
    const out = evaluateVerdict(
      { 'pump-curve': cohort(), 'post-migration': cohort() }, { cal });
    expect(out.overall).toBe('GO');
  });

  it('never reports GO while a cohort is still INSUFFICIENT', () => {
    const out = evaluateVerdict({
      'pump-curve': cohort(),
      'post-migration': cohort({ rows: rows(2, 0.8) }),
    }, { cal });
    expect(out.overall).not.toBe('GO');
    expect(out.cohorts['post-migration'].verdict).toBe('INSUFFICIENT');
  });
});
