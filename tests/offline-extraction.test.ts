// @vitest-environment happy-dom
/**
 * P0-4 + P1-1 — offline candidate extraction from saved HTML, richer candidate
 * tags, and test-id auto-detection.
 *
 * The headline guarantee is PARITY: `extractCandidatesFromHtml(savedHtml)`
 * (offline, linkedom in Node) must return the exact same `CandidateElement`s as
 * `extractCandidates` run over the live DOM (happy-dom here) for the same HTML.
 * Both paths share the single `extractionProgram`, so this test pins that they
 * never drift.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractCandidates,
  extractCandidatesFromHtml,
  PREFERRED_TAGS,
  type EvaluatablePage,
} from '../src/candidateExtractor';
import { wrapPage } from '../src/heal';
import { withSelfHealing } from '../src/fixture';
import type { CandidateElement } from '../src/types';

/**
 * A fake Playwright `Page` whose `evaluate` runs the serialized extraction
 * function in-process against the ambient happy-dom document — exactly as the
 * real browser would run it, so this is a faithful "live page" stand-in.
 */
function snapshot(html: string): EvaluatablePage {
  document.body.innerHTML = html;
  return {
    evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R> {
      return Promise.resolve(fn(arg));
    },
  };
}

// A rich, structurally-unambiguous fragment: preferred + non-preferred tags,
// ids (incl. a duplicate id to exercise dedupe), the new heading/li/img tags,
// and every captured field. No tables / tbody-inserting structures so the live
// (happy-dom) and offline (linkedom) parsers build identical trees.
const SHOP_HTML = `
  <form id="search-form" class="filters">
    <label for="q">Search</label>
    <input id="q" name="query" class="form-control" placeholder="Find products"
           type="search" value="" aria-label="Search products" data-testid="search-box">
    <button id="go" class="btn primary" type="submit">Search</button>
  </form>
  <nav>
    <ul class="pager">
      <li id="page-1" class="page active">Page 1</li>
      <li id="page-2" class="page">Page 2</li>
    </ul>
  </nav>
  <div id="grid" class="product-grid">
    <div class="card">
      <img id="img-sauce" class="product-img" alt="Sauce Labs Backpack" src="bp.png">
      <h5 class="product-title" data-testid="title-backpack">Sauce Labs Backpack</h5>
      <span class="price">$29.99</span>
      <a id="add-bp" href="/add/1" class="link">Add to cart</a>
    </div>
    <div class="card">
      <img id="img-bike" class="product-img" alt="Sauce Labs Bike Light" src="bl.png">
      <h5 class="product-title">Sauce Labs Bike Light</h5>
      <span class="price">$9.99</span>
      <a id="add-bl" href="/add/2" class="link">Add to cart</a>
    </div>
  </div>
`;

const wrapDoc = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

const byId = (cands: CandidateElement[], id: string): CandidateElement | undefined =>
  cands.find((c) => c.element_id === id);

describe('extractCandidatesFromHtml — offline parity with the live extractor', () => {
  it('returns the SAME CandidateElement[] as the live extractor for the same HTML', async () => {
    const live = await extractCandidates(snapshot(SHOP_HTML));
    const offline = await extractCandidatesFromHtml(wrapDoc(SHOP_HTML));

    // Non-trivial: the fragment produces many candidates across several tags.
    expect(live.length).toBeGreaterThan(10);
    // Byte-for-byte identical candidate arrays — order, fields, and values.
    expect(offline).toEqual(live);
  });

  it('honours maxCandidates and testIdAttribute the same way on both paths', async () => {
    const live = await extractCandidates(snapshot(SHOP_HTML), 5, 'data-testid');
    const offline = await extractCandidatesFromHtml(wrapDoc(SHOP_HTML), {
      maxCandidates: 5,
      testIdAttribute: 'data-testid',
    });
    expect(live).toHaveLength(5);
    expect(offline).toEqual(live);
  });

  it('throws a clear, actionable error when linkedom cannot be resolved', async () => {
    // Force the lazy import to fail by stubbing the module registry miss.
    vi.resetModules();
    vi.doMock('linkedom', () => {
      throw new Error('Cannot find module linkedom');
    });
    const mod = await import('../src/candidateExtractor');
    await expect(mod.extractCandidatesFromHtml('<div id="x">hi</div>')).rejects.toThrow(
      /requires the optional 'linkedom' package — npm install linkedom/,
    );
    vi.doUnmock('linkedom');
    vi.resetModules();
  });
});

describe('P1-1 — richer candidate tags', () => {
  it('captures an h5 product title and an li page item as candidates (offline)', async () => {
    const cands = await extractCandidatesFromHtml(wrapDoc(SHOP_HTML));

    expect(PREFERRED_TAGS).toEqual(expect.arrayContaining(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'img']));

    const h5s = cands.filter((c) => c.tag === 'h5');
    expect(h5s.map((c) => c.text)).toEqual(
      expect.arrayContaining(['Sauce Labs Backpack', 'Sauce Labs Bike Light']),
    );
    const h5Back = h5s.find((c) => c.text === 'Sauce Labs Backpack')!;
    expect(h5Back.role).toBe('heading');

    const li1 = byId(cands, 'page-1')!;
    expect(li1.tag).toBe('li');
    expect(li1.text).toBe('Page 1');

    const img = byId(cands, 'img-sauce')!;
    expect(img.tag).toBe('img');
    expect(img.role).toBe('img');
    expect(img.acc_name).toBe('Sauce Labs Backpack'); // from alt
  });
});

