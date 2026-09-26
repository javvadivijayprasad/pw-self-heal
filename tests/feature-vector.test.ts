/**
 * W3 — unit tests for the 17-feature vector extraction (`src/features.ts`).
 *
 * `tests/features.test.ts` pins `computeFeatures` against pre-serialized Python
 * reference rows, and `tests/domFeatures.test.ts` drives the *extractor* over
 * happy-dom snapshots. These tests close the remaining gap: they hand-construct
 * `LocatorMetadata` + `CandidateElement` pairs that resemble real DOM snapshots
 * and assert EACH of the 17 features individually, with precisely computed
 * expected values, plus every documented invariant and edge case from SPEC.md
 * §3.2. String-similarity expectations are derived from the same
 * `seqmatch.ratio` the feature code uses, so they test the wiring (which field
 * feeds which feature, case-insensitivity, empty handling, the max-of-four
 * rule) rather than re-deriving the algorithm.
 */

import { describe, it, expect } from 'vitest';
import {
  computeFeatures,
  featureArray,
  heuristicScore,
  FEATURE_NAMES,
  HEURISTIC_WEIGHTS,
} from '../src/features';
import { ratio } from '../src/seqmatch';
import type { CandidateElement, LocatorMetadata } from '../src/types';

/** A fully-populated original-locator metadata; override per test. */
function mkOriginal(over: Partial<LocatorMetadata> = {}): LocatorMetadata {
  return {
    tag: 'input',
    text: '',
    element_id: 'username',
    name: 'user',
    class_name: 'form-control input-lg',
    placeholder: 'Your username',
    aria_label: 'Username field',
    parent_tag: 'form',
    dom_depth: 4,
    type_attr: 'text',
    locator_type: 'id',
    ...over,
  };
}

/** A fully-populated live-DOM candidate; override per test. */
function mkCandidate(over: Partial<CandidateElement> = {}): CandidateElement {
  return {
    tag: 'input',
    text: '',
    element_id: 'username',
    name: 'user',
    class_name: 'form-control input-lg',
    placeholder: 'Your username',
    aria_label: 'Username field',
    type_attr: 'text',
    value_attr: '',
    parent_tag: 'form',
    dom_depth: 4,
    sibling_count: 0,
    ...over,
  };
}

/** Case-insensitive difflib ratio with the empty/empty = 0.0 rule applied. */
const sim = (a: string, b: string): number => (!a || !b ? 0.0 : ratio(a.toLowerCase(), b.toLowerCase()));

describe('tag_match', () => {
  it('is 1.0 for equal tags and 0.0 otherwise', () => {
    expect(computeFeatures(mkOriginal({ tag: 'input' }), mkCandidate({ tag: 'input' })).tag_match).toBe(1.0);
    expect(computeFeatures(mkOriginal({ tag: 'input' }), mkCandidate({ tag: 'button' })).tag_match).toBe(0.0);
  });

  it('is case-insensitive', () => {
    expect(computeFeatures(mkOriginal({ tag: 'INPUT' }), mkCandidate({ tag: 'input' })).tag_match).toBe(1.0);
    expect(computeFeatures(mkOriginal({ tag: 'Button' }), mkCandidate({ tag: 'BUTTON' })).tag_match).toBe(1.0);
  });

  it('is 0.0 when the original tag is empty (even if the candidate tag is empty too)', () => {
    expect(computeFeatures(mkOriginal({ tag: '' }), mkCandidate({ tag: '' })).tag_match).toBe(0.0);
    expect(computeFeatures(mkOriginal({ tag: '' }), mkCandidate({ tag: 'input' })).tag_match).toBe(0.0);
  });
});

