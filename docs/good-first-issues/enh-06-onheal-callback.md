# Add an `onHeal` callback option

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

Heals are logged to `.pwheal/heal-events.jsonl` and surfaced via
`getHealingSummary()`. Some teams want to react to each heal in-process (push to
a dashboard, custom logger) without parsing the file afterward.

### Task

1. Add an optional `onHeal?: (event: HealEvent) => void` to `SelfHealConfig`
   (`src/types.ts`).
2. Call it (guarded, in a try/catch so a throwing callback can't break the test)
   wherever a `HealEvent` is recorded, alongside the existing telemetry write.

### Acceptance criteria

- `onHeal` is invoked once per heal with the full `HealEvent`.
- A throwing `onHeal` does not break healing (swallowed/logged).
- Omitting it changes nothing (backward compatible).
- A unit test asserts the callback fires with the event; `npm run build && npm test` pass.

### Pointers

- `src/types.ts` — `SelfHealConfig`, `HealEvent`.
- `src/heal.ts` / `src/locator.ts` — where `record(event)` / the telemetry write happens.

Additive and self-contained.
