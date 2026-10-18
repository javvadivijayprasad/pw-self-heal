# Models

> For architecture, features, training data, metrics, intended use, and
> limitations, see the [**model card**](../docs/model-card.md).

This directory holds the ONNX-exported ranking models used by `ml` and `hybrid`
modes. They are **not** committed in source form; generate them from the trained
pickles with `scripts/export-onnx.py`:

```bash
python scripts/export-onnx.py \
  --gb  ../../self_healing_stage_services/models/healing_ranker_gb.pkl \
  --xgb ../../self_healing_stage_services/models/healing_ranker_xgb.pkl \
  --out models
```

Produces `healing_ranker_gb.onnx` (default) and `healing_ranker_xgb.onnx`.
Only the `.onnx` files are published in the npm tarball (`files` in package.json).

## Provenance

The rankers are trained on a labeled locator-drift dataset (6,200 train / 1,550
test). Reported metrics:

| Model | AUC | F1 (macro) | Notes |
|---|---|---|---|
| Gradient Boosting | 0.9993 | 0.977 | default |
| XGBoost | 0.9994 | 0.977 | `multi_attr_match_count` is its top feature (0.42) |

Hybrid mode (`α·heuristic + (1−α)·ml`, α=0.40) achieves 68.63% HSR, +4.05pp over
the heuristic baseline.

Trained-model record (Zenodo DOI): **10.5281/zenodo.19684439**.

> Heuristic mode requires no model and is always available; `ml`/`hybrid`
> gracefully fall back to heuristic if the ONNX model or `onnxruntime-node` is
> not present.