describe('text_similarity', () => {
  it('is the case-insensitive difflib ratio of the two text values', () => {
    const fv = computeFeatures(mkOriginal({ text: 'Sign In' }), mkCandidate({ text: 'sign in' }));
    expect(fv.text_similarity).toBe(1.0);
  });

  it('reflects partial similarity precisely', () => {
    const fv = computeFeatures(mkOriginal({ text: 'Submit order' }), mkCandidate({ text: 'Submit' }));
    expect(fv.text_similarity).toBeCloseTo(sim('Submit order', 'Submit'), 12);
  });

  it('is 0.0 when either side has no text (empty/empty must be 0.0, not 1.0)', () => {
    expect(computeFeatures(mkOriginal({ text: '' }), mkCandidate({ text: 'Save' })).text_similarity).toBe(0.0);
    expect(computeFeatures(mkOriginal({ text: 'Save' }), mkCandidate({ text: '' })).text_similarity).toBe(0.0);
    expect(computeFeatures(mkOriginal({ text: '' }), mkCandidate({ text: '' })).text_similarity).toBe(0.0);
  });
});

describe('null / undefined field handling (real DOM snapshots may omit fields)', () => {
  it('treats null and undefined string fields as empty (similarity 0.0)', () => {
    const fv = computeFeatures(
      mkOriginal({
        text: null as unknown as string,
        element_id: undefined as unknown as string,
        name: null as unknown as string,
        placeholder: undefined as unknown as string,
        aria_label: null as unknown as string,
      }),
      mkCandidate({ text: 'Save', element_id: 'save', name: 'q', placeholder: 'p', aria_label: 'a' }),
    );
    expect(fv.text_similarity).toBe(0.0);
    expect(fv.id_similarity).toBe(0.0);
    expect(fv.attribute_similarity).toBe(0.0);
    expect(Number.isFinite(fv.text_similarity)).toBe(true);

    // candidate-side null is handled symmetrically
    const rev = computeFeatures(
      mkOriginal({ text: 'Save' }),
      mkCandidate({ text: null as unknown as string }),
    );
    expect(rev.text_similarity).toBe(0.0);
  });
});

describe('per-attribute string similarities', () => {
  it('id_similarity is the difflib ratio of element_id (case-insensitive)', () => {
    const fv = computeFeatures(mkOriginal({ element_id: 'username' }), mkCandidate({ element_id: 'user-name' }));
    expect(fv.id_similarity).toBeCloseTo(sim('username', 'user-name'), 12);
    expect(fv.id_similarity).toBeCloseTo(0.9411764705882353, 12);
    const insensitive = computeFeatures(mkOriginal({ element_id: 'SignIn' }), mkCandidate({ element_id: 'signin' }));
    expect(insensitive.id_similarity).toBe(1.0);
  });

  it('name_similarity is the difflib ratio of name', () => {
    const fv = computeFeatures(mkOriginal({ name: 'q' }), mkCandidate({ name: 'query' }));
    expect(fv.name_similarity).toBeCloseTo(sim('q', 'query'), 12);
  });

  it('placeholder_similarity is the difflib ratio of placeholder', () => {
    const fv = computeFeatures(mkOriginal({ placeholder: 'Email address' }), mkCandidate({ placeholder: 'E-mail address' }));
    expect(fv.placeholder_similarity).toBeCloseTo(sim('Email address', 'E-mail address'), 12);
  });

  it('aria_label_similarity is the difflib ratio of aria_label', () => {
    const fv = computeFeatures(mkOriginal({ aria_label: 'Search box' }), mkCandidate({ aria_label: 'Search field' }));
    expect(fv.aria_label_similarity).toBeCloseTo(sim('Search box', 'Search field'), 12);
  });

  it('each attribute similarity is 0.0 when either side is empty', () => {
    const fv = computeFeatures(
      mkOriginal({ element_id: '', name: '', placeholder: '', aria_label: '' }),
      mkCandidate({ element_id: 'x', name: 'y', placeholder: 'z', aria_label: 'w' }),
    );
    expect(fv.id_similarity).toBe(0.0);
    expect(fv.name_similarity).toBe(0.0);
    expect(fv.placeholder_similarity).toBe(0.0);
    expect(fv.aria_label_similarity).toBe(0.0);
  });

  it('attribute_similarity = max(id, name, placeholder, aria_label)', () => {
    const fv = computeFeatures(
      mkOriginal({ element_id: 'totally-different', name: 'user-name', placeholder: 'zzz', aria_label: 'qqq' }),
      mkCandidate({ element_id: 'nothing-alike', name: 'user-name', placeholder: 'aaa', aria_label: 'bbb' }),
    );
    expect(fv.name_similarity).toBe(1.0);
    expect(fv.attribute_similarity).toBe(1.0);
    expect(fv.attribute_similarity).toBe(
      Math.max(fv.id_similarity, fv.name_similarity, fv.placeholder_similarity, fv.aria_label_similarity),
    );
  });

  it('attribute_similarity is 0.0 when all four attributes are empty on one side', () => {
    const fv = computeFeatures(
      mkOriginal({ element_id: '', name: '', placeholder: '', aria_label: '' }),
      mkCandidate({ element_id: 'a', name: 'b', placeholder: 'c', aria_label: 'd' }),
    );
    expect(fv.attribute_similarity).toBe(0.0);
  });
});

