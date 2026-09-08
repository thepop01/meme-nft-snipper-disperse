// The frozen go/no-go rule (§19.5). Cohorts are judged INDEPENDENTLY — a partial pass is
// legitimate: one regime can go live while the other stays watching-only.
//
// The interval is a percentile BOOTSTRAP, not a t-test: meme returns are heavy-tailed and
// bounded below at -1, so a positive sample mean is routinely noise.
import { bootstrapMeanCI } from './bootstrap.js';
import { evPerAlert } from './metrics.js';

const seeded = seed => { let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };

export function evaluateCohort(cohort, { cal, rng }) {
  const rows = (cohort.rows ?? []).filter(row => row.label);
  const n = rows.length;
  const requiredN = cohort.extended ? cal.minQualifiedAlerts * 2 : cal.minQualifiedAlerts;

  // Condition 1. Below N we do not judge at all — an early verdict on a thin sample is
  // exactly the mistake this rule exists to prevent.
  if (n < requiredN) {
    return { verdict: 'INSUFFICIENT', n, requiredN, ci: null, reasons: ['n_below_minimum'] };
  }

  const returns = rows.map(row => row.label.y_policy_net_return);
  const ci = bootstrapMeanCI(returns, {
    samples: cal.bootstrapSamples, confidence: cal.confidence, rng: rng ?? seeded(1) });

  // Conditions 3-5 are hard gates on GO regardless of the interval.
  const reasons = [];
  const rugRate = rows.filter(row => row.label.y_rugged).length / n;
  if (rugRate > cal.rugCeilingFrac) reasons.push('rug_rate_above_ceiling');
  if (cohort.medianFillDecay != null && cohort.medianFillDecay > cal.maxMedianFillDecayFrac) {
    reasons.push('fill_decay_above_policy');
  }
  if (!cohort.parity?.ok) reasons.push('parity_failures_unresolved');

  const base = { n, requiredN, ci, ev: evPerAlert(rows), rugRate };

  // Condition 2 drives the three-way decision.
  if (ci.upper < 0) return { ...base, verdict: 'NO_GO', reasons: [...reasons, 'ci_below_zero'] };
  if (ci.lower <= 0 && ci.upper >= 0) {
    // Hard gates outrank extension: a straddling CI must not mask a real failure
    // as "collect more data".
    if (reasons.length) return { ...base, verdict: 'NO_GO', reasons };
    if (cohort.extended) {
      return { ...base, verdict: 'NO_GO', reasons: ['extension_exhausted'] };
    }
    return { ...base, verdict: 'EXTEND', targetN: cal.minQualifiedAlerts * 2,
             reasons: ['ci_straddles_zero'] };
  }
  if (reasons.length) return { ...base, verdict: 'NO_GO', reasons };
  return { ...base, verdict: 'GO', reasons: [] };
}

export function evaluateVerdict(cohorts, { cal, rng } = {}) {
  const out = {};
  for (const [name, data] of Object.entries(cohorts)) {
    // Per-cohort seed derived from the name: stable, and independent of iteration order.
    const seed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    out[name] = evaluateCohort(data, { cal, rng: rng ?? seeded(seed) });
  }
  const verdicts = Object.values(out).map(v => v.verdict);
  const overall = verdicts.length && verdicts.every(v => v === 'GO') ? 'GO'
    : verdicts.includes('GO') ? 'PARTIAL'
    : verdicts.some(v => v === 'EXTEND' || v === 'INSUFFICIENT') ? 'PENDING'
    : 'NO_GO';
  return { cohorts: out, overall };
}
