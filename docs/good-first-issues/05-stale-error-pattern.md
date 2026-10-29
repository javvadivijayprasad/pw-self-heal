# Recognize one more context-restart error in `isStaleError`

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

pw-self-heal classifies "the page/context went away" errors as a distinct
`stale` class so it can recover instead of hard-failing. The recognized patterns
live in `src/errors.ts`. Playwright emits a few more phrasings we don't match yet,
e.g. `Protocol error (...): Target closed` and
`Page closed` / `Browser has been closed`.

### Task

1. Add one or two additional stale/context-restart message patterns to the
   detector in `src/errors.ts` (`isStaleError` / the stale pattern list). Keep them
   specific enough not to catch ordinary failures.
2. Confirm the precedence is preserved (stale is checked first).

### Acceptance criteria

- The new pattern(s) are matched by `isStaleError` / `classifyError` → `'stale'`.
- A unit test in `tests/stale-context.test.ts` asserts the new message classifies
  as `stale`, and a normal assertion/zero-match message still does NOT.
- `npm run build && npm test` pass.

### Pointers

- `src/errors.ts` — the stale pattern list, `classifyError`, precedence comment.
- `tests/stale-context.test.ts` — existing stale-classification tests.

Pick a real Playwright message (paste the exact string in your PR). Small and
well-bounded.
