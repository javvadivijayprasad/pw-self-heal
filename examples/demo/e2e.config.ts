import { defineConfig } from '@playwright/test';

// Runs the pre-publish end-to-end heal demo (self-heal.e2e.spec.ts), which
// imports the built dist/ directly so it works without the package being
// published. Run: npx playwright test -c examples/demo/e2e.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.spec.ts',
  timeout: 30_000,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});
