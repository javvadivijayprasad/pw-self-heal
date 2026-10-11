/**
 * Self-healing page wrapper. Proxies Playwright's selector-taking action
 * methods AND its locator builders (getByRole/getByTestId/... via locator.ts),
 * intercepts zero-match failures, ranks DOM candidates locally (no server),
 * retries against the healed target, and logs the heal.
 */

import { extractCandidates, type EvaluatablePage } from './candidateExtractor';
import { Ranker, scoresFromResult } from './ranker';
import { appendHealEvent } from './telemetry';
import { updateSourceFile } from './sourceUpdater';
import { makeLocatorFactories, type HealablePage, type HealContext } from './locator';
import { DEFAULT_CONFIG, HealEvent, LocatorMetadata, ScoredCandidate, SelfHealConfig } from './types';
import { classifyError } from './errors';

// Error classification (healable / retryable / stale / fatal) lives in a shared
// module so both healing paths can use it without an import cycle. Re-exported
// here to keep the public surface (and `index.ts`) backward compatible.
export { classifyError, isStaleError } from './errors';
export type { ErrorClass } from './errors';

/** Infer LocatorMetadata from a CSS/selector string (the original is gone). */
export function parseLocator(selector: string): LocatorMetadata {
  const meta: LocatorMetadata = {
    tag: '',
    text: '',
    element_id: '',
    name: '',
    class_name: '',
    placeholder: '',
    aria_label: '',
    parent_tag: '',
    dom_depth: 0,
    type_attr: '',
    locator_type: 'css',
  };
  let m: RegExpMatchArray | null;
  if (/^#[\w-]+$/.test(selector)) {
    meta.locator_type = 'id';
    meta.element_id = selector.slice(1);
    meta.tag = 'input';
  } else if ((m = selector.match(/^(\w+)#([\w-]+)$/))) {
    meta.tag = m[1];
    meta.element_id = m[2];
    meta.locator_type = 'id';
  } else if ((m = selector.match(/^\[name=['"](.+)['"]\]$/))) {
    meta.locator_type = 'name';
    meta.name = m[1];
    meta.tag = 'input';
  } else if ((m = selector.match(/^\[placeholder=['"](.+)['"]\]$/))) {
    meta.placeholder = m[1];
    meta.tag = 'input';
  } else if ((m = selector.match(/^\[aria-label=['"](.+)['"]\]$/))) {
    meta.aria_label = m[1];
  } else if (/^\.[\w-]+/.test(selector)) {
    meta.locator_type = 'class';
    meta.class_name = selector.replace(/\./g, ' ').trim();
  }
  return meta;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SELECTOR_METHODS = [
  'click', 'fill', 'type', 'check', 'uncheck', 'selectOption', 'hover', 'focus',
  'textContent', 'innerText', 'getAttribute', 'isVisible', 'waitForSelector', '$',
] as const;

const LOCATOR_FACTORIES = [
  'getByRole', 'getByTestId', 'getByLabel', 'getByText',
  'getByPlaceholder', 'getByAltText', 'getByTitle', 'locator',
] as const;

export interface HealingSummary {
  totalHeals: number;
  cachedLocators: number;
  heals: HealEvent[];
}

/** Wrap a Playwright Page with self-healing. Returns a proxy of the same shape. */
export function wrapPage<T extends EvaluatablePage>(
  page: T,
  userConfig: Partial<SelfHealConfig> = {},
): T & { getHealingSummary(): HealingSummary; setTestId(id: string): void } {
  const config: SelfHealConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const ranker = new Ranker(config);
  const healCache = new Map<string, string>();
  const healingLog: HealEvent[] = [];
  const p = page as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

  const record = (event: HealEvent): void => {
    healingLog.push(event);
    appendHealEvent(config.telemetry, event);
  };

  async function scrollInto(selector: string): Promise<void> {
    if (!config.scrollIntoView) return;
    try {
      await (page as EvaluatablePage).evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (el) (el as HTMLElement).scrollIntoView({ block: 'center' });
      }, selector);
      await sleep(200);
    } catch {
      /* ignore */
    }
  }

  async function attemptHeal(
    selector: string,
    action: (sel: string, ...rest: unknown[]) => Promise<unknown>,
    ...args: unknown[]
  ): Promise<unknown> {
    const effective = healCache.get(selector) ?? selector;
    try {
      return await action(effective, ...args);
    } catch (err) {
      const cls = classifyError(err);
      if (cls === 'fatal') throw err;

      // STALE / context-restart: destroyed execution context, closed/crashed
      // page, or detached frame/element. A cached healed SELECTOR may have been
      // resolved against the OLD page; drop it and re-resolve the ORIGINAL
      // selector on the live context before attempting any DOM-dependent heal.
      if (cls === 'stale') {
        if (healCache.has(selector)) healCache.delete(selector);
        try {
          return await action(selector, ...args);
        } catch (liveErr) {
          if (classifyError(liveErr) === 'fatal') throw liveErr;
          // still failing on the live context — fall through to a fresh heal.
        }
      }

      if (cls === 'retryable') {
        try {
          if (config.implicitWaitOnRetry > 0) await sleep(config.implicitWaitOnRetry);
          await scrollInto(effective);
          return await action(effective, ...args);
        } catch (retryErr) {
          if (classifyError(retryErr) === 'fatal') throw retryErr;
        }
      }

      if (config.waitBeforeHeal > 0) {
        await sleep(config.waitBeforeHeal);
        try {
          return await action(effective, ...args);
        } catch {
          /* proceed to heal */
        }
      }

      if (config.logHeals) {
        // eslint-disable-next-line no-console
        console.log(`[pw-self-heal] locator failed: "${selector}" [${cls}] — healing`);
      }

      let candidates;
      try {
        candidates = await extractCandidates(
          page as EvaluatablePage,
          config.maxCandidates,
          config.testIdAttribute,
        );
      } catch (exErr) {
        // Context torn down mid-heal (page.evaluate on a destroyed context):
        // abort cleanly rather than false-healing; surface the original error.
        if (classifyError(exErr) === 'stale') throw err;
        throw exErr;
      }
      const meta = parseLocator(selector);
      const result = await ranker.rank(meta, candidates);

      if (!result.healed || !result.suggestedLocator) throw err;

      const newSelector = result.suggestedLocator;
      const best = result.bestCandidate as ScoredCandidate;
      try {
        const out = await action(newSelector, ...args);
        healCache.set(selector, newSelector);
        const event: HealEvent = {
          timestamp: Date.now(),
          testId: config.testId,
          original: selector,
          healed: newSelector,
          score: best.finalScore,
          mode: result.mode,
          candidatesEvaluated: result.candidatesEvaluated,
          elapsedMs: result.elapsedMs,
          via: 'string',
          scores: scoresFromResult(result),
        };
        record(event);
        if (config.logHeals) {
          // eslint-disable-next-line no-console
          console.log(
            `[pw-self-heal] HEALED "${selector}" -> "${newSelector}" (score=${best.finalScore.toFixed(4)}, ${result.mode})`,
          );
        }
        if (config.autoUpdateSource && config.sourceRoot) {
          updateSourceFile(config.sourceRoot, selector, newSelector);
        }
        return out;
      } catch {
        throw err;
      }
    }
  }

  const proxy = Object.create(page) as Record<string, unknown>;
  for (const name of SELECTOR_METHODS) {
    proxy[name] = (selector: string, ...rest: unknown[]) =>
      attemptHeal(selector, (s, ...r) => p[name](s, ...r), ...rest);
  }

  // Locator-first healing: install healing getBy*/locator factories.
  const ctx: HealContext = {
    page: page as unknown as HealablePage,
    ranker,
    config,
    record,
    cache: new Map(),
    // Parallel token snapshots + a live-token getter power the cache's
    // context-restart guard (see locator.ts). Default token is the page object
    // itself: stable on the normal path, so cache reuse pays ~zero overhead.
    cacheTokens: new Map(),
    getPageToken: () => page,
  };
  const factories = makeLocatorFactories(ctx) as Record<string, unknown>;
  for (const name of LOCATOR_FACTORIES) proxy[name] = factories[name];

  proxy.getHealingSummary = (): HealingSummary => ({
    totalHeals: healingLog.length,
    cachedLocators: healCache.size,
    heals: healingLog.slice(),
  });
  proxy.setTestId = (id: string) => {
    config.testId = id;
  };
  return proxy as unknown as T & { getHealingSummary(): HealingSummary; setTestId(id: string): void };
}
