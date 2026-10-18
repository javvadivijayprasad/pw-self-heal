/** Public types for @vijaypjavvadi/pw-self-heal. */

import type { ErrorClass } from './errors';

export type RankerMode = 'heuristic' | 'ml' | 'hybrid';
export type Algorithm = 'gb' | 'xgb';

/** Description of the original (broken) locator's target element. */
export interface LocatorMetadata {
  tag: string;
  text: string;
  element_id: string;
  name: string;
  class_name: string;
  placeholder: string;
  aria_label: string;
  parent_tag: string;
  dom_depth: number;
  type_attr: string;
  /** Locator kind inferred from the selector string (id|name|class|css...). */
  locator_type: string;
}

/** A candidate replacement element extracted from the live DOM. */
export interface CandidateElement {
  tag: string;
  text: string;
  element_id: string;
  name: string;
  class_name: string;
  placeholder: string;
  aria_label: string;
  type_attr: string;
  value_attr: string;
  parent_tag: string;
  dom_depth: number;
  sibling_count: number;
  /** Rough CSS selector hint for debugging / suggested locator. */
  css_path_hint?: string;
  /** data-testid (or configured test-id attribute) value, if present. */
  test_id?: string;
  /** Explicit or implicit ARIA role. */
  role?: string;
  /** Best-effort accessible name (aria-label | text | placeholder | alt | title). */
  acc_name?: string;
}

/** The kind of Playwright locator that was used. */
export type LocatorKind =
  | 'role'
  | 'testid'
  | 'label'
  | 'text'
  | 'placeholder'
  | 'altText'
  | 'title'
  | 'css'
  | 'xpath';

/**
 * Coarse strategy used to express a *healed* locator against a candidate.
 * A subset of {@link LocatorKind}: the robust/semantic ways to re-target an
 * element, ordered by {@link SelfHealConfig.fallbackStrategy}.
 */
export type LocatorStrategy = 'role' | 'text' | 'testid' | 'css' | 'xpath';

/** Captures the intent expressed by a Playwright locator, for healing. */
export interface LocatorDescriptor {
  kind: LocatorKind;
  /** The primary value: role name, testid, text, css string, etc. */
  value: string;
  /** Locator options, e.g. { name } for getByRole. */
  options?: { name?: string; exact?: boolean } & Record<string, unknown>;
}

/** The 17-dimensional similarity vector (13 core + 4 Phase-3). */
export interface FeatureVector {
  tag_match: number;
  text_similarity: number;
  attribute_similarity: number;
  class_similarity: number;
  parent_similarity: number;
  depth_similarity: number;
  id_similarity: number;
  name_similarity: number;
  placeholder_similarity: number;
  aria_label_similarity: number;
  type_attr_match: number;
  sibling_count_ratio: number;
  multi_attr_match_count: number;
  candidate_text_actionable: number;
  candidate_in_form: number;
  candidate_attr_richness: number;
  original_attr_count: number;
}

export interface ScoredCandidate {
  candidate: CandidateElement;
  features: FeatureVector;
  heuristicScore: number;
  mlProbability: number;
  finalScore: number;
  rank: number;
}

/**
 * Public projection of one ranked candidate's scoring decision.
 *
 * Where {@link ScoredCandidate} is the internal shape (it carries the raw
 * candidate element and the full 17-d {@link FeatureVector}), `LocatorScore`
 * is the clean, stable surface downstream code consumes for logging,
 * dashboards, or custom ranking. Produced via `toLocatorScore` /
 * `scoresFromResult` and attached to {@link HealEvent.scores}.
 *
 * Fields (precedence / meaning):
 *  - `locator`        the rebuilt/suggested locator string for this candidate
 *                     (from `suggestLocator`).
 *  - `finalScore`     the blended score used for the accept/reject decision
 *                     (heuristic-only in `heuristic` mode; ml-only in `ml`
 *                     mode; `alpha*heuristic + (1-alpha)*ml` in `hybrid`).
 *  - `mlProbability`  model probability in [0,1]; `0` when heuristic-only
 *                     (mode `heuristic`, or ml/hybrid degraded to heuristic).
 *  - `heuristicScore` the heuristic-only similarity score.
 *  - `mode`           the (effective) ranker mode that produced the score.
 *  - `rank`           the candidate's rank as assigned by the ranker
 *                     (1 = best; mirrors {@link ScoredCandidate.rank}).
 */
export interface LocatorScore {
  locator: string;
  finalScore: number;
  mlProbability: number;
  heuristicScore: number;
  mode: RankerMode;
  rank: number;
}

/**
 * Stable, documented outcome vocabulary for a heal attempt (SemVer 1.x
 * contract). Downstream consumers may `switch` on `kind` across the whole 1.x
 * line; the four members and their payloads are frozen and only ever extended
 * additively.
 *
 *  - `healed`         a candidate cleared the confidence threshold and the
 *                     action succeeded against it; carries the rebuilt
 *                     `selector` and the accepted `score`.
 *  - `belowThreshold` candidates were found and ranked, but the BEST one scored
 *                     under the confidence `threshold`; carries both numbers.
 *  - `noCandidates`   candidate extraction found nothing to rank.
 *  - `notHealable`    the failure was not a locator miss (assertion / loading /
 *                     stale / fatal), so changing the locator cannot help;
 *                     carries the failure {@link ErrorClass}.
 *
 * Purely additive: the pre-existing `HealResult.healed: boolean` is unchanged.
 */
