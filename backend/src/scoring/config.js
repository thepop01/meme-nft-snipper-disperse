// Shadow-only placeholders. Any calibration or interpretation change requires a version bump.
export const CONFIG = Object.freeze({
  version: 'meme-score-v2.0.0',
  status: 'v1-placeholder — thresholds NOT calibrated. Do not automate.',
  windows: { canonicalMs: 60_000, flowSeriesLen: 4, cohortEntryMs: 5 * 60_000, cohortCheckMs: [15, 30].map(minutes => minutes * 60_000) },
  structural: {
    weights: { capitalEfficiency: 0.25, milestoneSpeed: 0.10, nonBotShare: 0.20, bundleCluster: 0.20,
      top10ExLp: 0.10, devPrior: 0.05, creatorInitialBuy: 0, rawFreshCount: 0, smartPresence: 0 },
    freshAgeMs: 72 * 3600_000, freshBoundary: [20, 60], funderLookbackMs: 24 * 3600_000, devConfidentN: 8, shrinkStrength: 5,
  },
  dynamic: {
    'pump-curve': { weights: { flowState: 0.30, cohortRetention: 0.25, drawdownHealth: 0.20, uniqueParticipation: 0.15, derivatives: 0.10 }, emaAlpha: 0.3 },
    'post-migration': { weights: { flowState: 0.25, efficiencyAnalogs: 0.25, cohortRetention: 0.20, athHealth: 0.15, derivatives: 0.10, smartLifecycle: 0.05 }, emaAlpha: 0.3 },
  },
  norm: { capEff: [0.05, 0.5], milestone: [30, 800], volPerTrade: [0.02, 0.4], velocity: [0, 0.01] },
  admission: { combined: { meme: 75, structural: 70, dynamic: 60, coverage: 75 }, momentum: { meme: 70, structural: 70, dynamic: 50, coverage: 70 }, provisional: { minSwaps: 10, ttlMs: 10 * 60_000 } },
  blockers: { liquidityCollapseFrac: 0.70, farmFrac: 0.50, devConcentrationFrac: 0.20, nonBotMinShare: 0.30,
    honeypotMaxChecks: 5, honeypotStaleMs: 10 * 60_000, madK: 4, madKCandidates: [4, 6] },
  policy: { maxEntryDecayFrac: 0.05, exitLadder: [[2, 0.5], [4, 0.25]], evalHorizonMs: 6 * 3600_000, positiveReturn: 0.50, mcapTarget: 500_000 },
  calibration: {
    bootstrapSamples: 2000,
    confidence: 0.95,
    minQualifiedAlerts: 200,       // N per cohort, predeclared (§19.5)
    rugCeilingFrac: 0.30,
    maxMedianFillDecayFrac: 0.05,
  },
});
