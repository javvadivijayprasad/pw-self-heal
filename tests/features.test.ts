import { describe, it, expect } from 'vitest';
import refCases from './ref.json';
import { computeFeatures, heuristicScore, FEATURE_NAMES } from '../src/features';
import { suggestLocator } from '../src/ranker';
import { parseLocator, classifyError } from '../src/heal';
import { ratio } from '../src/seqmatch';
import type { CandidateElement, FeatureVector, LocatorMetadata } from '../src/types';

const TOL = 1e-6;

describe('seqmatch.ratio parity with difflib.SequenceMatcher', () => {
  it('matches known Python ratios', () => {
    expect(ratio('signin', 'signin-v2')).toBeCloseTo(0.8, 6);
    expect(ratio('cta', 'cta primary')).toBeCloseTo(0.42857143, 6);
    expect(ratio('form-control', 'footer')).toBeCloseTo(0.33333333, 6);
    expect(ratio('', '')).toBe(1.0); // difflib: empty/empty ratio is 1.0
    expect(ratio('abc', 'abc')).toBe(1.0);
  });
});

describe('computeFeatures parity with the Python reference', () => {
  refCases.forEach((c, idx) => {
    it(`case ${idx + 1}: 17 features match`, () => {
      const fv = computeFeatures(
        c.original as unknown as LocatorMetadata,
        c.candidate as unknown as CandidateElement,
      );
      for (const name of FEATURE_NAMES) {
        expect(
          Math.abs((fv[name] as number) - (c.features as Record<string, number>)[name]),
          `feature ${name}`,
        ).toBeLessThan(TOL);
      }
    });
    it(`case ${idx + 1}: heuristic score matches`, () => {
      const fv = computeFeatures(
        c.original as unknown as LocatorMetadata,
        c.candidate as unknown as CandidateElement,
      );
      expect(heuristicScore(fv)).toBeCloseTo(c.heuristic, 6);
    });
  });
});

describe('parseLocator', () => {
  it('parses an id selector', () => {
    const m = parseLocator('#username');
    expect(m.locator_type).toBe('id');
    expect(m.element_id).toBe('username');
  });
  it('parses a tag#id selector', () => {
    const m = parseLocator('button#submit');
    expect(m.tag).toBe('button');
    expect(m.element_id).toBe('submit');
  });
  it('parses a class selector', () => {
    const m = parseLocator('.btn.primary');
    expect(m.locator_type).toBe('class');
    expect(m.class_name).toContain('btn');
  });
});

describe('suggestLocator', () => {
  it('prefers id, then name', () => {
    expect(suggestLocator({ element_id: 'x' } as CandidateElement)).toBe('#x');
    expect(suggestLocator({ element_id: '', name: 'q' } as CandidateElement)).toBe('[name="q"]');
  });
});

describe('classifyError', () => {
  it('classifies healable / retryable / fatal', () => {
    expect(classifyError(new Error('waiting for locator("#x")'))).toBe('healable');
    expect(classifyError(new Error('element is not visible'))).toBe('retryable');
    expect(classifyError(new Error('expect(received).toBe(expected)'))).toBe('fatal');
  });
});