export type HealOutcome =
  | { kind: 'healed'; selector: string; score: number }
  | { kind: 'notHealable'; class: ErrorClass }
  | { kind: 'belowThreshold'; score: number; threshold: number }
  | { kind: 'noCandidates' };

export interface HealResult {
  healed: boolean;
  suggestedLocator?: string;
  bestCandidate?: ScoredCandidate;
  topCandidates: ScoredCandidate[];
  mode: RankerMode;
  algorithm: Algorithm;
  thresholdUsed: number;
  candidatesEvaluated: number;
  elapsedMs: number;
  /**
   * Stable {@link HealOutcome} for this ranking pass (SemVer 1.x contract).
   * Set by the ranker to `healed` / `belowThreshold` / `noCandidates`. The
   * `notHealable` variant is produced by the heal paths (not the ranker, which
   * never sees the failure). Optional + additive; `healed: boolean` is unchanged.
   */
  outcome?: HealOutcome;
}

export interface HealEvent {
  timestamp: number;
  testId: string;
  original: string;
  healed: string;
  score: number;
  mode: RankerMode;
  candidatesEvaluated: number;
  elapsedMs: number;
  /** 'string' for page.click(selector); otherwise the locator kind. */
  via?: 'string' | LocatorKind;
  /**
   * Top-N scoring decisions behind this heal (N = {@link SelfHealConfig.topK}),
   * ordered best-first, for downstream logging/dashboards. Optional and purely
   * additive: pre-existing consumers are unaffected. Lands in both the
   * telemetry JSONL and `getHealingSummary()`.
   */
  scores?: LocatorScore[];
  /**
   * Identity of the Playwright test that triggered this heal, copied from the
   * `TestInfo` available to the fixture / `wrapPage`. Lets consumers (e.g.
   * attestqa) JOIN heal events to Playwright test results without guessing from
   * timestamps. Each sub-field is guarded (absent in the imperative `wrapPage`
   * path when no test info is supplied). Optional + backward compatible; lands
   * in both the telemetry JSONL and `getHealingSummary()`.
   */
  test?: { title?: string; titlePath?: string[]; file?: string; testId?: string };
  /**
   * Stable {@link HealOutcome} for this heal (SemVer 1.x contract). Present on
   * recorded events (a heal was attempted and succeeded, so `kind: 'healed'`).
   * Optional + additive.
   */
  outcome?: HealOutcome;
}

export interface SelfHealConfig {
  mode: RankerMode;
  algorithm: Algorithm;
  confidence?: number;
  topK: number;
  maxCandidates: number;
  telemetry: string;
  autoUpdateSource: boolean;
  sourceRoot: string;
  modelPath?: string;
  testId: string;
  waitBeforeHeal: number;
  implicitWaitOnRetry: number;
  scrollIntoView: boolean;
  logHeals: boolean;
  /** Attribute used by getByTestId (Playwright default: data-testid). */
  testIdAttribute: string;
  /** Per-action timeout (ms) before treating a locator as missing. */
  healTimeout: number;
  /**
   * When true, on an action/assertion failure attach the current page HTML
   * (`await page.content()`) as a Playwright test attachment named
   * `pw-self-heal-dom.html` (content-type `text/html`). Off by default. Lets
   * consumers heal OFFLINE later from the saved HTML in the Playwright JSON
   * report (see {@link extractCandidatesFromHtml}). Requires the fixture to
   * forward its `testInfo` to `wrapPage`.
   */
  captureDomOnFailure?: boolean;
  /**
   * Ordered fallback strategies for expressing a healed locator. After the
   * original locator's own kind is tried first (intent preservation), the
   * healer walks this list and uses the FIRST strategy the candidate can
   * express. Default: role -> text -> testid -> xpath (semantic first,
   * brittle path last).
   */
  fallbackStrategy: LocatorStrategy[];
}

export const DEFAULT_CONFIG: SelfHealConfig = {
  mode: 'hybrid',
  algorithm: 'gb',
  confidence: undefined,
  topK: 5,
  maxCandidates: 200,
  telemetry: '.pwheal/heal-events.jsonl',
  autoUpdateSource: false,
  sourceRoot: '',
  modelPath: undefined,
  testId: '',
  waitBeforeHeal: 1000,
  implicitWaitOnRetry: 2000,
  scrollIntoView: true,
  logHeals: true,
  testIdAttribute: 'data-testid',
  healTimeout: 5000,
  captureDomOnFailure: false,
  fallbackStrategy: ['role', 'text', 'testid', 'xpath'],
};

/** Mode -> acceptance threshold, mirroring the service settings. */
export const THRESHOLDS: Record<RankerMode, number> = {
  heuristic: 0.45,
  ml: 0.5,
  hybrid: 0.5,
};

/** Heuristic weight for the hybrid blend: alpha*heuristic + (1-alpha)*ml. */
export const HYBRID_ALPHA = 0.4;
