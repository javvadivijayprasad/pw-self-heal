import { describe, it, expect } from 'vitest';
import { classifyError, isStaleError } from '../src/errors';
import { HealingLocator } from '../src/locator';
import { wrapPage } from '../src/heal';
import { Ranker } from '../src/ranker';
import { DEFAULT_CONFIG } from '../src/types';
import type {
  CandidateElement,
  HealEvent,
  LocatorDescriptor,
  SelfHealConfig,
} from '../src/types';
import type { HealablePage, HealContext, RealLocator } from '../src/locator';

const cand = (over: Partial<CandidateElement>): CandidateElement =>
  ({
    tag: 'div',
    text: '',
    element_id: '',
    name: '',
    class_name: '',
    placeholder: '',
    aria_label: '',
    type_attr: '',
    value_attr: '',
    parent_tag: '',
    dom_depth: 0,
    sibling_count: 0,
    ...over,
  }) as CandidateElement;

const keyFor = (d: LocatorDescriptor) => `${d.kind}|${d.value}|${d.options?.name ?? ''}`;

const baseCfg = (over: Partial<SelfHealConfig> = {}): SelfHealConfig => ({
  ...DEFAULT_CONFIG,
  logHeals: false,
  waitBeforeHeal: 0,
  implicitWaitOnRetry: 0,
  healTimeout: 10,
  ...over,
});

// The exact stale/context-restart signatures Playwright surfaces.
const STALE_MESSAGES = [
  'Execution context was destroyed, most likely because of a navigation',
  'Target closed',
  'Target page, context or browser has been closed',
  'Target crashed',
  'Navigation failed because page was closed',
  'frame was detached',
  'Element is not attached to the DOM',
];

describe('classifyError — stale / context-restart detection', () => {
  it.each(STALE_MESSAGES)('tags %s as stale', (msg) => {
    expect(classifyError(new Error(msg))).toBe('stale');
    expect(isStaleError(new Error(msg))).toBe(true);
  });

  it('matches stale signatures case-insensitively', () => {
    expect(classifyError(new Error('EXECUTION CONTEXT WAS DESTROYED'))).toBe('stale');
    expect(classifyError(new Error('target closed'))).toBe('stale');
    expect(classifyError(new Error('element is not attached to the dom'))).toBe('stale');
  });

  it('does NOT misclassify a normal zero-match as stale (stays healable)', () => {
    expect(classifyError(new Error('waiting for locator: resolved to 0 elements'))).toBe('healable');
    expect(classifyError(new Error('No element matches selector #x'))).toBe('healable');
    expect(isStaleError(new Error('resolved to 0 elements'))).toBe(false);
  });

  it('does NOT misclassify a real assertion / defect as stale (stays fatal)', () => {
    expect(classifyError(new Error('expect(received).toBe(expected)'))).toBe('fatal');
    expect(classifyError(new Error('TypeError: x is not a function'))).toBe('fatal');
    expect(isStaleError(new Error('boom'))).toBe(false);
  });

  it('keeps genuinely retryable (not-actionable-yet) errors as retryable', () => {
    expect(classifyError(new Error('element is not visible'))).toBe('retryable');
    expect(classifyError(new Error('is outside of the viewport'))).toBe('retryable');
  });

  it('stale takes precedence over the overlapping retryable phrasing', () => {
    // "Target closed" used to be retryable; a dead target is now stale.
    expect(classifyError(new Error('Target closed'))).toBe('stale');
  });

  it('handles non-Error / message-less throwables as fatal', () => {
    expect(classifyError(null)).toBe('fatal');
    expect(classifyError(undefined)).toBe('fatal');
    expect(classifyError('a string')).toBe('fatal');
    expect(classifyError({})).toBe('fatal');
  });
});

