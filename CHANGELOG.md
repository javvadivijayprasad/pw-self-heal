# Changelog

All notable changes to `@vijaypjavvadi/pw-self-heal` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
