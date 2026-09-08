// Evaluation metrics (§19.4).
// Canonical row shape: { assetKey, score, label } where `label` is a buildLabel() result.
// Reading anything other than the y_* fields silently yields NaN — that was the defect.
export function assertProbabilities(rows) {
  if (!rows.length) throw new Error('calibrated probabilities required: empty set');
  if (!rows.every(row => row.isProbability && Number.isFinite(row.probability) &&
                         row.probability >= 0 && row.probability <= 1)) {
    throw new Error('calibrated probabilities required: a raw memeScore is a ranking index, ' +
      'not a probability (§14.1)');
  }
}

const labeled = rows => rows.filter(row => row.label);

export function precisionAtK(rows, k) {
  const top = labeled([...rows].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)))
    .slice(0, k);
  if (!top.length) return null;
  return top.filter(row => row.label.y_policy_net_positive).length / top.length;
}

// THE metric: expected value net of costs, NOT hit rate.
export function evPerAlert(rows) {
  const withLabel = labeled(rows);
  if (!withLabel.length) return null;
  return withLabel.reduce((sum, row) => sum + row.label.y_policy_net_return, 0) / withLabel.length;
}

export function brier(rows) {
  assertProbabilities(rows);
  return rows.reduce((sum, row) =>
    sum + (row.probability - Number(Boolean(row.label))) ** 2, 0) / rows.length;
}

export function calibrationTable(rows, bins = 10) {
  assertProbabilities(rows);
  return Array.from({ length: bins }, (_, index) => {
    const values = rows.filter(row =>
      Math.min(bins - 1, Math.floor(row.probability * bins)) === index);
    return {
      bin: index,
      count: values.length,
      predicted: values.length
        ? values.reduce((sum, row) => sum + row.probability, 0) / values.length : null,
      observed: values.length ? values.filter(row => row.label).length / values.length : null,
    };
  });
}
