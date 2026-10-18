# Changelog

All notable changes to `@vijaypjavvadi/pw-self-heal` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-10-18

Driven by the attestqa integration's evaluation runs (Toolshop, Juice Shop):
additive error-diagnosis and offline-extraction APIs so a downstream caller can
tell assertion/loading failures from locator failures, inspect why, and rank
candidates from saved HTML. No breaking changes.

### Added

- **Test identity on telemetry (`HealEvent.test`).** Heal events now carry an
  optional `test?: { title?; titlePath?; file?; testId? }` populated from the
  Playwright `TestInfo` available to the fixture / `wrapPage`. Lets consumers
  JOIN heal events to Playwright test results without guessing from timestamps.
  Each sub-field is guarded (cleanly absent in the imperative `wrapPage` path
  with no test info); the identity lands in both `getHealingSummary()` and the
  telemetry JSONL. New exported helper `testMetaFrom(testInfo)`. Backward
  compatible (optional + additive).
- **Stable outcome vocabulary (`HealOutcome`).** A new exported, documented
  discriminated union — a SemVer 1.x contract consumers can `switch` on:
  `{ kind: 'healed'; selector; score }`, `{ kind: 'belowThreshold'; score;
  threshold }`, `{ kind: 'noCandidates' }`, and `{ kind: 'notHealable';
  class }` (where `class` is the failure `ErrorClass`). Attached to
  `HealResult.outcome` (set by the ranker to `healed` / `belowThreshold` /
  `noCandidates`) and surfaced on `HealEvent.outcome` for recorded heals. The
  `notHealable` variant is produced from a classified failure via the new
  exported `notHealableOutcome(errorClass)` helper. Purely additive — the
  existing `HealResult.healed: boolean` is unchanged.

- **Assertion & loading error classes (`classifyError`).** `ErrorClass` gains two
  additive members, `'assertion'` and `'loading'`, alongside the existing
  `'stale' | 'healable' | 'retryable' | 'fatal'`. The classification precedence is
  now **stale → healable → retryable → loading → assertion → fatal** (first match
  wins):
  - **`assertion`** — a Playwright `expect(...)` failure where the locator
    RESOLVED but a value/text/class/attribute/count didn't match. Detected from a
    `Received:` line and/or an `expect(` call paired with
    `toHaveText|toBeTruthy|toHaveClass|toHaveCount|toHaveAttribute|toEqual|toBe`.
    Never treated as healable: changing the locator cannot fix a value mismatch.
    (The broad `waiting for locator` heal signal is suppressed for assertions,
    while explicit zero-match phrases still heal.)
  - **`loading`** — an assertion that failed because the element is still loading:
    a `skeleton|placeholder|shimmer|loading|spinner` class on the element or an
    ancestor, `aria-busy="true"`, or an empty element whose same-shape siblings
    have text. Detected from the live DOM via the optional `page`, or from a
    loading signal in the message alone when no DOM is available.
  - **Backward compatible.** The old four classes are unchanged. Consumers that do
    NOT explicitly handle `'assertion'`/`'loading'` should treat them as `'fatal'`
    (surface them; never auto-heal or silently retry). The internal heal paths do
    exactly this.
- **`diagnose(err, page?)`.** A new async API that explains *why* an action or
  assertion failed. Returns `{ class, selector?, expected?, received?, matched?,
  stateElsewhere?, hint }` — the error class (incl. `'assertion'`/`'loading'`),
  the parsed selector and `Expected:`/`Received:` values, how many elements the
  selector resolves to now (`matched`, when a `page` is given), and a
  one-sentence `hint` for a person or agent.
- **`failedSelectorOf(message)`.** One standalone parser that extracts the failed
  selector/locator from every Playwright message shape — `waiting for
  locator('…')`, `Locator: getByRole('button', { name: 'Log in' })`, and
  `locator.click: Timeout … waiting for getByTestId('x')`.