describe('class_similarity', () => {
  it('is the difflib ratio of class_name (case-insensitive)', () => {
    const fv = computeFeatures(mkOriginal({ class_name: 'form-control' }), mkCandidate({ class_name: 'form-control input' }));
    expect(fv.class_similarity).toBeCloseTo(sim('form-control', 'form-control input'), 12);
    expect(fv.class_similarity).toBeCloseTo(0.8, 12);
  });

  it('is 0.0 when either class list is empty', () => {
    expect(computeFeatures(mkOriginal({ class_name: '' }), mkCandidate({ class_name: 'btn' })).class_similarity).toBe(0.0);
  });
});

describe('parent_similarity', () => {
  it('is 1.0 for equal parent tags (case-insensitive), 0.0 otherwise', () => {
    expect(computeFeatures(mkOriginal({ parent_tag: 'form' }), mkCandidate({ parent_tag: 'FORM' })).parent_similarity).toBe(1.0);
    expect(computeFeatures(mkOriginal({ parent_tag: 'form' }), mkCandidate({ parent_tag: 'div' })).parent_similarity).toBe(0.0);
  });

  it('is 0.0 when the original parent tag is empty', () => {
    expect(computeFeatures(mkOriginal({ parent_tag: '' }), mkCandidate({ parent_tag: '' })).parent_similarity).toBe(0.0);
  });
});

describe('depth_similarity', () => {
  it('is 1.0 at equal depth', () => {
    expect(computeFeatures(mkOriginal({ dom_depth: 5 }), mkCandidate({ dom_depth: 5 })).depth_similarity).toBe(1.0);
  });

  it('decays as max(0, 1 - |delta| / 10)', () => {
    expect(computeFeatures(mkOriginal({ dom_depth: 5 }), mkCandidate({ dom_depth: 6 })).depth_similarity).toBeCloseTo(0.9, 12);
    expect(computeFeatures(mkOriginal({ dom_depth: 5 }), mkCandidate({ dom_depth: 8 })).depth_similarity).toBeCloseTo(0.7, 12);
    expect(computeFeatures(mkOriginal({ dom_depth: 2 }), mkCandidate({ dom_depth: 7 })).depth_similarity).toBeCloseTo(0.5, 12);
  });

  it('floors at 0.0 for very large depth differences (never negative)', () => {
    expect(computeFeatures(mkOriginal({ dom_depth: 1 }), mkCandidate({ dom_depth: 25 })).depth_similarity).toBe(0.0);
  });

  it('is 0.0 if EITHER depth is 0 (missing-depth guard, not a perfect match)', () => {
    expect(computeFeatures(mkOriginal({ dom_depth: 0 }), mkCandidate({ dom_depth: 5 })).depth_similarity).toBe(0.0);
    expect(computeFeatures(mkOriginal({ dom_depth: 5 }), mkCandidate({ dom_depth: 0 })).depth_similarity).toBe(0.0);
    expect(computeFeatures(mkOriginal({ dom_depth: 0 }), mkCandidate({ dom_depth: 0 })).depth_similarity).toBe(0.0);
  });
});

