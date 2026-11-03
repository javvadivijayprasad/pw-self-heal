# Add `data-pw` and `data-e2e` to test-id auto-detection

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

pw-self-heal auto-detects a fallback test-id attribute when `data-testid` is
absent. Two more common conventions aren't covered: `data-pw` (Playwright-style)
and `data-e2e`.

### Task

1. Add `data-pw` and `data-e2e` to `TESTID_FALLBACK_ATTRIBUTES` in
   `src/candidateExtractor.ts` (keep existing order; append the new ones).

### Acceptance criteria

- Both attributes are in the fallback list.
- A unit test asserts a page with only `data-pw` auto-detects it, and that an
  explicit `testIdAttribute` still overrides.
- `npm run build && npm test` pass.

### Pointers

- `src/candidateExtractor.ts` — `TESTID_FALLBACK_ATTRIBUTES`.
- `tests/offline-extraction.test.ts` — existing auto-detection test to copy.

> Note: the offline-path tests need the optional `linkedom` (Node ≥ 20). The
> live-path assertion works everywhere.

Tiny, self-contained.
