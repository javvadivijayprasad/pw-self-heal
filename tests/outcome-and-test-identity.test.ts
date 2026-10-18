import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapPage, testMetaFrom } from '../src/heal';
import type { TestInfoLike } from '../src/heal';
import { HealingLocator } from '../src/locator';
import type { HealablePage, HealContext, RealLocator } from '../src/locator';
import { Ranker, suggestLocator } from '../src/ranker';
import { notHealableOutcome } from '../src/errors';
import { DEFAULT_CONFIG } from '../src/types';
import type {
  CandidateElement,
  HealEvent,
  LocatorDescriptor,
  LocatorMetadata,
  SelfHealConfig,
} from '../src/types';

// ---------------------------------------------------------------------------
// shared fixtures
// ---------------------------------------------------------------------------

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

const meta = (over: Partial<LocatorMetadata> = {}): LocatorMetadata => ({
  tag: 'input',
  text: '',
  element_id: 'submit',
  name: '',
  class_name: '',
  placeholder: '',
  aria_label: '',
  parent_tag: '',
  dom_depth: 0,
  type_attr: '',
  locator_type: 'id',
  ...over,
});

const baseCfg = (over: Partial<SelfHealConfig> = {}): SelfHealConfig => ({
  ...DEFAULT_CONFIG,
  mode: 'heuristic', // keep ONNX out of the unit tests — deterministic heuristic
  logHeals: false,
  waitBeforeHeal: 0,
  implicitWaitOnRetry: 0,
  healTimeout: 10,
  telemetry: '',
  ...over,
});

const fakeTestInfo = (): TestInfoLike & {
  title: string;
  titlePath: string[];
  file: string;
  testId: string;
} => ({
  attach: async () => {},
  title: 'logs in with valid credentials',
  titlePath: ['auth.spec.ts', 'auth', 'logs in with valid credentials'],
  file: '/repo/tests/auth.spec.ts',
  testId: 'auth.spec.ts:42',
});

// ---------------------------------------------------------------------------
// P1-2 — testMetaFrom (pure helper)
// ---------------------------------------------------------------------------

describe('testMetaFrom (P1-2)', () => {
  it('copies every identity field from a Playwright-like TestInfo', () => {
    const ti = fakeTestInfo();
    expect(testMetaFrom(ti)).toEqual({
      title: 'logs in with valid credentials',
      titlePath: ['auth.spec.ts', 'auth', 'logs in with valid credentials'],
      file: '/repo/tests/auth.spec.ts',
      testId: 'auth.spec.ts:42',
    });
  });

  it('returns undefined when no test info is supplied (imperative wrapPage path)', () => {
    expect(testMetaFrom(undefined)).toBeUndefined();
  });

  it('returns undefined for a test-info object carrying no identity fields', () => {
    expect(testMetaFrom({ attach: async () => {} })).toBeUndefined();
  });

  it('guards each field independently (partial TestInfo)', () => {
    expect(testMetaFrom({ attach: async () => {}, title: 'only title' })).toEqual({
      title: 'only title',
    });
    // Wrong types are ignored, not forwarded.
    expect(
      testMetaFrom({
        attach: async () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        titlePath: 'not-an-array' as any,
        file: '/x.ts',
      }),
    ).toEqual({ file: '/x.ts' });
  });
});

// ---------------------------------------------------------------------------
// P1-2 — HealEvent.test end-to-end: summary + persisted JSONL
// ---------------------------------------------------------------------------

/** A string-selector page that misses on `#submit` and heals onto `#submit-btn`. */
function stringHealPage() {
  return {
    click: async (sel: string) => {
      if (sel === '#submit') throw new Error('waiting for locator: resolved to 0 elements');
      return `ok:${sel}`;
    },
    evaluate: async () => [cand({ element_id: 'submit-btn', tag: 'input' })],
  } as unknown as HealablePage;
}

