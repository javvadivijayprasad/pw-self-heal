#!/usr/bin/env python3
"""Export the trained self-healing rankers (sklearn / XGBoost pickles) to ONNX
so they can run in-process from Node via onnxruntime-node — no Python at runtime.

Usage:
    python scripts/export-onnx.py \
        --gb  ../../self_healing_stage_services/models/healing_ranker_gb.pkl \
        --xgb ../../self_healing_stage_services/models/healing_ranker_xgb.pkl \
        --out models

The exported model takes a single float32 input tensor of shape [N, F] where F
is the model's trained feature count (model.n_features_in_), in FEATURE_NAMES
order. Output is the class-probability tensor.

Requires: scikit-learn, skl2onnx, onnxmltools, onnxconverter-common, xgboost.
    pip install skl2onnx onnxmltools onnxconverter-common xgboost
"""
from __future__ import annotations

import argparse
import pickle
from pathlib import Path


def load_model(path: str):
    """Load a trained ranker.

    Stage A persists models with ``joblib.dump`` (pickle + joblib's numpy-array
    framing). Plain ``pickle.load`` fails on those files with an ``invalid load
    key`` error because it reads past the pickle stream into the raw array bytes.
    Try ``joblib.load`` first and fall back to ``pickle.load`` only if joblib is
    unavailable or the file turns out to be a plain pickle.
    """
    try:
        import joblib

        return joblib.load(path)
    except ModuleNotFoundError:
        # A missing module means the file loaded as joblib but was trained with a
        # different library version (e.g. sklearn's internals moved). Do NOT fall
        # back to pickle — surface the real cause so the version can be matched.
        raise
    except Exception:
        with open(path, "rb") as f:
            return pickle.load(f)


def export_sklearn(model, n_features: int, out_path: Path) -> None:
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    initial_type = [("input", FloatTensorType([None, n_features]))]
    onx = convert_sklearn(model, initial_types=initial_type, options={id(model): {"zipmap": False}})
    out_path.write_bytes(onx.SerializeToString())
    print(f"  wrote {out_path} ({out_path.stat().st_size} bytes)")


def export_xgboost(model, n_features: int, out_path: Path) -> None:
    from onnxmltools import convert_xgboost
    from onnxmltools.convert.common.data_types import FloatTensorType

    initial_type = [("input", FloatTensorType([None, n_features]))]
    onx = convert_xgboost(model, initial_types=initial_type)
    out_path.write_bytes(onx.SerializeToString())
    print(f"  wrote {out_path} ({out_path.stat().st_size} bytes)")


def n_features_of(model) -> int:
    for attr in ("n_features_in_",):
        if hasattr(model, attr):
            return int(getattr(model, attr))
    # XGBoost sklearn wrapper
    booster = getattr(model, "get_booster", lambda: None)()
    if booster is not None and booster.num_features():
        return int(booster.num_features())
    raise SystemExit("Could not determine model feature count; set it manually.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gb")
    ap.add_argument("--xgb")
    ap.add_argument("--out", default="models")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.gb:
        gb = load_model(args.gb)
        print("Exporting Gradient Boosting →")
        export_sklearn(gb, n_features_of(gb), out_dir / "healing_ranker_gb.onnx")

    if args.xgb:
        xgb = load_model(args.xgb)
        print("Exporting XGBoost →")
        export_xgboost(xgb, n_features_of(xgb), out_dir / "healing_ranker_xgb.onnx")


if __name__ == "__main__":
    main()
