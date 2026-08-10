# Roadmap

What's shipped and what's coming next for `@vijaypjavvadi/pw-self-heal`.
We aim for a **monthly release cadence**. Dates are targets and may shift; the
scope of each release is the commitment, the exact day is not.

## Current release

### v1.0.0 — July 2026 ✅ (available now)

First stable release.

- In-process self-healing for Playwright locators — no server, no API key.
- Trained 17-feature ONNX ranker (GB AUC 0.9993 / XGB 0.9994); heuristic, `ml`,
  and `hybrid` modes.
- Intent-aware healing for `getByRole` / `getByTestId` / `getByLabel` /
  `getByText` / `getByPlaceholder` / `getByAltText` / `getByTitle` and string
  selectors.
- Wrapped locators stay real Playwright `Locator` objects, so web-first
  assertions (`expect(locator).toBeVisible()`, `.toHaveText()`, …) work.
- Bounded fast-heal via `healTimeout`; heal telemetry + `pw-self-heal report`.

---

## Upcoming releases

### v1.1.0 — August 2026 (next)

**Optional governed LLM fallback.** Model-first healing, with an opt-in LLM rung
that only fires when the local ranker can't clear the confidence threshold.

- Bring your own provider/key (Anthropic / OpenAI / Gemini); off by default.
- The LLM chooses among the DOM candidates the extractor already found — it can't
  invent a brittle selector.
- All context passes through an in-process sanitizer first (no PII/secret
  egress). Stays a single `npm install` — LLM SDKs are optional dependencies.
- Design: [`docs/llm-fallback-design.md`](docs/llm-fallback-design.md).

### v1.2.0 — September 2026

**Deeper healing + a learning loop.**

- Chained / sub-locator healing — `.filter()`, `.nth()`, and nested `.locator()`
  become healing-aware (currently returned unwrapped).
- `recordFeedback(original, correct)` to mark heals right/wrong, feeding a
  retraining dataset.

### v1.3.0 — October 2026

**Ergonomics + coverage.**

- XGBoost ranker option (`algorithm: 'xgb'`) once the pipeline→ONNX export lands.
- Safer `autoUpdateSource`: write healed selectors back into the test source with
  review guards.
- Smarter fast-heal (instant short-circuit for truly-absent locators) and heal
  cache tuning.
- Deprecation warnings for any config options changing in 2.0 (no breakage yet).

### v2.0.0 — Q4 2026 (target November–December)

**Next-generation model + a cleaner API.** The first release allowed to make
breaking changes.

- Retrained / expanded ranker (additional DOM features) — changes model
  semantics and default thresholds, hence the major bump.
- Config cleanup: remove options deprecated in 1.3, tidy defaults.
- Node baseline review (raise minimum only if it buys something concrete).
- A documented migration guide from 1.x.

---

## The wider suite (separate packages, their own versions)

`pw-self-heal` is one tool in a family of independently-published Playwright
extensions. Each ships as its **own npm package with its own version line** — so
you install only what you need, and a fix in one never forces a bump in another.
These are **not** pw-self-heal releases; they track separately.

| Package | What it does | Status |
|---|---|---|
| `@vijaypjavvadi/pw-self-heal` | Self-healing locators (this package) | **Live — 1.0.0** |
| `@vijaypjavvadi/pw-triage` | Reporter that classifies failures (real-defect / flake / environmental) and scores flakiness across runs | Planned — Q3 2026 |
| `@vijaypjavvadi/pw-perf` | Reporter + fixture capturing API / page-load / action latency and flagging budget breaches in CI | Planned — Q3 2026 |
| `@vijaypjavvadi/pw-select` | Test-impact analysis (run only affected tests) + history-driven scheduling/sharding to cut CI time | Planned — Q4 2026 |
| `@vijaypjavvadi/testforge` | Umbrella CLI bundling the suite (and `bdd2pw`, `sel2pw`) behind one command | Planned — Q3 2026 |

All follow the same principles as `pw-self-heal`: deterministic core, no server,
no required network, works inside the test run you already have.

---

## Versioning

We follow [semantic versioning](https://semver.org): `1.0.x` for fixes, `1.x.0`
for backward-compatible features, `2.0.0` for breaking changes. Have a request or
a bug? Open an issue at
<https://github.com/javvadivijayprasad/pw-self-heal/issues>.
