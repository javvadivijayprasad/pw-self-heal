# Competitive Teardown — Self-Healing Playwright Locators (npm)

Prepared 2026-07-01. Source: npm registry READMEs + dependency manifests.
Purpose: find each competitor's drawbacks and lock in `pw-self-heal`'s positioning.

---

## The market splits into three camps — each with one fatal weakness

| Camp | How it heals | Packages | The weakness |
|---|---|---|---|
| **Heuristic-only** | String/structural similarity, weighted attribute scoring | `selfmend`, `playwright-ai-self-healing`, `locatorpro-playwright` | No learning, no model, weak on hard/ambiguous cases; "AI" is often just Levenshtein |
| **LLM-dependent** | Calls an LLM (cloud or local) to guess the element | `sela-core`, `playwright-anchor` | Needs an API key or a local LLM install; privacy egress, cost, latency, or human-in-loop |
| **Server-backed ML** | Real ML model behind a backend service | `healx-playwright` | Requires standing up Postgres + Redis + a Python API — the adoption killer |

**No competitor combines a trained in-process ML model (no server, no key) with an
optional *governed* LLM fallback and published research.** That gap is the wedge.

---

## Per-competitor drawbacks

### sela-core (v1.0.9) — LLM wrapper
- Depends directly on `@anthropic-ai/sdk`, `axios`, `ts-morph`, **and bundles `playwright` as a hard dependency** (not a peer) → heavy install, version-conflict risk with the user's own Playwright.
- **Requires an Anthropic API key** → paid, cloud, per-heal cost + latency.
- Every heal sends DOM/context to Anthropic → **privacy egress by default**, no sanitization layer described.
- No trained domain model — accuracy is only as good as the general LLM's guess.
- "Drop-in replacement for @playwright/test" means it wraps the runner surface — more to break as Playwright evolves.

### selfmend (v0.2.3) — heuristic, offline (closest on *privacy*)
- **Purely heuristic signal-matching — no trained model, no ML, no LLM fallback.** Ceiling on accuracy for ambiguous or heavily-changed DOM.
- **Requires Node ≥ 22** (yours is ≥ 18) → excludes a large slice of CI/LTS users.
- Early (v0.2.x), no intent-aware locator rebuild, no learning loop / telemetry flywheel.
- Its whole pitch is "offline + no key" — which `pw-self-heal` also does, **plus a trained model**. Direct beat.

### playwright-anchor (v0.2.0) — local-LLM, git-diff workflow
- **Requires you to run a local LLM** (Ollama / llama.cpp / LM Studio) → multi-GB models, real setup friction; "zero infra" is not true.
- Healing is a **dev-time, commit-based** flow: it records heals to `.playwright-anchors.json` and **CI only replays recorded heals** — it cannot autonomously heal a *new* break in CI without the LLM present.
- Human-in-the-loop by design (review the diff) → not hands-off resilience.
- General LLM, no trained domain ranker, no published metrics. Early (v0.2).

### healx-playwright (v0.2.2) — server-backed ML (the exact thing you beat)
- **Requires docker-compose: PostgreSQL + Redis + a Python FastAPI backend** running at localhost:8000. This is precisely the adoption blocker `pw-self-heal`'s SPEC was written to eliminate.
- Not in-process; DOM is POSTed to a backend. Ops burden, latency, another service to maintain.
- Early (v0.2.x). ML is real (sentence-transformers, tree edit distance) but **unshippable to a normal `npm install`** — that's the whole point.

### self-healing-locator-agent (v1.0.0) — **the most dangerous competitor**
- This one **already ships the same 3-layer ladder** you're planning: Layer 1 weighted attribute scoring (<50ms, offline) → Layer 2 local LLM (Ollama) → Layer 3 cloud Gemini (free tier). So **"local-first + LLM fallback" is NOT novel** — press elsewhere.
- **BUT its Layer 1 is heuristic weighted scoring, not a trained model** — no ONNX, no benchmarked ranker, no AUC, no published model.
- **No governance / sanitization** on the cloud (Gemini) path → DOM egress with no PII filtering.
- No research provenance (no DOI, no paper).
- Layer 2 requires Ollama setup; Layer 3 needs a Gemini key.
- **Your differentiators vs this one:** trained 17-feature ONNX ranker (AUC 0.9993) with a **Zenodo DOI + paper**, and a **governed** LLM fallback (sanitizer, not raw egress). That's the whole ballgame against it.

### locatorpro-playwright (v1.0.2) — not really "healing"
- It's **proactive priority-based selector generation** (35 fallback selectors upfront), not reactive model-based matching against the live DOM. Different category.
- No ML, no LLM, no learning/telemetry. Honestly admits Playwright's built-ins should be first choice.

### playwright-ai-self-healing (v1.0.0) — "AI" is marketing
- "AI algorithms" = Levenshtein + structural similarity heuristics. **No trained model, no LLM.**
- Single publish (Sep 2025), not updated since; no intent-aware rebuild; overpromising branding.

---

## Where `pw-self-heal` wins (the close)

Feature-by-feature, `pw-self-heal` is the only entry that is **all** of:

1. **Trained, benchmarked, citable ML** — 17-feature ONNX ranker, GB AUC 0.9993 / XGB 0.9994, hybrid 68.63% HSR, published to **Zenodo (DOI 10.5281/zenodo.19684439)** with a paper. *No npm competitor has a published, versioned trained model.*
2. **In-process, zero-infra** — no server, no Postgres/Redis, no Python. Beats `healx` outright and beats `sela-core`'s bundled-Playwright weight.
3. **Private by default** — DOM never leaves the machine, no API key required. Beats `sela-core` and the cloud path of `self-healing-locator-agent`.
4. **Intent-aware locator healing** — heals `getByTestId → getByTestId`, not a brittle CSS path. Most competitors rebuild to raw selectors.
5. **Optional *governed* LLM fallback** — model-first, with an opt-in LLM rung whose payload passes an in-process TS sanitizer. The one competitor with the same ladder (`self-healing-locator-agent`) has **no governance and no trained model**.
6. **Broad Node support** (≥18) vs `selfmend`'s ≥22.

**One-line positioning:**
> *The only self-healing Playwright locator with a trained, benchmarked, citable
> model that runs in-process — no server, no key — with an optional governed LLM
> fallback for the hard cases.*

---

## Honest risks (so we go in clear-eyed)

- **The category is crowded and fast-moving.** ~10+ packages, most shipped in the last 3 months. Generic-name SEO is already taken (`locatorpro`, `playwright-ai-self-healing`).
- **"Local + LLM fallback" is already claimed** by `self-healing-locator-agent`. Novelty must lean on the **trained model + governance + provenance**, not the ladder idea.
- **Scoped name (`@vijaypjavvadi/...`) is lower-discoverability** than SEO-tuned unscoped names. Mitigate with keywords, a strong README, and the DOI badge.
- Most rivals are v0.x with little traction — **the window is open**, but being first-with-a-real-model matters more than being first.

## Recommended moves to "close"

1. **Lead every surface with the DOI-backed trained model** — README badge, first paragraph, npm keywords. It's the one claim no competitor can copy quickly.
2. **Ship the governed LLM fallback (0.2.0)** to leapfrog `self-healing-locator-agent` on the exact ladder it owns — governance + trained model is the moat.
3. **Add a one-line comparison table to the README** (vs server-backed, vs LLM-only, vs heuristic-only) so the differentiation is immediate.
4. **Publish now** — pw-self-heal isn't on npm yet; every week the field fills in. First real-model entrant is a defensible claim (and EB1A-relevant originality evidence).
