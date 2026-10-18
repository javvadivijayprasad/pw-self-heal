# Model Card — pw-self-heal locator ranker

Following the model-card framework (Mitchell et al., 2019). This card describes
the trained similarity model that powers `ml` and `hybrid` modes in
`@vijaypjavvadi/pw-self-heal`.

## Model details

- **Purpose.** Given a Playwright locator that no longer matches any element and a
  set of candidate elements extracted from the live DOM, score each candidate by
  how likely it is to be the element the locator originally referred to. The
  highest-scoring candidate above threshold is used to rebuild the locator.
- **Architecture.** A gradient-boosted decision-tree classifier trained with
  scikit-learn (`GradientBoostingClassifier`), with an XGBoost variant. Deployed
  as an `sklearn` Pipeline (`StandardScaler` → classifier) exported to **ONNX**,
  so scaling happens inside the graph and the TypeScript runtime feeds raw
  features. Runs in-process via `onnxruntime-node`; no server, no Python at
  runtime.
- **Input.** A fixed-length **17-feature** float vector (see below), one per
  (original-locator, candidate) pair.
- **Output.** A class probability in `[0, 1]` (the positive-class column); higher
  means a better match. In `hybrid` mode this is blended `0.4·heuristic + 0.6·ml`.
- **Versions.** `healing_ranker_gb.onnx` (Gradient Boosting, default),
  `healing_ranker_xgb.onnx` (XGBoost, optional).
- **Provenance.** Archived on Zenodo, DOI
  [10.5281/zenodo.19684439](https://doi.org/10.5281/zenodo.19684439). Ported to
  TypeScript with byte-for-byte feature parity against the reference
  implementation.
- **License.** MIT, distributed with the package.

## The 17 features

Core (13): `tag_match`, `text_similarity`, `attribute_similarity`,
`class_similarity`, `parent_similarity`, `depth_similarity`, `id_similarity`,
`name_similarity`, `placeholder_similarity`, `aria_label_similarity`,
`type_attr_match`, `sibling_count_ratio`, `multi_attr_match_count`.
Extended (4): `candidate_text_actionable`, `candidate_in_form`,
`candidate_attr_richness`, `original_attr_count`.

String similarities are case-insensitive Ratcliff/Obershelp ratios (empty/empty =
0.0). `depth_similarity = max(0, 1 − |Δdepth|/10)`, `sibling_count_ratio =
min(siblings/20, 1)`, `multi_attr_match_count` is a raw integer in `[0..4]`. The
exact invariants are pinned by unit tests (`tests/features.test.ts`,
`tests/feature-vector.test.ts`).

## Intended use

- **In scope.** Runtime healing of broken Playwright locators in web UI tests,
  where an element still exists under a slightly changed selector (renamed
  `data-testid`, reworded label, moved input). Ranking candidates for a
  human-reviewable heal log.
- **Out of scope.** Any security- or correctness-critical decision; deciding
  whether an application behaves correctly (the model matches *elements*, not
  requirements); non-web UIs; use as a general element classifier outside this
  candidate-ranking pipeline. A genuinely-missing element must still fail — the
  confidence threshold enforces this, and assertions are never routed through
  healing.

## Training & evaluation data

- **Task framing.** Binary classification over (original-locator, candidate)
  pairs: is this candidate the drifted element (positive) or not (negative)?
- **Dataset.** A labeled locator-drift dataset built from before/after DOM
  snapshots of UI refactors, ~**6,200** training and ~**1,550** held-out test
  pairs. Features computed by the same extractor used at runtime.
- **Note.** The dataset skews toward conventional web application markup
  (semantic HTML, ARIA, common test-id conventions). Performance on highly
  unusual DOMs (heavy shadow-DOM, canvas-rendered UIs, obfuscated class names)
  is expected to be lower — see Limitations.

## Metrics

| Model | ROC-AUC | F1 (macro) |
|---|---|---|
| Gradient Boosting (default) | **0.9993** | 0.977 |
| XGBoost | **0.9994** | 0.977 |

End-to-end, **hybrid** mode achieves a **68.63% heal success rate (HSR)** on the
evaluation refactors — **+4.05 pp** over the heuristic-only baseline. AUC/F1 are
classifier metrics on held-out pairs; HSR is the operational metric (fraction of
broken locators healed to the correct element within threshold).

## Limitations & caveats

- **Distribution shift.** Trained on conventional web DOMs; accuracy drops on
  shadow-DOM-heavy, canvas, or heavily-obfuscated pages. `heuristic` mode is
  always available as a no-model fallback.
- **Similarity, not truth.** A high score means "structurally/semantically most
  like the original," not "definitely correct." The `confidence` threshold and
  the human-reviewable heal log (`LocatorScore` in telemetry) exist so heals can
  be audited and baked into the source.
- **Feature-order dependency.** The ONNX input must be the 17 features in
  `FEATURE_NAMES` order; a mismatch produces meaningless scores. This is guarded
  by tests and the CI model-validation step.
- **No online learning.** The model is static at runtime; it does not adapt
  during a run. A feedback loop for retraining is on the roadmap.

## Ethical & privacy considerations

The model runs **entirely in-process**. The DOM, candidate features, and heal
decisions never leave the machine in default mode; there is no network call and
no API key. The model neither stores nor transmits any page content. Because it
only ranks candidate elements, it cannot exfiltrate data or take actions beyond
selecting which element a test interacts with.

## Citation

See [`CITATION.cff`](../CITATION.cff). The trained model is archived at
[10.5281/zenodo.19684439](https://doi.org/10.5281/zenodo.19684439).
