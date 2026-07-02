# `@vijaypjavvadi/pw-self-heal` — Specification

> Self-healing locators for Playwright that run **in-process, with no server**.
> Backed by a trained ranking model (Zenodo DOI `10.5281/zenodo.19684439`).

---

## 1. Objective

When a UI changes and a locator stops matching, a Playwright test fails even
though the element still exists under a slightly different selector. `pw-self-heal`
intercepts that failure, finds the best replacement element in the live DOM using
the same 17-feature similarity model that powers the TestForge AI self-healing
service, retries the action against the healed element, and logs the heal — all
inside the test process.

The packaging goal is the differentiator. The healing *science* already exists as
a Python FastAPI microservice (`self_healing_stage_services`, AUC 0.9993/0.9994,
hybrid 68.63% HSR). That form factor blocks adoption: nobody stands up a FastAPI
server to run their Playwright suite. This package ports the ranker to TypeScript
and ships the model as ONNX so a developer gets healing with a single
`npm install` and a one-line fixture change — **zero server, zero Python, zero
network by default.**

Goals:

- Recover from locator drift at runtime so green builds stay green through cosmetic UI churn.
- Add **zero overhead on passing actions** — healing only runs on the failure path.
- Preserve real failures: an actual assertion/product defect must still fail.
- Be adoptable: in-process, dependency-light, privacy-preserving (DOM never leaves the machine in default mode).
- Emit a heal log that feeds a learning loop and a human-readable report.

Non-goals: visual regression, assertion generation, and any LLM narrative (those
live in sibling tools / the SaaS). This package only heals locators.

---

## 2. Functional details

### 2.1 Public API

```ts
import { test as base, expect } from '@playwright/test';
import { withSelfHealing } from '@vijaypjavvadi/pw-self-heal';

// Fixture form — wraps the built-in `page` fixture.
export const test = withSelfHealing(base, {
  mode: 'hybrid',            // 'heuristic' | 'ml' | 'hybrid' (default 'hybrid' if model present, else 'heuristic')
  confidence: 0.5,           // accept a healed candidate only at/above this final score
  telemetry: '.pwheal/heal-events.jsonl',
  autoUpdateSource: false,   // optionally rewrite the selector in the source file on a successful heal
});
```

```ts
// Imperative form — wrap any Page directly.
import { wrapPage } from '@vijaypjavvadi/pw-self-heal';
const healing = wrapPage(page, { mode: 'hybrid' });
await healing.fill('#username', 'admin');  // heals if '#username' is stale
```

The wrapped page proxies the selector-taking action methods (`click`, `fill`,
`type`, `check`, `uncheck`, `selectOption`, `hover`, `focus`, `waitForSelector`,
`textContent`, `innerText`, `getAttribute`, `isVisible`, `$`) and passes through
everything else unchanged. `getHealingSummary()` returns the per-test heal log.

### 2.2 Recovery pipeline (per intercepted action)

Adapted from the existing SDK client, but the heal step is **local**, not HTTP:

1. Run the action with the effective selector (cached heal, if any).
2. On error, classify it: `healable` (locator not found), `retryable` (exists but not actionable yet — not visible, intercepted, stale, navigating), or `fatal` (real defect → rethrow immediately).
3. `retryable` → wait, optionally scroll into view, retry the same selector.
4. Still failing / `healable` → snapshot the DOM, extract candidates, score them locally, pick the best ≥ `confidence`, retry against the healed selector.
5. On success: cache `original → healed` for the rest of the run, append a heal event, optionally rewrite the source selector. On failure: rethrow the **original** error.

### 2.3 Modes

- `heuristic` — weighted 6-feature score, no model, no native deps. Always available.
- `ml` — trained model only (ONNX), via `onnxruntime-node` (optional dependency).
- `hybrid` — `α·heuristic + (1−α)·ml`, `α = 0.40` (the production default that achieved 68.63% HSR).

Thresholds default to the service values: heuristic `0.45`, ml/hybrid `0.50`. If
the model or `onnxruntime-node` is absent, `ml`/`hybrid` gracefully degrade to
`heuristic` with a one-time warning.

### 2.4 CLI (optional, secondary)

```
pw-self-heal report [--in .pwheal/heal-events.jsonl]   # heal counts, top unstable locators, avg score/latency
```

### 2.5 Telemetry / feedback

Each heal appends one JSONL line: `{ timestamp, testId, original, healed, score, mode, candidatesEvaluated, elapsedMs }`. An optional `recordFeedback(original, correct)` marks a heal right/wrong; the file is the training input for the SaaS flywheel (kept out of the OSS default path).

