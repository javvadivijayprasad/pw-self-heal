# Auto-detect more test-id attributes (`data-qa-id`, `data-automation-id`)

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

When a page has no `data-testid`, pw-self-heal auto-detects a fallback test-id
attribute from a known list (`data-test`, `data-cy`, `data-qa`, `data-test-id`).
Some popular conventions aren't covered yet — notably `data-qa-id` and
`data-automation-id` (common in enterprise apps).

### Task

1. Add `data-qa-id` and `data-automation-id` to the fallback list in
   `src/candidateExtractor.ts` (the `TESTID_FALLBACK_ATTRIBUTES` constant).
2. Keep the existing order; put the new ones after the current entries.

### Acceptance criteria

- The two attributes are added to `TESTID_FALLBACK_ATTRIBUTES`.
- A unit test (in `tests/offline-extraction.test.ts` or a new test file) asserts
  that on a page with only `data-automation-id` present, extraction auto-detects
  and uses it — and that an explicit `testIdAttribute` config still overrides.
- `npm run build && npm test` pass.

### Pointers

- `src/candidateExtractor.ts` — `TESTID_FALLBACK_ATTRIBUTES`, the auto-detect logic.
- `tests/offline-extraction.test.ts` — existing auto-detection tests to copy the pattern from.

Small, self-contained, no need to understand the model or healing pipeline.
