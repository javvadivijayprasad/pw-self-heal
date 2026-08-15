/** Public types for @vijaypjavvadi/pw-self-heal. */

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
