# pw-self-heal v1.0.0

**Self-healing Playwright locators that run in-process — no server, no API key.**
When a locator breaks after a UI change, a trained ONNX model repairs it against
the live DOM at runtime, retries the action, and keeps your test green.

First stable release. `npm install -D @vijaypjavvadi/pw-self-heal`

---

## Why this exists

UI churn breaks locators even when the element still works — a renamed
`data-testid`, a reworded button, a moved input. Most suites then fail red for a
purely cosmetic reason. `pw-self-heal` recovers at runtime, entirely inside your
test process: the DOM never leaves the machine, there's no API key, and the
default path makes no network call. Healing only runs on the failure path, so
passing tests pay ~zero overhead.

It's the only self-healing tool on npm that pairs a **trained, benchmarked,
citable model** with a fully in-process runtime — no FastAPI/Postgres backend, no
cloud LLM, no Ollama install.

## Highlights

- **Trained ranking model, shipped as ONNX.** 17-feature ranker published with a
  Zenodo DOI ([10.5281/zenodo.19684439](https://doi.org/10.5281/zenodo.19684439)).
  Gradient Boosting AUC **0.9993**, XGBoost AUC **0.9994**; hybrid mode reaches
  **68.63% heal success rate**, +4.05pp over the heuristic baseline.
- **In-process, private by default.** No server, no API key, DOM stays local.
- **Intent-aware healing.** `getByTestId('add-to-cart')` heals to
  `getByTestId('add-to-cart-btn')` — same modality, not a brittle CSS path.
- **Drop-in.** Wrap the `page` fixture once; every test (and every Page Object)
  heals with no rewrites.
- **Real Playwright locators.** Wrapped locators stay genuine `Locator` objects,
  so `expect(locator).toBeVisible()` / `.toHaveText()` and all web-first
  assertions keep working.
- **Bounded fast-heal.** A broken locator is detected within `healTimeout`
  (default 5s) instead of stalling on the full Playwright action timeout.
- **Three modes** — `heuristic` (zero native deps), `ml`, `hybrid` (default).
- **Heal telemetry + report** — every heal logged to `.pwheal/heal-events.jsonl`;
  `pw-self-heal report` summarizes a run.

## Install

```bash
npm install -D @vijaypjavvadi/pw-self-heal
# optional, for ml / hybrid ranking:
npm install -D onnxruntime-node
```

Requires Node ≥ 18 and `@playwright/test` ≥ 1.40 (peer, optional).

## Quick start

```ts
// fixtures.ts
import { test as base } from '@playwright/test';
import { withSelfHealing } from '@vijaypjavvadi/pw-self-heal';
export const test = withSelfHealing(base, { mode: 'hybrid' });
export { expect } from '@playwright/test';
```

```ts
// any.spec.ts
import { test, expect } from './fixtures';

test('checkout survives a UI refactor', async ({ page }) => {
  await page.goto('https://shop.example.com');
  await page.getByTestId('add-to-cart').click();            // heals on drift
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
```

Works the same with Page Objects, Cucumber/BDD (`wrapPage` on the World), and raw
Playwright — see the [README](../README.md#using-it-in-your-framework).

## Modes & thresholds

| Mode | Needs model? | Notes |
|---|---|---|
| `heuristic` | no | 6-weighted features, zero native deps |
| `ml` | yes (ONNX) | trained GB/XGB ranker via `onnxruntime-node` |
| `hybrid` | yes (ONNX) | `0.4·heuristic + 0.6·ml` — default, 68.63% HSR |

If the model or `onnxruntime-node` is absent, `ml`/`hybrid` degrade to `heuristic`
with a one-time warning. Thresholds: heuristic `0.45`, ml/hybrid `0.50`.

## Verified

- Unit tests: feature-parity with the reference implementation.
- Model check: the shipped ONNX ranker heals a real locator drift and rejects
  unrelated elements (no false green).
- End-to-end: a real Chromium run heals a renamed `data-testid` and a reworded
  button, confirms a genuinely missing element still fails, and confirms
  `expect(locator)` web-first assertions work against wrapped locators.

## Citation

A [`CITATION.cff`](../CITATION.cff) is included. The trained ranking model is
archived at [10.5281/zenodo.19684439](https://doi.org/10.5281/zenodo.19684439).

## Links

- npm: https://www.npmjs.com/package/@vijaypjavvadi/pw-self-heal
- Trained model (Zenodo DOI): https://doi.org/10.5281/zenodo.19684439
- Optional governed LLM fallback (design): `docs/llm-fallback-design.md`

## License

MIT © Vijay P. Javvadi
