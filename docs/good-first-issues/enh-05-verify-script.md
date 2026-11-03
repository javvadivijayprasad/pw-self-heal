# Add an `npm run verify` script and document it in CONTRIBUTING

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

Contributors run `typecheck`, `build`, `test`, and `smoke` separately. A single
`verify` script that chains them gives CONTRIBUTING one command to point at.

### Task

1. Add to `package.json` scripts (match the existing names exactly):
   ```json
   "verify": "npm run typecheck && npm run build && npm test && npm run smoke"
   ```
2. In `CONTRIBUTING.md`, reference `npm run verify` as the single pre-PR check.

### Acceptance criteria

- `npm run verify` runs all four steps and exits non-zero if any fails.
- `CONTRIBUTING.md` mentions it as the pre-PR check.
- Individual scripts unchanged.

### Pointers

- `package.json` — the `scripts` block.
- `CONTRIBUTING.md` — dev-workflow section.

> `smoke` runs in heuristic mode without `onnxruntime-node`, so `verify` works
> either way locally.

Two-file change, good for a first PR.
