# Recognize more context-restart errors in `isStaleError`

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

pw-self-heal classifies "page/context went away" errors as `stale` so it can
recover. A few Playwright phrasings aren't matched yet, e.g.
`Protocol error (...): Target closed`, `Page closed`, `Browser has been closed`.

### Task

1. Add one or two more stale/context-restart patterns to the detector in
   `src/errors.ts` (`isStaleError` / the stale pattern list), specific enough not
   to catch ordinary failures.
2. Keep the precedence (stale is checked first).

### Acceptance criteria

- The new pattern(s) classify as `'stale'` via `classifyError`.
- A unit test in `tests/stale-context.test.ts` asserts the new message is `stale`
  and a normal assertion/zero-match message is NOT.
- `npm run build && npm test` pass.

### Pointers

- `src/errors.ts` — stale pattern list + precedence comment.
- `tests/stale-context.test.ts` — existing classification tests.

Paste the exact Playwright message you used in your PR. Small and well-bounded.