- **`stateElsewhere` (P0-3).** When an assertion is about a class (`toHaveClass`)
  or ARIA/checked state (`toHaveAttribute('aria-current'|'aria-selected'|
  'aria-pressed'|'aria-expanded', …)`, `toBeChecked`) and a `page` is supplied,
  `diagnose` searches up to 2 levels up and 2 levels down from the asserted
  element for where that state actually lives and reports the nearest match as
  `{ found, relation: 'parent' | 'child' | 'sibling' }`, with a concrete fix in
  `hint` (e.g. *"`active` is on the parent `li.page-item.active`, not on the
  `button` — assert on `page.locator('li.page-item.active')`"*).
- New public exports from the package root: `diagnose`, `failedSelectorOf`,
  `isAssertionMessage`, `messageHasLoadingSignal`, the widened `ErrorClass`, and
  the `Diagnosis` / `StateElsewhere` types.
- **`extractCandidatesFromHtml(html, opts?)` — offline candidate extraction
  (P0-4).** Extract `CandidateElement`s from a *saved HTML string* parsed in
  Node, for consumers that heal AFTER a run (when the live `page` is gone, e.g.
  from HTML captured in the Playwright report). It applies the EXACT same rules
  as the live `extractCandidates` — preferred-tag priority, structural-tag skip,
  id dedupe, `maxCandidates` cap, and the identical per-field capture (`id`,
  `class_name`, `parent_tag`, `dom_depth`, `sibling_count`, `value_attr`,
  `name`, text, placeholder, aria-label, type, role, acc-name) — because both
  paths now share ONE self-contained extraction program. Live and offline
  extraction are pinned to byte-for-byte parity by test. Uses the optional,
  dependency-light **`linkedom`** parser, loaded lazily (same pattern as
  `onnxruntime-node`); if it is not installed a clear error is thrown:
  *"extractCandidatesFromHtml requires the optional 'linkedom' package — npm
  install linkedom"*.
- **`captureDomOnFailure` fixture option (P0-4).** When set on the self-healing
  config, on an action/assertion failure the wrapped page attaches the current
  page HTML (`await page.content()`) as a Playwright test attachment named
  `pw-self-heal-dom.html` (content-type `text/html`), captured at most once per
  page. Wired through `withSelfHealing` → `wrapPage` (the fixture forwards its
  `testInfo`), so consumers can read the saved DOM from the Playwright JSON
  report and heal offline later with `extractCandidatesFromHtml`. Off by
  default; purely additive.
- **Richer candidate tags (P1-1).** `PREFERRED_TAGS` now also includes
  `h1`–`h6`, `li`, and `img`, so assertions that target headings (product names
  are often `h5`), list items (page markers on `li`), and images (product
  images) surface as candidates. Structural-skip and id-dedupe behavior is
  unchanged.
- **Test-id attribute auto-detection (P1-1).** When the effective test-id
  attribute is the default `data-testid` but it is absent from the page/HTML,
  extraction auto-detects the first present alternative among `data-test`,
  `data-cy`, `data-qa`, `data-test-id` and uses it for `test_id` capture,
  emitting a one-time telemetry log naming the chosen attribute. An explicit
  (non-default) `config.testIdAttribute` always wins and disables auto-detection.
  Applied identically to the live and offline (HTML) extraction paths.
- New public exports from the package root: `extractCandidatesFromHtml`,
  `PREFERRED_TAGS`, `DEFAULT_TESTID_ATTRIBUTE`, `TESTID_FALLBACK_ATTRIBUTES`, and
  the `WrapPageOptions` / `TestInfoLike` / `TestAttachment` types.
- Added **`linkedom`** to `optionalDependencies`.


## [1.2.2] - 2026-10-10

### Fixed

- **Stale-element / context-restart recovery.** When the Playwright browser
  context or page restarts mid-run (context closed+recreated, page
  crashed/reloaded, or a navigation destroys the execution context), healing no
  longer surfaces the resulting `Target closed` /
  `Execution context was destroyed` / `Element is not attached to the DOM` error
  as a hard failure:
  - A new **stale / context-restart** error class (`classifyError`, now in
    `src/errors.ts`, re-exported from the package root alongside `isStaleError`)
    recognizes the teardown signatures — *Execution context was destroyed*,
    *Target closed*, *Target page, context or browser has been closed*,
    *Target crashed*, *Navigation failed because page was closed*,
    *frame was detached*, *Element is not attached to the DOM* (matched
    case-insensitively) — distinct from `healable` (zero-match), `retryable`
    (not-actionable-yet), and `fatal` (real defect). Stale is checked **first**
    because several of its messages overlap with retryable phrasing.
  - A **cached healed locator** that throws a context-restart error is now
    **invalidated** (along with any sibling entries bound to the dead context)
    and the action **re-resolves on the live page** — original locator first,
    then a fresh heal — instead of throwing the stale error. A lightweight
    page/context **token guard** on the heal cache skips entries bound to a
    now-dead page with no overhead on the normal path.
  - `tryHeal` / `extractCandidates` now **abort cleanly** when `page.evaluate`
    dies on a destroyed context, so a heal is never fabricated against a dead
    DOM; the caller re-attempts on the live context or rethrows the original
    error.

## [1.2.1] - 2026-09-26

### Added

- **Model card** (`docs/model-card.md`) documenting the trained locator ranker —
  architecture (Gradient Boosting / XGBoost → ONNX), the 17 input features,
  training/evaluation data (~6,200/1,550 pairs), metrics (GB AUC 0.9993, XGB
  0.9994, hybrid 68.63% HSR), intended use, limitations, and ethical/privacy
  considerations. Linked from the README and `models/README.md`.

## [1.2.0] - 2026-09-05

### Added

- Public **`LocatorScore`** struct (`src/types.ts`) — a clean, documented
  projection of a single ranked candidate's scoring decision
  (`locator`, `finalScore`, `mlProbability`, `heuristicScore`, `mode`, `rank`),
  distinct from the internal `ScoredCandidate` (which carries the raw candidate
  and the full 17-d feature vector). Intended for downstream logging,
  dashboards, and custom ranking.
- Conversion helpers `toLocatorScore(scored, mode)` and
  `scoresFromResult(healResult)` (`src/ranker.ts`), exported from the package
  root alongside the `LocatorScore` type.
- Heal records now carry an optional `scores?: LocatorScore[]` field
  (`HealEvent.scores`) — the top-N decisions (N = `config.topK`, best-first),
  populated on every heal so they surface in both the telemetry JSONL and
  `getHealingSummary()`. Purely additive and backward compatible; pre-existing
  consumers are unaffected.

## [1.1.2] - 2026-08-22

### Added

- CI: an **ONNX model validation** step in GitHub Actions. Every push installs
  the optional `onnxruntime-node` runtime and runs `npm run smoke`
  (`scripts/heal-model-check.mjs`), which loads the trained model, confirms it
  heals a real locator drift, and rejects an unrelated element (no false green).
  Also exposed as the `smoke` npm script for local use.

## [1.1.1] - 2026-08-17

### Added

- Comprehensive unit tests for the **17-feature vector extraction**
  (`tests/feature-vector.test.ts`, 52 cases). Complementary to
  `domFeatures.test.ts` (which drives the extractor): these hand-construct
  `LocatorMetadata` + `CandidateElement` pairs resembling real DOM snapshots
  and assert each of the 17 features individually plus every SPEC §3.2
  invariant — case-insensitive string similarity, empty/empty similarity `0.0`
  (not `1.0`), `depth_similarity = max(0, 1 − |Δ|/10)` with the either-depth-0
  guard, `sibling_count_ratio = min(siblings/20, 1)` saturation,
  `multi_attr_match_count` as a raw un-normalized integer in `[0..4]`,
  `attribute_similarity = max(id, name, placeholder, aria_label)`,
  `type_attr_match` fallback to `locator_type`, `featureArray` length/order,
  and `heuristicScore` (weights sum to 1.0; strong vs weak). `src/features.ts`
  is now at 100% statement/function/line and 98.3% branch coverage (the sole
  uncovered branch is unreachable dead code).
- Unit tests for **17-feature vector extraction from DOM snapshots**
  (`tests/domFeatures.test.ts`, 27 cases). They drive `extractCandidates`
  over real DOM snapshots and assert the resulting `CandidateElement` ->
  `FeatureVector` pipeline: extractor field capture, preferred-tag ordering,
  structural-tag skip, id dedupe, `maxCandidates`, custom test-id attribute,
  implicit ARIA roles, accessible-name precedence, CSS path hints,
  `dom_depth`/`sibling_count`, and the value and range of each of the 17
  features (plus `featureArray` ordering and a full before/after refactor
  ranking case). `src/candidateExtractor.ts` and `src/features.ts` are now at
  100% statement and function coverage; overall statement coverage rises from
  49.1% to 56.1% on the way to the 85% target.
- `npm run test:coverage` script and v8 coverage configuration in
  `vitest.config.ts`.
- Dev dependencies `happy-dom` and `@vitest/coverage-v8` (test-only; not part
  of the published tarball).

## [1.1.0] - 2026-08-15

### Added

- Configurable **locator fallback strategy** (`fallbackStrategy`, default
  `['role', 'text', 'testid', 'xpath']`). When healing rebuilds a locator, the
  original locator's kind is preserved first (a renamed `data-testid` still
  heals on its testid), then the configured order picks the first strategy the
  candidate can express — semantic/robust first, brittle path last. Exposes the
  `LocatorStrategy` type. Backward compatible: omitting it uses the default.
