# Add a `--top <n>` flag to `pw-self-heal report`

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

`pw-self-heal report` prints the most-healed locators. On a large run that list
is long; a `--top <n>` flag to cap it would make the output scannable.

### Task

1. Parse `--top <n>` in the `report` command in `src/cli.ts` (default: show all,
   or a sensible default like 10).
2. Slice `summary.topHealed` to the first `n` before rendering (both the table
   and the `--json` output).

### Acceptance criteria

- `pw-self-heal report --in <file> --top 5` shows at most 5 healed locators.
- Invalid/absent `--top` keeps current behavior.
- A unit test asserts the cap for both table and `--json`.
- `npm run build && npm test` pass; README CLI example mentions `--top`.

### Pointers

- `src/cli.ts` — the `report` command (see how `--json`/`--in` are parsed).
- `src/report.ts` — `summarize()` / `topHealed`.

Small CLI change; no healing-engine knowledge needed.
