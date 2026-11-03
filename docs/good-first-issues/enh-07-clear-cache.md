# Add a `clearHealCache()` method to the wrapped page

**Labels:** `good first issue`, `help wanted`, `enhancement`

### Context

After a successful heal, the `original → healed` mapping is cached for the rest
of the run. In long-lived sessions (or between logical phases of a test) a user
may want to reset that cache so the next action re-resolves from scratch.

### Task

1. Expose a `clearHealCache()` method on the wrapped page (next to
   `getHealingSummary()`), which empties the heal cache `Map`.

### Acceptance criteria

- `page.clearHealCache()` empties the cache; a subsequent action re-resolves
  instead of using a stale cached locator.
- `getHealingSummary().cachedLocators` reflects the reset.
- A unit test asserts the cache is cleared; `npm run build && npm test` pass.
- README "Inspecting heals" mentions it.

### Pointers

- `src/heal.ts` — `wrapPage` and where `getHealingSummary` is attached; the heal
  cache lives on the `HealContext` (`cache: Map<...>`).

Small, additive API.
