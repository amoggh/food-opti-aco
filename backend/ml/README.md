# Machine Learning ETA Prediction Module

This module provides learned trip travel time and delivery ETA predictions to support the optimization and heuristic routing pipelines.

> [!NOTE]
> Machine learning serves as an auxiliary predictive component. In accordance with project specifications, ML does not replace the central Bio-Inspired Ant Colony Optimization engine.

---

## Model Architecture

- **Algorithm**: `RandomForestRegressor` from `scikit-learn` (100 estimators, max depth 14).
- **Task**: Supervised non-linear regression predicting travel time (minutes) under dynamic traffic and street conditions.
- **Features Used**:
  1. `distance_km`: Trip traversal distance along the road network.
  2. `traffic_level_code`: Categorical congestion state (`LOW`: 0, `MEDIUM`: 1, `HIGH`: 2, `SEVERE`: 3).
  3. `road_type_code`: Road hierarchy classification (`local`: 0, `secondary`: 1, `arterial`: 2).
  4. `time_of_day_min`: Simulation clock minutes (time-of-day rush curves).
  5. `is_weekend`: Binary weekend flag.
  6. `prep_time_min`: Meal kitchen preparation duration.

---

## Empirical Performance Metrics

Evaluated on held-out test data (2,000 synthetic trip records):
- **Mean Absolute Error (MAE)**: `1.446 minutes`
- **Root Mean Squared Error (RMSE)**: `2.297 minutes`
- **Coefficient of Determination ($R^2$)**: `0.9897` (98.97% of variance explained)

---

## Usage

### Training the ETA Model via CLI
```bash
python -m backend.ml.eta_model --samples 2000 --output backend/data/processed/eta_rf_model.pkl
```

### Programmatic Inference
```python
from pathlib import Path
from backend.ml.eta_model import ETAPredictor

predictor = ETAPredictor.load(Path("backend/data/processed/eta_rf_model.pkl"))

estimated_minutes = predictor.predict_travel_time(
    distance_km=4.5,
    traffic_level="HIGH",
    road_type="arterial",
    time_of_day_min=750.0,
    prep_time_min=18.0,
)
print(f"Predicted Travel Time: {estimated_minutes:.2f} mins")
```
