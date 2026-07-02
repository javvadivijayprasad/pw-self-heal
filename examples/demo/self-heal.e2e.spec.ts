/**
 * Real end-to-end self-healing demo.
 *
 * Run:
 *   npm install -D onnxruntime-node        # ml/hybrid model runtime (optional)
 *   npx playwright install chromium
 *   npx playwright test -c examples/demo/playwright.config.ts
 *
 * These tests load a page whose DOM has *drifted* (an id/testid/label was
 * renamed) and then use the ORIGINAL locator. A plain Playwright test would fail
 * red; with self-healing the locator is repaired against the live DOM and the
 * action completes. The last test proves there is NO false green: a genuinely
 * missing target must still fail.
 */
import { test as base, expect } from '@playwright/test';
// Import the BUILT package so we exercise exactly what ships to npm.
import { withSelfHealing } from '../../dist/index.js';

// hybrid = trained ONNX model + heuristic (falls back to heuristic if the model
// or onnxruntime-node is absent). telemetry '' keeps the demo from writing files.
const test = withSelfHealing(base, { mode: 'hybrid', telemetry: '' });

const SHOP = `<!doctype html><html><body>
  <h1>Checkout</h1>
  <!-- data-testid was "add-to-cart"; a refactor renamed it to "add-to-cart-btn" -->
  <button data-testid="add-to-cart-btn" id="buy">Add to cart</button>
  <!-- button text was "Sign in"; copy change made it "Log in" -->
  <button id="auth" type="button">Log in</button>
  <p id="status">idle</p>
  <script>
    document.getElementById('buy').addEventListener('click', () => {
      document.getElementById('status').textContent = 'in-cart';
    });
    document.getElementById('auth').addEventListener('click', () => {
      document.getElementById('status').textContent = 'authed';
    });
  </script>
</body></html>`;

test('heals a renamed data-testid and completes the click', async ({ page }) => {
  await page.setContent(SHOP);

  // The test still asks for the OLD testid — matches zero elements, so it heals
  // to getByTestId('add-to-cart-btn') and clicks it.
  await page.getByTestId('add-to-cart').click();
  // Web-first assertion on a wrapped locator — works because makeHealingProxy
  // keeps it a real Playwright Locator.
  await expect(page.locator('#status')).toHaveText('in-cart');

  const summary = (page as unknown as { getHealingSummary(): { totalHeals: number } }).getHealingSummary();
  // eslint-disable-next-line no-console
  console.log('HEAL SUMMARY (testid):', JSON.stringify(summary));
  expect(summary.totalHeals).toBeGreaterThan(0);
});

test('heals a reworded button via role+name', async ({ page }) => {
  await page.setContent(SHOP);

  // Author wrote "Sign in"; the button now says "Log in". Self-heal by intent.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#status')).toHaveText('authed');
});

test('does NOT false-heal a genuinely missing element', async ({ page }) => {
  await page.setContent('<main><h2>Empty page</h2><p>nothing to click</p></main>');

  // No plausible match exists — the heal must be rejected and the action fail.
  let threw = false;
  try {
    await page.getByTestId('add-to-cart').click({ timeout: 2500 });
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});