describe('P1-1 — test-id attribute auto-detection', () => {
  const AUTO_HTML = `
    <button id="b1" data-test="login-btn">Login</button>
    <input id="i1" data-qa="user-field" name="user">
  `;

  it('auto-detects data-test when data-testid is absent (offline + live parity)', async () => {
    const offline = await extractCandidatesFromHtml(wrapDoc(AUTO_HTML));
    const live = await extractCandidates(snapshot(AUTO_HTML));

    // data-test value is picked up into test_id on BOTH paths, identically.
    expect(byId(offline, 'b1')!.test_id).toBe('login-btn');
    expect(byId(live, 'b1')!.test_id).toBe('login-btn');
    expect(offline).toEqual(live);
  });

  it('lets an explicit testIdAttribute override auto-detection', async () => {
    // data-test is present (auto-detect would pick it), but an explicit,
    // non-default attribute must win verbatim — here data-qa.
    const cands = await extractCandidatesFromHtml(wrapDoc(AUTO_HTML), {
      testIdAttribute: 'data-qa',
    });
    expect(byId(cands, 'i1')!.test_id).toBe('user-field'); // explicit data-qa used
    expect(byId(cands, 'b1')!.test_id).toBe(''); // data-test NOT consulted
  });

  it('logs the auto-detected attribute once for telemetry', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // 'data-cy' exercises a distinct fallback so this is the only test that logs it.
    await extractCandidatesFromHtml(wrapDoc('<button id="z" data-cy="cy-btn">Z</button>'));
    const logged = spy.mock.calls.some((c) =>
      String(c[0]).includes('test-id attribute auto-detected') && String(c[0]).includes('data-cy'),
    );
    expect(logged).toBe(true);
    spy.mockRestore();
  });
});

describe('captureDomOnFailure — DOM attachment on failure', () => {
  function makeFakePage(throwErr: Error) {
    return {
      // extractCandidates path never reached on a fatal error, but provide it.
      evaluate: async () => ({ candidates: [], testIdAttributeUsed: 'data-testid' }),
      content: async () => '<html><body>CAPTURED-DOM</body></html>',
      click: async () => {
        throw throwErr;
      },
    };
  }

  function makeTestInfoSpy() {
    const attachments: Array<{ name: string; options: unknown }> = [];
    return {
      attachments,
      testInfo: {
        attach: vi.fn(async (name: string, options: unknown) => {
          attachments.push({ name, options });
        }),
      },
    };
  }

  it('attaches pw-self-heal-dom.html on failure when enabled', async () => {
    const spy = makeTestInfoSpy();
    const page = makeFakePage(new Error('boom: fatal element gone'));
    const healing = wrapPage(page as never, { captureDomOnFailure: true }, { testInfo: spy.testInfo });

    await expect((healing as unknown as { click(s: string): Promise<unknown> }).click('#missing'))
      .rejects.toThrow(/boom/);

    expect(spy.testInfo.attach).toHaveBeenCalledTimes(1);
    expect(spy.attachments).toHaveLength(1);
    expect(spy.attachments[0].name).toBe('pw-self-heal-dom.html');
    expect(spy.attachments[0].options).toMatchObject({
      body: '<html><body>CAPTURED-DOM</body></html>',
      contentType: 'text/html',
    });
  });

  it('does NOT attach when captureDomOnFailure is disabled (default off)', async () => {
    const spy = makeTestInfoSpy();
    const page = makeFakePage(new Error('boom: fatal element gone'));
    const healing = wrapPage(page as never, {}, { testInfo: spy.testInfo });

    await expect((healing as unknown as { click(s: string): Promise<unknown> }).click('#missing'))
      .rejects.toThrow(/boom/);

    expect(spy.testInfo.attach).not.toHaveBeenCalled();
    expect(spy.attachments).toHaveLength(0);
  });

  it('captures at most once even across multiple failing actions', async () => {
    const spy = makeTestInfoSpy();
    const page = makeFakePage(new Error('boom: fatal element gone'));
    const healing = wrapPage(page as never, { captureDomOnFailure: true }, { testInfo: spy.testInfo });
    const h = healing as unknown as { click(s: string): Promise<unknown> };

    await expect(h.click('#a')).rejects.toThrow();
    await expect(h.click('#b')).rejects.toThrow();
    expect(spy.testInfo.attach).toHaveBeenCalledTimes(1);
  });

  it('withSelfHealing forwards testInfo so the fixture enables captureDomOnFailure', async () => {
    // Capture the page-fixture function that withSelfHealing registers via
    // `base.extend({ page })`, then drive it with fakes — no real Playwright.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pageFixture: any;
    const fakeBase = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extend: (obj: any) => {
        pageFixture = obj.page;
        return {};
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withSelfHealing(fakeBase as any, { captureDomOnFailure: true });
    expect(typeof pageFixture).toBe('function');

    const attach = vi.fn(async () => {});
    const page = makeFakePage(new Error('kaboom in fixture'));
    const testInfo = { titlePath: ['suite', 'case'], attach };

    await pageFixture(
      { page },
      async (healing: { click(s: string): Promise<unknown> }) => {
        await expect(healing.click('#x')).rejects.toThrow(/kaboom/);
      },
      testInfo,
    );

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe('pw-self-heal-dom.html');
  });
});
