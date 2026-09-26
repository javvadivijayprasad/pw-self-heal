// @vitest-environment happy-dom
/**
 * W3 — unit tests for 17-feature vector extraction from DOM snapshots.
 *
 * `tests/features.test.ts` pins `computeFeatures` against pre-serialized
 * Python reference rows. These tests close the other half of the loop: they
 * drive the *extractor* over real DOM snapshots (happy-dom) and assert that
 * the resulting `CandidateElement`s produce well-formed, correctly-valued
 * 17-feature vectors — i.e. the snapshot -> candidate -> feature pipeline the
 * ONNX model actually consumes at runtime.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractCandidates, type EvaluatablePage } from '../src/candidateExtractor';
import { computeFeatures, featureArray, heuristicScore, FEATURE_NAMES } from '../src/features';
import type { CandidateElement, FeatureVector, LocatorMetadata } from '../src/types';

/**
 * A fake Playwright `Page` whose `evaluate` runs the callback in-process
 * against the happy-dom document, exactly as the browser would.
 */
function snapshot(html: string): EvaluatablePage {
  document.body.innerHTML = html;
  return {
    evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R> {
      return Promise.resolve(fn(arg));
    },
  };
}

/** Promote an extracted candidate to the original-locator metadata shape. */
function asOriginal(c: CandidateElement, locatorType = 'id'): LocatorMetadata {
  return {
    tag: c.tag,
    text: c.text,
    element_id: c.element_id,
    name: c.name,
    class_name: c.class_name,
    placeholder: c.placeholder,
    aria_label: c.aria_label,
    parent_tag: c.parent_tag,
    dom_depth: c.dom_depth,
    type_attr: c.type_attr,
    locator_type: locatorType,
  };
}

const byId = (cands: CandidateElement[], id: string): CandidateElement => {
  const found = cands.find((c) => c.element_id === id);
  if (!found) throw new Error(`no candidate with id ${id}`);
  return found;
};

