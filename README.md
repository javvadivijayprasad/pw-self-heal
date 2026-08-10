# @vijaypjavvadi/pw-self-heal

> Self-healing locators for Playwright that run **in-process — no server, no Python**.
> When a locator breaks, the live DOM is searched for the best replacement using a
> trained 17-feature similarity model plus the locator's own intent, the action is
> retried, and the heal is logged.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19684439.svg)](https://doi.org/10.5281/zenodo.19684439)

Part of the **Playwright Extensions** suite (`pw-self-heal`, `pw-triage`, `pw-perf`).

📍 See the [**Roadmap**](ROADMAP.md) for what's shipping next.

## Why

UI churn breaks locators even when the element still exists — a renamed
`data-testid`, a reworded button, a moved input. Most tests then fail for a
cosmetic reason. `pw-self-heal` recovers at runtime, entirely inside your test
process: the DOM never leaves the machine, there is no API key, and the default
mode makes no network call. Healing only runs on the **failure path**, so passing
tests pay zero overhead.

## How it compares

Most self-healing tools sit in one of three camps, each with a catch. `pw-self-heal`
is the only one that pairs a **trained, benchmarked, citable model** with a fully
in-process runtime.

| Approach | Needs a server? | Needs an API key? | Trained model? | DOM stays local? |
|---|---|---|---|---|
| Server-backed ML (e.g. FastAPI + Postgres/Redis) | **Yes** | no | yes | no |
| LLM-only (cloud or local Ollama) | no / local LLM | **usually** | no (general LLM) | **no** (cloud) |
| Heuristic-only (attribute/string similarity) | no | no | **no** | yes |
| **`pw-self-heal`** | **no** | **no** | **yes — ONNX, GB AUC 0.9993** | **yes** |

The ranking model is published with a Zenodo DOI
([10.5281/zenodo.19684439](https://doi.org/10.5281/zenodo.19684439)) — heuristic,
ML (ONNX), and hybrid modes, with an optional governed LLM fallback on the roadmap
([design](docs/llm-fallback-design.md)).

## Install

```bash
npm install -D @vijaypjavvadi/pw-self-heal
# optional: ML / hybrid ranking
npm install -D onnxruntime-node
```

## Quick start

Wrap the `page` fixture once — every test heals, with no other change:

```ts
import { test as base, expect } from '@playwright/test';
import { withSelfHealing } from '@vijaypjavvadi/pw-self-heal';

export const test = withSelfHealing(base, { mode: 'hybrid' });

test('checkout still works after a data-testid rename', async ({ page }) => {
  await page.goto('https://shop.example.com');
  // 'add-to-cart' was renamed to 'add-to-cart-btn' in a refactor —
  // this self-heals to getByTestId('add-to-cart-btn') and keeps going.
  await page.getByTestId('add-to-cart').click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
```

## Using it in your framework

`pw-self-heal` wraps Playwright's own `page`, so it drops into whatever you already
use — no test rewrites, no new locator API to learn. Wrapped locators are **real
Playwright `Locator` objects**, so `expect(locator).toBeVisible()`,
`.toHaveText()`, chaining, and every other Playwright feature keep working; only
the action methods (`click`, `fill`, `type`, …) gain healing.

### 1. `@playwright/test` (fixtures) — recommended

Wrap the base `test` once in a shared fixtures file and import it everywhere:

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

test('checkout', async ({ page }) => {
  await page.getByTestId('add-to-cart').click();          // heals on drift
  await expect(page.getByText('Order confirmed')).toBeVisible(); // normal assertion
});
```

### 2. Page Object Model

Because healing lives on the `page` fixture, **every Page Object that receives
`page` heals automatically — your POM classes need no changes:**

```ts
// LoginPage.ts — unchanged, ordinary Playwright code
export class LoginPage {
  constructor(private page: Page) {}
  async login(user: string, pass: string) {
    await this.page.getByLabel('Username').fill(user);            // heals if label moved
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}

// login.spec.ts
import { test } from './fixtures';       // the healing test
test('login', async ({ page }) => {
  await new LoginPage(page).login('me', 'secret');  // page is already healing
});
```

### 3. Cucumber / BDD

Wrap the page you keep on the World in your `Before` hook:

```ts
import { wrapPage } from '@vijaypjavvadi/pw-self-heal';

Before(async function (scenario) {
  const raw = await this.context.newPage();
  this.page = wrapPage(raw, { mode: 'hybrid', testId: scenario.pickle.name });
});
// Step definitions call this.page.getByRole(...).click() as usual.
```

### 4. Raw Playwright (no test runner)

```ts
import { chromium } from 'playwright';
import { wrapPage } from '@vijaypjavvadi/pw-self-heal';

const browser = await chromium.launch();
const page = wrapPage(await browser.newPage(), { mode: 'hybrid' });
await page.goto('https://app.example.com');
await page.getByTestId('save').click();   // heals on drift, then continues
```

### Gradual adoption

Import the healing `test` only in the specs you want to protect; the rest keep
using plain `@playwright/test`. Start with `mode: 'heuristic'` (zero native deps,
no model) to evaluate, then switch to `'hybrid'` once you add `onnxruntime-node`.

## What it heals

**Locator builders** (the modern API — the headline):
`getByRole`, `getByTestId`, `getByLabel`, `getByText`, `getByPlaceholder`,
`getByAltText`, `getByTitle`, and `page.locator(css | xpath)`.

When a locator resolves to **zero elements**, pw-self-heal captures what the
locator was asking for (role + name, testid, label, text…), ranks the live DOM
candidates with the model, re-weights them toward that intent, rebuilds an
equivalent locator against the best match, and retries. The heal is reported in
the same modality — `getByTestId('add-to-cart')` heals to
`getByTestId('add-to-cart-btn')`, not to a brittle CSS path.

**Legacy string selectors** are also healed: `page.click('#id')`,
`page.fill('[name="x"]', …)`, etc.

> Intent-aware ranking is what makes testid/role healing accurate: the trained
> model scores id/name/text/aria similarity, and the intent boost adds the signal
> the author actually expressed — so a renamed testid heals on its testid.

## Modes

| Mode | Needs model? | Notes |
|---|---|---|
| `heuristic` | no | 6-weighted features. Always available, zero native deps. |
| `ml` | yes (ONNX) | Trained GB/XGB ranker via `onnxruntime-node`. |
| `hybrid` | yes (ONNX) | `0.4·heuristic + 0.6·ml` — the production default (68.63% HSR). |

If the model or `onnxruntime-node` is missing, `ml`/`hybrid` fall back to
`heuristic` with a one-time warning. Acceptance thresholds: heuristic `0.45`,
ml/hybrid `0.50` (override with `confidence`).

## Inspecting heals

```ts
const test = withSelfHealing(base, { mode: 'hybrid' });
// after a test:
//   page.getHealingSummary() -> { totalHeals, cachedLocators, heals[] }
```

Every heal is also appended to `.pwheal/heal-events.jsonl`. Summarize a run:

```bash
pw-self-heal report --in .pwheal/heal-events.jsonl
```

## Configuration

| Option | Default | Description |
|---|---|---|
| `mode` | `'hybrid'` | `heuristic` \| `ml` \| `hybrid` |
| `confidence` | mode threshold | minimum score to accept a heal |
| `telemetry` | `.pwheal/heal-events.jsonl` | JSONL heal log (`''` to disable) |
| `testIdAttribute` | `'data-testid'` | attribute used by `getByTestId` |
| `healTimeout` | `5000` | ms to wait for the original locator before treating it as missing and healing (keeps a broken locator from stalling the full action timeout) |
| `autoUpdateSource` | `false` | rewrite the selector in the test source on heal |
| `maxCandidates` | `200` | DOM candidates to score |

## How it works

1. Give the (possibly cached) locator up to `healTimeout` ms to resolve. A present
   element runs the action normally — passing tests pay ~zero overhead — instead
   of stalling on Playwright's full action timeout when a locator is broken.
2. If it never appears (or the action fails while the locator matches zero
   elements), treat it as a heal candidate. A locator that still matches is a real
   failure and is rethrown untouched.
3. Extract DOM candidates, score them with the model, and re-rank toward the
   locator's intent.
4. Rebuild an equivalent locator against the best candidate ≥ threshold and retry.
5. On success → cache the heal (so it's instant next time), append a telemetry
   event, optionally rewrite source. On failure → rethrow the original error.

## Model & citation

The ranker is trained (GB AUC 0.9993 / XGB 0.9994) and published with a Zenodo
DOI: **10.5281/zenodo.19684439**. See [`models/README.md`](models/README.md) to
export the ONNX models from the trained pickles. The TypeScript feature port is
verified for byte-for-byte parity with the reference implementation.

## How to cite

If you use `pw-self-heal` in academic work, please cite it. A
[`CITATION.cff`](CITATION.cff) is included (GitHub shows a "Cite this repository"
button), or use:

> Javvadi, V. P. (2026). *pw-self-heal: In-Process Self-Healing Locators for
> Playwright with a Trained Similarity Ranker* (Version 1.0.0) [Computer software].
> https://doi.org/10.5281/zenodo.19684439

The DOI resolves to the archived trained ranking model (GB AUC 0.9993 / XGB AUC
0.9994) that powers the `ml` and `hybrid` modes.

## License

MIT © Vijay P. Javvadi
