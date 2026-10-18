// @vitest-environment happy-dom
/**
 * P0-1/P0-2/P0-3 — assertion & loading classification, diagnose(), and
 * stateElsewhere, driven by the exact Playwright messages observed in real runs
 * at the downstream consumer (attestqa), plus coverage of the new code paths.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyError,
  isAssertionMessage,
  messageHasLoadingSignal,
  failedSelectorOf,
  diagnose,
} from '../src/errors';
import type { EvaluatablePage } from '../src/candidateExtractor';

/** A fake Playwright Page whose evaluate runs against the happy-dom document. */
function snapshot(html: string): EvaluatablePage {
  document.body.innerHTML = html;
  return {
    evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R> {
      return Promise.resolve(fn(arg));
    },
  };
}

// --- Real messages from the attestqa runs ----------------------------------
const TRUTHY_EMPTY = 'Error: expect(received).toBeTruthy()\n\nReceived: ""';

const TO_HAVE_CLASS_ACTIVE = [
  'Error: expect(locator).toHaveClass(expected)',
  '',
  "Locator: locator('button.nav-link')",
  'Expected pattern: /active/',
  'Received string:  "nav-link"',
  'Call log:',
  "  - expect.toHaveClass with timeout 5000ms",
  "  - waiting for locator('button.nav-link')",
].join('\n');

describe('P0-1 classifyError — assertion & loading classes', () => {
  it('classifies expect(received).toBeTruthy() with Received "" as assertion', () => {
    expect(classifyError(new Error(TRUTHY_EMPTY))).toBe('assertion');
  });

  it('classifies a toHaveClass failure (locator resolved) as assertion, NOT healable', () => {
    // The call log mentions "waiting for locator(...)" yet the locator resolved;
    // a value mismatch must never be treated as healable.
    expect(classifyError(new Error(TO_HAVE_CLASS_ACTIVE))).toBe('assertion');
  });

  it('downgrades an assertion to loading when the message itself carries a loading signal', () => {
    const msg = 'Error: expect(received).toBeTruthy()\n\nReceived: ""\n\nLocator: locator(".skeleton-row")';
    expect(classifyError(new Error(msg))).toBe('loading');
  });

  it('downgrades to loading when an explicit loadingSignal is passed (DOM-derived)', () => {
    expect(classifyError(new Error(TRUTHY_EMPTY), true)).toBe('loading');
    expect(classifyError(new Error(TRUTHY_EMPTY), false)).toBe('assertion');
  });

  it('a genuine zero-match inside an expect still heals (explicit resolved-to-0 wins)', () => {
    const msg = 'expect(locator).toHaveText(expected)\nreceived: <element(s) not found>\nCall log:\n  - waiting for locator: resolved to 0 elements';
    expect(classifyError(new Error(msg))).toBe('healable');
  });

  it('keeps the old four classes intact (backward compatible)', () => {
    expect(classifyError(new Error('Target closed'))).toBe('stale');
    expect(classifyError(new Error('waiting for locator: resolved to 0 elements'))).toBe('healable');
    expect(classifyError(new Error('element is not visible'))).toBe('retryable');
    expect(classifyError(new Error('TypeError: x is not a function'))).toBe('fatal');
    expect(classifyError(null)).toBe('fatal');
  });

  it('isAssertionMessage / messageHasLoadingSignal helpers', () => {
    expect(isAssertionMessage(TRUTHY_EMPTY)).toBe(true);
    expect(isAssertionMessage('boom')).toBe(false);
    expect(messageHasLoadingSignal('Locator: .skeleton')).toBe(true);
    expect(messageHasLoadingSignal('aria-busy="true"')).toBe(true);
    expect(messageHasLoadingSignal('nothing here')).toBe(false);
  });
});

describe('P0-2 failedSelectorOf — one parser, all three message shapes', () => {
  it("shape A: waiting for locator('…') → inner selector", () => {
    expect(failedSelectorOf("waiting for locator('#login-btn')")).toBe('#login-btn');
  });
  it('shape B: Locator: getByRole(...) → the getBy call', () => {
    expect(
      failedSelectorOf("Locator: getByRole('button', { name: 'Log in' })"),
    ).toBe("getByRole('button', { name: 'Log in' })");
  });
  it('shape C: locator.click Timeout … waiting for getByTestId(x) → the getBy call', () => {
    expect(
      failedSelectorOf("locator.click: Timeout 30000ms exceeded.\nCall log: waiting for getByTestId('submit')"),
    ).toBe("getByTestId('submit')");
  });
  it('returns undefined when nothing selector-like is present', () => {
    expect(failedSelectorOf('some unrelated error')).toBeUndefined();
    expect(failedSelectorOf('')).toBeUndefined();
  });
});

