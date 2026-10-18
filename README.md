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

### Resilience to context restarts & stale elements

Healing also recovers when the Playwright **browser context or page restarts**
mid-run — a context closed and recreated, a page that crashed or reloaded, or a
navigation that destroys the execution context. These surface as
`Target closed` / `Execution context was destroyed` /
`Element is not attached to the DOM`-class errors, which pw-self-heal classifies
as a distinct **stale / context-restart** condition (separate from a zero-match
miss or a real defect). When that happens, a **cached heal bound to the old page
is invalidated** and the action is **re-resolved against the live page** (the
original locator first, then a fresh heal) rather than failing with the stale
error; and a heal in progress is **aborted cleanly** so it is never fabricated
against a dead DOM. The guard adds no overhead on the normal, no-restart path.

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

### Ranking decisions: `LocatorScore`

Every heal event carries an optional `scores: LocatorScore[]` — the top-N
ranked candidates (N = `topK`, best first) that produced the decision. It is a
clean, public projection of the internal ranking, meant for logging,
dashboards, or custom re-ranking:

```ts
interface LocatorScore {
  locator: string;        // rebuilt/suggested locator string for this candidate
  finalScore: number;     // blended score used for the accept/reject decision
  mlProbability: number;  // model probability in [0,1] (0 if heuristic-only)
  heuristicScore: number; // heuristic-only similarity score
  mode: 'heuristic' | 'ml' | 'hybrid'; // effective ranker mode
  rank: number;           // rank among candidates (1 = best)
}
```

Read them off the summary (or the telemetry JSONL — each line is a `HealEvent`):

```ts
for (const heal of page.getHealingSummary().heals) {
  for (const s of heal.scores ?? []) {
    console.log(`#${s.rank} ${s.locator} finalScore=${s.finalScore} (${s.mode})`);
  }
}
```

You can also convert a `HealResult` yourself with the exported helpers
`scoresFromResult(result)` or `toLocatorScore(scoredCandidate, mode)`.

### Test identity: `HealEvent.test`

Every heal event carries an optional `test` object copied from the Playwright
`TestInfo` available to the fixture (and to `wrapPage` when you forward
`testInfo`). It lets you JOIN heal events to Playwright test results without
guessing from timestamps:

```ts
interface HealEventTest {
  title?: string;        // testInfo.title
  titlePath?: string[];  // testInfo.titlePath
  file?: string;         // testInfo.file
  testId?: string;       // testInfo.testId
}
```

Each sub-field is guarded, so `test` is cleanly ABSENT in the imperative
`wrapPage` path when no test info is supplied. It appears in both
`getHealingSummary()` and the telemetry JSONL.

### Outcome vocabulary: `HealOutcome` (stable 1.x contract)

`HealOutcome` is a **frozen, documented discriminated union** you can `switch`
on across the entire **1.x** line. Its four members and their payloads are a
SemVer contract — they only ever change additively:

```ts
type HealOutcome =
  | { kind: 'healed'; selector: string; score: number }      // candidate accepted
  | { kind: 'notHealable'; class: ErrorClass }               // assertion/loading/stale/fatal
  | { kind: 'belowThreshold'; score: number; threshold: number } // best candidate too weak
  | { kind: 'noCandidates' };                                // extraction found nothing
```

- `HealResult.outcome` is set by the ranker to `healed`, `belowThreshold`, or
  `noCandidates`.
- `HealEvent.outcome` is attached to recorded heals (always `kind: 'healed'`).
- `notHealable` is produced from a classified failure via the exported
  `notHealableOutcome(errorClass)` helper (returns `null` for the locator-miss
  classes `healable` / `retryable`, which proceed to ranking).

This is purely additive: the pre-existing `HealResult.healed: boolean` is
unchanged.

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
| `fallbackStrategy` | `['role', 'text', 'testid', 'xpath']` | ordered strategies for expressing a healed locator (semantic first, brittle path last) |

### Fallback strategy

When a heal is accepted, the healed locator has to be *expressed* against the
winning candidate. `fallbackStrategy` controls how, using this precedence:

1. **Intent preservation.** The original locator's own kind is tried first, so a
   renamed `data-testid` re-heals on `getByTestId`, a role on `getByRole`, a
   label on `getByLabel`, and so on. This step is skipped for raw `css` / `xpath`
   locators, which carry no semantic modality to preserve.
2. **Configured fallback.** For anything the original kind can't express, the
   healer walks `fallbackStrategy` in order and uses the **first** strategy the
   candidate supports. The default is `['role', 'text', 'testid', 'xpath']` —
   most robust/semantic first, brittle path last. A strategy is *usable* when:
   - `role` — candidate has both a role **and** an accessible name;
   - `text` — candidate has non-empty text;
   - `testid` — candidate exposes the `testIdAttribute` value;
   - `css` — candidate has an id or a distinctive attribute (name / placeholder /
     aria-label);
   - `xpath` — always available (last-resort `page.locator(...)` path).
3. **Terminal fallback.** If your custom list omits `xpath` and nothing else
   fits, a guaranteed CSS/path locator is used.

Override the order (e.g. prefer stable test ids over roles):

```ts
const page = withSelfHealing(basePage, {
  fallbackStrategy: ['testid', 'role', 'text', 'css', 'xpath'],
});
```

Omitting `fallbackStrategy` keeps the default order — fully backward compatible.

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
DOI: **10.5281/zenodo.19684439**. See the [**model card**](docs/model-card.md)
for architecture, features, training data, metrics, intended use, and
limitations, and [`models/README.md`](models/README.md) to export the ONNX models
from the trained pickles. The TypeScript feature port is verified for
byte-for-byte parity with the reference implementation.

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
