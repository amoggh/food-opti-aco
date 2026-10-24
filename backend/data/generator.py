"""Synthetic data generator for food delivery optimization environment."""
import argparse
import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

from backend.config.data_config import DataGenerationConfig


RESTAURANT_NAMES_PREFIX = [
    "Golden", "Royal", "Urban", "Spice", "The Rustic", "Grand", "Green", "Flavors of",
    "Bistro", "Daily", "Little", "Artisan", "Corner", "Claypot", "Mama's", "Wok &",
    "Sizzling", "Aroma", "Olive &", "Street", "Supreme", "Ocean", "Crispy", "Biryani"
]
RESTAURANT_NAMES_SUFFIX = [
    "Kitchen", "Bistro", "Dhaba", "Trattoria", "Grill", "Pizzeria", "Express", "House",
    "Cafe", "Tavern", "Hub", "Diner", "Garden", "Bowl", "Platter", "Lounge",
    "Bakehouse", "Corner", "Junction", "Eats", "Depot", "Cart", "Feast", "Box"
]

CUSTOMER_FIRST_NAMES = [
    "Aarav", "Aditi", "Ananya", "Arjun", "Dev", "Diya", "Ishan", "Kavya",
    "Manish", "Meera", "Neha", "Nikhil", "Pooja", "Pranav", "Rahul", "Riya",
    "Rohan", "Sanjay", "Shreya", "Siddharth", "Sneha", "Tanvi", "Varun", "Vikram"
]
CUSTOMER_LAST_NAMES = [
    "Sharma", "Patel", "Verma", "Rao", "Nair", "Gupta", "Kumar", "Iyer",
    "Reddy", "Mehta", "Singh", "Joshi", "Bose", "Chopra", "Deshmukh", "Menon"
]