describe('type_attr_match', () => {
  it('is 1.0 when candidate type_attr equals the original type_attr (case-insensitive)', () => {
    expect(computeFeatures(mkOriginal({ type_attr: 'text' }), mkCandidate({ type_attr: 'TEXT' })).type_attr_match).toBe(1.0);
    expect(computeFeatures(mkOriginal({ type_attr: 'submit' }), mkCandidate({ type_attr: 'button' })).type_attr_match).toBe(0.0);
  });

  it('falls back to the original locator_type when type_attr is empty', () => {
    const original = mkOriginal({ type_attr: '', locator_type: 'text' });
    expect(original.type_attr).toBe('');
    expect(computeFeatures(original, mkCandidate({ type_attr: 'text' })).type_attr_match).toBe(1.0);
    expect(computeFeatures(original, mkCandidate({ type_attr: 'password' })).type_attr_match).toBe(0.0);
  });

  it('prefers type_attr over locator_type when both are present', () => {
    const original = mkOriginal({ type_attr: 'email', locator_type: 'text' });
    expect(computeFeatures(original, mkCandidate({ type_attr: 'email' })).type_attr_match).toBe(1.0);
    expect(computeFeatures(original, mkCandidate({ type_attr: 'text' })).type_attr_match).toBe(0.0);
  });

  it('is 0.0 when both type_attr and locator_type are empty', () => {
    const original = mkOriginal({ type_attr: '', locator_type: '' });
    expect(computeFeatures(original, mkCandidate({ type_attr: '' })).type_attr_match).toBe(0.0);
  });
});

describe('sibling_count_ratio', () => {
  it('normalises the candidate sibling count by 20', () => {
    expect(computeFeatures(mkOriginal(), mkCandidate({ sibling_count: 0 })).sibling_count_ratio).toBe(0.0);
    expect(computeFeatures(mkOriginal(), mkCandidate({ sibling_count: 4 })).sibling_count_ratio).toBeCloseTo(0.2, 12);
    expect(computeFeatures(mkOriginal(), mkCandidate({ sibling_count: 10 })).sibling_count_ratio).toBeCloseTo(0.5, 12);
    expect(computeFeatures(mkOriginal(), mkCandidate({ sibling_count: 20 })).sibling_count_ratio).toBe(1.0);
  });

  it('saturates (caps) at 1.0 for more than 20 siblings', () => {
    expect(computeFeatures(mkOriginal(), mkCandidate({ sibling_count: 24 })).sibling_count_ratio).toBe(1.0);
    expect(computeFeatures(mkOriginal(), mkCandidate({ sibling_count: 200 })).sibling_count_ratio).toBe(1.0);
  });
});

describe('multi_attr_match_count', () => {
  const orig = mkOriginal({ element_id: 'q', name: 'q', placeholder: 'Search', aria_label: 'Search box' });

  it('counts exact id/name/placeholder/aria-label matches as a raw integer', () => {
    const all4 = computeFeatures(orig, mkCandidate({ element_id: 'q', name: 'q', placeholder: 'Search', aria_label: 'Search box' }));
    expect(all4.multi_attr_match_count).toBe(4);
    expect(Number.isInteger(all4.multi_attr_match_count)).toBe(true);
    const two = computeFeatures(orig, mkCandidate({ element_id: 'q2', name: 'q', placeholder: 'Search', aria_label: 'different' }));
    expect(two.multi_attr_match_count).toBe(2);
    const none = computeFeatures(orig, mkCandidate({ element_id: 'x', name: 'y', placeholder: 'z', aria_label: 'w' }));
    expect(none.multi_attr_match_count).toBe(0);
  });

  it('is NOT normalized - the value can exceed 1.0 (unlike the similarity features)', () => {
    const fv = computeFeatures(orig, mkCandidate({ element_id: 'q', name: 'q', placeholder: 'Search', aria_label: 'Search box' }));
    expect(fv.multi_attr_match_count).toBeGreaterThan(1.0);
    expect(fv.multi_attr_match_count).toBe(4);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const fv = computeFeatures(
      mkOriginal({ element_id: 'Login', name: ' User ', placeholder: 'SEARCH', aria_label: 'Box' }),
      mkCandidate({ element_id: 'login', name: 'user', placeholder: 'search', aria_label: '  box  ' }),
    );
    expect(fv.multi_attr_match_count).toBe(4);
  });

  it('does not count an attribute that is empty on one side', () => {
    const fv = computeFeatures(
      mkOriginal({ element_id: 'q', name: '', placeholder: '', aria_label: '' }),
      mkCandidate({ element_id: 'q', name: 'q', placeholder: 'Search', aria_label: 'Search box' }),
    );
    expect(fv.multi_attr_match_count).toBe(1);
  });
});

