# Allow per-mode acceptance thresholds via a `thresholds` config

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

Acceptance thresholds are fixed per mode (`heuristic` 0.45, `ml`/`hybrid` 0.50)
in `THRESHOLDS`. The single `confidence` option overrides for all modes. Teams
tuning behavior want to set per-mode thresholds.

### Task

1. Add an optional `thresholds?: Partial<Record<RankerMode, number>>` to
   `SelfHealConfig` (`src/types.ts`).
2. When resolving the effective threshold, prefer `config.confidence`, then
   `config.thresholds?.[mode]`, then the built-in `THRESHOLDS[mode]`.

### Acceptance criteria

- `thresholds: { hybrid: 0.6 }` is used for hybrid mode; other modes fall back to
  defaults; `confidence` still wins when set.
- Omitting it changes nothing (backward compatible).
- A unit test asserts the resolution order.
- `npm run build && npm test` pass; README Configuration table documents it.

### Pointers

- `src/types.ts` — `SelfHealConfig`, `RankerMode`, `THRESHOLDS`.
- `src/locator.ts` — where the threshold is resolved (`config.confidence ?? THRESHOLDS[mode]`).

Additive; small, clear resolution-order change.