class SyntheticDataGenerator:
    """Generates realistic synthetic datasets for food delivery optimization."""

    def __init__(self, config: DataGenerationConfig = None):
        self.config = config or DataGenerationConfig()
        self.rng = random.Random(self.config.random_seed)

    def _sample_coordinates_from_hubs(
        self, hubs: list, sigma: float = 0.008
    ) -> Tuple[float, float]:
        """Samples a coordinate clustered around one of the designated hubs using Gaussian distribution."""
        hub = self.rng.choice(hubs)
        lat = self.rng.gauss(hub.lat, sigma)
        lon = self.rng.gauss(hub.lon, sigma)

        # Clamp within city bounds
        lat = max(self.config.lat_min, min(self.config.lat_max, lat))
        lon = max(self.config.lon_min, min(self.config.lon_max, lon))
        return round(lat, 6), round(lon, 6)

    def _sample_customer_coordinates(self) -> Tuple[float, float]:
        """Customers are located predominantly in residential zones, with some scattered citywide."""
        if self.rng.random() < 0.85:
            return self._sample_coordinates_from_hubs(self.config.residential_zones, sigma=0.015)
        # Uniform background spread
        lat = self.rng.uniform(self.config.lat_min, self.config.lat_max)
        lon = self.rng.uniform(self.config.lon_min, self.config.lon_max)
        return round(lat, 6), round(lon, 6)

    def generate_restaurants(self) -> List[Dict]:
        """Generates realistic restaurant entries clustered in commercial dining hubs."""
        restaurants = []
        name_pool = set()

        for i in range(1, self.config.num_restaurants + 1):
            rest_id = f"REST_{i:03d}"
            lat, lon = self._sample_coordinates_from_hubs(self.config.commercial_hubs, sigma=0.007)

            # Generate unique name
            while True:
                name = f"{self.rng.choice(RESTAURANT_NAMES_PREFIX)} {self.rng.choice(RESTAURANT_NAMES_SUFFIX)}"
                if name not in name_pool:
                    name_pool.add(name)
                    break

            avg_prep_time = self.rng.randint(
                self.config.min_prep_time_minutes, self.config.max_prep_time_minutes
            )

            restaurants.append({
                "restaurant_id": rest_id,
                "latitude": lat,
                "longitude": lon,
                "name": name,
                "average_preparation_time": avg_prep_time,
            })

        return restaurants

    def generate_customers(self) -> List[Dict]:
        """Generates customer records distributed across city residential areas."""
        customers = []
        for i in range(1, self.config.num_customers + 1):
            cust_id = f"CUST_{i:04d}"
            lat, lon = self._sample_customer_coordinates()
            name = f"{self.rng.choice(CUSTOMER_FIRST_NAMES)} {self.rng.choice(CUSTOMER_LAST_NAMES)}"

            customers.append({
                "customer_id": cust_id,
                "latitude": lat,
                "longitude": lon,
                "name": name,
            })
        return customers

    def generate_riders(self, restaurants: List[Dict]) -> List[Dict]:
        """Generates delivery riders stationed near restaurant clusters or central hubs."""
        riders = []
        for i in range(1, self.config.num_riders + 1):
            rider_id = f"RIDER_{i:03d}"
            # Riders are positioned either close to an active restaurant or around a commercial hub
            if restaurants and self.rng.random() < 0.6:
                anchor = self.rng.choice(restaurants)
                lat = self.rng.gauss(anchor["latitude"], 0.004)
                lon = self.rng.gauss(anchor["longitude"], 0.004)
            else:
                lat, lon = self._sample_coordinates_from_hubs(self.config.commercial_hubs, sigma=0.01)

            lat = round(max(self.config.lat_min, min(self.config.lat_max, lat)), 6)
            lon = round(max(self.config.lon_min, min(self.config.lon_max, lon)), 6)

            capacity = self.rng.randint(
                self.config.min_rider_capacity, self.config.max_rider_capacity
            )

            riders.append({
                "rider_id": rider_id,
                "latitude": lat,
                "longitude": lon,
                "capacity": capacity,
                "status": self.config.default_rider_status,
            })
        return riders

    def generate_orders(
        self, restaurants: List[Dict], customers: List[Dict]
    ) -> List[Dict]:
        """Generates time-stamped food delivery orders with preparation times and deadlines."""
        if not restaurants or not customers:
            raise ValueError("Restaurants and Customers must be generated before Orders.")

        base_time = datetime.strptime(self.config.simulation_start_iso, "%Y-%m-%d %H:%M:%S")
        orders = []

        rest_lookup = {r["restaurant_id"]: r for r in restaurants}
        customer_ids = [c["customer_id"] for c in customers]
        rest_ids = [r["restaurant_id"] for r in restaurants]

        for i in range(1, self.config.num_orders + 1):
            order_id = f"ORD_{i:04d}"
            rest_id = self.rng.choice(rest_ids)
            cust_id = self.rng.choice(customer_ids)

            # Order placed during peak rush window
            order_offset_sec = self.rng.randint(0, self.config.order_time_window_minutes * 60)
            order_time = base_time + timedelta(seconds=order_offset_sec)

            # Preparation time centered around restaurant average with slight variance
            rest_avg_prep = rest_lookup[rest_id]["average_preparation_time"]
            prep_time = max(
                self.config.min_prep_time_minutes,
                int(round(self.rng.gauss(rest_avg_prep, 3.0)))
            )

            # Delivery buffer (transit time allowance + service time)
            delivery_buffer = self.rng.randint(
                self.config.min_delivery_buffer_minutes,
                self.config.max_delivery_buffer_minutes
            )
            # Deadline must strictly occur after order creation and preparation
            total_lead_time_minutes = prep_time + delivery_buffer
            deadline = order_time + timedelta(minutes=total_lead_time_minutes)

            orders.append({
                "order_id": order_id,
                "restaurant_id": rest_id,
                "customer_id": cust_id,
                "order_time": order_time.strftime("%Y-%m-%d %H:%M:%S"),
                "preparation_time": prep_time,
                "deadline": deadline.strftime("%Y-%m-%d %H:%M:%S"),
                "order_status": self.config.default_order_status,
            })

        # Sort orders chronologically by order_time for realistic progression
        orders.sort(key=lambda x: x["order_time"])
        # Re-index order IDs to match chronological sequence
        for idx, order in enumerate(orders, 1):
            order["order_id"] = f"ORD_{idx:04d}"

        return orders

    def generate_all(self) -> Dict[str, List[Dict]]:
        """Generates all 4 synthetic datasets consistently using the configured random seed."""
        # Reset RNG seed for reproducibility
        self.rng = random.Random(self.config.random_seed)
        restaurants = self.generate_restaurants()
        customers = self.generate_customers()
        riders = self.generate_riders(restaurants)
        orders = self.generate_orders(restaurants, customers)

        return {
            "restaurants": restaurants,
            "customers": customers,
            "orders": orders,
            "riders": riders,
        }

    def save_datasets_to_csv(self, output_dir: Path) -> Dict[str, Path]:
        """Generates and writes all datasets to CSV files in output_dir."""
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        data = self.generate_all()
        saved_paths = {}

        for entity_name, records in data.items():
            if not records:
                continue
            file_path = output_dir / f"{entity_name}.csv"
            fieldnames = list(records[0].keys())

            with open(file_path, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(records)

            saved_paths[entity_name] = file_path

        return saved_paths


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic food delivery dataset.")
    parser.add_argument("--output-dir", type=str, default="backend/data/raw", help="Output directory for CSVs")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--restaurants", type=int, default=25, help="Number of restaurants")
    parser.add_argument("--customers", type=int, default=120, help="Number of customers")
    parser.add_argument("--orders", type=int, default=150, help="Number of orders")
    parser.add_argument("--riders", type=int, default=20, help="Number of riders")
    args = parser.parse_args()

    config = DataGenerationConfig(
        random_seed=args.seed,
        num_restaurants=args.restaurants,
        num_customers=args.customers,
        num_orders=args.orders,
        num_riders=args.riders,
    )
    generator = SyntheticDataGenerator(config)
    paths = generator.save_datasets_to_csv(Path(args.output_dir))

    print("Synthetic dataset generation completed successfully:")
    for entity, p in paths.items():
        print(f"  - {entity}: {p}")


if __name__ == "__main__":
    main()
