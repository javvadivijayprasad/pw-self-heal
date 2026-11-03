# Add `--out <file>` to write `report --json` to a file

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

`pw-self-heal report --json` prints to stdout. CI jobs often want the JSON
written straight to a file (e.g. to upload as an artifact) without shell
redirection.

### Task

1. Parse `--out <file>` in the `report` command (`src/cli.ts`).
2. When `--out` is given with `--json`, write the JSON to that file (create
   parent dirs with `mkdirSync({ recursive: true })`) instead of stdout.

### Acceptance criteria

- `pw-self-heal report --in <f> --json --out summary.json` writes valid JSON to
  `summary.json` and prints nothing to stdout.
- Without `--out`, `--json` still prints to stdout (unchanged).
- A unit test asserts the file is written and parses.
- `npm run build && npm test` pass; README updated.

### Pointers

- `src/cli.ts` — mirror how `--html [out]` already writes a file with
  `mkdirSync`/`writeFileSync`.

Self-contained; follows an existing pattern in the file.
