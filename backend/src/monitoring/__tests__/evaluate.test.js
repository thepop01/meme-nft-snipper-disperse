import { describe, it, expect, vi } from 'vitest';
import { evaluateToken } from '../evaluate.js';
import { CONFIG } from '../../scoring/config.js';

const deps = ({ admission = 'qualified', status = 'scored' } = {}) => ({
  extract: vi.fn(async () => ({ structural: {}, dynamic: {}, snapshot: { mcap: 50_000 } })),
  score: vi.fn(() => ({ version: 'meme-score-v2.0.0', status, profile: 'pump-curve',
    structural: { score: 80, coverage: 0.9, breakdown: {} },
    dynamic: { score: 70, coverage: 0.8, breakdown: {} },
    memeScore: 76, evidenceCoverage: 86, blockers: [] })),
  admitFn: vi.fn(() => admission),
});
const token = (over = {}) => ({ assetKey: 'solana:pumpfun:M', events: [], ...over });

describe('evaluateToken alert stamping (§18.3, §20)', () => {
  it('stamps the alert on first qualification', async () => {
    const out = await evaluateToken(token(), { asOf: 1_000, cfg: CONFIG, ...deps() });
    expect(out.alert).toMatchObject({ ts: 1_000, mcap: 50_000 });
  });

  it('preserves an alert carried on the token when prevAlert is not passed', async () => {
    const existing = { ts: 1_000, mcap: 10_000, priceUsd: null };
    const out = await evaluateToken(token({ alert: existing }),
      { asOf: 9_999, cfg: CONFIG, ...deps() });
    expect(out.alert).toEqual(existing);   // NOT re-stamped at 9_999
  });

  it('still honours an explicit prevAlert', async () => {
    const existing = { ts: 500, mcap: 1, priceUsd: null };
    const out = await evaluateToken(token(),
      { asOf: 9_999, cfg: CONFIG, prevAlert: existing, ...deps() });
    expect(out.alert).toEqual(existing);
  });

  it('does not stamp an alert while merely watching', async () => {
    const out = await evaluateToken(token(),
      { asOf: 5, cfg: CONFIG, ...deps({ admission: 'watching' }) });
    expect(out.alert).toBeNull();
  });

  it('returns unscored without calling admit', async () => {
    const d = deps({ status: 'unscored' });
    const out = await evaluateToken(token(), { asOf: 3, cfg: CONFIG, ...d });
    expect(out.admission).toBe('unscored');
    expect(d.admitFn).not.toHaveBeenCalled();
  });

  it('emits admission_changed only on a real transition', async () => {
    const tape = { append: vi.fn(async () => {}) };
    await evaluateToken(token(), { asOf: 11, cfg: CONFIG, tape,
      prevAdmission: 'watching', ...deps() });
    expect(tape.append.mock.calls.map(([e]) => e.type))
      .toEqual(['score_evaluated', 'admission_changed']);

    const tape2 = { append: vi.fn(async () => {}) };
    await evaluateToken(token(), { asOf: 12, cfg: CONFIG, tape: tape2,
      prevAdmission: 'qualified', ...deps() });
    expect(tape2.append.mock.calls.map(([e]) => e.type)).toEqual(['score_evaluated']);
  });
});
