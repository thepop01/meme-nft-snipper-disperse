// Gas oracle + fee math for mint jobs. Two modes:
//  caps   — never exceed user maxFee/maxPriority (gwei); flag aboveCap.
//  all-in — remaining balance (minus mint cost and dust) becomes the gas
//           budget: maxFeePerGas = budget / gasLimit.
export const DUST_BUFFER_WEI = 10n ** 14n; // 0.0001 native left behind

const GWEI = 10n ** 9n;

export async function getGasSnapshot(provider) {
  const block = await provider.getBlock('latest');
  let priorityFeeWei = 1n * GWEI;
  try {
    priorityFeeWei = BigInt(await provider.send('eth_maxPriorityFeePerGas', []));
  } catch { /* some RPCs lack the method; keep 1 gwei default */ }
  return { baseFeeWei: block.baseFeePerGas ?? 0n, priorityFeeWei };
}

export function computeTxFees({ mode, snap, maxFeeGwei, maxPriorityGwei, gasLimit, balanceWei, mintCostWei }) {
  if (mode === 'all-in') {
    const budget = balanceWei - mintCostWei - DUST_BUFFER_WEI;
    if (budget <= 0n) throw new Error('Insufficient balance for mint cost + gas');
    const maxFeePerGas = budget / gasLimit;
    return {
      maxFeePerGas,
      maxPriorityFeePerGas: snap.priorityFeeWei < maxFeePerGas ? snap.priorityFeeWei : maxFeePerGas,
      aboveCap: false,
    };
  }
  // caps mode
  const capFee = BigInt(Math.round(maxFeeGwei * 1e9));
  const capPriority = BigInt(Math.round(maxPriorityGwei * 1e9));
  const wanted = snap.baseFeeWei * 2n + snap.priorityFeeWei;
  const maxFeePerGas = wanted > capFee ? capFee : wanted;
  // Priority fee must never exceed the total fee cap or nodes reject the tx.
  let maxPriorityFeePerGas = snap.priorityFeeWei > capPriority ? capPriority : snap.priorityFeeWei;
  if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas, aboveCap: snap.baseFeeWei > capFee };
}
