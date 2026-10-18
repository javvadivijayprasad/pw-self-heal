/**
 * Candidate extraction. The Python service parses HTML with BeautifulSoup
 * server-side; here we support TWO entry points that share ONE set of rules:
 *
 *  - {@link extractCandidates} runs extraction inside the live page via
 *    `page.evaluate`, reading the live DOM directly (the online path).
 *  - {@link extractCandidatesFromHtml} runs the SAME extraction over a saved
 *    HTML string parsed in Node with the optional `linkedom` package (the
 *    offline path used by consumers that heal AFTER the run, from captured
 *    HTML, when the live `page` is gone).
 *
 * Both paths call the single self-contained {@link extractionProgram}, so the
 * rules (preferred-tag priority, structural-tag skip, dedupe by element id,
 * cap at maxCandidates, the per-field capture, test-id auto-detection) are
 * defined exactly once and can never drift between online and offline.
 *
 * Mirrors `candidate_extractor.py`: preferred-tag priority, structural-tag
 * skip, dedupe by element id, cap at maxCandidates. Also captures the test-id,
 * a best-effort ARIA role, and an accessible-name approximation so the
 * locator-first healer can match on a locator's expressed intent.
 */

import type { CandidateElement } from './types';

/** Minimal slice of the Playwright Page API we depend on. */
export interface EvaluatablePage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/** The library's default test-id attribute; drives auto-detection opt-in. */
export const DEFAULT_TESTID_ATTRIBUTE = 'data-testid';

/**
 * Fallback test-id attributes probed (in order) when `data-testid` is the
 * configured attribute but is absent from the page/HTML. The first one that is
 * present wins. An explicitly-configured attribute (anything other than the
 * default) disables auto-detection and is always used verbatim.
 */
export const TESTID_FALLBACK_ATTRIBUTES = ['data-test', 'data-cy', 'data-qa', 'data-test-id'];

export const PREFERRED_TAGS = [
  'input', 'button', 'a', 'select', 'textarea', 'label', 'div', 'span',
  // P1-1: assertions frequently target headings (product names are often h5),
  // list items (page markers sit on li), and images (product images are img).
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'img',
];

/** Arguments passed to {@link extractionProgram}. */
interface ExtractionArgs {
  maxCandidates: number;
  testIdAttribute: string;
  preferredTags: string[];
  /** When true, auto-detect the test-id attribute if the configured one is absent. */
  autoDetect: boolean;
  /**
   * DOM root to read from. Supplied ONLY on the offline (Node) path, where a
   * non-serializable `linkedom` document is passed by direct call. On the live
   * path this is left undefined and the browser's global `document` is used —
   * which is why `args` must stay JSON-serializable for `page.evaluate`.
   */
  root?: unknown;
}

/** What {@link extractionProgram} returns: the candidates + the attr actually used. */
interface ExtractionResult {
  candidates: CandidateElement[];
  /** The effective test-id attribute (post auto-detection). */
  testIdAttributeUsed: string;
}

/**
 * The single source of truth for extraction. Entirely self-contained (every
 * helper is nested) so Playwright can serialize it to run inside the browser,
 * AND so it can be invoked directly in Node against a `linkedom` document.
 *
 * On the live path Playwright serializes this function and runs it in the page,
 * where `args.root` is undefined and the global `document` is used (no `eval`,
 * CSP-safe). On the offline path it is called directly with `args.root` set to
 * the parsed document.
 */
function extractionProgram(args: ExtractionArgs): ExtractionResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: Document = (args.root as Document) || (document as Document);
  const { maxCandidates, preferredTags, autoDetect } = args;

  const NON_CANDIDATE = new Set([
    'html', 'head', 'body', 'script', 'style', 'meta', 'title', 'link', 'base', 'noscript',
  ]);

  // --- test-id auto-detection ------------------------------------------------
  // Explicit (non-default) attribute always wins; auto-detect only kicks in
  // when the configured attribute is the library default AND absent from the DOM.
  let testIdAttribute = args.testIdAttribute;
  if (autoDetect && !doc.querySelector('[' + testIdAttribute + ']')) {
    const fallbacks = ['data-test', 'data-cy', 'data-qa', 'data-test-id'];
    for (const attr of fallbacks) {
      if (doc.querySelector('[' + attr + ']')) {
        testIdAttribute = attr;
        break;
      }
    }
  }

  // Collapse internal whitespace runs (incl. newlines/tabs) to a single space
  // and trim. This both (a) matches Playwright's own text-matching semantics
  // (getByText normalizes whitespace) and (b) guarantees that aggregated text
  // from multi-child containers is IDENTICAL across the live DOM (`innerText`)
  // and the offline parser (`textContent`), which normalize inter-node
  // whitespace differently — the precondition for live/offline parity.
  function normText(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }
  function depth(el: Element): number {
    let d = 0;
    let p = el.parentElement;
    while (p) {
      d++;
      p = p.parentElement;
    }
    return d;
  }
  function siblingCount(el: Element): number {
    const parent = el.parentElement;
    if (!parent) return 0;
    let n = 0;
    for (const child of Array.from(parent.children)) {
      if (child.tagName === el.tagName) n++;
    }
    return n - 1;
  }
  function cssHint(el: Element): string {
    let hint = el.tagName.toLowerCase();
    if (el.id) hint += `#${el.id}`;
    else if (el.className && typeof el.className === 'string') {
      hint += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return hint;
  }
  function implicitRole(el: Element): string {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (['', 'text', 'email', 'tel', 'url', 'password', 'search'].includes(type)) return 'textbox';
    }
    return '';
  }
  function accName(el: Element): string {
    const e = el as HTMLElement;
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const txt = normText(e.innerText || el.textContent || '');
    if (txt) return txt.slice(0, 200);
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const val = el.getAttribute('value');
    return val ? val.trim() : '';
  }
  function toCandidate(el: Element) {
    const e = el as HTMLElement;
    return {
      tag: el.tagName.toLowerCase(),
      text: normText(e.innerText || el.textContent || '').slice(0, 200),
      element_id: el.id || '',
      name: el.getAttribute('name') || '',
      class_name: typeof el.className === 'string' ? el.className : '',
      placeholder: el.getAttribute('placeholder') || '',
      aria_label: el.getAttribute('aria-label') || '',
      type_attr: el.getAttribute('type') || '',
      value_attr: el.getAttribute('value') || '',
      parent_tag: el.parentElement ? el.parentElement.tagName.toLowerCase() : '',
      dom_depth: depth(el),
      sibling_count: siblingCount(el),
      css_path_hint: cssHint(el),
      test_id: el.getAttribute(testIdAttribute) || '',
      role: implicitRole(el),
      acc_name: accName(el),
    };
  }

  const out: ReturnType<typeof toCandidate>[] = [];
  const seenIds = new Set<string>();
  const push = (el: Element) => {
    const cand = toCandidate(el);
    if (cand.element_id && seenIds.has(cand.element_id)) return;
    if (cand.element_id) seenIds.add(cand.element_id);
    out.push(cand);
  };

  for (const tagName of preferredTags) {
    if (out.length >= maxCandidates) break;
    for (const el of Array.from(doc.getElementsByTagName(tagName))) {
      if (out.length >= maxCandidates) break;
      push(el);
    }
  }
  if (out.length < maxCandidates) {
    // querySelectorAll('*') is used (not getElementsByTagName('*')) so the
    // structural fallback behaves identically on the live DOM and on the
    // offline parser; both return elements in document order.
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      if (out.length >= maxCandidates) break;
      const tag = el.tagName.toLowerCase();
      if (preferredTags.includes(tag)) continue;
      if (NON_CANDIDATE.has(tag)) continue;
      push(el);
    }
  }
  return { candidates: out as CandidateElement[], testIdAttributeUsed: testIdAttribute };
}