---

## 3. Technical details

### 3.1 Source of truth (port faithfully — do not re-invent)

Port from `self_healing_stage_services`:

- `src/self_healing_service/ml/features.py` → the 17-feature vector + heuristic weights. **Byte-for-byte semantics** so the shipped ONNX model receives in-distribution inputs.
- `src/self_healing_service/candidate_extractor.py` → candidate enumeration (preferred-tag priority, structural-tag skip, dedupe by id).
- `src/self_healing_service/healer.py` → scoring/threshold/ranking orchestration.
- `sdk/playwright/self_healing_page.js` → the proxy wrapper + error classification (already JS; convert to TS, swap HTTP heal for local ranker).
- `models/healing_ranker_gb.pkl` / `healing_ranker_xgb.pkl` → export to ONNX.

### 3.2 Feature vector (17 features)

Core 13: `tag_match`, `text_similarity`, `attribute_similarity`, `class_similarity`,
`parent_similarity`, `depth_similarity`, `id_similarity`, `name_similarity`,
`placeholder_similarity`, `aria_label_similarity`, `type_attr_match`,
`sibling_count_ratio`, `multi_attr_match_count`. Phase-3 additions:
`candidate_text_actionable`, `candidate_in_form`, `candidate_attr_richness`,
`original_attr_count`.

Invariants that **must** be preserved in the TS port:

- String similarity is case-insensitive and returns `0.0` if either side is empty (empty/empty = 0.0, not 1.0). Use an equivalent of Python `difflib.SequenceMatcher.ratio()`.
- `depth_similarity = max(0, 1 − |Δdepth|/10)`, and `0.0` if either depth is 0.
- `sibling_count_ratio = min(siblings/20, 1)`.
- `multi_attr_match_count` is a **raw count in [0..4]** over (id, name, placeholder, aria_label) — *not* normalized. XGBoost weights it 0.42 (its top feature).
- `type_attr_match` falls back to `locator_type` on the original side when `type_attr` is empty.
- `attribute_similarity = max(id_sim, name_sim, placeholder_sim, aria_label_sim)`.

Heuristic weights (sum to 1.0, used only by the heuristic ranker):
`tag_match 0.15, text_similarity 0.20, attribute_similarity 0.25, class_similarity 0.15, parent_similarity 0.15, depth_similarity 0.10`.

### 3.3 In-browser candidate extraction

The Python version parses HTML with BeautifulSoup. In-process for Playwright,
run extraction inside the page via `page.evaluate` so candidate descriptors
(tag, text, id, name, class, placeholder, aria-label, parent tag, dom depth,
sibling count, type attr) are computed directly from the live DOM. Preferred-tag
order: `input, button, a, select, textarea, label, div, span`; skip structural
tags (`html, head, body, script, style, meta, title, link, base, noscript`);
dedupe by element id; cap at `max_candidates = 200`.

### 3.4 Model export

`scripts/export-onnx.py` loads each sklearn/XGBoost pickle and emits ONNX via
`skl2onnx` / `onnxmltools` with a fixed input vector of length 17 in
`FEATURE_NAMES` order. Output `models/healing_ranker_gb.onnx` (a few hundred KB —
shippable in the npm tarball). At runtime, `onnxruntime-node` loads the model
lazily on first `ml`/`hybrid` heal. The `.pkl` files are **not** shipped.

### 3.5 Packaging

- `onnxruntime-node` is an **optional** dependency; heuristic mode never pulls it.
- `files` ships `dist/` + `models/*.onnx` only.
- Peer `@playwright/test >=1.40`.
- Healing runs only on the failure path → no measurable overhead on passing tests.
- Default mode performs no network I/O; the DOM stays in-process.

### 3.6 Testing

- Unit: TS feature values match the Python reference for a fixture set of (original, candidate) pairs — guards the byte-for-byte invariant.
- Integration: a static HTML page where a control's `id` changes between two loads; assert the action heals and the test passes; assert a genuinely-missing element still throws.
- Parity guard: a small labeled candidate set reproduces the expected ranking order from the service.

### 3.7 Provenance / citation

README links the Zenodo DOI and `paper0_testforge_ai.tex`. Report the model
metrics (GB AUC 0.9993, XGB AUC 0.9994, hybrid 68.63% HSR, +4.05pp over heuristic)
with a pointer to the trained-model record.

---

> **Status update:** locator-first healing (getByRole/getByTestId/getByLabel/getByText/getByPlaceholder/getByAltText/getByTitle + page.locator) is implemented and verified, with intent-aware ranking. See `src/locator.ts`.
