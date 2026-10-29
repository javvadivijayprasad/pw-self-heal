# Add a "Troubleshooting" section to the README

**Labels:** `good first issue`, `help wanted`, `documentation`

### Context

New users hit a few predictable snags. A short Troubleshooting section would save
them (and us) time.

### Task

Add a `## Troubleshooting` section to `README.md` covering at least:

1. **"ml/hybrid mode isn't using the model"** — `onnxruntime-node` is an optional
   dependency; install it (`npm i -D onnxruntime-node`). Without it, `ml`/`hybrid`
   degrade to `heuristic` with a one-time warning (that's expected).
2. **Tests hang ~5s before a heal** — that's `healTimeout` (default 5000ms): the
   locator is given that long to appear before healing. Lower it in config if your
   app is fast.
3. **`extractCandidatesFromHtml` throws "requires the optional 'linkedom' package"**
   — install `linkedom` (it's an optional dependency used only by the offline path).
4. **A heal didn't happen** — check the confidence threshold; a candidate must
   score at/above it (heuristic 0.45, ml/hybrid 0.50). Inspect `getHealingSummary()`
   / the `.pwheal/heal-events.jsonl` log to see the scores.

### Acceptance criteria

- A clear `## Troubleshooting` section exists, each item a problem → cause → fix.
- Commands and option names match the current API (verify against the README/config
  table — don't invent flags).

### Pointers

- `README.md` — "Modes", "Configuration", and "Inspecting heals" sections have the
  accurate details to draw from.

Docs-only, no code. A great first contribution.