describe('P0-2 diagnose — message parsing + matched (with page)', () => {
  it('parses selector / expected / received and computes matched from the live DOM', async () => {
    const page = snapshot('<button class="nav-link">1</button><button class="nav-link">2</button>');
    const d = await diagnose(new Error(TO_HAVE_CLASS_ACTIVE), page);
    expect(d.class).toBe('assertion');
    expect(d.selector).toBe('button.nav-link');
    expect(d.expected).toBe('/active/');
    expect(d.received).toBe('"nav-link"');
    expect(d.matched).toBe(2);
    expect(d.hint).toMatch(/do not heal/i);
  });

  it('works with no page (message-only)', async () => {
    const d = await diagnose(new Error(TRUTHY_EMPTY));
    expect(d.class).toBe('assertion');
    expect(d.received).toBe('""');
    expect(d.matched).toBeUndefined();
  });
});

describe('P0-1/P0-2 loading detection via the live DOM (happy-dom)', () => {
  it('toBeTruthy "" with a skeleton ancestor in the DOM → loading', async () => {
    const page = snapshot('<div class="card skeleton"><span id="price"></span></div>');
    const d = await diagnose(new Error(TRUTHY_EMPTY), page);
    expect(d.class).toBe('loading');
    expect(d.hint).toMatch(/loading/i);
  });

  it('pinned element inside a shimmer wrapper → loading', async () => {
    const msg = "Error: expect(locator).toHaveText(expected)\n\nLocator: locator('#total')\nExpected string: \"42\"\nReceived string: \"\"";
    const page = snapshot('<div class="shimmer"><span id="total"></span></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.class).toBe('loading');
    expect(d.matched).toBe(1);
  });

  it('aria-busy on an ancestor → loading', async () => {
    const msg = "expect(locator).toHaveText(expected)\nLocator: locator('#q')\nReceived string: \"\"";
    const page = snapshot('<section aria-busy="true"><span id="q"></span></section>');
    const d = await diagnose(new Error(msg), page);
    expect(d.class).toBe('loading');
  });

  it('empty element whose same-shape siblings have text → loading', async () => {
    const msg = "expect(locator).toHaveText(expected)\nLocator: locator('#r3')\nReceived string: \"\"";
    const page = snapshot('<ul><li id="r1">a</li><li id="r2">b</li><li id="r3"></li></ul>');
    const d = await diagnose(new Error(msg), page);
    expect(d.class).toBe('loading');
  });

  it('a settled element (has text, no skeleton) stays assertion', async () => {
    const page = snapshot('<button class="nav-link">Home</button>');
    const d = await diagnose(new Error(TO_HAVE_CLASS_ACTIVE), page);
    expect(d.class).toBe('assertion');
  });
});

describe('P0-3 stateElsewhere — find where the class/ARIA state really lives', () => {
  it('toHaveClass(/active/) where the parent li has active → relation parent', async () => {
    const page = snapshot(
      '<ul><li class="page-item active"><button class="nav-link">1</button></li></ul>',
    );
    const d = await diagnose(new Error(TO_HAVE_CLASS_ACTIVE), page);
    expect(d.class).toBe('assertion');
    expect(d.stateElsewhere).toBeDefined();
    expect(d.stateElsewhere!.relation).toBe('parent');
    expect(d.stateElsewhere!.found).toBe('li.page-item.active');
    expect(d.hint).toContain("page.locator('li.page-item.active')");
  });

  it('finds the state on a child (down 1 level)', async () => {
    const msg = "expect(locator).toHaveClass(expected)\nLocator: locator('#wrap')\nExpected pattern: /active/";
    const page = snapshot('<div id="wrap"><span class="active">x</span></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('child');
  });

  it('finds the state on a sibling', async () => {
    const msg = "expect(locator).toHaveClass(expected)\nLocator: locator('#b')\nExpected pattern: /active/";
    const page = snapshot('<div><span id="a" class="active">x</span><span id="b">y</span></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('sibling');
  });

  it('ARIA state: toHaveAttribute(aria-current) found on the parent', async () => {
    const msg = "expect(locator).toHaveAttribute('aria-current', 'page')\nLocator: locator('#link')\nExpected string: \"page\"";
    const page = snapshot('<li aria-current="page"><a id="link">Home</a></li>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere).toBeDefined();
    expect(d.stateElsewhere!.relation).toBe('parent');
  });

  it('no stateElsewhere when the state is nowhere nearby', async () => {
    const msg = "expect(locator).toHaveClass(expected)\nLocator: locator('#lonely')\nExpected pattern: /active/";
    const page = snapshot('<div><span id="lonely">x</span></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere).toBeUndefined();
  });
});

describe('diagnose — robustness', () => {
  it('swallows a torn-down page.evaluate and falls back to message-only', async () => {
    const page: EvaluatablePage = {
      evaluate() {
        return Promise.reject(new Error('Execution context was destroyed'));
      },
    };
    const d = await diagnose(new Error(TO_HAVE_CLASS_ACTIVE), page);
    expect(d.class).toBe('assertion'); // DOM-derived loading not available, message-only
    expect(d.selector).toBe('button.nav-link');
  });

  it('handles a non-Error throwable', async () => {
    const d = await diagnose('a plain string');
    expect(d.class).toBe('fatal');
  });
});

describe('P0-3 stateElsewhere — checked / literal-arg / ARIA-fallback paths', () => {
  it('toHaveClass with the class in the matcher arg (/active/) still parses', async () => {
    const msg = "expect(locator).toHaveClass(/active/)\nLocator: locator('#wrap')\nExpected pattern: /active/";
    const page = snapshot('<div id="wrap"><b class="active">x</b></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('child');
  });

  it('toBeChecked: a checked sibling input is reported (DOM .checked)', async () => {
    const msg = "expect(locator).toBeChecked()\nLocator: locator('#c1')";
    const page = snapshot('<div><input id="c1" type="checkbox"><input id="c2" type="checkbox" checked></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere).toBeDefined();
    expect(d.stateElsewhere!.relation).toBe('sibling');
  });

  it('toBeChecked: aria-checked="true" on the parent is reported', async () => {
    const msg = "expect(locator).toBeChecked()\nLocator: locator('#inner')";
    const page = snapshot('<div role="checkbox" aria-checked="true"><span id="inner">x</span></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('parent');
  });

  it('toHaveAttribute without a literal arg falls back to a named ARIA state attr', async () => {
    const msg = "expect(locator).toHaveAttribute(expected)\nLocator: locator('#tab')\nExpected: element to have attribute aria-selected";
    const page = snapshot('<li aria-selected="true"><a id="tab">T</a></li>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('parent');
  });

  it('an invalid CSS selector is swallowed (matched stays 0)', async () => {
    const msg = "expect(locator).toHaveText(x)\nLocator: locator('>>>bad')\nReceived string: \"\"";
    const page = snapshot('<div>hi</div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.matched).toBe(0);
    expect(d.class).toBe('assertion');
  });
});

describe('diagnose — hints for the pre-existing classes', () => {
  it('stale', async () => {
    const d = await diagnose(new Error('Target closed'));
    expect(d.class).toBe('stale');
    expect(d.hint).toMatch(/torn down|re-resolve/i);
  });
  it('healable', async () => {
    const d = await diagnose(new Error("waiting for locator('#x'): resolved to 0 elements"));
    expect(d.class).toBe('healable');
    expect(d.selector).toBe('#x');
    expect(d.hint).toMatch(/matched no elements|heal/i);
  });
  it('retryable', async () => {
    const d = await diagnose(new Error('element is not visible'));
    expect(d.class).toBe('retryable');
    expect(d.hint).toMatch(/not actionable|retry/i);
  });
});

describe('coverage — parser & probe edge cases', () => {
  it('failedSelectorOf falls back to a bare Locator: line (xpath/chained)', () => {
    expect(failedSelectorOf('Locator: xpath=//button[1]')).toBe('xpath=//button[1]');
  });

  it('toHaveClass with a plain-string Expected (no regex slashes) parses the class', async () => {
    const msg = "expect(locator).toHaveClass(expected)\nLocator: locator('#wrap')\nExpected string: active";
    const page = snapshot('<div id="wrap"><b class="active">x</b></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('child');
  });

  it('an invalid CSS selector throws inside the probe and is swallowed', async () => {
    const msg = "expect(locator).toHaveText(x)\nLocator: locator('[')\nReceived string: \"\"";
    const page = snapshot('<div>hi</div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.matched).toBe(0);
  });

  it('finds the state on a grandchild (down 2 levels)', async () => {
    const msg = "expect(locator).toHaveClass(/active/)\nLocator: locator('#root')\nExpected pattern: /active/";
    const page = snapshot('<div id="root"><div class="mid"><span class="active">x</span></div></div>');
    const d = await diagnose(new Error(msg), page);
    expect(d.stateElsewhere!.relation).toBe('child');
  });

  it('healable hint without a selector', async () => {
    const d = await diagnose(new Error('No element matches the given query'));
    expect(d.class).toBe('healable');
    expect(d.selector).toBeUndefined();
    expect(d.hint).toMatch(/matched no elements/i);
  });

  it('diagnose handles a null throwable', async () => {
    const d = await diagnose(null);
    expect(d.class).toBe('fatal');
    expect(d.selector).toBeUndefined();
  });
});