describe('HealEvent.test — populated end-to-end (P1-2)', () => {
  it('appears in getHealingSummary() AND the persisted JSONL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwheal-'));
    const telemetry = join(dir, 'heal-events.jsonl');
    try {
      const ti = fakeTestInfo();
      const wrapped = wrapPage(
        stringHealPage(),
        baseCfg({ confidence: 0.001, telemetry }),
        { testInfo: ti },
      );

      const out = await wrapped.click('#submit');
      expect(out).toBe('ok:#submit-btn'); // healed

      // (a) summary
      const summary = wrapped.getHealingSummary();
      expect(summary.totalHeals).toBe(1);
      expect(summary.heals[0].test).toEqual({
        title: 'logs in with valid credentials',
        titlePath: ['auth.spec.ts', 'auth', 'logs in with valid credentials'],
        file: '/repo/tests/auth.spec.ts',
        testId: 'auth.spec.ts:42',
      });

      // (b) persisted JSONL
      const line = readFileSync(telemetry, 'utf8').trim().split('\n').pop()!;
      const persisted = JSON.parse(line) as HealEvent;
      expect(persisted.test).toEqual(summary.heals[0].test);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is cleanly ABSENT (summary + JSONL) when no test info is supplied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwheal-'));
    const telemetry = join(dir, 'heal-events.jsonl');
    try {
      const wrapped = wrapPage(stringHealPage(), baseCfg({ confidence: 0.001, telemetry }));
      await wrapped.click('#submit');

      const summary = wrapped.getHealingSummary();
      expect(summary.totalHeals).toBe(1);
      expect(summary.heals[0].test).toBeUndefined();

      const line = readFileSync(telemetry, 'utf8').trim().split('\n').pop()!;
      const persisted = JSON.parse(line) as Record<string, unknown>;
      // Serialized cleanly: the key is omitted entirely, not `null`/`{}`.
      expect('test' in persisted).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// P1-2 — test identity on the locator-first heal path
// ---------------------------------------------------------------------------

describe('HealEvent.test — locator-first path (P1-2)', () => {
  it('threads ctx.testMeta onto the recorded event', async () => {
    const recorded: HealEvent[] = [];
    const desc: LocatorDescriptor = { kind: 'testid', value: 'submit' };

    const real: RealLocator = {
      count: async () => 0,
      first: () => real,
      waitFor: async () => {
        throw new Error('waiting for locator: resolved to 0 elements');
      },
      click: async () => {
        throw new Error('waiting for locator: resolved to 0 elements');
      },
    } as unknown as RealLocator;

    const page = {
      evaluate: async () => [cand({ test_id: 'submit-btn' })],
      getByTestId: () => ({ click: async () => 'healed-click' }) as unknown as RealLocator,
    } as unknown as HealablePage;

    const testMeta = testMetaFrom(fakeTestInfo());
    const ctx: HealContext = {
      page,
      ranker: new Ranker(baseCfg({ confidence: 0.001 })),
      config: baseCfg({ confidence: 0.001 }),
      record: (e) => recorded.push(e),
      cache: new Map(),
      cacheTokens: new Map(),
      getPageToken: () => page,
      testMeta,
    };

    const healer = new HealingLocator(real, desc, ctx);
    const out = await healer.invoke('click', []);

    expect(out).toBe('healed-click');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].test).toEqual(testMeta);
    expect(recorded[0].outcome).toEqual({
      kind: 'healed',
      selector: "getByTestId('submit-btn')",
      score: recorded[0].score,
    });
  });
});

// ---------------------------------------------------------------------------
// P1-3 — HealOutcome vocabulary
// ---------------------------------------------------------------------------

describe('HealOutcome — ranker-produced variants (P1-3)', () => {
  it('produces `healed` with selector + score when a candidate is accepted', async () => {
    const ranker = new Ranker(baseCfg({ confidence: 0.001 }));
    const c = cand({ element_id: 'submit-btn', tag: 'input' });
    const result = await ranker.rank(meta(), [c]);

    expect(result.healed).toBe(true);
    expect(result.outcome).toEqual({
      kind: 'healed',
      selector: suggestLocator(c),
      score: result.bestCandidate!.finalScore,
    });
  });

  it('produces `belowThreshold` with score + threshold when the best is under confidence', async () => {
    const ranker = new Ranker(baseCfg({ confidence: 0.99 }));
    const result = await ranker.rank(meta(), [cand({ tag: 'span' })]);

    expect(result.healed).toBe(false);
    expect(result.outcome?.kind).toBe('belowThreshold');
    if (result.outcome?.kind === 'belowThreshold') {
      expect(result.outcome.threshold).toBe(0.99);
      expect(result.outcome.score).toBeLessThan(0.99);
      expect(result.outcome.score).toBe(result.topCandidates[0].finalScore);
    }
  });

  it('produces `noCandidates` when extraction found nothing to rank', async () => {
    const ranker = new Ranker(baseCfg());
    const result = await ranker.rank(meta(), []);

    expect(result.healed).toBe(false);
    expect(result.candidatesEvaluated).toBe(0);
    expect(result.outcome).toEqual({ kind: 'noCandidates' });
  });
});

describe('HealOutcome — notHealable from non-locator-miss classes (P1-3)', () => {
  it.each(['assertion', 'loading', 'stale', 'fatal'] as const)(
    'maps class %s to { kind: notHealable, class }',
    (cls) => {
      expect(notHealableOutcome(cls)).toEqual({ kind: 'notHealable', class: cls });
    },
  );

  it('returns null for the locator-miss classes (they proceed to ranking)', () => {
    expect(notHealableOutcome('healable')).toBeNull();
    expect(notHealableOutcome('retryable')).toBeNull();
  });
});

describe('HealOutcome — healed surfaced on the recorded event (P1-3)', () => {
  it('string-selector heal records outcome { kind: healed }', async () => {
    const wrapped = wrapPage(stringHealPage(), baseCfg({ confidence: 0.001 }));
    await wrapped.click('#submit');
    const ev = wrapped.getHealingSummary().heals[0];
    expect(ev.outcome).toEqual({
      kind: 'healed',
      selector: '#submit-btn',
      score: ev.score,
    });
  });
});
