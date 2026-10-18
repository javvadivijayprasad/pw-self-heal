/**
 * Locator-first healing. Wraps Playwright's locator builders
 * (getByRole / getByTestId / getByLabel / getByText / getByPlaceholder /
 * getByAltText / getByTitle / locator) so that when a locator resolves to
 * zero elements, we capture the locator's *intent*, rank live DOM candidates
 * with the trained model AND an intent-aware boost, rebuild an equivalent
 * locator against the best candidate, and retry the action.
 *
 * Why intent matters: the trained model scores id/name/text/aria similarity,
 * but a locator like getByTestId('submit') expresses which signal the author
 * cared about. The intent boost re-weights candidates toward that signal, so a
 * renamed data-testid ('submit' -> 'submit-btn') heals on its testid even
 * though the model has no dedicated testid feature.
 */

import { extractCandidates, type EvaluatablePage } from './candidateExtractor';
import { classifyError } from './errors';
import { Ranker, scoresFromResult, suggestLocator } from './ranker';
import { ratio } from './seqmatch';
import {
  CandidateElement,
  DEFAULT_CONFIG,
  HealEvent,
  LocatorDescriptor,
  LocatorKind,
  LocatorMetadata,
  LocatorStrategy,
  SelfHealConfig,
  THRESHOLDS,
} from './types';

export interface RealLocator {
  count(): Promise<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: (...args: any[]) => any;
}

export interface HealablePage extends EvaluatablePage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByRole(role: string, options?: any): RealLocator;
  getByTestId(testId: string): RealLocator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByLabel(text: string, options?: any): RealLocator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByText(text: string, options?: any): RealLocator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByPlaceholder(text: string, options?: any): RealLocator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByAltText(text: string, options?: any): RealLocator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByTitle(text: string, options?: any): RealLocator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  locator(selector: string, options?: any): RealLocator;
}

/** Shared healing context, owned by the wrapped page. */
export interface HealContext {
  page: HealablePage;
  ranker: Ranker;
  config: SelfHealConfig;
  record(event: HealEvent): void;
  cache: Map<string, RealLocator>;
  /**
   * Optional token identifying the live page / execution context. Cached healed
   * locators are bound to the token that was live when they were created; when
   * the browser context restarts (context closed+recreated, page crashed/
   * reloaded, navigation destroyed the context) the token changes and those
   * entries are stale. A cheap identity read — no cost on the normal
   * (no-restart) path. Defaults to the {@link HealContext.page} object itself.
   */
  getPageToken?(): unknown;
  /**
   * Per-key token snapshots parallel to {@link HealContext.cache} (same
   * lifetime). Optional for backward compatibility; when absent the cache
   * degrades to force-dropping only the failing key on a stale error.
   */
  cacheTokens?: Map<string, unknown>;
  /**
   * Optional Playwright test identity (P1-2), copied from the `TestInfo`
   * available to `wrapPage`/the fixture and threaded onto every {@link
   * HealEvent.test}. Absent in the imperative path with no test info.
   */
  testMeta?: HealEvent['test'];
}

const ROLE_TO_TAG: Record<string, string> = {
  button: 'button',
  link: 'a',
  textbox: 'input',
  checkbox: 'input',
  radio: 'input',
  combobox: 'select',
  slider: 'input',
  heading: 'h2',
  img: 'img',
};

function strSim(a: unknown, b: unknown): number {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  if (!sa || !sb) return 0;
  return ratio(sa.toLowerCase(), sb.toLowerCase());
}

