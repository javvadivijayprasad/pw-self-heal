import { describe, it, expect } from 'vitest';
import { rebuildLocator } from '../src/locator';
import { DEFAULT_CONFIG } from '../src/types';
import type {
  CandidateElement,
  LocatorDescriptor,
  LocatorStrategy,
  SelfHealConfig,
} from '../src/types';
import type { HealablePage, RealLocator } from '../src/locator';

/**
 * A record of every getBy* / locator call the rebuild made, plus the returned
 * label. We assert on `label` (a deterministic string) rather than the opaque
 * locator object, and on which page factory got called.
 */
function makePage() {
  const calls: Array<{ m: string; args: unknown[] }> = [];
  const tag = (m: string) =>
    (...args: unknown[]): RealLocator => {
      calls.push({ m, args });
      return { __m: m, __args: args } as unknown as RealLocator;
    };
  const page = {
    getByRole: tag('getByRole'),
    getByTestId: tag('getByTestId'),
    getByLabel: tag('getByLabel'),
    getByText: tag('getByText'),
    getByPlaceholder: tag('getByPlaceholder'),
    getByAltText: tag('getByAltText'),
    getByTitle: tag('getByTitle'),
    locator: tag('locator'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluate: (async () => []) as any,
  } as unknown as HealablePage;
  return { page, calls };
}

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

const cfg = (fallbackStrategy: LocatorStrategy[]): SelfHealConfig => ({
  ...DEFAULT_CONFIG,
  fallbackStrategy,
});

// A descriptor whose kind carries NO modality to preserve, so rebuildLocator
// goes straight to the configured fallbackStrategy.
const cssDesc: LocatorDescriptor = { kind: 'css', value: '.whatever' };

describe('DEFAULT_CONFIG.fallbackStrategy', () => {
  it('defaults to role -> text -> testid -> xpath', () => {
    expect(DEFAULT_CONFIG.fallbackStrategy).toEqual(['role', 'text', 'testid', 'xpath']);
  });
});

describe('rebuildLocator — configured fallback strategy', () => {
  it('a candidate with role + accessible name yields a role locator', () => {
    const { page, calls } = makePage();
    const { label } = rebuildLocator(page, cand({ role: 'button', acc_name: 'Submit' }), cssDesc);
    expect(label).toBe("getByRole('button', { name: 'Submit' })");
    expect(calls[0].m).toBe('getByRole');
  });

  it('a candidate with only a testid yields a testid locator', () => {
    const { page, calls } = makePage();
    const { label } = rebuildLocator(page, cand({ test_id: 'save-btn' }), cssDesc);
    expect(label).toBe("getByTestId('save-btn')");
    expect(calls[0].m).toBe('getByTestId');
  });

  it('a candidate with only text yields a text locator', () => {
    const { page, calls } = makePage();
    const { label } = rebuildLocator(page, cand({ text: 'Continue' }), cssDesc);
    expect(label).toBe("getByText('Continue')");
    expect(calls[0].m).toBe('getByText');
  });

  it('falls to xpath (suggestLocator path) only when nothing semantic applies', () => {
    const { page, calls } = makePage();
    // Bare tag: no role, no text, no testid, no id/attrs.
    const { label } = rebuildLocator(page, cand({ tag: 'span' }), cssDesc);
    expect(label).toBe("locator('span')");
    expect(calls[0].m).toBe('locator');
  });

  it('does NOT use xpath when a semantic strategy is available', () => {
    const { page } = makePage();
    const { label } = rebuildLocator(
      page,
      cand({ role: 'link', acc_name: 'Docs', element_id: 'docs' }),
      cssDesc,
    );
    expect(label).toContain('getByRole');
  });
});

describe('rebuildLocator — strategy ordering is configurable', () => {
  const both = cand({ role: 'button', acc_name: 'Save', test_id: 'save-btn' });

  it('default order (role first) chooses role', () => {
    const { page } = makePage();
    const { label } = rebuildLocator(page, both, cssDesc);
    expect(label).toBe("getByRole('button', { name: 'Save' })");
  });

  it('putting testid first changes the choice to testid', () => {
    const { page } = makePage();
    const { label } = rebuildLocator(page, both, cssDesc, cfg(['testid', 'role', 'text', 'xpath']));
    expect(label).toBe("getByTestId('save-btn')");
  });

  it('text can be promoted ahead of role', () => {
    const { page } = makePage();
    const { label } = rebuildLocator(
      page,
      cand({ role: 'button', acc_name: 'Save', text: 'Save now' }),
      cssDesc,
      cfg(['text', 'role']),
    );
    expect(label).toBe("getByText('Save now')");
  });
});

describe('rebuildLocator — intent preservation (original kind first)', () => {
  it('a renamed testid still heals on its testid, even if role+name exist', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'testid', value: 'submit' };
    const { label } = rebuildLocator(
      page,
      cand({ test_id: 'submit-btn', role: 'button', acc_name: 'Submit' }),
      desc,
    );
    // testid intent wins over the default role-first fallback.
    expect(label).toBe("getByTestId('submit-btn')");
  });

  it('a role locator without an accessible name preserves getByRole(role)', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'role', value: 'button' };
    const { label } = rebuildLocator(page, cand({ role: 'button' }), desc);
    expect(label).toBe("getByRole('button')");
  });

  it('a role locator uses the descriptor name when the candidate has none', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'role', value: 'button', options: { name: 'Go' } };
    const { label } = rebuildLocator(page, cand({ role: 'button' }), desc);
    expect(label).toBe("getByRole('button', { name: 'Go' })");
  });

  it('preserves label intent', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'label', value: 'Email' };
    const { label } = rebuildLocator(page, cand({ acc_name: 'Email address' }), desc);
    expect(label).toBe("getByLabel('Email address')");
  });

  it('preserves text intent', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'text', value: 'Hi' };
    const { label } = rebuildLocator(page, cand({ acc_name: 'Hello' }), desc);
    expect(label).toBe("getByText('Hello')");
  });

  it('preserves placeholder intent', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'placeholder', value: 'Search' };
    const { label } = rebuildLocator(page, cand({ placeholder: 'Search products' }), desc);
    expect(label).toBe("getByPlaceholder('Search products')");
  });

  it('preserves altText intent', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'altText', value: 'Logo' };
    const { label } = rebuildLocator(page, cand({ acc_name: 'Company logo' }), desc);
    expect(label).toBe("getByAltText('Company logo')");
  });

  it('preserves title intent', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'title', value: 'Info' };
    const { label } = rebuildLocator(page, cand({ acc_name: 'More info' }), desc);
    expect(label).toBe("getByTitle('More info')");
  });

  it('falls through when the original kind cannot be expressed (empty testid)', () => {
    const { page } = makePage();
    const desc: LocatorDescriptor = { kind: 'testid', value: 'x' };
    // No test_id on candidate, but it has role+name -> default fallback picks role.
    const { label } = rebuildLocator(page, cand({ role: 'button', acc_name: 'OK' }), desc);
    expect(label).toBe("getByRole('button', { name: 'OK' })");
  });
});

describe('rebuildLocator — css strategy and terminal fallback', () => {
  it('css strategy uses an id/attribute anchor', () => {
    const { page } = makePage();
    const { label } = rebuildLocator(page, cand({ element_id: 'email' }), cssDesc, cfg(['css']));
    expect(label).toBe("locator('#email')");
  });

  it('css strategy is skipped for a bare tag, reaching the terminal fallback', () => {
    const { page } = makePage();
    // list omits xpath; css cannot express a bare tag -> terminal suggestLocator.
    const { label } = rebuildLocator(page, cand({ tag: 'section' }), cssDesc, cfg(['css']));
    expect(label).toBe("locator('section')");
  });

  it('role strategy is skipped when role has no accessible name', () => {
    const { page } = makePage();
    // role present but no acc_name -> role strategy null -> terminal fallback.
    const { label } = rebuildLocator(page, cand({ role: 'button', tag: 'button' }), cssDesc, cfg(['role']));
    expect(label).toBe("locator('button')");
  });

  it('testid strategy is skipped when candidate has no testid', () => {
    const { page } = makePage();
    const { label } = rebuildLocator(page, cand({ tag: 'p' }), cssDesc, cfg(['testid']));
    expect(label).toBe("locator('p')");
  });
});
