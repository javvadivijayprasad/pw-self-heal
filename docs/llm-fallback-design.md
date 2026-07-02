# Design: Optional Governed LLM Fallback for `@vijaypjavvadi/pw-self-heal`

Status: **Draft / proposal** — no code written yet.
Target version: **`0.2.0`** (additive, opt-in, no breaking changes).
Author: Vijay P. Javvadi.

---

## 1. Summary

Today `pw-self-heal` heals a broken locator at runtime by ranking live-DOM
candidates with a trained model (`ml` / `hybrid`) or the heuristic ranker. If the
best candidate does not clear the confidence threshold, the heal fails and the
original error is rethrown.

This proposal adds **one optional rung** to the end of that pipeline: when the
local model cannot confidently pick a candidate, an **LLM supplied by the user
(their own key)** chooses among the *already-extracted* DOM candidates. The model
still handles the vast majority of heals locally; the LLM only fires on the hard
misses.

The whole thing ships as the **same single npm package** — the LLM SDKs are
`optionalDependencies`, lazy-loaded only when the user opts in. Default installs
remain local-only, no network, no key.

## 2. Goals & non-goals

**Goals**
- Model-first, LLM-last: the LLM is a fallback, never the primary ranker.
- Opt-in and off by default — preserve the package's "no server, no network, no
  API key, DOM never leaves the machine" promise for anyone who doesn't enable it.
- User brings their own provider + key (`anthropic` / `openai` / `gemini`),
  mirroring `bdd2pw`'s existing `--llm` design.
- All LLM-bound data passes through an **in-process TypeScript governance
  sanitizer** first — no PII/secrets leave the machine unfiltered.
- Stay pure npm/TypeScript — **no Python, no PyPI dependency, no sidecar server.**

**Non-goals**
- The LLM does **not** generate free-form selectors (no hallucinated CSS/XPath).
  It only *selects among real candidates* the extractor already found.
- No visual regression, no assertion generation (those remain sibling tools).
- No change to the default heal path or its metrics.

## 3. Key design decision — LLM as *candidate selector*, not selector generator

The single most important choice. Instead of asking the LLM "what selector should
I use?", we ask it to **pick the best element from the candidate list the DOM
extractor already produced**, given the original locator's intent.

Why:
- **Grounded** — the LLM can only choose an element that actually exists in the
  live DOM, so it cannot invent a brittle or non-existent selector.
- **Minimal data egress** — only a small list of candidate *descriptors* (tag,
  text, key attributes) leaves the machine, never the full DOM or page HTML.
- **Cheap & fast** — one small structured prompt, bounded output (an index).
- **Governable** — the sanitizer only has to clean the candidate descriptors and
  the intent, a small fixed surface.

So the LLM's job: `intent + candidate[] -> { pick: index | null, confidence }`.
We then rebuild an equivalent locator against `candidate[pick]` and retry — the
same rebuild path the model heal already uses.

## 4. Where it slots into the recovery pipeline

Current pipeline (SPEC §2.2), unchanged up to step 4. New step **4b**:

1. Run action with the (possibly cached) locator.
2. On error, classify: `healable` / `retryable` / `fatal`. `fatal` → rethrow now.
3. `retryable` → wait / scroll / retry same selector.
4. `healable` → extract DOM candidates, score locally, pick best ≥ `confidence`.
5. **NEW → 4b. If (and only if) no candidate clears the threshold AND
   `llmFallback` is enabled AND the per-run call budget is not exhausted:**
   a. Take the top-`N` model-ranked candidate descriptors (default `N = 8`).
   b. Run them + the locator intent through the **governance sanitizer**.
   c. Send to the user's LLM: "pick the best matching candidate or return none."
   d. If the LLM returns a valid pick, rebuild the locator against it and retry.
6. On success → cache `original → healed`, append a telemetry event
   (`mode: 'llm'`), optionally rewrite source. On failure → **rethrow the
   original error** (never an LLM error).

The LLM never sees an action the model already healed — it is strictly the
"model wasn't confident enough" branch.

## 5. Public API

Additive option on the existing config; everything else unchanged.

```ts
import { test as base } from '@playwright/test';
import { withSelfHealing } from '@vijaypjavvadi/pw-self-heal';

export const test = withSelfHealing(base, {
  mode: 'hybrid',
  confidence: 0.5,

  // NEW — omit this and behaviour is identical to today (fully local).
  llmFallback: {
    provider: 'anthropic',        // 'anthropic' | 'openai' | 'gemini'
    apiKey: process.env.ANTHROPIC_API_KEY,   // user-supplied; never bundled
    model: undefined,             // optional override; sane per-provider default
    triggerBelow: 0.5,            // only call LLM if best model score < this (defaults to `confidence`)
    topN: 8,                      // candidates shown to the LLM
    maxCallsPerRun: 20,           // hard budget; cache hits don't count
    timeoutMs: 15000,             // per-call deadline
    cache: '.pwheal/llm-cache.sqlite',  // optional; ':memory:' for one-shot
    governance: 'strict',         // 'strict' (default) | 'off' (test-only escape hatch)
    onPropose: undefined,         // optional hook: (proposal) => void, for audit
  },
});
```

Notes:
- If `llmFallback` is absent → **zero behavioural change**, zero new deps loaded.
- If `apiKey` is missing/empty when `llmFallback` is set → one-time warning, LLM
  rung disabled, local healing continues (graceful degrade, never throws).
- `governance: 'off'` mirrors bdd2pw's `--llm-skip-governance` — documented as
  test-only, never for production.

## 6. The governance sanitizer (in-process TypeScript)

A small rule-based module — **no network, no Python** — that cleans every payload
before it reaches a provider. Ports the intent of the existing `ai-governance`
service to TS so the package stays self-contained.

