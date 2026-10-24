"""Unit tests for machine learning ETA predictor."""
import shutil
import tempfile
from pathlib import Path

import pytest

from backend.ml.dataset import generate_eta_training_dataset
from backend.ml.eta_model import ETAPredictor


def test_eta_dataset_generation():
    df = generate_eta_training_dataset(num_samples=200, random_seed=42)

    assert len(df) == 200
    for col in ETAPredictor.FEATURE_COLS + ["travel_time_min", "delivery_eta_min"]:
        assert col in df.columns

    assert (df["travel_time_min"] > 0).all()
    assert (df["distance_km"] > 0).all()


def test_eta_predictor_training_and_accuracy():
    df = generate_eta_training_dataset(num_samples=800, random_seed=42)
    predictor = ETAPredictor(n_estimators=40, random_state=42)
    metrics = predictor.train(df)

    assert predictor.is_trained
    assert metrics["mae"] < 5.0   # Low average error in minutes
    assert metrics["r2"] > 0.85   # High explained variance (R^2 > 85%)

    # Test single-point prediction
    pred_short = predictor.predict_travel_time(distance_km=2.0, traffic_level="LOW", road_type="arterial")
    pred_long = predictor.predict_travel_time(distance_km=15.0, traffic_level="HIGH", road_type="local")

    assert pred_short > 0.0
    assert pred_long > pred_short  # Longer trip with high traffic must take more time


def test_eta_predictor_serialization():
    temp_dir = Path(tempfile.mkdtemp(prefix="food_delivery_ml_test_"))
    try:
        df = generate_eta_training_dataset(num_samples=200, random_seed=42)
        predictor = ETAPredictor(n_estimators=20, random_state=42)
        predictor.train(df)

        model_path = temp_dir / "eta_model.pkl"
        predictor.save(model_path)

        loaded_predictor = ETAPredictor.load(model_path)
        assert loaded_predictor.is_trained

        pred_orig = predictor.predict_travel_time(distance_km=5.0)
        pred_loaded = loaded_predictor.predict_travel_time(distance_km=5.0)
        assert pred_orig == pred_loaded
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
