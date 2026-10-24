"""Machine learning ETA predictor using Random Forest regression."""
import argparse
import pickle
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from backend.ml.dataset import generate_eta_training_dataset


class ETAPredictor:
    """Random Forest regressor predicting trip travel times and delivery ETAs."""

    FEATURE_COLS = [
        "distance_km",
        "traffic_level_code",
        "road_type_code",
        "time_of_day_min",
        "is_weekend",
        "prep_time_min",
    ]

    TRAFFIC_CODE_MAP = {
        "LOW": 0,
        "MEDIUM": 1,
        "HIGH": 2,
        "SEVERE": 3,
    }

    ROAD_TYPE_MAP = {
        "local": 0,
        "secondary": 1,
        "arterial": 2,
    }

    def __init__(self, n_estimators: int = 100, random_state: int = 42):
        self.model = RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=14,
            random_state=random_state,
        )
        self.metrics: Dict[str, float] = {}
        self.is_trained: bool = False

    def train(self, df: pd.DataFrame, test_size: float = 0.2) -> Dict[str, float]:
        """Trains the Random Forest model and evaluates regression performance metrics."""
        X = df[self.FEATURE_COLS]
        y = df["travel_time_min"]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )

        self.model.fit(X_train, y_train)
        self.is_trained = True

        y_pred = self.model.predict(X_test)
        mae = float(mean_absolute_error(y_test, y_pred))
        mse = float(mean_squared_error(y_test, y_pred))
        rmse = float(np.sqrt(mse))
        r2 = float(r2_score(y_test, y_pred))

        self.metrics = {
            "mae": round(mae, 3),
            "rmse": round(rmse, 3),
            "r2": round(r2, 4),
        }
        return self.metrics

    def predict_travel_time(
        self,
        distance_km: float,
        traffic_level: str = "LOW",
        road_type: str = "secondary",
        time_of_day_min: float = 720.0,
        is_weekend: int = 0,
        prep_time_min: float = 15.0,
    ) -> float:
        """Infers estimated travel time in minutes for a single trip segment."""
        if not self.is_trained:
            raise RuntimeError("Model has not been trained yet. Call train() or load() first.")

        traffic_code = self.TRAFFIC_CODE_MAP.get(traffic_level.upper(), 0)
        road_code = self.ROAD_TYPE_MAP.get(road_type.lower(), 1)
        row_df = pd.DataFrame([{
            "distance_km": distance_km,
            "traffic_level_code": traffic_code,
            "road_type_code": road_code,
            "time_of_day_min": time_of_day_min,
            "is_weekend": is_weekend,
            "prep_time_min": prep_time_min,
        }], columns=self.FEATURE_COLS)

        pred = self.model.predict(row_df)[0]
        return round(float(pred), 2)

    def save(self, filepath: Path) -> None:
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "wb") as f:
            pickle.dump({"model": self.model, "metrics": self.metrics}, f)

    @classmethod
    def load(cls, filepath: Path) -> "ETAPredictor":
        filepath = Path(filepath)
        with open(filepath, "rb") as f:
            data = pickle.load(f)
        predictor = cls()
        predictor.model = data["model"]
        predictor.metrics = data.get("metrics", {})
        predictor.is_trained = True
        return predictor


def main():
    parser = argparse.ArgumentParser(description="Train and evaluate Random Forest ETA model.")
    parser.add_argument("--samples", type=int, default=2000, help="Number of synthetic trip records")
    parser.add_argument("--output", type=str, default="backend/data/processed/eta_rf_model.pkl", help="Model artifact path")
    args = parser.parse_args()

    print(f"Generating synthetic trip dataset with {args.samples} samples...")
    dataset = generate_eta_training_dataset(num_samples=args.samples)

    print("Training Random Forest Regressor for ETA prediction...")
    predictor = ETAPredictor()
    metrics = predictor.train(dataset)

    print("\n--- Regression Performance Metrics ---")
    print(f"  - Mean Absolute Error (MAE) : {metrics['mae']:.3f} minutes")
    print(f"  - Root Mean Squared Error (RMSE): {metrics['rmse']:.3f} minutes")
    print(f"  - Coefficient of Determination (R2): {metrics['r2']:.4f}")

    predictor.save(Path(args.output))
    print(f"\nTrained ETA model saved to: {args.output}")


if __name__ == "__main__":
    main()