Responsibilities:
- **Redact secret-like values** in attribute/text fields: tokens, JWTs, API keys,
  emails, phone numbers, long digit runs (card/SSN-shaped), `password`/`otp`
  input values → replaced with `‹redacted›`.
- **Drop high-risk attributes** entirely (`value` on password/otp inputs,
  `autocomplete="cc-*"`, anything matching a configurable denylist).
- **Truncate** free text to a max length (default 120 chars) to bound egress.
- **Allowlist the fields** that may leave at all: `tag`, `role`, `name`, `id`,
  `testid`, `label`, `placeholder`, `aria-label`, `text`, `type`. Nothing else in
  a candidate descriptor is transmitted.
- Emit a per-call `governanceReport` (counts of redactions/drops) into telemetry.

Contract: `sanitize(intent, candidates) -> { intent, candidates, report }`. If
`governance: 'strict'` and sanitization cannot run, the LLM rung is **skipped**
(fail-closed), not bypassed.

## 7. Provider adapter

A thin internal interface so all three providers look the same to the pipeline:

```ts
interface LlmSelector {
  choose(input: {
    intent: LocatorIntent;
    candidates: SanitizedCandidate[];
  }): Promise<{ pick: number | null; confidence: number }>;
}
```

- Adapters: `anthropic` (`@anthropic-ai/sdk`), `openai` (`openai`),
  `gemini` (`@google/generative-ai`) — all **optionalDependencies**, imported via
  dynamic `import()` only when selected.
- Output is parsed against a strict schema (index within range, or `null`). Any
  malformed/over-range response → treated as `null` (no heal), original error
  rethrown. The LLM cannot break the run.
- Default models (overridable): mirror bdd2pw's defaults
  (`anthropic → claude-sonnet-4-6`, `openai → gpt-4o-mini`,
  `gemini → gemini-2.5-flash`).

## 8. Packaging

```jsonc
// package.json additions
"optionalDependencies": {
  "onnxruntime-node": "^1.18.0",        // existing
  "@anthropic-ai/sdk": "^0.91.1",       // new — only if using anthropic
  "openai": "^4.77.0",                  // new — only if using openai
  "@google/generative-ai": "^0.21.0",   // new — only if using gemini
  "better-sqlite3": "^11.0.0"           // new — only if using llm-cache
}
```

- Default `npm install` pulls **none** of these (optional). A normal local-only
  user's footprint is unchanged.
- `files` still ships `dist/` + `models/*.onnx` only — no keys, no secrets.
- Missing provider SDK at runtime → same graceful-degrade + one-time warning as a
  missing ONNX model.

## 9. Telemetry

Extend the existing JSONL heal event with LLM fields (only when the LLM rung ran):

```jsonc
{
  "timestamp": "…", "testId": "…", "original": "getByTestId('add-to-cart')",
  "healed": "getByTestId('add-to-cart-btn')", "score": 0.83,
  "mode": "llm",                       // new mode value
  "modelBestScore": 0.41,              // why the LLM was invoked
  "provider": "anthropic", "llmConfidence": 0.9,
  "candidatesEvaluated": 8, "elapsedMs": 640,
  "governance": { "redactions": 2, "dropped": 1 }
}
```

`pw-self-heal report` gains an LLM section: calls made, LLM-heal success rate,
avg latency, redaction totals, estimated token cost (like bdd2pw's `--llm-stats`).

## 10. Safety & failure modes

- **Fail-closed governance**: strict mode + sanitizer failure → skip LLM.
- **Budget**: `maxCallsPerRun` caps spend/latency; exceeded → skip, log.
- **Timeout**: `timeoutMs` per call; expiry → skip, rethrow original.
- **Never surface LLM errors**: any provider/parse/network failure → original
  test error is what the developer sees.
- **Cache**: `original → pick` cached per run (and optionally to SQLite) so a
  repeated stale locator costs one LLM call, not one per occurrence.
- **Determinism note**: LLM heals are non-deterministic; docs must state the LLM
  rung is a resilience aid for CI, not a substitute for fixing locators. Every LLM
  heal is logged so teams can review and bake the fix in.

## 11. Testing

- **Unit** — sanitizer redaction table (each secret pattern in → `‹redacted›`
  out); allowlist enforcement (no non-allowlisted field transmitted).
- **Adapter** — mock each provider; malformed / out-of-range / null responses all
  resolve to "no heal" without throwing.
- **Pipeline** — with a stub selector, assert the LLM rung fires **only** when the
  model score is below `triggerBelow`, respects the call budget, and caches.
- **Privacy guard** — a test asserting that with `llmFallback` unset, no provider
  module is imported and no network socket is opened.
- **Integration** — HTML page whose control changes in a way the heuristic/model
  scores below threshold but a human (and the LLM) can still identify; assert heal
  succeeds and is logged with `mode: 'llm'`.

## 12. Rollout

- Ships as `0.2.0`, fully backward-compatible (absent config = today's behaviour).
- README gains an "Optional LLM fallback (bring your own key)" section that leads
  with the privacy default and the opt-in nature.
- Positioning for the suite: **local model-first healing, with an optional
  governed LLM fallback** — the governance angle reuses the TestForge story
  without dragging in the Python service.

---

### Open questions for Vijay

1. **LLM as selector vs. generator** — confirm you want the grounded
   "pick-a-candidate" contract (recommended) rather than letting the LLM emit a
   selector.
2. **Cache dependency** — is a SQLite cache (`better-sqlite3`, native) acceptable,
   or prefer a dependency-free JSON cache to keep zero native deps?
3. **Governance source of truth** — port the `ai-governance` redaction rules into
   TS here, or keep TS sanitizer independent and lighter?
