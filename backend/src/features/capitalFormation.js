const LAMPORTS_PER_SOL = 1_000_000_000;

function targetLamports(curveTargetSol) {
  if (curveTargetSol == null || curveTargetSol === '') return null;
  const targetSol = Number(curveTargetSol);
  if (!Number.isFinite(targetSol) || targetSol <= 0) return null;
  return targetSol * LAMPORTS_PER_SOL;
}

// Higher progress-per-buy and fewer swaps to each milestone are better.  Sells remain
// available as diagnostics, but cannot inflate the primary capital-formation feature.
export function capitalFormation(trades, curveTargetSol) {
  const target = targetLamports(curveTargetSol);
  const buys = trades.filter(trade => trade.side === 'buy');
  if (target == null || buys.length < 5) return { primary: null, coverage: 0 };
  if (buys.some(trade => !Number.isFinite(Number(trade.solLamports)) || Number(trade.solLamports) <= 0)) {
    return { primary: null, coverage: 0 };
  }

  const fractions = [0.25, 0.5, 0.75, 1];
  const milestones = {};
  let fractionIndex = 0;
  let raisedLamports = 0;

  buys.forEach((trade, index) => {
    raisedLamports += Number(trade.solLamports ?? 0);
    while (fractionIndex < fractions.length && raisedLamports >= target * fractions[fractionIndex]) {
      milestones[`swaps_to_${fractions[fractionIndex] * 100}pct`] = index + 1;
      fractionIndex += 1;
    }
  });
  while (fractionIndex < fractions.length) {
    milestones[`swaps_to_${fractions[fractionIndex] * 100}pct`] = null;
    fractionIndex += 1;
  }

  const curveProgress = Math.min(1, raisedLamports / target);
  return {
    primary: curveProgress / buys.length,
    milestones,
    coverage: 1,
    diagnostics: {
      grossSolPerBuy: raisedLamports / LAMPORTS_PER_SOL / buys.length,
      solRaisedLamports: raisedLamports,
      swapCount: buys.length,
      sellCount: trades.length - buys.length,
    },
  };
}
