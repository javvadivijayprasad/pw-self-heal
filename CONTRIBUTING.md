# Contributing to pw-self-heal

Thanks for your interest in improving `@vijaypjavvadi/pw-self-heal` — in-process
self-healing Playwright locators ranked by a trained 17-feature ONNX model.

## Development setup

```bash
git clone https://github.com/javvadivijayprasad/pw-self-heal.git
cd pw-self-heal
npm install
npm run build     # tsup → dist/
npm test          # vitest
npm run typecheck # tsc --noEmit
```

Node.js >= 18 is required. `onnxruntime-node` is an optional dependency: the
`heuristic` mode works without it; `ml` and `hybrid` modes need it installed.

## The rule: 100% tested

**Every change ships with tests.** A pull request is not ready until:

1. New or changed behavior is covered by tests (unit and, where relevant, e2e).
2. The full suite is green: `npm run build && npm test`.
3. Coverage does not regress.

This applies to features, fixes, and even docs that make testable claims. PRs
without tests for their changes will be asked to add them before review.

## How to contribute

- **Bugs** — open an issue with a minimal repro (Playwright version, mode
  `heuristic`/`ml`/`hybrid`, the original locator, and the DOM snippet if you can
  share it). See [SUPPORT.md](SUPPORT.md) for what to include.
- **Features** — open an issue first to discuss fit with the
  [roadmap](ROADMAP.md) before writing code.
- **Model/ML changes** — anything touching the 17-feature extractor or the ONNX
  ranker must include benchmark numbers alongside unit tests.

## Pull request process

1. Fork and create a branch from `main`.
2. Make your change **with tests** (see the rule above).
3. Run `npm run build && npm test && npm run typecheck` locally — all green.
4. Use a [Conventional Commits](https://www.conventionalcommits.org/) message,
   e.g. `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `chore: ...`.
5. Open the PR with a short description of what changed and why. CI must pass.

## Project layout

- `src/` — library source (feature extraction, ranking, healing, fixture, CLI)
- `tests/` — vitest unit tests (`tests/**/*.test.ts`)
- `models/` — trained ONNX ranking model
- `docs/` — design notes and release notes
- `scripts/` — build/model tooling

## Code of conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are accepted under the [MIT License](LICENSE).