const LOGIN_FORM = `
  <form id="login">
    <label for="user">Username</label>
    <input id="user" name="username" class="form-control input-lg"
           placeholder="Your name" type="text" value=""
           aria-label="Username field" data-testid="user-input">
    <button id="submit-btn" class="btn primary" type="submit">Sign in</button>
  </form>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractCandidates: DOM snapshot -> CandidateElement', () => {
  it('captures every field the feature extractor reads', async () => {
    const cands = await extractCandidates(snapshot(LOGIN_FORM));
    const input = byId(cands, 'user');

    expect(input).toEqual({
      tag: 'input',
      text: '',
      element_id: 'user',
      name: 'username',
      class_name: 'form-control input-lg',
      placeholder: 'Your name',
      aria_label: 'Username field',
      type_attr: 'text',
      value_attr: '',
      parent_tag: 'form',
      dom_depth: 3,
      sibling_count: 0,
      css_path_hint: 'input#user',
      test_id: 'user-input',
      role: 'textbox',
      acc_name: 'Username field',
    });
  });

  it('captures button text, role and accessible name', async () => {
    const cands = await extractCandidates(snapshot(LOGIN_FORM));
    const button = byId(cands, 'submit-btn');

    expect(button.tag).toBe('button');
    expect(button.text).toBe('Sign in');
    expect(button.role).toBe('button');
    expect(button.acc_name).toBe('Sign in');
    expect(button.type_attr).toBe('submit');
    expect(button.css_path_hint).toBe('button#submit-btn');
    expect(button.parent_tag).toBe('form');
  });

  it('emits preferred tags first, then everything else', async () => {
    const cands = await extractCandidates(
      snapshot('<section><div id="d"></div><input id="i"><span id="s"></span></section>'),
    );
    const tags = cands.map((c) => c.tag);

    expect(tags.indexOf('input')).toBe(0);
    expect(tags.indexOf('div')).toBeLessThan(tags.indexOf('span'));
    expect(tags.indexOf('section')).toBeGreaterThan(tags.indexOf('span'));
  });

  it('skips structural / non-candidate tags', async () => {
    const cands = await extractCandidates(
      snapshot('<script>var a=1;</script><style>.a{}</style><noscript>x</noscript><div id="d"></div>'),
    );
    const tags = cands.map((c) => c.tag);

    expect(tags).toContain('div');
    for (const t of ['html', 'head', 'body', 'script', 'style', 'noscript']) {
      expect(tags).not.toContain(t);
    }
  });

  it('dedupes by element id, keeping the first (preferred-tag) hit', async () => {
    const cands = await extractCandidates(
      snapshot('<span id="dup">a</span><div id="dup">b</div>'),
    );
    const dups = cands.filter((c) => c.element_id === 'dup');

    expect(dups).toHaveLength(1);
    expect(dups[0].tag).toBe('div'); // div is earlier in PREFERRED_TAGS than span
  });

  it('respects maxCandidates', async () => {
    const html = Array.from({ length: 12 }, (_, i) => `<input id="i${i}">`).join('');
    const cands = await extractCandidates(snapshot(html), 3);

    expect(cands).toHaveLength(3);
  });

  it('respects a custom test-id attribute', async () => {
    const page = snapshot('<button id="b" data-qa="save-btn" data-testid="ignored">Save</button>');
    const cands = await extractCandidates(page, 200, 'data-qa');

    expect(byId(cands, 'b').test_id).toBe('save-btn');
  });

  it('respects a custom preferred-tag list', async () => {
    const page = snapshot('<div id="d"></div><input id="i">');
    const cands = await extractCandidates(page, 200, 'data-testid', ['div']);

    expect(cands[0].tag).toBe('div');
  });

  it('derives implicit ARIA roles per tag/type', async () => {
    const cands = await extractCandidates(
      snapshot(`
        <button id="r-button">b</button>
        <a id="r-link" href="/x">x</a>
        <a id="r-anchor">x</a>
        <select id="r-select"></select>
        <textarea id="r-textarea"></textarea>
        <img id="r-img" alt="i">
        <h3 id="r-heading">h</h3>
        <input id="r-text" type="text">
        <input id="r-bare">
        <input id="r-email" type="email">
        <input id="r-checkbox" type="checkbox">
        <input id="r-radio" type="radio">
        <input id="r-range" type="range">
        <input id="r-submit" type="submit" value="Go">
        <div id="r-explicit" role="alert">!</div>
        <p id="r-none">p</p>`),
    );
    const roleOf = (id: string) => byId(cands, id).role;

    expect(roleOf('r-button')).toBe('button');
    expect(roleOf('r-link')).toBe('link');
    expect(roleOf('r-anchor')).toBe('');
    expect(roleOf('r-select')).toBe('combobox');
    expect(roleOf('r-textarea')).toBe('textbox');
    expect(roleOf('r-img')).toBe('img');
    expect(roleOf('r-heading')).toBe('heading');
    expect(roleOf('r-text')).toBe('textbox');
    expect(roleOf('r-bare')).toBe('textbox');
    expect(roleOf('r-email')).toBe('textbox');
    expect(roleOf('r-checkbox')).toBe('checkbox');
    expect(roleOf('r-radio')).toBe('radio');
    expect(roleOf('r-range')).toBe('slider');
    expect(roleOf('r-submit')).toBe('button');
    expect(roleOf('r-explicit')).toBe('alert');
    expect(roleOf('r-none')).toBe('');
  });

  it('resolves the accessible name by precedence', async () => {
    const cands = await extractCandidates(
      snapshot(`
        <button id="a-aria" aria-label="From aria">From text</button>
        <button id="a-text" placeholder="From placeholder">From text</button>
        <input id="a-placeholder" placeholder="From placeholder">
        <img id="a-alt" alt="From alt">
        <div id="a-title" title="From title"></div>
        <input id="a-value" type="submit" value="From value">
        <div id="a-empty"></div>`),
    );
    const nameOf = (id: string) => byId(cands, id).acc_name;

    expect(nameOf('a-aria')).toBe('From aria');
    expect(nameOf('a-text')).toBe('From text');
    expect(nameOf('a-placeholder')).toBe('From placeholder');
    expect(nameOf('a-alt')).toBe('From alt');
    expect(nameOf('a-title')).toBe('From title');
    expect(nameOf('a-value')).toBe('From value');
    expect(nameOf('a-empty')).toBe('');
  });

  it('builds css path hints from id, then classes, then tag alone', async () => {
    const cands = await extractCandidates(
      snapshot('<div id="h-id" class="x y"></div><div class="a b c"></div><div></div>'),
    );
    const divs = cands.filter((c) => c.tag === 'div');

    expect(divs[0].css_path_hint).toBe('div#h-id');
    expect(divs[1].css_path_hint).toBe('div.a.b'); // first two classes only
    expect(divs[2].css_path_hint).toBe('div');
  });

  it('computes dom_depth and sibling_count from the snapshot tree', async () => {
    const cands = await extractCandidates(
      snapshot('<div id="l1"><div id="l2"><div id="l3"><span id="s1"></span><span id="s2"></span><span id="s3"></span></div></div></div>'),
    );

    expect(byId(cands, 'l1').dom_depth).toBe(2); // body > html
    expect(byId(cands, 'l2').dom_depth).toBe(3);
    expect(byId(cands, 'l3').dom_depth).toBe(4);
    expect(byId(cands, 's1').dom_depth).toBe(5);
    expect(byId(cands, 's1').sibling_count).toBe(2);
    expect(byId(cands, 'l2').sibling_count).toBe(0);
  });
});

describe('17-feature vectors computed from DOM snapshots', () => {
  it('produces exactly the 17 named features, in FEATURE_NAMES order', async () => {
    const cands = await extractCandidates(snapshot(LOGIN_FORM));
    const original = asOriginal(byId(cands, 'user'));

    for (const cand of cands) {
      const fv = computeFeatures(original, cand);
      expect(Object.keys(fv).sort()).toEqual([...FEATURE_NAMES].sort());

      const arr = featureArray(fv);
      expect(arr).toHaveLength(17);
      expect(arr).toEqual(FEATURE_NAMES.map((n) => fv[n]));
    }
  });

  it('keeps every feature finite and inside its documented range', async () => {
    const cands = await extractCandidates(snapshot(LOGIN_FORM));
    const original = asOriginal(byId(cands, 'user'));

    for (const cand of cands) {
      const fv = computeFeatures(original, cand);
      for (const name of FEATURE_NAMES) {
        const v = fv[name] as number;
        expect(Number.isFinite(v), `${name} finite`).toBe(true);
        const max = name === 'multi_attr_match_count' ? 4 : 1;
        expect(v, `${name} >= 0`).toBeGreaterThanOrEqual(0);
        expect(v, `${name} <= ${max}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('scores an element against its own snapshot as a perfect self-match', async () => {
    const cands = await extractCandidates(snapshot(LOGIN_FORM));
    const target = byId(cands, 'user');
    const fv = computeFeatures(asOriginal(target), target);

    expect(fv.tag_match).toBe(1.0);
    expect(fv.attribute_similarity).toBe(1.0);
    expect(fv.id_similarity).toBe(1.0);
    expect(fv.name_similarity).toBe(1.0);
    expect(fv.placeholder_similarity).toBe(1.0);
    expect(fv.aria_label_similarity).toBe(1.0);
    expect(fv.class_similarity).toBe(1.0);
    expect(fv.parent_similarity).toBe(1.0);
    expect(fv.depth_similarity).toBe(1.0);
    expect(fv.type_attr_match).toBe(1.0);
    expect(fv.multi_attr_match_count).toBe(4);
    expect(fv.candidate_in_form).toBe(1.0);
  });

  it('ranks the renamed-but-equivalent element top across a refactor', async () => {
    const before = await extractCandidates(
      snapshot(`
        <form id="login">
          <input id="username" name="username" class="form-control" placeholder="Username" type="text">
          <input id="password" name="password" class="form-control" placeholder="Password" type="password">
          <button id="signin" class="btn btn-primary" type="submit">Sign in</button>
        </form>`),
    );
    const original = asOriginal(byId(before, 'username'));

    const after = await extractCandidates(
      snapshot(`
        <form id="login-v2">
          <div class="field"><input id="username-v2" name="username" class="input" placeholder="Username" type="text"></div>
          <div class="field"><input id="password-v2" name="password" class="input" placeholder="Password" type="password"></div>
          <button id="signin-v2" class="btn" type="submit">Sign in</button>
        </form>`),
    );

    const scored = after
      .map((candidate) => ({ candidate, score: heuristicScore(computeFeatures(original, candidate)) }))
      .sort((a, b) => b.score - a.score);

    expect(scored[0].candidate.element_id).toBe('username-v2');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });
});