/** Attributes whose auto-detection has already been logged (one-time, per attr). */
const loggedAutoDetect = new Set<string>();

/** One-time-per-attribute telemetry when auto-detection changes the test-id attr. */
function noteTestIdAttribute(used: string, configured: string): void {
  if (used === configured) return;
  if (loggedAutoDetect.has(used)) return;
  loggedAutoDetect.add(used);
  // eslint-disable-next-line no-console
  console.log(
    `[pw-self-heal] test-id attribute auto-detected: "${used}" ("${configured}" not present on the page/HTML).`,
  );
}

export async function extractCandidates(
  page: EvaluatablePage,
  maxCandidates = 200,
  testIdAttribute = DEFAULT_TESTID_ATTRIBUTE,
  preferredTags: string[] = PREFERRED_TAGS,
): Promise<CandidateElement[]> {
  const autoDetect = testIdAttribute === DEFAULT_TESTID_ATTRIBUTE;
  // `extractionProgram` is passed by reference: Playwright serializes it to run
  // in the page (no `root` → browser `document`); the in-process test fake runs
  // it against the ambient DOM. Either way the SAME rules apply.
  const raw = (await page.evaluate(extractionProgram, {
    maxCandidates,
    testIdAttribute,
    preferredTags,
    autoDetect,
  } as ExtractionArgs)) as unknown;
  // Backward-compatible: a caller (or test double) whose `evaluate` returns a
  // raw CandidateElement[] (the pre-P0-4 contract) is still honoured. The real
  // program returns { candidates, testIdAttributeUsed }.
  if (Array.isArray(raw)) return raw as CandidateElement[];
  const result = raw as ExtractionResult;
  noteTestIdAttribute(result.testIdAttributeUsed, testIdAttribute);
  return result.candidates;
}

/**
 * Offline extraction from a saved HTML string, for consumers that heal AFTER a
 * run (the live `page` is gone). Applies the EXACT same rules as
 * {@link extractCandidates} — they share {@link extractionProgram}.
 *
 * Requires the optional `linkedom` package (a dependency-light DOM parser),
 * loaded lazily, exactly like the optional `onnxruntime-node` peer. If it is
 * not installed a clear, actionable error is thrown.
 */
export async function extractCandidatesFromHtml(
  html: string,
  opts: { maxCandidates?: number; testIdAttribute?: string; preferredTags?: string[] } = {},
): Promise<CandidateElement[]> {
  const maxCandidates = opts.maxCandidates ?? 200;
  const testIdAttribute = opts.testIdAttribute ?? DEFAULT_TESTID_ATTRIBUTE;
  const preferredTags = opts.preferredTags ?? PREFERRED_TAGS;
  const autoDetect = testIdAttribute === DEFAULT_TESTID_ATTRIBUTE;

  // Typed as `string` so tsc treats the dynamic import as an optional module
  // (resolved at runtime), matching the `onnxruntime-node` pattern in ranker.ts.
  const LINKEDOM_MODULE: string = 'linkedom';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parseHTML: (html: string) => { document: any };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linkedom: any = await import(LINKEDOM_MODULE);
    parseHTML = linkedom.parseHTML;
  } catch {
    throw new Error(
      "extractCandidatesFromHtml requires the optional 'linkedom' package — npm install linkedom",
    );
  }

  const { document: doc } = parseHTML(html);
  const result = extractionProgram({
    maxCandidates,
    testIdAttribute,
    preferredTags,
    autoDetect,
    root: doc,
  });
  noteTestIdAttribute(result.testIdAttributeUsed, testIdAttribute);
  return result.candidates;
}
