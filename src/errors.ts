/**
 * Error classification for self-healing.
 *
 * Shared by both healing paths (string-selector in heal.ts and locator-first in
 * locator.ts). Lives in its own module so heal.ts and locator.ts can both import
 * it without creating an import cycle (heal.ts already imports from locator.ts).
 *
 * Precedence (highest first — the FIRST matching class wins):
 *   1. STALE / CONTEXT-RESTART — the execution context, page, frame, or element
 *      was torn down out from under the action: a navigation destroyed the
 *      execution context, the page crashed or closed, the browser context
 *      restarted, a frame detached, or the element went stale (detached from the
 *      DOM). Checked FIRST on purpose: several of these messages ("Target
 *      closed", "element is not attached…") overlap with retryable phrasing, yet
 *      a dead context is never merely "retry in a moment". A cached heal bound to
 *      the old context must be INVALIDATED and the action re-resolved on the LIVE
 *      page, and a heal must never be fabricated against a destroyed context.
 *   2. HEALABLE — the locator resolved to zero elements (the classic heal trigger).
 *   3. RETRYABLE — the element exists but is not actionable YET (not visible,
 *      covered by another element, disabled, off-screen, mid-navigation).
 *   4. LOADING — an assertion failed on an element that is still loading:
 *      empty/placeholder-like, inside a skeleton/shimmer/spinner wrapper, or
 *      marked `aria-busy="true"`. A refinement of ASSERTION: the value didn't
 *      match because the UI hadn't settled, so the fix is to WAIT, not to change
 *      the locator or treat it as a hard defect.
 *   5. ASSERTION — the locator resolved fine but a value/text/class/attribute/
 *      count didn't match (a Playwright `expect(...)` failure). NEVER healable by
 *      changing the locator: the element was found, the expectation was wrong (or
 *      the state lives on a different element — see `diagnose` / `stateElsewhere`).
 *   6. FATAL — a real defect; never swallowed.
 *
 * BACKWARD COMPATIBILITY: `'assertion'` and `'loading'` are additive. The old
 * four classes (`'stale' | 'healable' | 'retryable' | 'fatal'`) behave exactly as
 * before, so existing `switch`/`if` consumers keep working. Consumers that do NOT
 * explicitly handle the two new classes should treat them as `'fatal'` (i.e. a
 * failure to surface, not something to auto-heal or silently retry).
 */
export type ErrorClass =
  | 'stale'
  | 'healable'
  | 'retryable'
  | 'loading'
  | 'assertion'
  | 'fatal';

import type { EvaluatablePage } from './candidateExtractor';
import type { HealOutcome } from './types';

/**
 * Stale / context-restart signatures. Matched case-INSENSITIVELY because
 * Playwright varies the capitalisation of these across versions and surfaces
 * (e.g. "Target closed" vs "target closed", "Element is not attached to the
 * DOM" vs lower-case). Mirrors the messages Playwright throws when the context
 * is gone.
 */
const STALE_PATTERNS = [
  'execution context was destroyed',
  'target closed',
  'target page, context or browser has been closed',
  'target crashed',
  'navigation failed because page was closed',
  'frame was detached',
  'element is not attached to the dom',
];

const HEALABLE_PATTERNS = [
  'waiting for locator',
  'No element matches',
  'resolved to 0 elements',
  'no matching selector',
  'failed to find element',
];

const RETRYABLE_PATTERNS = [
  'not visible',
  'intercepts pointer events',
  'is not enabled',
  'is outside of the viewport',
  'navigating',
];

/** expect() matchers that signal a value-level assertion (not a locator fault). */
const ASSERTION_MATCHERS =
  /\b(toHaveText|toBeTruthy|toHaveClass|toHaveCount|toHaveAttribute|toEqual|toBe)\b/;

/** Class names / ARIA state that indicate a still-loading, placeholder element. */
const LOADING_CLASS_RE = /skeleton|placeholder|shimmer|loading|spinner/i;