/** Map a locator's intent to the model's LocatorMetadata shape. */
export function descriptorToMeta(desc: LocatorDescriptor, testIdAttr: string): LocatorMetadata {
  const meta: LocatorMetadata = {
    tag: '', text: '', element_id: '', name: '', class_name: '', placeholder: '',
    aria_label: '', parent_tag: '', dom_depth: 0, type_attr: '', locator_type: desc.kind,
  };
  const name = desc.options?.name != null ? String(desc.options.name) : '';
  switch (desc.kind) {
    case 'testid':
      meta.element_id = desc.value;
      break;
    case 'role':
      meta.tag = ROLE_TO_TAG[desc.value.toLowerCase()] ?? '';
      meta.aria_label = name;
      meta.text = name;
      break;
    case 'label':
      meta.tag = 'input';
      meta.aria_label = desc.value;
      meta.text = desc.value;
      break;
    case 'text':
      meta.text = desc.value;
      break;
    case 'placeholder':
      meta.tag = 'input';
      meta.placeholder = desc.value;
      break;
    case 'altText':
      meta.tag = 'img';
      meta.aria_label = desc.value;
      break;
    case 'title':
      meta.aria_label = desc.value;
      break;
    case 'css': {
      const sel = desc.value;
      let m: RegExpMatchArray | null;
      if (/^#[\w-]+$/.test(sel)) {
        meta.locator_type = 'id';
        meta.element_id = sel.slice(1);
      } else if ((m = sel.match(/^\[(?:data-)?testid=['"]?(.+?)['"]?\]$/))) {
        meta.element_id = m[1];
      } else if (/^\.[\w-]+/.test(sel)) {
        meta.class_name = sel.replace(/\./g, ' ').trim();
      }
      break;
    }
    case 'xpath':
    default:
      break;
  }
  return meta;
}

/** Intent-aware similarity in [0,1] between a locator's intent and a candidate. */
export function intentBoost(desc: LocatorDescriptor, c: CandidateElement): number {
  const name = desc.options?.name;
  switch (desc.kind) {
    case 'testid':
      return strSim(desc.value, c.test_id);
    case 'role': {
      const roleOk = !!c.role && c.role.toLowerCase() === desc.value.toLowerCase();
      if (name != null && String(name)) {
        return (roleOk ? 0.5 : 0) + 0.5 * strSim(String(name), c.acc_name);
      }
      return roleOk ? 0.6 : 0;
    }
    case 'label':
      return strSim(desc.value, c.acc_name);
    case 'text':
      return strSim(desc.value, c.acc_name || c.text);
    case 'placeholder':
      return strSim(desc.value, c.placeholder || c.acc_name);
    case 'altText':
    case 'title':
      return strSim(desc.value, c.acc_name);
    case 'css':
    case 'xpath':
    default:
      return 0;
  }
}

type Built = { locator: RealLocator; label: string };

/**
 * Intent preservation: express the healed locator using the ORIGINAL locator's
 * kind, if the candidate can still support it. Returns null when the candidate
 * cannot express that modality (e.g. a testid locator whose candidate has no
 * test-id), so the caller can fall through to {@link rebuildLocator}'s
 * configured fallback strategy. This is what lets a renamed data-testid heal
 * back onto its testid instead of collapsing to a brittle path.
 */
function buildByKind(page: HealablePage, c: CandidateElement, desc: LocatorDescriptor): Built | null {
  switch (desc.kind) {
    case 'testid':
      return c.test_id
        ? { locator: page.getByTestId(c.test_id), label: `getByTestId('${c.test_id}')` }
        : null;
    case 'role': {
      const role = c.role || desc.value;
      const nm = c.acc_name || (desc.options?.name != null ? String(desc.options.name) : '');
      if (!role) return null;
      return nm
        ? { locator: page.getByRole(role, { name: nm }), label: `getByRole('${role}', { name: '${nm}' })` }
        : { locator: page.getByRole(role), label: `getByRole('${role}')` };
    }
    case 'label': {
      const v = c.acc_name || desc.value;
      return v ? { locator: page.getByLabel(v), label: `getByLabel('${v}')` } : null;
    }
    case 'text': {
      const v = c.acc_name || c.text || desc.value;
      return v ? { locator: page.getByText(v), label: `getByText('${v}')` } : null;
    }
    case 'placeholder': {
      const v = c.placeholder || c.acc_name || desc.value;
      return v ? { locator: page.getByPlaceholder(v), label: `getByPlaceholder('${v}')` } : null;
    }
    case 'altText': {
      const v = c.acc_name || desc.value;
      return v ? { locator: page.getByAltText(v), label: `getByAltText('${v}')` } : null;
    }
    case 'title': {
      const v = c.acc_name || desc.value;
      return v ? { locator: page.getByTitle(v), label: `getByTitle('${v}')` } : null;
    }
    case 'css':
    case 'xpath':
    default:
      // No semantic modality to preserve — let the fallbackStrategy decide.
      return null;
  }
}

/**
 * Express the healed locator using one coarse {@link LocatorStrategy}. Returns
 * null when the candidate cannot support that strategy, so the caller advances
 * to the next entry in the configured order. The `xpath` strategy is the
 * last-resort path and always yields a locator (via {@link suggestLocator}).
 */
function buildByStrategy(page: HealablePage, c: CandidateElement, strat: LocatorStrategy): Built | null {
  switch (strat) {
    case 'role': {
      // role needs a role AND an accessible name to be unambiguous.
      if (!c.role || !c.acc_name) return null;
      return {
        locator: page.getByRole(c.role, { name: c.acc_name }),
        label: `getByRole('${c.role}', { name: '${c.acc_name}' })`,
      };
    }
    case 'text': {
      const v = c.text || c.acc_name;
      return v ? { locator: page.getByText(v), label: `getByText('${v}')` } : null;
    }
    case 'testid': {
      // respects config.testIdAttribute: candidate.test_id was extracted with it.
      return c.test_id
        ? { locator: page.getByTestId(c.test_id), label: `getByTestId('${c.test_id}')` }
        : null;
    }
    case 'css': {
      // css needs a real anchor (id / name / placeholder / aria-label); a bare
      // tag is not distinctive enough to count as a usable css strategy.
      if (!(c.element_id || c.name || c.placeholder || c.aria_label)) return null;
      const sel = suggestLocator(c);
      return { locator: page.locator(sel), label: `locator('${sel}')` };
    }
    case 'xpath':
    default: {
      // Last-resort path — always available.
      const sel = suggestLocator(c);
      return { locator: page.locator(sel), label: `locator('${sel}')` };
    }
  }
}

/**
 * Rebuild an equivalent locator against the healed candidate.
 *
 * Precedence (documented; see README "Fallback strategy"):
 *   1. INTENT PRESERVATION — try the ORIGINAL locator's own kind first, so a
 *      renamed testid heals on testid, a role on role, a label on label, etc.
 *      ({@link buildByKind}; skipped for css/xpath, which carry no modality).
 *   2. CONFIGURED FALLBACK — walk `config.fallbackStrategy` in order and use the
 *      FIRST strategy the candidate can express. Default order:
 *      role -> text -> testid -> xpath (semantic/robust first, brittle last).
 *   3. TERMINAL FALLBACK — a guaranteed CSS/path locator via suggestLocator,
 *      reached only if the configured list omits `xpath` and nothing else fits.
 *
 * `config` is optional so the public export stays backward compatible; it
 * defaults to {@link DEFAULT_CONFIG} (i.e. the default fallback order).
 */
export function rebuildLocator(
  page: HealablePage,
  c: CandidateElement,
  desc: LocatorDescriptor,
  config: SelfHealConfig = DEFAULT_CONFIG,
): Built {
  // 1. Intent preservation.
  const preserved = buildByKind(page, c, desc);
  if (preserved) return preserved;

  // 2. Configured fallback strategies, in order.
  const strategies = config.fallbackStrategy ?? DEFAULT_CONFIG.fallbackStrategy;
  for (const strat of strategies) {
    const built = buildByStrategy(page, c, strat);
    if (built) return built;
  }

  // 3. Terminal last-resort path.
  const sel = suggestLocator(c);
  return { locator: page.locator(sel), label: `locator('${sel}')` };
}

function descLabel(desc: LocatorDescriptor): string {
  const nm = desc.options?.name != null ? `, { name: '${String(desc.options.name)}' }` : '';
  const fnByKind: Record<LocatorKind, string> = {
    role: `getByRole('${desc.value}'${nm})`,
    testid: `getByTestId('${desc.value}')`,
    label: `getByLabel('${desc.value}')`,
    text: `getByText('${desc.value}')`,
    placeholder: `getByPlaceholder('${desc.value}')`,
    altText: `getByAltText('${desc.value}')`,
    title: `getByTitle('${desc.value}')`,
    css: `locator('${desc.value}')`,
    xpath: `locator('${desc.value}')`,
  };
  return fnByKind[desc.kind];
}

const HEALABLE_METHODS = new Set([
  'click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption',
  'hover', 'focus', 'tap', 'clear', 'setInputFiles', 'scrollIntoViewIfNeeded',
  'textContent', 'innerText', 'getAttribute', 'inputValue', 'waitFor', 'selectText',
]);

/** A Playwright Locator wrapper that self-heals on a zero-match failure. */
export class HealingLocator {
  private readonly key: string;
  constructor(
    private readonly real: RealLocator,
    private readonly desc: LocatorDescriptor,
    private readonly ctx: HealContext,
  ) {
    this.key = `${desc.kind}|${desc.value}|${desc.options?.name ?? ''}`;
  }

  /** The live page/context token (defaults to the page object itself). */
  private pageToken(): unknown {
    return this.ctx.getPageToken ? this.ctx.getPageToken() : this.ctx.page;
  }

  /**
   * Read the heal cache, honoring the context-restart guard: a cached locator is
   * bound to the token that was live when it was healed. If that token no longer
   * matches the live one, the context restarted — purge the dead entries and
   * report a miss so we re-resolve on the CURRENT page. No overhead on the
   * normal path (one identity compare of a stable token).
   */
  private cachedLocator(): RealLocator | undefined {
    const cached = this.ctx.cache.get(this.key);
    if (!cached) return undefined;
    const tokens = this.ctx.cacheTokens;
    if (tokens && tokens.get(this.key) !== this.pageToken()) {
      this.invalidateDeadEntries();
      return undefined;
    }
    return cached;
  }

  /** Store a healed locator together with the token it was resolved against. */
  private storeCache(loc: RealLocator): void {
    this.ctx.cache.set(this.key, loc);
    this.ctx.cacheTokens?.set(this.key, this.pageToken());
  }

  /** Force-drop the current key — its cached heal just threw a stale error. */
  private invalidateStaleEntry(): void {
    this.ctx.cache.delete(this.key);
    this.ctx.cacheTokens?.delete(this.key);
  }

  /**
   * Drop every cache entry NOT bound to the live token: they were healed on a
   * page/context that has since been torn down, so reusing any of them would
   * throw the same stale error. Falls back to clearing just our own key when no
   * token map is present (backward compatible).
   */
  private invalidateDeadEntries(): void {
    const tokens = this.ctx.cacheTokens;
    if (!tokens) {
      this.ctx.cache.delete(this.key);
      return;
    }
    const live = this.pageToken();
    for (const [k, tok] of tokens) {
      if (tok !== live) {
        this.ctx.cache.delete(k);
        tokens.delete(k);
      }
    }
  }

  async invoke(method: string, args: unknown[]): Promise<unknown> {
    const cached = this.cachedLocator();

    // Fast-miss detection. A Playwright action auto-waits the FULL action
    // timeout (often 30s) before failing, which would delay every heal until
    // the test deadline — healing would never get a chance to run. Instead,
    // give the original locator only `healTimeout` ms to appear; if it never
    // attaches, heal immediately. A present element resolves this wait instantly,
    // so passing actions keep paying ~zero overhead.
    if (!cached && HEALABLE_METHODS.has(method)) {
      let present = true;
      try {
        await this.real
          .first()
          .waitFor({ state: 'attached', timeout: this.ctx.config.healTimeout });
      } catch {
        present = false;
      }
      if (!present) {
        const healed = await this.tryHeal(method, args);
        if (healed.ok) return healed.value;
        // Heal did not clear the threshold — fall through so the caller gets
        // Playwright's own (real) error rather than a swallowed one.
      }
    }

    const usingCache = cached !== undefined;
    const effective = cached ?? this.real;
    try {
      return await effective[method](...args);
    } catch (err) {
      const cls = classifyError(err);

      // STALE / context-restart while reusing a CACHED heal: that locator is
      // bound to a page/execution context that has been torn down (reusing it
      // throws "Target closed" / "Execution context was destroyed" / ...).
      // INVALIDATE it (and any sibling entries on the now-dead context) and
      // RE-RESOLVE on the CURRENT page — original locator first, then a fresh
      // heal on the live context — instead of surfacing the stale error.
      if (usingCache && cls === 'stale') {
        this.invalidateStaleEntry();
        this.invalidateDeadEntries();
        try {
          return await this.real[method](...args);
        } catch (liveErr) {
          if (!HEALABLE_METHODS.has(method)) throw liveErr;
          const healed = await this.tryHeal(method, args);
          if (healed.ok) return healed.value;
          throw liveErr;
        }
      }

      if (!HEALABLE_METHODS.has(method)) throw err;

      let missing = false;
      try {
        missing = (await this.real.count()) === 0;
      } catch (countErr) {
        // If even counting hits a stale/context-restart error, the context is
        // dead — do NOT fabricate a heal against it. Surface the original error
        // so the caller can re-attempt once the live context is back.
        if (classifyError(countErr) === 'stale') throw err;
        missing = true;
      }
      if (!missing) throw err;

      const healed = await this.tryHeal(method, args);
      if (healed.ok) return healed.value;
      throw err;
    }
  }

  private async tryHeal(method: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown }> {
    const { page, ranker, config } = this.ctx;
    const t0 = Date.now();
    let candidates: CandidateElement[];
    try {
      candidates = await extractCandidates(page, config.maxCandidates, config.testIdAttribute);
    } catch (err) {
      // Context torn down mid-heal: page.evaluate ran against a destroyed
      // execution context. Abort the heal CLEANLY — never rank a dead DOM and
      // never false-heal. The caller re-attempts on the live context (or
      // rethrows the original error if nothing can be done).
      if (classifyError(err) === 'stale') return { ok: false };
      throw err;
    }
    if (candidates.length === 0) return { ok: false };

    const meta = descriptorToMeta(this.desc, config.testIdAttribute);
    const result = await ranker.rank(meta, candidates);
    const threshold = config.confidence ?? THRESHOLDS[config.mode];

    // Combine the model score with the intent boost; intent can carry a heal
    // the model alone would miss (e.g. testid drift).
    let best: { cand: CandidateElement; score: number } | null = null;
    for (const sc of result.topCandidates) {
      const combined = Math.max(sc.finalScore, intentBoost(this.desc, sc.candidate));
      if (!best || combined > best.score) best = { cand: sc.candidate, score: combined };
    }
    if (!best || best.score < threshold) return { ok: false };

    const { locator: healedLoc, label } = rebuildLocator(page, best.cand, this.desc, config);
    try {
      const value = await healedLoc[method](...args);
      this.storeCache(healedLoc);
      const score = Math.round(best.score * 1e6) / 1e6;
      const event: HealEvent = {
        timestamp: Date.now(),
        testId: config.testId,
        original: descLabel(this.desc),
        healed: label,
        score,
        mode: result.mode,
        candidatesEvaluated: candidates.length,
        elapsedMs: Date.now() - t0,
        via: this.desc.kind,
        // Top-N (N = config.topK) ranking decisions, best-first, for downstream
        // logging/dashboards. Purely additive; existing consumers unaffected.
        scores: scoresFromResult(result),
        // The combined model+intent score cleared the threshold and the action
        // succeeded against the rebuilt locator — a `healed` outcome. Built
        // directly (not from result.outcome) because the intent boost can carry
        // a heal the model-only ranking scored below threshold.
        outcome: { kind: 'healed', selector: label, score },
        ...(this.ctx.testMeta ? { test: this.ctx.testMeta } : {}),
      };
      this.ctx.record(event);
      if (config.logHeals) {
        // eslint-disable-next-line no-console
        console.log(
          `[pw-self-heal] HEALED ${event.original} -> ${event.healed} (score=${event.score.toFixed(4)}, ${result.mode})`,
        );
      }
      return { ok: true, value };
    } catch {
      return { ok: false };
    }
  }

  // ---- Healable actions ----
  click(...a: unknown[]) { return this.invoke('click', a); }
  dblclick(...a: unknown[]) { return this.invoke('dblclick', a); }
  fill(...a: unknown[]) { return this.invoke('fill', a); }
  type(...a: unknown[]) { return this.invoke('type', a); }
  press(...a: unknown[]) { return this.invoke('press', a); }
  check(...a: unknown[]) { return this.invoke('check', a); }
  uncheck(...a: unknown[]) { return this.invoke('uncheck', a); }
  selectOption(...a: unknown[]) { return this.invoke('selectOption', a); }
  hover(...a: unknown[]) { return this.invoke('hover', a); }
  focus(...a: unknown[]) { return this.invoke('focus', a); }
  tap(...a: unknown[]) { return this.invoke('tap', a); }
  clear(...a: unknown[]) { return this.invoke('clear', a); }
  setInputFiles(...a: unknown[]) { return this.invoke('setInputFiles', a); }
  scrollIntoViewIfNeeded(...a: unknown[]) { return this.invoke('scrollIntoViewIfNeeded', a); }
  textContent(...a: unknown[]) { return this.invoke('textContent', a); }
  innerText(...a: unknown[]) { return this.invoke('innerText', a); }
  getAttribute(...a: unknown[]) { return this.invoke('getAttribute', a); }
  inputValue(...a: unknown[]) { return this.invoke('inputValue', a); }
  waitFor(...a: unknown[]) { return this.invoke('waitFor', a); }

  // ---- Non-throwing / passthrough (no heal) ----
  count() { return this.real.count(); }
  isVisible(...a: unknown[]) { return this.real.isVisible(...a); }
  isEnabled(...a: unknown[]) { return this.real.isEnabled(...a); }
  isChecked(...a: unknown[]) { return this.real.isChecked(...a); }
  isDisabled(...a: unknown[]) { return this.real.isDisabled(...a); }
  isEditable(...a: unknown[]) { return this.real.isEditable(...a); }
  boundingBox(...a: unknown[]) { return this.real.boundingBox(...a); }
  screenshot(...a: unknown[]) { return this.real.screenshot(...a); }
  /** Chaining/sub-locators are returned unwrapped (no healing) in this release. */
  first() { return this.real.first(); }
  last() { return this.real.last(); }
  nth(...a: unknown[]) { return this.real.nth(...a); }
  locator(...a: unknown[]) { return this.real.locator(...a); }
  filter(...a: unknown[]) { return this.real.filter(...a); }
  all(...a: unknown[]) { return this.real.all(...a); }
}

/**
 * Wrap a real Playwright Locator so it self-heals on action methods while
 * staying a genuine Locator for everything else. Using a Proxy (instead of the
 * bespoke class above) keeps `instanceof Locator` and `constructor.name ===
 * 'Locator'` true, so Playwright's web-first assertions —
 * expect(locator).toBeVisible(), .toHaveText(), etc. — accept it. Only the
 * healable action methods are intercepted; every other property and method
 * delegates to the real locator (bound to it, so internal state works).
 */
export function makeHealingProxy(
  real: RealLocator,
  desc: LocatorDescriptor,
  ctx: HealContext,
): RealLocator {
  const healer = new HealingLocator(real, desc, ctx);
  return new Proxy(real as unknown as object, {
    get(target, prop) {
      if (typeof prop === 'string' && HEALABLE_METHODS.has(prop)) {
        return (...args: unknown[]) => healer.invoke(prop, args);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as RealLocator;
}

/** Build the healing locator factory methods to install on the wrapped page. */
export function makeLocatorFactories(ctx: HealContext) {
  const p = ctx.page;
  const wrap = (real: RealLocator, desc: LocatorDescriptor) =>
    makeHealingProxy(real, desc, ctx);
  return {
    getByRole: (role: string, options?: { name?: string }) =>
      wrap(p.getByRole(role, options), { kind: 'role', value: role, options }),
    getByTestId: (testId: string) =>
      wrap(p.getByTestId(testId), { kind: 'testid', value: String(testId) }),
    getByLabel: (text: string, options?: { name?: string }) =>
      wrap(p.getByLabel(text, options), { kind: 'label', value: String(text), options }),
    getByText: (text: string, options?: { name?: string }) =>
      wrap(p.getByText(text, options), { kind: 'text', value: String(text), options }),
    getByPlaceholder: (text: string, options?: { name?: string }) =>
      wrap(p.getByPlaceholder(text, options), { kind: 'placeholder', value: String(text), options }),
    getByAltText: (text: string, options?: { name?: string }) =>
      wrap(p.getByAltText(text, options), { kind: 'altText', value: String(text), options }),
    getByTitle: (text: string, options?: { name?: string }) =>
      wrap(p.getByTitle(text, options), { kind: 'title', value: String(text), options }),
    locator: (selector: string, options?: Record<string, unknown>) =>
      wrap(p.locator(selector, options), {
        kind: selector.startsWith('//') || selector.startsWith('xpath=') ? 'xpath' : 'css',
        value: selector,
      }),
  };
}
