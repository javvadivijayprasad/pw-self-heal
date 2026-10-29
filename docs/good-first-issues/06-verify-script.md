# Add an `npm run verify` script and document it in CONTRIBUTING

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

Contributors currently run `build`, `typecheck`, `test`, and `smoke` separately.
A single `verify` script that runs them in order is a nice quality-of-life
improvement and gives CONTRIBUTING one command to point at.

### Task

1. Add to `package.json` scripts:
   ```json
   "verify": "npm run typecheck && npm run build && npm test && npm run smoke"
   ```
   (Match the exact script names already present — check the `scripts` block.)
2. In `CONTRIBUTING.md`, reference `npm run verify` as the single pre-PR check.

### Acceptance criteria

- `npm run verify` runs typecheck → build → test → smoke and exits non-zero if any
  step fails.
- `CONTRIBUTING.md` mentions `npm run verify` as the check to run before opening a PR.
- No change to the individual scripts.

### Pointers

- `package.json` — the `scripts` block (confirm the exact names: `typecheck`,
  `build`, `test`, `smoke`).
- `CONTRIBUTING.md` — the dev-workflow section.

Note: `smoke` needs `onnxruntime-node` installed to exercise the ML path; it passes
in heuristic mode without it, so `verify` works either way locally.

Tiny change, touches two files, good for a first PR.
