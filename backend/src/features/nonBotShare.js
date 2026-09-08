const unconfiguredClassifier = Object.freeze({
  version: 'unconfigured', status: 'experimental', precision: null, recall: null,
  isFrontendRouted: () => false,
});

// The classifier is display-only until validation clears its predeclared precision floor.
// Bot labels: Jito-bundle wallets, known bot program IDs, and repeat first-block buyers
// across >=3 launches. Manual labels: long multi-protocol histories with CEX funding and
// no bundle interaction. Everything ambiguous is excluded from the validation set.
export function nonBotShare(trades, classifier = unconfiguredClassifier) {
  const sampleSize = trades.length;
  const contract = {
    share: null,
    sampleSize,
    classifierVersion: classifier.version ?? 'unconfigured',
    classifierStatus: classifier.status ?? 'experimental',
    precision: classifier.precision ?? null,
    recall: classifier.recall ?? null,
  };
  if (classifier.status !== 'validated') return contract;
  if (typeof classifier.isFrontendRouted !== 'function') return { ...contract, evidence: 'unavailable' };
  if (sampleSize < 30) return { ...contract, evidence: 'insufficient' };
  const manual = trades.filter(trade => classifier.isFrontendRouted(trade)).length;
  return { ...contract, share: manual / sampleSize, evidence: 'sufficient' };
}
