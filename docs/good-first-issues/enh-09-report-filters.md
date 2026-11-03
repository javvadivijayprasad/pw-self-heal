# Add `--since <iso>` and `--test <id>` filters to `pw-self-heal report`

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

On a big `heal-events.jsonl`, you often want to look at just the recent heals, or
just the heals from one test. The report command has no way to filter.

### Task

1. Parse `--since <iso-timestamp>` and `--test <id>` in the `report` command
   (`src/cli.ts`).
2. Filter the loaded events before `summarize()`: `--since` keeps events with
   `timestamp >= Date.parse(iso)`; `--test` keeps events whose `testId` matches.

### Acceptance criteria

- `report --since 2026-01-01 --test login` summarizes only matching events.
- No filters = current behavior.
- A unit test asserts filtering on a small fixture (both flags).
- `npm run build && npm test` pass; README mentions the flags.

### Pointers

- `src/cli.ts` — the `report` command, `loadEvents`.
- `src/types.ts` — `HealEvent` has `timestamp` and `testId`.

Self-contained CLI work.
