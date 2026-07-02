import { test as base, expect } from '@playwright/test';
import { withSelfHealing } from '@vijaypjavvadi/pw-self-heal';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Self-healing test. We deliberately load the page in its *refactored* state
// (?v=2) where the data-testids and an id have been renamed, but we still ask
// for the ORIGINAL locators — pw-self-heal recovers each one at runtime.
const test = withSelfHealing(base, { mode: 'heuristic', logHeals: true });

const APP = pathToFileURL(join(__dirname, 'app.html')).href;

test('shop flow survives a UI refactor', async ({ page }) => {
  await page.goto(`${APP}?v=2`);

  // 'add-to-cart' was renamed to 'add-to-cart-btn' -> heals on testid.
  await page.getByTestId('add-to-cart').click();
  await expect(page.locator('#status')).toHaveText('Add to cart OK');

  // Button reworded 'Sign in' -> 'Log in' -> heals on role + accessible name.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#status')).toHaveText('Log in OK');

  // The original test never changed; the heals are logged to .pwheal/.
});
