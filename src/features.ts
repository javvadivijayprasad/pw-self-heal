/**
 * 17-feature DOM similarity vector — a byte-for-byte TypeScript port of
 * `self_healing_service/ml/features.py`. The trained GB/XGB models and the
 * heuristic weights were fit against these exact semantics; any divergence
 * feeds the model out-of-distribution inputs. See the Python source for the
 * invariant list. Keep this file in lock-step with it.
 */

import { ratio } from './seqmatch';
import type { CandidateElement, FeatureVector, LocatorMetadata } from './types';

export const FEATURE_NAMES: Array<keyof FeatureVector> = [
  'tag_match',
  'text_similarity',
  'attribute_similarity',
  'class_similarity',
  'parent_similarity',
  'depth_similarity',
  'id_similarity',
  'name_similarity',
  'placeholder_similarity',
  'aria_label_similarity',
  'type_attr_match',
  'sibling_count_ratio',
  'multi_attr_match_count',
  'candidate_text_actionable',
  'candidate_in_form',
  'candidate_attr_richness',
  'original_attr_count',
];

/** Heuristic weights (sum to 1.0); mirrors heuristic_ranker.py. */
export const HEURISTIC_WEIGHTS: Partial<Record<keyof FeatureVector, number>> = {
  tag_match: 0.15,
  text_similarity: 0.2,
  attribute_similarity: 0.25,
  class_similarity: 0.15,
  parent_similarity: 0.15,
  depth_similarity: 0.1,
};

const ACTIONABLE_TEXT_PATTERNS = new Set([
  'login', 'log in', 'sign in', 'sign up', 'signup', 'register',
  'submit', 'save', 'update', 'create', 'delete', 'remove',
  'ok', 'cancel', 'close', 'next', 'back', 'continue', 'proceed',
  'confirm', 'apply', 'search', 'go', 'send', 'post', 'publish',
  'yes', 'no', 'accept', 'decline', 'agree', 'skip', 'edit',
]);

const CAND_ATTRS_FOR_RICHNESS: Array<keyof CandidateElement> = [
  'element_id', 'name', 'class_name', 'placeholder', 'aria_label', 'type_attr', 'value_attr',
];
const ORIG_ATTRS_FOR_COUNT: Array<keyof LocatorMetadata> = [
  'element_id', 'name', 'class_name', 'placeholder', 'aria_label', 'type_attr', 'text',
];

/** Case-insensitive difflib ratio; 0.0 if either side is empty. */
function strSim(a: unknown, b: unknown): number {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  if (!sa || !sb) return 0.0;
  return ratio(sa.toLowerCase(), sb.toLowerCase());
}

function nonEmpty(v: unknown): boolean {
  return v != null && String(v).trim().length > 0;
}

function populatedFraction(obj: Record<string, unknown>, attrs: string[]): number {
  let populated = 0;
  for (const a of attrs) if (nonEmpty(obj[a])) populated++;
  return populated / attrs.length;
}

function candidateTextActionable(text: unknown): number {
  if (!text) return 0.0;
  const t = String(text).trim().toLowerCase();
  if (!t || t.length > 50) return 0.0;
  if (ACTIONABLE_TEXT_PATTERNS.has(t)) return 1.0;
  for (const p of ACTIONABLE_TEXT_PATTERNS) if (t.includes(p)) return 0.7;
  if (t.split(/\s+/).some((w) => ACTIONABLE_TEXT_PATTERNS.has(w))) return 0.5;
  return 0.0;
}

export function computeFeatures(
  original: LocatorMetadata,
  candidate: CandidateElement,
): FeatureVector {
  const o = original as unknown as Record<string, unknown>;
  const c = candidate as unknown as Record<string, unknown>;
  const s = (v: unknown) => (v == null ? '' : String(v));

  const oTag = s(o.tag).toLowerCase();
  const cTag = s(c.tag).toLowerCase();
  const tagMatch = oTag && oTag === cTag ? 1.0 : 0.0;

  const textSim = strSim(o.text, c.text);
  const idSim = strSim(o.element_id, c.element_id);
  const nameSim = strSim(o.name, c.name);
  const plcSim = strSim(o.placeholder, c.placeholder);
  const ariaSim = strSim(o.aria_label, c.aria_label);
  const attrSim = Math.max(idSim, nameSim, plcSim, ariaSim);
  const classSim = strSim(o.class_name, c.class_name);

  const oParent = s(o.parent_tag).toLowerCase();
  const cParent = s(c.parent_tag).toLowerCase();
  const parentSim = oParent && oParent === cParent ? 1.0 : 0.0;

  const oDepth = Number(o.dom_depth) || 0;
  const cDepth = Number(c.dom_depth) || 0;
  const depthSim = oDepth && cDepth ? Math.max(0.0, 1.0 - Math.abs(oDepth - cDepth) / 10.0) : 0.0;

  const oType = (s(o.type_attr) || s(o.locator_type)).toLowerCase();
  const cType = s(c.type_attr).toLowerCase();
  const typeMatch = oType && oType === cType ? 1.0 : 0.0;

  const cSiblings = Number(c.sibling_count) || 0;
  const siblingRatio = Math.min(cSiblings / 20.0, 1.0);

  let matchCount = 0;
  for (const attr of ['element_id', 'name', 'placeholder', 'aria_label']) {
    const ov = o[attr];
    const cv = c[attr];
    if (ov && cv && String(ov).trim().toLowerCase() === String(cv).trim().toLowerCase()) matchCount++;
  }

  return {
    tag_match: tagMatch,
    text_similarity: textSim,
    attribute_similarity: attrSim,
    class_similarity: classSim,
    parent_similarity: parentSim,
    depth_similarity: depthSim,
    id_similarity: idSim,
    name_similarity: nameSim,
    placeholder_similarity: plcSim,
    aria_label_similarity: ariaSim,
    type_attr_match: typeMatch,
    sibling_count_ratio: siblingRatio,
    multi_attr_match_count: matchCount,
    candidate_text_actionable: candidateTextActionable(c.text),
    candidate_in_form: cParent === 'form' ? 1.0 : 0.0,
    candidate_attr_richness: populatedFraction(c, CAND_ATTRS_FOR_RICHNESS as string[]),
    original_attr_count: populatedFraction(o, ORIG_ATTRS_FOR_COUNT as string[]),
  };
}

export function heuristicScore(features: FeatureVector): number {
  let sum = 0;
  for (const k of Object.keys(HEURISTIC_WEIGHTS) as Array<keyof FeatureVector>) {
    sum += (HEURISTIC_WEIGHTS[k] as number) * (features[k] as number);
  }
  return sum;
}

/** Feature vector as a length-17 array in FEATURE_NAMES order (for ONNX input). */
export function featureArray(features: FeatureVector): number[] {
  return FEATURE_NAMES.map((k) => features[k] as number);
}
