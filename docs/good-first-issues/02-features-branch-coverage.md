# Reach 100% branch coverage in `features.ts`

**Labels:** `good first issue`, `help wanted`, `test`

### Context

`src/features.ts` is at 100% statement/line/function coverage but ~98% branch —
the one uncovered branch is the `return 0.5` path in `candidateTextActionable`,
which looks unreachable (any single-word actionable token is already caught by an
earlier substring branch that returns `0.7`).

### Task

Decide and do one of:

- **(a)** Prove it's reachable: add a unit test with an input that actually hits
  the `return 0.5` branch, OR
- **(b)** Confirm it's dead code and remove the unreachable branch, simplifying
  the function.

Either way, `features.ts` should reach 100% branch coverage.

### Acceptance criteria

- `npm run test:coverage` shows `src/features.ts` at 100% branches.
- If you removed code, existing feature tests (`tests/features.test.ts`,
  `tests/feature-vector.test.ts`) still pass unchanged.
- No change to the 17-feature values for any existing test (parity is pinned).

### Pointers

- `src/features.ts` — `candidateTextActionable`.
- `tests/feature-vector.test.ts` — feature unit tests.

A good way to learn the feature pipeline. Ask in the issue if unsure whether it's
reachable — happy to help reason through it.
