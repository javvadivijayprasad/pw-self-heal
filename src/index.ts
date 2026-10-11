/** @vijaypjavvadi/pw-self-heal — public API. */

export { withSelfHealing } from './fixture';
export { wrapPage, classifyError, isStaleError, parseLocator } from './heal';
export type { ErrorClass, HealingSummary } from './heal';
export { Ranker, suggestLocator, toLocatorScore, scoresFromResult } from './ranker';
export {
  HealingLocator,
  makeLocatorFactories,
  descriptorToMeta,
  intentBoost,
  rebuildLocator,
} from './locator';
export type { RealLocator, HealablePage, HealContext } from './locator';
export { computeFeatures, heuristicScore, featureArray, FEATURE_NAMES, HEURISTIC_WEIGHTS } from './features';
export { extractCandidates } from './candidateExtractor';
export { renderHtmlReport, summarize } from './report';
export type { HealSummary } from './report';
export type { EvaluatablePage } from './candidateExtractor';
export { DEFAULT_CONFIG, THRESHOLDS, HYBRID_ALPHA } from './types';
export type {
  RankerMode,
  Algorithm,
  LocatorMetadata,
  CandidateElement,
  LocatorKind,
  LocatorStrategy,
  LocatorDescriptor,
  FeatureVector,
  ScoredCandidate,
  LocatorScore,
  HealResult,
  HealEvent,
  SelfHealConfig,
} from './types';
