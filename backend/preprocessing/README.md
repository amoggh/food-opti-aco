# Preprocessing Module

This module is responsible for loading, cleaning, validating, and transforming raw delivery datasets into structured, typed formats with continuous simulation time representations.

## Components

### `pipeline.py`
Contains `PreprocessingPipeline` and data models:
- **`ProcessedRestaurant`**: Encapsulates restaurant identifier, spatial coordinates, name, and validated kitchen preparation time.
- **`ProcessedCustomer`**: Contains customer identifier, delivery destination coordinates, and customer name.
- **`ProcessedOrder`**: Normalized order records with converted simulation timestamps:
  - `order_time_min`: Continuous minutes elapsed from simulation start (`2026-10-01 12:00:00`).
  - `deadline_min`: Guaranteed delivery deadline expressed in continuous simulation minutes.
  - `preparation_time`: Positive kitchen preparation minutes.
- **`ProcessedRider`**: Delivery couriers with initial spatial coordinates, multi-order bag capacities, and status.

## Usage

### Run Preprocessing Pipeline via CLI
```bash
python -m backend.preprocessing.pipeline --raw-dir backend/data/raw --processed-dir backend/data/processed
```

### Programmatic Usage
```python
from pathlib import Path
from backend.preprocessing.pipeline import PreprocessingPipeline

pipeline = PreprocessingPipeline(Path("backend/data/raw"))
result = pipeline.run()

for order in result.orders[:5]:
    print(f"Order {order.order_id}: placed at t={order.order_time_min}m, deadline at t={order.deadline_min}m")
```
