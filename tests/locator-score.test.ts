import { describe, it, expect } from 'vitest';
import { toLocatorScore, scoresFromResult } from '../src/ranker';
import { HealingLocator } from '../src/locator';
import type {
  CandidateElement,
  FeatureVector,
  HealEvent,
  HealResult,
  LocatorDescriptor,
  LocatorScore,
  RankerMode,
  ScoredCandidate,
  SelfHealConfig,
} from '../src/types';
import { DEFAULT_CONFIG } from '../src/types';
import type { HealablePage, HealContext, RealLocator } from '../src/locator';
import { Ranker } from '../src/ranker';

/** A zeroed 17-d feature vector (values are irrelevant to the projection). */
const zeroFeatures = (): FeatureVector => ({
  tag_match: 0,
  text_similarity: 0,
  attribute_similarity: 0,
  class_similarity: 0,
  parent_similarity: 0,
  depth_similarity: 0,
  id_similarity: 0,
  name_similarity: 0,
  placeholder_similarity: 0,
  aria_label_similarity: 0,
  type_attr_match: 0,
  sibling_count_ratio: 0,
  multi_attr_match_count: 0,
  candidate_text_actionable: 0,
  candidate_in_form: 0,
  candidate_attr_richness: 0,
  original_attr_count: 0,
});

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

const scored = (over: Partial<ScoredCandidate>): ScoredCandidate => ({
  candidate: cand({ element_id: 'submit-btn' }),
  features: zeroFeatures(),
  heuristicScore: 0.7,
  mlProbability: 0.9,
  finalScore: 0.82,
  rank: 1,
  ...over,
});

describe('toLocatorScore projection', () => {
  it('maps every field from a ScoredCandidate', () => {
    const sc = scored({
      candidate: cand({ element_id: 'login' }),
      heuristicScore: 0.55,
      mlProbability: 0.88,
      finalScore: 0.74,
      rank: 2,
    });
    const ls: LocatorScore = toLocatorScore(sc, 'hybrid');
    expect(ls).toEqual({
      locator: '#login',
      finalScore: 0.74,
      mlProbability: 0.88,
      heuristicScore: 0.55,
      mode: 'hybrid',
      rank: 2,
    });
  });

  it('uses suggestLocator for the locator string (name fallback)', () => {
    const sc = scored({ candidate: cand({ element_id: '', name: 'email' }) });
    expect(toLocatorScore(sc, 'ml').locator).toBe('[name="email"]');
  });

  it('carries mlProbability 0 through in heuristic mode', () => {
    const sc = scored({ mlProbability: 0, mode: undefined as never });
    const ls = toLocatorScore(sc, 'heuristic');
    expect(ls.mode).toBe('heuristic');
    expect(ls.mlProbability).toBe(0);
    expect(ls.heuristicScore).toBe(0.7);
  });

  it('carries the mode through verbatim', () => {
    const modes: RankerMode[] = ['heuristic', 'ml', 'hybrid'];
    for (const m of modes) expect(toLocatorScore(scored({}), m).mode).toBe(m);
  });
});

