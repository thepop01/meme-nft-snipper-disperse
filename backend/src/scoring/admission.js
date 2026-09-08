export function admit(score, token, cfg) {
  if (score.status === 'unscored') return 'unscored';
  if (score.blockers?.length) return 'rejected';
  const rules = cfg.admission;
  const structuralScore = score.structural?.score;
  const dynamicScore = score.dynamic?.score;
  const memeScore = score.memeScore;
  if (structuralScore == null || dynamicScore == null || memeScore == null) return 'watching';
  const capitalEfficiency = score.structural.breakdown?.capitalEfficiency?.value ?? null;
  if (memeScore >= rules.combined.meme && structuralScore >= rules.combined.structural && dynamicScore >= rules.combined.dynamic && score.evidenceCoverage >= rules.combined.coverage) return 'qualified';
  const structural = token.structural ?? {};
  if (capitalEfficiency != null && capitalEfficiency >= 0.9 && structural.nonBotClassifierStatus === 'validated' && structural.nonBotShare >= 0.5 && structural.classifiedTrades >= 30 && structuralScore >= rules.momentum.structural && dynamicScore >= rules.momentum.dynamic && memeScore >= rules.momentum.meme && score.evidenceCoverage >= rules.momentum.coverage) return 'qualified';
  const stillFresh = token.provisionalAt == null || token.asOf - token.provisionalAt < rules.provisional.ttlMs;
  if (stillFresh && capitalEfficiency != null && capitalEfficiency >= 0.9 && structural.swapCount >= rules.provisional.minSwaps) return 'provisional';
  return 'watching';
}
