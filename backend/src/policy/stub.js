// Shadow policy (§20). Records an executable decision WITHOUT sending a transaction.
// No executor, wallet, or signing path is imported here — that is the safety property.
export function policyDecision(score, token, cfg) {
  if (score.admission !== 'qualified' || score.blockers?.length) {
    return { action: 'shadow_skip', reason: score.blockers?.length ? 'blocker' : 'not_qualified' };
  }

  // Decay needs a supply-aware mcap on BOTH sides. Without one the test is unevaluable, so
  // skip rather than silently treating unknown as "no decay" (§5.2.7 unknown != favourable).
  const alertMcap = score.alert?.mcap ?? null;
  if (alertMcap == null || token.mcap == null) {
    return { action: 'shadow_skip', reason: 'mcap_unavailable' };
  }

  // One-sided: only an UPWARD move past the limit disqualifies the entry, because the
  // opportunity we alerted on has already been taken. A price that fell is still entrable.
  const decayFrac = (token.mcap - alertMcap) / alertMcap;
  if (decayFrac > cfg.policy.maxEntryDecayFrac) {
    return { action: 'shadow_skip', reason: 'entry_decay' };
  }

  return { action: 'shadow_enter', assetKey: token.assetKey, version: score.version };
}

export async function recordShadowDecision(store, decision) {
  await store.append?.({ ...decision, shadow: true });
  return decision;
}