describe('individual features, driven from DOM snapshots', () => {
  async function pair(
    originalHtml: string,
    originalId: string,
    candidateHtml: string,
    candidateId: string,
  ): Promise<FeatureVector> {
    const before = await extractCandidates(snapshot(originalHtml));
    const original = asOriginal(byId(before, originalId));
    const after = await extractCandidates(snapshot(candidateHtml));
    return computeFeatures(original, byId(after, candidateId));
  }

  it('tag_match and parent_similarity are exact-match indicators', async () => {
    const same = await pair(
      '<form id="f"><input id="a" type="text"></form>',
      'a',
      '<form id="f"><input id="b" type="text"></form>',
      'b',
    );
    expect(same.tag_match).toBe(1.0);
    expect(same.parent_similarity).toBe(1.0);

    const different = await pair(
      '<form id="f"><input id="a" type="text"></form>',
      'a',
      '<div id="d"><button id="b">x</button></div>',
      'b',
    );
    expect(different.tag_match).toBe(0.0);
    expect(different.parent_similarity).toBe(0.0);
  });

  it('candidate_in_form flags form descendants only', async () => {
    const inForm = await pair(
      '<form id="f"><input id="a"></form>',
      'a',
      '<form id="f"><input id="b"></form>',
      'b',
    );
    expect(inForm.candidate_in_form).toBe(1.0);

    const outsideForm = await pair(
      '<form id="f"><input id="a"></form>',
      'a',
      '<div id="d"><input id="b"></div>',
      'b',
    );
    expect(outsideForm.candidate_in_form).toBe(0.0);
  });

  it('depth_similarity decays 0.1 per level of nesting drift', async () => {
    const original = '<form id="f"><input id="a"></form>'; // depth 3
    const oneDeeper = await pair(original, 'a', '<form id="f"><div><input id="b"></div></form>', 'b');
    expect(oneDeeper.depth_similarity).toBeCloseTo(0.9, 10);

    const threeDeeper = await pair(
      original,
      'a',
      '<form id="f"><div><div><div><input id="b"></div></div></div></form>',
      'b',
    );
    expect(threeDeeper.depth_similarity).toBeCloseTo(0.7, 10);

    const sameDepth = await pair(original, 'a', '<form id="f"><input id="b"></form>', 'b');
    expect(sameDepth.depth_similarity).toBe(1.0);
  });

  it('sibling_count_ratio normalises by 20 and saturates at 1.0', async () => {
    const five = `<form id="f">${Array.from({ length: 5 }, (_, i) => `<input id="s${i}">`).join('')}</form>`;
    const fv5 = await pair('<form id="f"><input id="a"></form>', 'a', five, 's0');
    expect(fv5.sibling_count_ratio).toBeCloseTo(0.2, 10); // 4 siblings / 20

    const many = `<form id="f">${Array.from({ length: 25 }, (_, i) => `<input id="m${i}">`).join('')}</form>`;
    const fv25 = await pair('<form id="f"><input id="a"></form>', 'a', many, 'm0');
    expect(fv25.sibling_count_ratio).toBe(1.0); // 24 / 20 clamped
  });

  it('multi_attr_match_count counts exact id/name/placeholder/aria-label hits', async () => {
    const all4 = await pair(
      '<input id="q" name="q" placeholder="Search" aria-label="Search box">',
      'q',
      '<input id="q" name="q" placeholder="Search" aria-label="Search box" class="new">',
      'q',
    );
    expect(all4.multi_attr_match_count).toBe(4);

    const two = await pair(
      '<input id="q" name="q" placeholder="Search" aria-label="Search box">',
      'q',
      '<input id="q2" name="q" placeholder="Search" aria-label="Find">',
      'q2',
    );
    expect(two.multi_attr_match_count).toBe(2);

    const none = await pair('<input id="q" name="q">', 'q', '<input id="z" name="z">', 'z');
    expect(none.multi_attr_match_count).toBe(0);
  });

  it('candidate_text_actionable grades button copy from the snapshot', async () => {
    const orig = '<button id="a">Sign in</button>';
    const exact = await pair(orig, 'a', '<button id="b">Sign in</button>', 'b');
    expect(exact.candidate_text_actionable).toBe(1.0);

    const contains = await pair(orig, 'a', '<button id="b">Submit Order</button>', 'b');
    expect(contains.candidate_text_actionable).toBe(0.7);

    const inert = await pair(orig, 'a', '<button id="b">Lorem ipsum dolor</button>', 'b');
    expect(inert.candidate_text_actionable).toBe(0.0);

    const tooLong = await pair(
      orig,
      'a',
      `<button id="b">${'Save '.repeat(20)}</button>`,
      'b',
    );
    expect(tooLong.candidate_text_actionable).toBe(0.0); // > 50 chars
  });

  it('candidate_attr_richness is the populated fraction of 7 candidate attrs', async () => {
    const rich = await pair(
      '<input id="a">',
      'a',
      '<input id="b" name="n" class="c" placeholder="p" aria-label="al" type="text" value="v">',
      'b',
    );
    expect(rich.candidate_attr_richness).toBeCloseTo(1.0, 10);

    const partial = await pair('<input id="a">', 'a', '<input id="b" name="n" type="text">', 'b');
    expect(partial.candidate_attr_richness).toBeCloseTo(3 / 7, 10);

    const bare = await pair('<input id="a">', 'a', '<div id="b"></div>', 'b');
    expect(bare.candidate_attr_richness).toBeCloseTo(1 / 7, 10); // element_id only
  });

  it('original_attr_count is the populated fraction of 7 original attrs', async () => {
    const rich = await pair(
      '<button id="a" name="n" class="c" placeholder="p" aria-label="al" type="submit">Save</button>',
      'a',
      '<button id="b">Save</button>',
      'b',
    );
    expect(rich.original_attr_count).toBeCloseTo(1.0, 10); // all 7 incl. text

    const sparse = await pair('<div id="a"></div>', 'a', '<div id="b"></div>', 'b');
    expect(sparse.original_attr_count).toBeCloseTo(1 / 7, 10);
  });

  it('type_attr_match falls back to locator_type when the original has no type', async () => {
    const before = await extractCandidates(snapshot('<div id="a"></div>'));
    const after = await extractCandidates(snapshot('<input id="b" type="text">'));
    const original = asOriginal(byId(before, 'a'), 'text');

    expect(original.type_attr).toBe('');
    expect(computeFeatures(original, byId(after, 'b')).type_attr_match).toBe(1.0);
  });

  it('text_similarity is 0 when either side has no text', async () => {
    const fv = await pair('<input id="a">', 'a', '<button id="b">Save</button>', 'b');
    expect(fv.text_similarity).toBe(0.0);
  });

  it('attribute_similarity is the max of the four attribute similarities', async () => {
    const fv = await pair(
      '<input id="username" name="user-name" placeholder="Username" aria-label="Username">',
      'username',
      '<input id="totally-different" name="user-name" placeholder="zzz" aria-label="qqq">',
      'totally-different',
    );
    expect(fv.name_similarity).toBe(1.0);
    expect(fv.attribute_similarity).toBe(1.0);
    expect(fv.attribute_similarity).toBe(
      Math.max(fv.id_similarity, fv.name_similarity, fv.placeholder_similarity, fv.aria_label_similarity),
    );
  });
});
