"""Dataset generator for training the machine learning ETA prediction model."""
import random
from typing import Dict, List

import numpy as np
import pandas as pd

from backend.routing.traffic import TRAFFIC_SPEED_MULTIPLIERS, TrafficLevel


def generate_eta_training_dataset(
    num_samples: int = 1500,
    random_seed: int = 42,
) -> pd.DataFrame:
    """Generates synthetic historical delivery trip records for regression modeling."""
    rng = random.Random(random_seed)
    np_rng = np.random.default_rng(random_seed)

    records: List[Dict] = []
    traffic_levels = [TrafficLevel.LOW, TrafficLevel.MEDIUM, TrafficLevel.HIGH, TrafficLevel.SEVERE]
    road_types = ["local", "secondary", "arterial"]
    road_type_codes = {"local": 0, "secondary": 1, "arterial": 2}
    base_speeds = {"local": 25.0, "secondary": 35.0, "arterial": 50.0}

    for _ in range(num_samples):
        distance_km = round(rng.uniform(0.5, 15.0), 3)
        traffic = rng.choices(traffic_levels, weights=[0.4, 0.3, 0.2, 0.1], k=1)[0]
        road_type = rng.choice(road_types)
        time_of_day_min = round(rng.uniform(660.0, 840.0), 1)  # 11:00 AM to 2:00 PM lunch window
        is_weekend = rng.choice([0, 1])
        prep_time_min = round(rng.uniform(8.0, 25.0), 1)

        # Physics-based baseline travel time with traffic and realistic noise
        base_speed = base_speeds[road_type]
        multiplier = TRAFFIC_SPEED_MULTIPLIERS[traffic]
        effective_speed = max(5.0, base_speed * multiplier)

        # Nominal travel time
        nominal_travel_time = (distance_km / effective_speed) * 60.0

        # Non-linear delays (traffic signals, intersection stops, weather variance)
        noise_factor = float(np_rng.normal(loc=1.0, scale=0.05))
        actual_travel_time = round(max(1.0, nominal_travel_time * noise_factor + rng.uniform(0.2, 1.5)), 2)

        # Full delivery ETA (kitchen preparation + transit + service time)
        actual_delivery_eta = round(prep_time_min + actual_travel_time + 3.0, 2)

        records.append({
            "distance_km": distance_km,
            "traffic_level": traffic.value,
            "traffic_level_code": {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "SEVERE": 3}[traffic.value],
            "road_type": road_type,
            "road_type_code": road_type_codes[road_type],
            "time_of_day_min": time_of_day_min,
            "is_weekend": is_weekend,
            "prep_time_min": prep_time_min,
            "travel_time_min": actual_travel_time,
            "delivery_eta_min": actual_delivery_eta,
        })

    return pd.DataFrame(records)