/**
 * True when the message is a Playwright `expect(...)` assertion failure: it has a
 * `Received:` line, and/or an `expect(` call paired with one of the known value
 * matchers. These mean the locator RESOLVED but a value didn't match — so the
 * fix is never "change the locator".
 */
export function isAssertionMessage(msg: string): boolean {
  if (/(^|\n)\s*Received[^:\n]*:/.test(msg)) return true;
  if (/expect\(/.test(msg) && ASSERTION_MATCHERS.test(msg)) return true;
  return false;
}

/**
 * True when the message alone carries a loading signal: a skeleton/shimmer/
 * spinner/loading/placeholder class name, or `aria-busy="true"`. Used to
 * downgrade an assertion to `loading` even when no live DOM is available.
 */
export function messageHasLoadingSignal(msg: string): boolean {
  if (/aria-busy\s*=?\s*["']?\s*true/i.test(msg)) return true;
  return LOADING_CLASS_RE.test(msg);
}

/**
 * Classify an error.
 *
 * `loadingSignal` is an OPTIONAL second argument supplied by {@link diagnose}
 * after it has inspected the live DOM (skeleton ancestor, `aria-busy`, empty
 * element next to populated siblings). It only ever downgrades an ASSERTION to
 * LOADING; it never affects the other classes. Callers that pass a single
 * argument (every pre-existing caller) are unaffected.
 */
export function classifyError(err: unknown, loadingSignal = false): ErrorClass {
  const msg = (err as Error)?.message ?? (typeof err === 'string' ? err : '');
  const lower = msg.toLowerCase();
  // Stale/context-restart is checked FIRST — see the precedence note above.
  for (const p of STALE_PATTERNS) if (lower.includes(p)) return 'stale';

  const assertion = isAssertionMessage(msg);
  for (const p of HEALABLE_PATTERNS) {
    if (msg.includes(p)) {
      // A genuine zero-match heals. But a polling `expect(...)` assertion whose
      // call-log merely says "waiting for locator(...)" (the locator RESOLVED;
      // a value didn't match) must NOT be treated as healable. Only the broad
      // 'waiting for locator' signal is suppressed for assertions — explicit
      // zero-match phrases ("resolved to 0 elements", "No element matches", …)
      // still win, because a missing element SHOULD heal even inside an expect.
      if (assertion && p === 'waiting for locator') continue;
      return 'healable';
    }
  }

  for (const p of RETRYABLE_PATTERNS) if (msg.includes(p)) return 'retryable';

  if (assertion) {
    if (loadingSignal || messageHasLoadingSignal(msg)) return 'loading';
    return 'assertion';
  }
  return 'fatal';
}

/** True when the error means the page / context / frame / element was torn down. */
export function isStaleError(err: unknown): boolean {
  return classifyError(err) === 'stale';
}

/**
 * Map a failure {@link ErrorClass} to a {@link HealOutcome} when it is NOT a
 * locator miss — i.e. changing the locator cannot help, so no ranking happens.
 * Returns `{ kind: 'notHealable', class }` for `assertion` / `loading` /
 * `stale` / `fatal`, and `null` for the locator-miss classes (`healable` /
 * `retryable`) which proceed to candidate ranking (whose outcome the ranker
 * then reports as `healed` / `belowThreshold` / `noCandidates`). Part of the
 * stable 1.x outcome vocabulary (see {@link HealOutcome}).
 */
export function notHealableOutcome(cls: ErrorClass): HealOutcome | null {
  if (cls === 'healable' || cls === 'retryable') return null;
  return { kind: 'notHealable', class: cls };
}

// ---------------------------------------------------------------------------
// Diagnosis helpers (P0-2 / P0-3): parse Playwright failure messages and, when a
// page is supplied, probe the live DOM to explain WHY an action/assertion failed.
// ---------------------------------------------------------------------------

/** Where a class/ARIA state actually lives, relative to the asserted element. */
export interface StateElsewhere {
  found: string;
  relation: 'parent' | 'child' | 'sibling';
}

/** The structured result of {@link diagnose}. */
export interface Diagnosis {
  class: ErrorClass;
  selector?: string;
  expected?: string;
  received?: string;
  matched?: number;
  stateElsewhere?: StateElsewhere;
  hint: string;
}

/**
 * Extract the failed selector / locator expression from ANY Playwright failure
 * message. One parser for every shape we've seen in the wild:
 *   - `waiting for locator('…')`                              → the inner selector
 *   - `Locator: getByRole('button', { name: 'Log in' })`      → the getBy… call
 *   - `locator.click: Timeout … waiting for getByTestId('x')` → the getBy… call
 *
 * For a `getBy*` locator the full call expression is returned (it can't be fed to
 * `querySelector`); for a CSS `locator('…')` the inner CSS selector is returned.
 */
export function failedSelectorOf(message: string): string | undefined {
  if (!message) return undefined;
  // 1. A getBy* builder anywhere in the message (covers "Locator: getByRole(...)"
  //    and "waiting for getByTestId('x')"). The option object `{ name: 'x' }`
  //    contains no ')', so a single `[^)]*` run captures the whole call.
  const getBy = message.match(/getBy\w+\([^)]*\)/);
  if (getBy) return getBy[0].trim();
  // 2. A css `locator('…')` / `locator("…")` — return the inner selector.
  const loc = message.match(/locator\(\s*(['"])([\s\S]*?)\1\s*\)/);
  if (loc) return loc[2].trim();
  // 3. A bare `Locator:` line with something else on it (xpath, chained, …).
  const line = message.match(/Locator:\s*(.+)/);
  if (line) return line[1].trim();
  return undefined;
}

/** Parse an "Expected…:" / "Received…:" field (Playwright varies the label). */
function parseField(msg: string, label: 'Expected' | 'Received'): string | undefined {
  const m = msg.match(new RegExp(`${label}[^:\\n]*:\\s*(.+)`));
  return m ? m[1].trim() : undefined;
}

/**
 * Pull the asserted class name and/or attribute name out of an expect() message.
 *
 * Playwright renders the matcher header as `toHaveClass(expected)` /
 * `toHaveAttribute(expected)` and puts the real value on a separate
 * `Expected pattern: /active/` (or `Expected string: "..."`) line, so we read
 * the class from the matcher arg when it's echoed, otherwise from the Expected
 * field. Attribute names are only recoverable when the message echoes them
 * (literal arg) or names a known ARIA-state attribute.
 */
function parseAssertedState(msg: string): { className?: string; attrName?: string } {
  const out: { className?: string; attrName?: string } = {};
  if (/toHaveClass/.test(msg)) {
    let m = msg.match(/toHaveClass\(\s*\/([^/]+)\//);
    if (!m) m = msg.match(/toHaveClass\(\s*['"]([^'"]+)['"]/);
    if (m) {
      out.className = m[1];
    } else {
      const exp = parseField(msg, 'Expected');
      if (exp) {
        const pat = exp.match(/^\/(.+)\/[a-z]*$/);
        out.className = pat ? pat[1] : exp.replace(/^["']|["']$/g, '');
      }
    }
  }
  // checked state (toBeChecked / toHaveAttribute('checked'))
  if (/toBeChecked|toHaveAttribute\(\s*['"]checked['"]/.test(msg)) {
    out.attrName = 'checked';
  } else {
    const a = msg.match(/toHaveAttribute\(\s*['"]([^'"]+)['"]/);
    if (a) {
      out.attrName = a[1];
    } else if (/toHaveAttribute/.test(msg)) {
      const aria = msg.match(/\b(aria-current|aria-selected|aria-pressed|aria-expanded|aria-checked)\b/);
      if (aria) out.attrName = aria[1];
    }
  }
  return out;
}

/**
 * The DOM probe run inside the page via `page.evaluate`. MUST be self-contained
 * (no closures over module scope — it is serialized into the browser). Returns
 * how many elements the selector resolves to, whether the target looks like it's
 * still loading, and where a searched-for class/attribute actually lives.
 */
function domProbe(arg: {
  selector: string;
  className: string;
  attrName: string;
  scanDocLoading: boolean;
}): { matched: number; loading: boolean; stateElsewhere?: StateElsewhere } {
  const { selector, className, attrName, scanDocLoading } = arg;
  const LOADING = /skeleton|placeholder|shimmer|loading|spinner/i;

  const isLoadingNode = (node: Element | null): boolean => {
    if (!node || node.nodeType !== 1) return false;
    const cls = node.getAttribute('class') || '';
    if (LOADING.test(cls)) return true;
    if ((node.getAttribute('aria-busy') || '').toLowerCase() === 'true') return true;
    return false;
  };

  let matched = 0;
  let el: Element | null = null;
  const cssSelector = selector && !/^getBy/.test(selector);
  if (cssSelector) {
    try {
      const nodes = document.querySelectorAll(selector);
      matched = nodes.length;
      el = nodes[0] || null;
    } catch {
      /* not a valid CSS selector — leave matched at 0 */
    }
  }

  // --- loading detection ---------------------------------------------------
  let loading = false;
  if (el) {
    let p: Element | null = el;
    let hops = 0;
    while (p && hops <= 10) {
      if (isLoadingNode(p)) {
        loading = true;
        break;
      }
      p = p.parentElement;
      hops++;
    }
    if (!loading) {
      const txt = (el.textContent || '').trim();
      if (!txt && el.parentElement) {
        const sibs = Array.from(el.parentElement.children).filter(
          (c) => c !== el && c.tagName === el!.tagName,
        );
        if (sibs.length && sibs.some((s) => (s.textContent || '').trim().length > 0)) {
          loading = true;
        }
      }
    }
  }
  if (!loading && scanDocLoading) {
    // No CSS element to pin: a skeleton/spinner/aria-busy element present in the
    // DOM at the time of an (empty-ish) assertion is itself a loading signal.
    const all = Array.from(document.querySelectorAll('*'));
    for (const n of all) {
      if (isLoadingNode(n)) {
        loading = true;
        break;
      }
    }
  }

  // --- stateElsewhere: where does the class / ARIA state really live? -------
  let stateElsewhere: StateElsewhere | undefined;
  if (el && (className || attrName)) {
    const hasState = (node: Element | null): boolean => {
      if (!node || node.nodeType !== 1) return false;
      if (className && node.classList && node.classList.contains(className)) return true;
      if (attrName) {
        if (attrName === 'checked') {
          if ((node as HTMLInputElement).checked === true) return true;
          if ((node.getAttribute('aria-checked') || '').toLowerCase() === 'true') return true;
        } else {
          const v = node.getAttribute(attrName);
          if (v !== null && v.toLowerCase() !== 'false') return true;
        }
      }
      return false;
    };
    const describe = (node: Element): string => {
      let s = node.tagName.toLowerCase();
      if (node.id) s += `#${node.id}`;
      const cls = typeof node.className === 'string' ? node.className.trim() : '';
      if (cls) s += '.' + cls.split(/\s+/).join('.');
      return s;
    };

    // Search up to 2 levels up and 2 levels down, nearest-first.
    const cands: Array<{ node: Element; relation: 'parent' | 'child' | 'sibling' }> = [];
    const parent = el.parentElement;
    const grandparent = parent && parent.parentElement;
    if (parent) cands.push({ node: parent, relation: 'parent' });
    if (parent) {
      for (const c of Array.from(parent.children)) {
        if (c !== el) cands.push({ node: c, relation: 'sibling' });
      }
    }
    for (const c of Array.from(el.children)) cands.push({ node: c, relation: 'child' });
    if (grandparent) cands.push({ node: grandparent, relation: 'parent' });
    for (const c of Array.from(el.children)) {
      for (const gc of Array.from(c.children)) cands.push({ node: gc, relation: 'child' });
    }

    for (const cand of cands) {
      if (hasState(cand.node)) {
        stateElsewhere = { found: describe(cand.node), relation: cand.relation };
        break;
      }
    }
  }

  return { matched, loading, stateElsewhere };
}

/** Best-effort tag name of the asserted element from a CSS-ish selector. */
function tagOfSelector(selector?: string): string {
  if (!selector) return 'element';
  const m = selector.match(/^([a-zA-Z][\w-]*)/);
  return m ? m[1] : 'element';
}

function buildHint(
  cls: ErrorClass,
  d: {
    selector?: string;
    expected?: string;
    received?: string;
    matched?: number;
    stateElsewhere?: StateElsewhere;
    className?: string;
    attrName?: string;
  },
): string {
  switch (cls) {
    case 'stale':
      return 'The page/execution context was torn down (navigation, reload, or close) — re-resolve the locator on the live page instead of reusing a cached heal.';
    case 'healable':
      return `The locator${d.selector ? ` \`${d.selector}\`` : ''} matched no elements — re-targeting (a heal) is appropriate.`;
    case 'retryable':
      return 'The element exists but is not actionable yet (not visible, covered, disabled, or mid-navigation) — retry after it settles.';
    case 'loading':
      return `The element appears to still be loading (skeleton/shimmer/spinner, \`aria-busy="true"\`, or empty next to populated siblings) — wait for it to settle before asserting, do not change the locator.`;
    case 'assertion': {
      if (d.stateElsewhere) {
        const what = d.className ? `\`${d.className}\`` : d.attrName ? `\`${d.attrName}\`` : 'the expected state';
        const target = tagOfSelector(d.selector);
        return `${what} is on the ${d.stateElsewhere.relation} \`${d.stateElsewhere.found}\`, not on the \`${target}\` — assert on \`page.locator('${d.stateElsewhere.found}')\`.`;
      }
      const exp = d.expected !== undefined ? ` expected ${d.expected}` : '';
      const rec = d.received !== undefined ? ` but received ${d.received}` : '';
      return `Assertion failed:${exp}${rec} — the locator resolved (matched ${d.matched ?? 'the element'}), so this is a value mismatch, not a locator problem; do not heal the locator.`;
    }
    default:
      return 'Unclassified failure — treat as a real defect and surface it.';
  }
}

/**
 * Diagnose a Playwright failure. Parses the message for the failed selector and
 * `Expected:` / `Received:` values; when a `page` is supplied it also probes the
 * live DOM for how many elements the selector resolves to now (`matched`),
 * whether the target is still loading (which downgrades an assertion to
 * `loading`), and — for class/ARIA-state assertions — where that state actually
 * lives (`stateElsewhere`). Produces a one-sentence `hint` for a human or agent.
 */
export async function diagnose(err: unknown, page?: EvaluatablePage): Promise<Diagnosis> {
  const msg = (err as Error)?.message ?? (typeof err === 'string' ? err : '');
  const selector = failedSelectorOf(msg);
  const expected = parseField(msg, 'Expected');
  const received = parseField(msg, 'Received');
  const assertion = isAssertionMessage(msg);
  const { className, attrName } = parseAssertedState(msg);

  let matched: number | undefined;
  let stateElsewhere: StateElsewhere | undefined;
  let domLoading = false;

  const cssSelector = !!selector && !/^getBy/.test(selector);
  if (page) {
    try {
      const probe = await page.evaluate(domProbe, {
        selector: selector ?? '',
        className: className ?? '',
        attrName: attrName ?? '',
        // Only fall back to a document-wide loading scan when we have no CSS
        // element to pin (bare value assertion). Keeps pinned cases precise.
        scanDocLoading: assertion && !cssSelector,
      });
      if (cssSelector) matched = probe.matched;
      domLoading = probe.loading;
      if (probe.stateElsewhere) stateElsewhere = probe.stateElsewhere;
    } catch {
      /* context torn down / evaluate failed — fall back to message-only. */
    }
  }

  const cls = classifyError(err, domLoading);
  const hint = buildHint(cls, {
    selector,
    expected,
    received,
    matched,
    stateElsewhere,
    className,
    attrName,
  });

  const out: Diagnosis = { class: cls, hint };
  if (selector !== undefined) out.selector = selector;
  if (expected !== undefined) out.expected = expected;
  if (received !== undefined) out.received = received;
  if (matched !== undefined) out.matched = matched;
  if (stateElsewhere) out.stateElsewhere = stateElsewhere;
  return out;
}
