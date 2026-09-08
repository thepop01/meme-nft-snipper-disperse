import { CONFIG } from './config.js';
import { classifyScope } from '../scope/chainScope.js';
import { weightedScore } from './weightedScore.js';
import { evaluateBlockers } from './blockers.js';

const norm = (value, [low, high]) => value == null ? null : Math.min(1, Math.max(0, (value - low) / (high - low)));
const normInv = (value, range) => value == null ? null : 1 - norm(value, range);
const inverse = value => value == null ? null : 1 - value;

export function computeMemeScore(token, structural = {}, dynamic = {}, cfg = CONFIG) {
  if (classifyScope(token) !== 'supported') return { version: cfg.version, status: 'unscored', assetKey: token?.assetKey };
  const profile = token.migrated ? 'post-migration' : 'pump-curve';
  const weights = cfg.dynamic[profile].weights;
  const capitalFormation = structural.capitalFormation ?? {};
  const nonBot = structural.nonBotShare && typeof structural.nonBotShare === 'object' ? structural.nonBotShare : {};
  const normalizedStructural = { ...structural,
    capitalEfficiency: structural.capitalEfficiency ?? capitalFormation.primary ?? null,
    milestones: structural.milestones ?? capitalFormation.milestones,
    nonBotShare: typeof structural.nonBotShare === 'number' ? structural.nonBotShare : nonBot.share,
    nonBotClassifierStatus: structural.nonBotClassifierStatus ?? nonBot.classifierStatus,
    nonBotEvidence: structural.nonBotEvidence ?? nonBot.evidence,
  };
  const structuralResult = weightedScore([
    { key: 'capitalEfficiency', value: norm(normalizedStructural.capitalEfficiency, cfg.norm.capEff), weight: cfg.structural.weights.capitalEfficiency },
    { key: 'milestoneSpeed', value: normInv(normalizedStructural.milestones?.swaps_to_100pct, cfg.norm.milestone), weight: cfg.structural.weights.milestoneSpeed },
    { key: 'nonBotShare', value: normalizedStructural.nonBotShare, weight: cfg.structural.weights.nonBotShare },
    { key: 'bundleCluster', value: inverse(normalizedStructural.maxSuspiciousComponentPct), weight: cfg.structural.weights.bundleCluster },
    { key: 'top10ExLp', value: inverse(normalizedStructural.top10ExLpPct), weight: cfg.structural.weights.top10ExLp },
    { key: 'devPrior', value: normalizedStructural.devFingerprint?.known ? 1 - normalizedStructural.devFingerprint.rugRate : null, weight: cfg.structural.weights.devPrior },
    { key: 'creatorInitialBuy', value: null, weight: cfg.structural.weights.creatorInitialBuy },
  ]);
  const structuralForBlockers = normalizedStructural;
  const dynamicResult = weightedScore([
    { key: 'flowState', value: dynamic.flowState?.bullish == null ? null : dynamic.flowState.bullish ? 1 : 0, weight: weights.flowState },
    { key: 'efficiencyAnalogs', value: norm(dynamic.efficiency?.volPerTrade, cfg.norm.volPerTrade), weight: weights.efficiencyAnalogs },
    { key: 'cohortRetention', value: dynamic.retention?.remainingTokenPct ?? null, weight: weights.cohortRetention },
    { key: 'athHealth', value: inverse(dynamic.snapshot?.athDistance), weight: weights.athHealth ?? weights.drawdownHealth },
    { key: 'derivatives', value: norm(dynamic.derivatives?.velocity, cfg.norm.velocity), weight: weights.derivatives },
    { key: 'smartLifecycle', value: dynamic.smartLifecycleScore ?? null, weight: weights.smartLifecycle },
    { key: 'uniqueParticipation', value: dynamic.uniqueParticipation ?? null, weight: weights.uniqueParticipation },
  ]);
  const memeScore = structuralResult.score != null && dynamicResult.score != null ? Math.round(0.6 * structuralResult.score + 0.4 * dynamicResult.score) : null;
  return { version: cfg.version, assetKey: token.assetKey, asOf: token.asOf, profile, status: 'scored', structural: structuralResult,
    dynamic: dynamicResult, memeScore, evidenceCoverage: Math.round((structuralResult.coverage * 0.6 + dynamicResult.coverage * 0.4) * 100),
    blockers: evaluateBlockers(token, structuralForBlockers, dynamic, cfg) };
}
