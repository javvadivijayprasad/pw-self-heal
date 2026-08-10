# Creating pw-self-heal: a self-healing locator agent for Playwright

A write-up of how `@vijaypjavvadi/pw-self-heal` was built — from a trained
research model to a published, in-process npm package that repairs broken
Playwright locators at runtime.

---

## The problem

Playwright tests find elements with **locators** — `getByTestId('add-to-cart')`,
`getByRole('button', { name: 'Sign in' })`, `page.locator('#buy')`. Locators are
tied to the page's markup, so the day a teammate renames a `data-testid`, rewords
a button, or moves an input, the locator matches nothing and the test fails red —
even though the element still works perfectly for a real user. Across a large
suite this happens constantly, and the failures are cosmetic, not real defects.

The goal of pw-self-heal is a small **agent that runs inside the test process**:
when a locator resolves to zero elements, it finds the best replacement in the
live DOM, retries the action, logs the heal, and lets the test continue — with no
server, no API key, and the DOM never leaving the machine.

## Where the intelligence came from

The healing *science* already existed as a Python service
(`self_healing_stage_services`): a trained 17-feature similarity ranker that
scores how well a candidate DOM element matches the original locator's intent.
Reported metrics — **Gradient Boosting AUC 0.9993, XGBoost AUC 0.9994**, hybrid
mode **68.63% heal success rate** (+4.05pp over a pure heuristic). The model is
archived on Zenodo (DOI **10.5281/zenodo.19684439**).

The problem with that form factor: nobody stands up a FastAPI service (plus
Postgres and Redis) just to run their Playwright suite. So the package's real
contribution was **porting the ranker to TypeScript and shipping the model as
ONNX**, so a developer gets healing from a single `npm install` and a one-line
fixture change.

## How the agent works

The runtime pipeline, per intercepted action:

1. Give the original locator a bounded window (`healTimeout`, default 5s) to
   appear. A present element runs normally — passing tests pay ~zero overhead.
2. If it never appears, treat it as a heal candidate (a locator that still
   matches is a real failure and is rethrown untouched).
3. Extract candidate elements from the live DOM (`page.evaluate`), capped and
   deduped.
4. Score every candidate with the trained model, then re-rank toward the
   locator's **intent** — a renamed `data-testid` heals on its testid, not on a
   brittle CSS path.
5. Rebuild an equivalent locator against the best candidate above threshold,
   retry the action, cache the heal for the rest of the run, and log it.

Three modes: `heuristic` (no model, zero native deps), `ml` (trained ONNX ranker
via `onnxruntime-node`), and `hybrid` (`0.4·heuristic + 0.6·ml`, the default).
If the model or runtime is absent, ml/hybrid degrade gracefully to heuristic.

## Engineering decisions that made it real

Porting a research model into a dependable library surfaced several problems that
only show up when you actually ship:

- **Model export.** The trained `.pkl` files are joblib-serialised sklearn
  Pipelines, not plain pickles — `pickle.load` fails on them. The export script
  had to use `joblib.load`, and the environment had to pin the exact training
  versions (scikit-learn 1.8.0 / xgboost 3.2.0) or the model wouldn't unpickle.
  The whole pipeline (scaler + classifier) is converted with `skl2onnx` so
  scaling happens inside the ONNX graph and TypeScript feeds raw features.

- **Fast-heal, not slow-fail.** A first cut let Playwright auto-wait the full
  action timeout (often 30s) before healing even started — so a real test hung
  for 30s on every broken locator. Wiring the existing `healTimeout` config into
  the action path made the miss detected in ~5s and healed immediately, while a
  present element still resolves instantly.

- **Staying a real `Locator`.** Wrapping locators in a bespoke class broke
  Playwright's web-first assertions (`expect(locator).toBeVisible()`), because
  `expect` checks that it received a genuine `Locator`. The fix was a `Proxy`
  around the real locator: healable actions route through the healing logic;
  everything else — including the identity checks `expect` relies on — delegates
  to the real locator. Assertions work unchanged.

## Verification

Correctness was established at three levels:

1. **Unit** — the TypeScript feature computation matches the Python reference for
   a fixture set (byte-for-byte parity guards the model's input distribution).
2. **Model check** — the exported ONNX ranker, run through the real ranker,
   heals a genuine locator drift (model probability 1.000, final score 0.925) and
   rejects unrelated elements (no false green).
3. **End-to-end** — a real Chromium run heals a renamed `data-testid` and a
   reworded button, confirms a genuinely missing element still fails, and
   confirms web-first assertions work against wrapped locators.

## The next step: a governed LLM fallback

The roadmap's headline feature keeps the local model as the primary ranker and
adds an **optional** LLM rung that only fires on the hard misses the model can't
score confidently. Two design principles keep it honest: the LLM only *chooses
among the DOM candidates the extractor already found* (it can't invent a brittle
selector), and all context passes through an in-process sanitizer first, so the
package stays a single install with no forced network egress. This is the
"agentic" extension — local intelligence first, a governed model second.

## Shipping it

Published to npm as `@vijaypjavvadi/pw-self-heal` (MIT), with the trained model in
the tarball, a `CITATION.cff` linking the Zenodo DOI, CI on Node 18/20/22, and
Trusted Publishing (OIDC) for token-free releases. It is, as of writing, the only
self-healing Playwright locator package on npm that pairs a **trained,
benchmarked, citable model** with a fully in-process runtime.

## What made it work

- Start from a proven model, not a blank page — the accuracy was already earned.
- Treat packaging as the product: the differentiator was removing the server, not
  inventing new science.
- Let real tests find the real bugs — the 30s hang and the broken assertions only
  showed up in an actual browser run, not in unit tests.
- Be honest about scope: ship the local model now, keep the LLM opt-in and
  governed, and document the limitations rather than hide them.
