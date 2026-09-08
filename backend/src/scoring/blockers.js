export function evaluateBlockers(token, structural = {}, dynamic = {}, cfg) {
  const blockers = [];
  const rules = cfg.blockers;
  const push = (code, reversible, evidence) => blockers.push({ code, reversible, evidence, ts: token.asOf, version: cfg.version });
  if (dynamic.dumpConfirmed) push('DUMP', false, { sigma: dynamic.dumpSigma, k: rules.madK });
  if (token.sellRouteVerified === false) {
    const checks = token.sellRouteChecks ?? 0;
    const age = token.sellRouteFirstCheckTs == null ? Infinity : token.asOf - token.sellRouteFirstCheckTs;
    if (checks < rules.honeypotMaxChecks && age < rules.honeypotStaleMs) push('HONEYPOT', true, { venue: token.sellRouteVenue, checks });
    else push('BAD_DATA', true, { reason: 'honeypot_unverifiable', checks });
  }
  if (dynamic.liquidityDropFrac != null && dynamic.liquidityDropFrac > rules.liquidityCollapseFrac) push('LIQ_COLLAPSE', false, { drop: dynamic.liquidityDropFrac });
  if (structural.nonBotClassifierStatus === 'validated' && structural.nonBotEvidence === 'sufficient' &&
      structural.nonBotShare != null && structural.nonBotShare < rules.nonBotMinShare) push('BOT_FLOW', false, { share: structural.nonBotShare });
  if (structural.maxSuspiciousComponentPct != null && structural.maxSuspiciousComponentPct > rules.farmFrac) push('FARM', false, { pct: structural.maxSuspiciousComponentPct });
  if (structural.devHoldFrac != null && structural.devHoldFrac > rules.devConcentrationFrac) push('DEV_CONCENTRATION', false, { pct: structural.devHoldFrac });
  if (dynamic.devSellBeforeSafeState) push('DEV_SELL', false, { ms: dynamic.devFirstSellMs });
  if (dynamic.staleData || dynamic.inconsistentData) push('BAD_DATA', true, { reason: dynamic.dataIssue });
  return blockers;
}