describe('candidate_text_actionable', () => {
  const orig = mkOriginal({ text: 'anything' });

  it('is 1.0 for an exact actionable phrase (case-insensitive)', () => {
    expect(computeFeatures(orig, mkCandidate({ text: 'Sign in' })).candidate_text_actionable).toBe(1.0);
    expect(computeFeatures(orig, mkCandidate({ text: 'SUBMIT' })).candidate_text_actionable).toBe(1.0);
    expect(computeFeatures(orig, mkCandidate({ text: 'log in' })).candidate_text_actionable).toBe(1.0);
  });

  it('is 0.7 when an actionable phrase is contained in a longer label', () => {
    expect(computeFeatures(orig, mkCandidate({ text: 'Submit Order' })).candidate_text_actionable).toBe(0.7);
    expect(computeFeatures(orig, mkCandidate({ text: 'Proceed to checkout' })).candidate_text_actionable).toBe(0.7);
  });

  it('is 0.0 for non-actionable copy', () => {
    expect(computeFeatures(orig, mkCandidate({ text: 'Lorem ipsum dolor' })).candidate_text_actionable).toBe(0.0);
  });

  it('is 0.0 for empty text or text longer than 50 characters', () => {
    expect(computeFeatures(orig, mkCandidate({ text: '' })).candidate_text_actionable).toBe(0.0);
    expect(computeFeatures(orig, mkCandidate({ text: 'Save '.repeat(20) })).candidate_text_actionable).toBe(0.0);
  });
});

describe('candidate_in_form', () => {
  it('is 1.0 only when the candidate parent tag is a form (case-insensitive)', () => {
    expect(computeFeatures(mkOriginal(), mkCandidate({ parent_tag: 'form' })).candidate_in_form).toBe(1.0);
    expect(computeFeatures(mkOriginal(), mkCandidate({ parent_tag: 'FORM' })).candidate_in_form).toBe(1.0);
    expect(computeFeatures(mkOriginal(), mkCandidate({ parent_tag: 'div' })).candidate_in_form).toBe(0.0);
    expect(computeFeatures(mkOriginal(), mkCandidate({ parent_tag: '' })).candidate_in_form).toBe(0.0);
  });
});

describe('candidate_attr_richness', () => {
  it('is 1.0 when all seven candidate attributes are populated', () => {
    const fv = computeFeatures(mkOriginal(), mkCandidate({
      element_id: 'a', name: 'b', class_name: 'c', placeholder: 'd', aria_label: 'e', type_attr: 'text', value_attr: 'v',
    }));
    expect(fv.candidate_attr_richness).toBeCloseTo(1.0, 12);
  });

  it('is the populated fraction for partially-filled candidates', () => {
    const fv = computeFeatures(mkOriginal(), mkCandidate({
      element_id: 'a', name: 'b', class_name: '', placeholder: '', aria_label: '', type_attr: 'text', value_attr: '',
    }));
    expect(fv.candidate_attr_richness).toBeCloseTo(3 / 7, 12);
  });

  it('is 1/7 for a bare element carrying only an id', () => {
    const fv = computeFeatures(mkOriginal(), mkCandidate({
      element_id: 'only', name: '', class_name: '', placeholder: '', aria_label: '', type_attr: '', value_attr: '',
    }));
    expect(fv.candidate_attr_richness).toBeCloseTo(1 / 7, 12);
  });

  it('treats whitespace-only attributes as unpopulated', () => {
    const fv = computeFeatures(mkOriginal(), mkCandidate({
      element_id: '   ', name: '', class_name: '', placeholder: '', aria_label: '', type_attr: '', value_attr: '',
    }));
    expect(fv.candidate_attr_richness).toBe(0.0);
  });
});

