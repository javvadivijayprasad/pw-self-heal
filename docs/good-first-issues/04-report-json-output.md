# Add `--json` output to the `pw-self-heal report` CLI

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

`pw-self-heal report` prints a human-readable summary of a run's heal events.
Teams that want to feed the summary into CI dashboards or scripts need a
machine-readable form.

### Task

1. Add a `--json` flag to the `report` command in `src/cli.ts`.
2. When passed, print the computed summary object as JSON (`JSON.stringify(summary, null, 2)`)
   to stdout instead of the formatted table — nothing else on stdout, so it can be piped.

### Acceptance criteria

- `pw-self-heal report --in <file> --json` prints valid JSON and nothing else on stdout.
- The default (no `--json`) output is unchanged.
- A unit test asserts `--json` produces parseable JSON for a small fixture
  `heal-events.jsonl`.
- `npm run build && npm test` pass; update the README CLI example to mention `--json`.

### Pointers

- `src/cli.ts` — the `report` command and its summary rendering.
- `src/report.ts` — `summarize()` / the summary shape.

Self-contained CLI work; no need to touch the healing engine.
