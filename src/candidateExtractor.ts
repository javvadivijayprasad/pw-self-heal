/**
 * In-browser candidate extraction. The Python service parses HTML with
 * BeautifulSoup server-side; here we run extraction inside the page via
 * `page.evaluate`, reading the live DOM directly. Mirrors
 * `candidate_extractor.py`: preferred-tag priority, structural-tag skip,
 * dedupe by element id, cap at maxCandidates. Also captures the test-id,
 * a best-effort ARIA role, and an accessible-name approximation so the
 * locator-first healer can match on a locator's expressed intent.
 */

import type { CandidateElement } from './types';

/** Minimal slice of the Playwright Page API we depend on. */
export interface EvaluatablePage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

const PREFERRED_TAGS = ['input', 'button', 'a', 'select', 'textarea', 'label', 'div', 'span'];

export async function extractCandidates(
  page: EvaluatablePage,
  maxCandidates = 200,
  testIdAttribute = 'data-testid',
  preferredTags: string[] = PREFERRED_TAGS,
): Promise<CandidateElement[]> {
  return page.evaluate(
    ({ maxCandidates, preferredTags, testIdAttribute }) => {
      const NON_CANDIDATE = new Set([
        'html', 'head', 'body', 'script', 'style', 'meta', 'title', 'link', 'base', 'noscript',
      ]);

      function depth(el: Element): number {
        let d = 0;
        let p = el.parentElement;
        while (p) {
          d++;
          p = p.parentElement;
        }
        return d;
      }
      function siblingCount(el: Element): number {
        const parent = el.parentElement;
        if (!parent) return 0;
        let n = 0;
        for (const child of Array.from(parent.children)) {
          if (child.tagName === el.tagName) n++;
        }
        return n - 1;
      }
      function cssHint(el: Element): string {
        let hint = el.tagName.toLowerCase();
        if (el.id) hint += `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          hint += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        return hint;
      }
      function implicitRole(el: Element): string {
        const explicit = el.getAttribute('role');
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'img') return 'img';
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'input') {
          if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          if (['', 'text', 'email', 'tel', 'url', 'password', 'search'].includes(type)) return 'textbox';
        }
        return '';
      }
      function accName(el: Element): string {
        const e = el as HTMLElement;
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const txt = (e.innerText || el.textContent || '').trim();
        if (txt) return txt.slice(0, 200);
        const ph = el.getAttribute('placeholder');
        if (ph && ph.trim()) return ph.trim();
        const alt = el.getAttribute('alt');
        if (alt && alt.trim()) return alt.trim();
        const title = el.getAttribute('title');
        if (title && title.trim()) return title.trim();
        const val = el.getAttribute('value');
        return val ? val.trim() : '';
      }
      function toCandidate(el: Element) {
        const e = el as HTMLElement;
        return {
          tag: el.tagName.toLowerCase(),
          text: (e.innerText || el.textContent || '').trim().slice(0, 200),
          element_id: el.id || '',
          name: el.getAttribute('name') || '',
          class_name: typeof el.className === 'string' ? el.className : '',
          placeholder: el.getAttribute('placeholder') || '',
          aria_label: el.getAttribute('aria-label') || '',
          type_attr: el.getAttribute('type') || '',
          value_attr: el.getAttribute('value') || '',
          parent_tag: el.parentElement ? el.parentElement.tagName.toLowerCase() : '',
          dom_depth: depth(el),
          sibling_count: siblingCount(el),
          css_path_hint: cssHint(el),
          test_id: el.getAttribute(testIdAttribute) || '',
          role: implicitRole(el),
          acc_name: accName(el),
        };
      }

      const out: ReturnType<typeof toCandidate>[] = [];
      const seenIds = new Set<string>();
      const push = (el: Element) => {
        const cand = toCandidate(el);
        if (cand.element_id && seenIds.has(cand.element_id)) return;
        if (cand.element_id) seenIds.add(cand.element_id);
        out.push(cand);
      };

      for (const tagName of preferredTags) {
        if (out.length >= maxCandidates) break;
        for (const el of Array.from(document.getElementsByTagName(tagName))) {
          if (out.length >= maxCandidates) break;
          push(el);
        }
      }
      if (out.length < maxCandidates) {
        for (const el of Array.from(document.getElementsByTagName('*'))) {
          if (out.length >= maxCandidates) break;
          const tag = el.tagName.toLowerCase();
          if (preferredTags.includes(tag)) continue;
          if (NON_CANDIDATE.has(tag)) continue;
          push(el);
        }
      }
      return out;
    },
    { maxCandidates, preferredTags, testIdAttribute },
  );
}