describe('original_attr_count', () => {
  it('is 1.0 when all seven original attributes (incl. text) are populated', () => {
    const fv = computeFeatures(mkOriginal({
      element_id: 'a', name: 'b', class_name: 'c', placeholder: 'd', aria_label: 'e', type_attr: 'text', text: 'Save',
    }), mkCandidate());
    expect(fv.original_attr_count).toBeCloseTo(1.0, 12);
  });

  it('is the populated fraction for a sparse original', () => {
    const fv = computeFeatures(mkOriginal({
      element_id: 'a', name: '', class_name: '', placeholder: '', aria_label: '', type_attr: '', text: '',
    }), mkCandidate());
    expect(fv.original_attr_count).toBeCloseTo(1 / 7, 12);
  });

  it('does not count value_attr or dom_depth (only the 7 documented fields)', () => {
    const fv = computeFeatures(mkOriginal({
      element_id: 'a', name: 'b', class_name: 'c', placeholder: 'd', aria_label: 'e', type_attr: 'text', text: '',
    }), mkCandidate());
    expect(fv.original_attr_count).toBeCloseTo(6 / 7, 12);
  });
});

describe('featureArray', () => {
  it('exposes exactly the 17 named features', () => {
    expect(FEATURE_NAMES).toHaveLength(17);
    const fv = computeFeatures(mkOriginal(), mkCandidate());
    expect(Object.keys(fv).sort()).toEqual([...FEATURE_NAMES].sort());
  });

  it('returns a length-17 array in FEATURE_NAMES order', () => {
    const fv = computeFeatures(
      mkOriginal({ element_id: 'a', name: 'b', dom_depth: 4 }),
      mkCandidate({ element_id: 'a2', name: 'b2', dom_depth: 6, sibling_count: 3 }),
    );
    const arr = featureArray(fv);
    expect(arr).toHaveLength(17);
    expect(arr).toEqual(FEATURE_NAMES.map((n) => fv[n]));
    expect(arr[FEATURE_NAMES.indexOf('tag_match')]).toBe(fv.tag_match);
    expect(arr[FEATURE_NAMES.indexOf('depth_similarity')]).toBe(fv.depth_similarity);
    expect(arr.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('heuristicScore', () => {
  it('the heuristic weights sum to 1.0', () => {
    const total = Object.values(HEURISTIC_WEIGHTS).reduce((a, b) => a + (b as number), 0);
    expect(total).toBeCloseTo(1.0, 12);
  });

  it('only the six weighted features contribute to the score', () => {
    expect(Object.keys(HEURISTIC_WEIGHTS).sort()).toEqual(
      ['attribute_similarity', 'class_similarity', 'depth_similarity', 'parent_similarity', 'tag_match', 'text_similarity'].sort(),
    );
  });

  it('is the weighted sum of the six heuristic features', () => {
    const fv = computeFeatures(
      mkOriginal({ tag: 'input', text: 'Submit', element_id: 'a', class_name: 'btn', parent_tag: 'form', dom_depth: 5 }),
      mkCandidate({ tag: 'input', text: 'Submit', element_id: 'a', class_name: 'btn', parent_tag: 'form', dom_depth: 5 }),
    );
    const expected =
      0.15 * fv.tag_match +
      0.2 * fv.text_similarity +
      0.25 * fv.attribute_similarity +
      0.15 * fv.class_similarity +
      0.15 * fv.parent_similarity +
      0.1 * fv.depth_similarity;
    expect(heuristicScore(fv)).toBeCloseTo(expected, 12);
  });

  it('gives a perfect self-match a score of 1.0', () => {
    const target = mkCandidate({ tag: 'input', text: 'Sign in', element_id: 'username', name: 'user', class_name: 'form-control', placeholder: 'Your username', aria_label: 'Username field', parent_tag: 'form', dom_depth: 4 });
    const original = mkOriginal({ tag: 'input', text: 'Sign in', element_id: 'username', name: 'user', class_name: 'form-control', placeholder: 'Your username', aria_label: 'Username field', parent_tag: 'form', dom_depth: 4, type_attr: 'text' });
    const fv = computeFeatures(original, target);
    expect(heuristicScore(fv)).toBeCloseTo(1.0, 12);
  });

  it('scores a strong match well above a weak one', () => {
    const original = mkOriginal({
      tag: 'input', text: 'Sign in', element_id: 'login-btn', name: 'login',
      class_name: 'btn btn-primary', parent_tag: 'form', dom_depth: 4,
    });
    const strong = computeFeatures(original, mkCandidate({
      tag: 'input', text: 'Sign in', element_id: 'login-btn', name: 'login',
      class_name: 'btn btn-primary', parent_tag: 'form', dom_depth: 5,
    }));
    const weak = computeFeatures(original, mkCandidate({
      tag: 'div', text: 'Footer links', element_id: 'footer', name: '',
      class_name: 'container-fluid', placeholder: '', aria_label: '',
      parent_tag: 'body', dom_depth: 12,
    }));
    expect(heuristicScore(strong)).toBeGreaterThan(0.85);
    expect(heuristicScore(weak)).toBeLessThan(0.2);
    expect(heuristicScore(strong)).toBeGreaterThan(heuristicScore(weak));
  });
});

describe('the full 17-feature vector from a realistic (original, candidate) pair', () => {
  it('computes every feature with the expected value for a renamed-input refactor', () => {
    const original = mkOriginal({
      tag: 'input', text: '', element_id: 'username', name: 'username',
      class_name: 'form-control', placeholder: 'Username', aria_label: 'Username',
      parent_tag: 'form', dom_depth: 3, type_attr: 'text', locator_type: 'id',
    });
    const candidate = mkCandidate({
      tag: 'input', text: '', element_id: 'username-v2', name: 'username',
      class_name: 'input', placeholder: 'Username', aria_label: 'Username',
      type_attr: 'text', value_attr: '', parent_tag: 'div', dom_depth: 4, sibling_count: 0,
    });
    const fv = computeFeatures(original, candidate);

    expect(fv.tag_match).toBe(1.0);
    expect(fv.text_similarity).toBe(0.0);
    expect(fv.id_similarity).toBeCloseTo(sim('username', 'username-v2'), 12);
    expect(fv.name_similarity).toBe(1.0);
    expect(fv.placeholder_similarity).toBe(1.0);
    expect(fv.aria_label_similarity).toBe(1.0);
    expect(fv.attribute_similarity).toBe(1.0);
    expect(fv.class_similarity).toBeCloseTo(sim('form-control', 'input'), 12);
    expect(fv.parent_similarity).toBe(0.0);
    expect(fv.depth_similarity).toBeCloseTo(0.9, 12);
    expect(fv.type_attr_match).toBe(1.0);
    expect(fv.sibling_count_ratio).toBe(0.0);
    expect(fv.multi_attr_match_count).toBe(3);
    expect(fv.candidate_text_actionable).toBe(0.0);
    expect(fv.candidate_in_form).toBe(0.0);
    expect(fv.candidate_attr_richness).toBeCloseTo(6 / 7, 12);
    expect(fv.original_attr_count).toBeCloseTo(6 / 7, 12);

    for (const name of FEATURE_NAMES) {
      const v = fv[name] as number;
      expect(Number.isFinite(v)).toBe(true);
      const max = name === 'multi_attr_match_count' ? 4 : 1;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(max);
    }
  });
});
