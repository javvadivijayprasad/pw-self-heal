/**
 * Playwright fixture integration. `withSelfHealing(base, config)` returns a
 * `test` whose `page` fixture is transparently self-healing — no other change
 * to test code is required.
 */

import type { Page, TestType } from '@playwright/test';
import { wrapPage } from './heal';
import type { TestInfoLike } from './heal';
import type { EvaluatablePage } from './candidateExtractor';
import type { SelfHealConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTest = TestType<any, any>;

export function withSelfHealing<T extends AnyTest>(
  base: T,
  config: Partial<SelfHealConfig> = {},
): T {
  return base.extend({
    page: async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { page }: { page: Page },
      use: (p: Page) => Promise<void>,
      // Playwright's real `TestInfo` carries `titlePath` AND `attach(...)`; the
      // latter powers `captureDomOnFailure`. Forwarded structurally to wrapPage.
      testInfo: { titlePath?: string[] } & Partial<TestInfoLike>,
    ) => {
      const testId = testInfo?.titlePath?.join(' > ') ?? '';
      const healing = wrapPage(
        page as unknown as EvaluatablePage,
        { testId, ...config },
        { testInfo: testInfo as TestInfoLike },
      );
      await use(healing as unknown as Page);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as T;
}