describe('cached heal that throws a context-closed error', () => {
  const desc: LocatorDescriptor = { kind: 'testid', value: 'submit' };
  const key = keyFor(desc);

  function ctxWith(cache: Map<string, RealLocator>, real: RealLocator): HealContext {
    const token = { live: true };
    return {
      page: { evaluate: async () => [] } as unknown as HealablePage,
      ranker: new Ranker(baseCfg()),
      config: baseCfg(),
      record: () => {},
      cache,
      cacheTokens: new Map([[key, token]]),
      getPageToken: () => token,
    };
  }

  it('is invalidated and the action re-resolves on the fresh page', async () => {
    let staleUsed = 0;
    const staleLoc: RealLocator = {
      count: async () => 1,
      click: async () => {
        staleUsed++;
        throw new Error('Target page, context or browser has been closed');
      },
    } as unknown as RealLocator;

    // The live original locator resolves fine on the current page.
    const realLoc: RealLocator = {
      count: async () => 1,
      first: () => realLoc,
      waitFor: async () => {},
      click: async () => 'clicked-on-live-page',
    } as unknown as RealLocator;

    const cache = new Map<string, RealLocator>([[key, staleLoc]]);
    const ctx = ctxWith(cache, realLoc);
    const healer = new HealingLocator(realLoc, desc, ctx);

    const out = await healer.invoke('click', []);

    expect(out).toBe('clicked-on-live-page'); // re-resolved, stale NOT surfaced
    expect(staleUsed).toBe(1); // cached entry was tried once, then abandoned
    expect(cache.has(key)).toBe(false); // stale entry invalidated
  });

  it('page-token guard skips a cache entry bound to a dead context (no overhead path)', async () => {
    let staleUsed = 0;
    const staleLoc: RealLocator = {
      count: async () => 1,
      click: async () => {
        staleUsed++;
        throw new Error('Target closed');
      },
    } as unknown as RealLocator;
    const realLoc: RealLocator = {
      count: async () => 1,
      first: () => realLoc,
      waitFor: async () => {},
      click: async () => 'live',
    } as unknown as RealLocator;

    // cacheTokens maps key -> OLD token, but the live token is NEW: restart.
    const oldToken = { gen: 1 };
    const newToken = { gen: 2 };
    const cache = new Map<string, RealLocator>([[key, staleLoc]]);
    const ctx: HealContext = {
      page: { evaluate: async () => [] } as unknown as HealablePage,
      ranker: new Ranker(baseCfg()),
      config: baseCfg(),
      record: () => {},
      cache,
      cacheTokens: new Map([[key, oldToken]]),
      getPageToken: () => newToken,
    };
    const healer = new HealingLocator(realLoc, desc, ctx);

    const out = await healer.invoke('click', []);

    expect(out).toBe('live');
    expect(staleUsed).toBe(0); // dead entry was never even invoked
    expect(cache.has(key)).toBe(false); // purged by the guard
  });
});

describe('tryHeal / extractCandidates aborts cleanly on a context-destroyed error', () => {
  const desc: LocatorDescriptor = { kind: 'testid', value: 'submit' };

  function missingLoc(): RealLocator {
    const loc: RealLocator = {
      count: async () => 0,
      first: () => loc,
      waitFor: async () => {
        throw new Error('waiting for locator: resolved to 0 elements');
      },
      click: async () => {
        throw new Error('waiting for locator: resolved to 0 elements');
      },
    } as unknown as RealLocator;
    return loc;
  }

  it('does not false-heal; rethrows the original zero-match error', async () => {
    const recorded: HealEvent[] = [];
    const cache = new Map<string, RealLocator>();
    const page = {
      // page.evaluate dies because the execution context was torn down mid-heal.
      evaluate: async () => {
        throw new Error('Execution context was destroyed, most likely because of a navigation');
      },
      getByTestId: () => { throw new Error('should not rebuild against a dead context'); },
    } as unknown as HealablePage;

    const ctx: HealContext = {
      page,
      ranker: new Ranker(baseCfg()),
      config: baseCfg(),
      record: (e) => recorded.push(e),
      cache,
      cacheTokens: new Map(),
      getPageToken: () => page,
    };
    const healer = new HealingLocator(missingLoc(), desc, ctx);

    await expect(healer.invoke('click', [])).rejects.toThrow(/resolved to 0 elements/);
    expect(recorded).toHaveLength(0); // no heal fabricated
    expect(cache.size).toBe(0); // nothing cached against the dead context
  });

  it('a NON-stale extraction error still propagates (not swallowed)', async () => {
    const page = {
      evaluate: async () => { throw new Error('unexpected extractor boom'); },
    } as unknown as HealablePage;
    const ctx: HealContext = {
      page,
      ranker: new Ranker(baseCfg()),
      config: baseCfg(),
      record: () => {},
      cache: new Map(),
      cacheTokens: new Map(),
      getPageToken: () => page,
    };
    const healer = new HealingLocator(missingLoc(), desc, ctx);
    await expect(healer.invoke('click', [])).rejects.toThrow(/extractor boom/);
  });
});

describe('string-selector path (wrapPage) — stale handling', () => {
  it('re-resolves the original selector when a context-restart error clears', async () => {
    let n = 0;
    const page = {
      click: async (sel: string) => {
        n++;
        if (n === 1) throw new Error('Target closed');
        return `ok:${sel}`;
      },
      evaluate: async () => [],
    } as unknown as HealablePage;

    const wrapped = wrapPage(page, baseCfg({ telemetry: '' }));
    const out = await wrapped.click('#submit');
    expect(out).toBe('ok:#submit');
    expect(wrapped.getHealingSummary().totalHeals).toBe(0); // recovered without a heal
  });

  it('aborts the heal (no false heal) when page.evaluate dies mid-heal', async () => {
    const page = {
      click: async () => {
        throw new Error('waiting for locator: resolved to 0 elements');
      },
      evaluate: async () => {
        throw new Error('Execution context was destroyed');
      },
    } as unknown as HealablePage;

    const wrapped = wrapPage(page, baseCfg({ telemetry: '' }));
    await expect(wrapped.click('#submit')).rejects.toThrow(/resolved to 0 elements/);
    expect(wrapped.getHealingSummary().totalHeals).toBe(0);
  });
});