- Community docs: `CONTRIBUTING.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, and this changelog, in preparation for the JOSS submission.
- GitHub issue forms (`bug_report.yml`, `feature_request.yml`) + `config.yml`,
  and a pull-request template with the 100%-tested checklist.

## [1.0.0] - 2026-07-02

First stable release.

### Added

- `CITATION.cff` for citable releases and Zenodo archiving
  (DOI [10.5281/zenodo.19684439](https://doi.org/10.5281/zenodo.19684439)).
- Release notes and competitive teardown in `docs/`.

### Changed

- README expanded with comparison table (server-backed ML, LLM-only, and
  heuristic-only tools) and roadmap link.
- Package metadata finalized for the stable line (repository, homepage, author).

## [0.1.0] - 2026-06-10

First public release: self-healing Playwright locators that run in-process — no
server, no API key.

### Added

- Healing engine: broken-locator detection with bounded fast-heal
  (`healTimeout`, default 5s), candidate extraction from the live DOM, retry of
  the original action after healing.
- Trained 17-feature ranking model shipped as ONNX (Gradient Boosting
  AUC 0.9993); hybrid mode heal success 68.63%, +4.05pp over the heuristic
  baseline.
- Three modes: `heuristic` (zero native deps), `ml` (ONNX), and `hybrid`
  (default). `onnxruntime-node` is optional.
- Intent-aware healing that preserves locator modality (testid → testid,
  role → role) instead of falling back to brittle CSS paths.
- Drop-in `page` fixture wrapper; healed locators remain genuine Playwright
  `Locator` objects, so web-first assertions keep working.
- Healing report and telemetry groundwork, CLI entry point (`pw-self-heal`),
  and source-updater for writing healed locators back to test files.

[Unreleased]: https://github.com/javvadivijayprasad/pw-self-heal/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/javvadivijayprasad/pw-self-heal/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/javvadivijayprasad/pw-self-heal/releases/tag/v0.1.0
