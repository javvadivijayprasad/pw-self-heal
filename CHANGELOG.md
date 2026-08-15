# Changelog

All notable changes to `@vijaypjavvadi/pw-self-heal` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
