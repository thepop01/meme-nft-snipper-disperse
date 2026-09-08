// The only score aggregator. Disabled inputs are neither scored nor counted as evidence.
export function weightedScore(inputs) {
  const enabled = inputs.filter(input => input.weight > 0);
  const available = enabled.filter(input => input.value != null && Number.isFinite(input.value));
  const totalWeight = enabled.reduce((sum, input) => sum + input.weight, 0);
  if (available.length === 0 || totalWeight === 0) return { score: null, coverage: 0, breakdown: {} };
  const availableWeight = available.reduce((sum, input) => sum + input.weight, 0);
  const score = Math.round(100 * available.reduce((sum, input) => sum + input.value * input.weight, 0) / availableWeight);
  return { score, coverage: availableWeight / totalWeight, breakdown: Object.fromEntries(available.map(input =>
    [input.key, { value: input.value, weight: input.weight, contribution: input.value * input.weight / availableWeight }])) };
}
