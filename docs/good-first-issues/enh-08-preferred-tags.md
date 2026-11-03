# Add `option`, `summary`, `td`, `th` to candidate `PREFERRED_TAGS`

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

Candidate extraction prioritizes a set of `PREFERRED_TAGS`. Assertions sometimes
target `<option>` (selects), `<summary>` (disclosure widgets), and table cells
(`<td>`/`<th>`), which aren't in the list — so a drifted locator for one of those
has no good candidate to heal to.

### Task

1. Add `option`, `summary`, `td`, `th` to `PREFERRED_TAGS` in
   `src/candidateExtractor.ts`. Keep the structural-skip and dedupe behavior.

### Acceptance criteria

- The four tags are captured as candidates (verify with a small DOM fixture).
- Existing extraction tests still pass (no ordering regressions that break parity).
- A unit test asserts an `<option>` and a `<td>` are captured.
- `npm run build && npm test` pass.

### Pointers

- `src/candidateExtractor.ts` — `PREFERRED_TAGS`.
- `tests/domFeatures.test.ts` — extraction tests to copy a pattern from.

Small list change; check the parity tests stay green.