describe('scoresFromResult over a HealResult', () => {
  const mkResult = (mode: RankerMode, top: ScoredCandidate[]): HealResult => ({
    healed: true,
    topCandidates: top,
    mode,
    algorithm: 'gb',
    thresholdUsed: 0.5,
    candidatesEvaluated: top.length,
    elapsedMs: 1,
  });

  it('converts topCandidates preserving rank order best-first', () => {
    const top = [
      scored({ candidate: cand({ element_id: 'a' }), finalScore: 0.9, rank: 1 }),
      scored({ candidate: cand({ element_id: 'b' }), finalScore: 0.6, rank: 2 }),
      scored({ candidate: cand({ element_id: 'c' }), finalScore: 0.3, rank: 3 }),
    ];
    const out = scoresFromResult(mkResult('hybrid', top));
    expect(out.map((s) => s.locator)).toEqual(['#a', '#b', '#c']);
    expect(out.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(out.map((s) => s.finalScore)).toEqual([0.9, 0.6, 0.3]);
    // monotonically non-increasing finalScore
    for (let i = 1; i < out.length; i++) {
      expect(out[i].finalScore).toBeLessThanOrEqual(out[i - 1].finalScore);
    }
  });

  it('tags every score with the result mode; heuristic => mlProbability 0', () => {
    const top = [scored({ mlProbability: 0 }), scored({ mlProbability: 0, rank: 2 })];
    const out = scoresFromResult(mkResult('heuristic', top));
    expect(out.every((s) => s.mode === 'heuristic')).toBe(true);
    expect(out.every((s) => s.mlProbability === 0)).toBe(true);
  });

  it('returns an empty array when there are no candidates', () => {
    expect(scoresFromResult(mkResult('ml', []))).toEqual([]);
  });
});

describe('heal event carries scores', () => {
  it('attaches top-N LocatorScore[] to the recorded HealEvent', async () => {
    // A page whose original locator resolves to 0 (missing) but heals onto a
    // candidate carrying a data-testid, exercising the locator-first path.
    const recorded: HealEvent[] = [];
    const missingLoc: RealLocator = {
      count: async () => 0,
      first: () => missingLoc,
      waitFor: async () => {
        throw new Error('waiting for locator: resolved to 0 elements');
      },
    } as unknown as RealLocator;

    const healedLoc: RealLocator = {
      count: async () => 1,
      click: async () => 'clicked',
    } as unknown as RealLocator;

    const page = {
      getByTestId: (_id: string) => healedLoc,
      getByRole: () => healedLoc,
      getByText: () => healedLoc,
      getByLabel: () => healedLoc,
      getByPlaceholder: () => healedLoc,
      getByAltText: () => healedLoc,
      getByTitle: () => healedLoc,
      locator: () => healedLoc,
      // one candidate with a testid that matches the original intent
      evaluate: (async () => [
        cand({ tag: 'button', test_id: 'submit', element_id: 'submit', acc_name: 'Submit' }),
      ]) as unknown as HealablePage['evaluate'],
    } as unknown as HealablePage;

    const config: SelfHealConfig = { ...DEFAULT_CONFIG, mode: 'heuristic', logHeals: false };
    const ctx: HealContext = {
      page,
      ranker: new Ranker(config),
      config,
      record: (e) => recorded.push(e),
      cache: new Map(),
    };
    const desc: LocatorDescriptor = { kind: 'testid', value: 'submit' };

    const healer = new HealingLocator(missingLoc, desc, ctx);
    const value = await healer.invoke('click', []);

    expect(value).toBe('clicked');
    expect(recorded).toHaveLength(1);
    const ev = recorded[0];
    expect(ev.scores).toBeDefined();
    expect(Array.isArray(ev.scores)).toBe(true);
    expect(ev.scores!.length).toBeGreaterThanOrEqual(1);
    const s0 = ev.scores![0];
    expect(s0).toHaveProperty('locator');
    expect(s0).toHaveProperty('finalScore');
    expect(s0).toHaveProperty('mlProbability');
    expect(s0).toHaveProperty('heuristicScore');
    expect(s0.mode).toBe('heuristic');
    expect(s0.mlProbability).toBe(0);
    expect(s0.rank).toBe(1);
  });
});

describe('wrapPage string-selector heal records scores', () => {
  it('attaches LocatorScore[] to the telemetry heal event (string path)', async () => {
    const { wrapPage } = await import('../src/heal');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const telemetry = path.join(
      os.tmpdir(),
      `pwheal-scores-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    );

    // Candidate resembling the (renamed) target; heals with a high heuristic
    // score so `mode: 'heuristic'` clears its 0.45 threshold.
    const candidate = cand({
      tag: 'input',
      element_id: 'login-old2',
      name: 'login-old',
      aria_label: 'Login',
      acc_name: 'Login',
      text: 'Login',
    });

    const fakePage = {
      // string action: fails on the ORIGINAL selector, succeeds on the healed one.
      click: async (selector: string) => {
        if (selector === '#login-old') {
          throw new Error('waiting for locator: resolved to 0 elements');
        }
        return `clicked:${selector}`;
      },
      evaluate: async () => [candidate],
    } as unknown as HealablePage;

    const page = wrapPage(fakePage, {
      mode: 'heuristic',
      confidence: 0.3, // heal on a strong-but-sub-default heuristic match
      logHeals: false,
      waitBeforeHeal: 0,
      implicitWaitOnRetry: 0,
      telemetry,
    });

    await page.click('#login-old');

    const summary = page.getHealingSummary();
    expect(summary.totalHeals).toBe(1);
    const ev = summary.heals[0];
    expect(ev.via).toBe('string');
    expect(ev.scores).toBeDefined();
    expect(ev.scores!.length).toBeGreaterThanOrEqual(1);
    expect(ev.scores![0].mode).toBe('heuristic');
    expect(ev.scores![0].rank).toBe(1);

    // The event (with scores) was also persisted to the telemetry JSONL.
    const line = fs.readFileSync(telemetry, 'utf8').trim().split('\n')[0];
    const persisted = JSON.parse(line);
    expect(Array.isArray(persisted.scores)).toBe(true);
    expect(persisted.scores[0]).toHaveProperty('locator');
    fs.rmSync(telemetry, { force: true });
  });
});
