"""Data preprocessing pipeline converting raw delivery datasets into structured, validated formats."""
import csv
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class ProcessedRestaurant:
    restaurant_id: str
    latitude: float
    longitude: float
    name: str
    average_preparation_time: int


@dataclass
class ProcessedCustomer:
    customer_id: str
    latitude: float
    longitude: float
    name: str


@dataclass
class ProcessedOrder:
    order_id: str
    restaurant_id: str
    customer_id: str
    order_time: str
    order_time_min: float  # Elapsed minutes since simulation start
    preparation_time: int  # Minutes
    deadline: str
    deadline_min: float    # Elapsed minutes since simulation start
    order_status: str


@dataclass
class ProcessedRider:
    rider_id: str
    latitude: float
    longitude: float
    capacity: int
    status: str


@dataclass
class PreprocessingResult:
    restaurants: List[ProcessedRestaurant]
    customers: List[ProcessedCustomer]
    orders: List[ProcessedOrder]
    riders: List[ProcessedRider]
    stats: Dict[str, int]


class PreprocessingPipeline:
    """Loads, cleans, validates, and prepares delivery data for routing and optimization."""

    DEFAULT_SIM_START = "2026-10-01 12:00:00"

    def __init__(self, raw_data_dir: Path, sim_start_iso: str = DEFAULT_SIM_START):
        self.raw_data_dir = Path(raw_data_dir)
        self.sim_start_time = datetime.strptime(sim_start_iso, "%Y-%m-%d %H:%M:%S")

    def _read_csv(self, filename: str) -> List[Dict[str, str]]:
        filepath = self.raw_data_dir / filename
        if not filepath.exists():
            raise FileNotFoundError(f"Required raw dataset not found: {filepath}")
        with open(filepath, mode="r", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def _to_sim_minutes(self, dt_str: str) -> float:
        dt = datetime.strptime(dt_str.strip(), "%Y-%m-%d %H:%M:%S")
        delta = dt - self.sim_start_time
        return round(delta.total_seconds() / 60.0, 2)

    def process_restaurants(self) -> List[ProcessedRestaurant]:
        raw = self._read_csv("restaurants.csv")
        processed = []
        for row in raw:
            # Skip rows with missing critical values
            if not row.get("restaurant_id") or not row.get("latitude") or not row.get("longitude"):
                continue
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue
            prep_time = max(1, int(row.get("average_preparation_time", 15)))

            processed.append(
                ProcessedRestaurant(
                    restaurant_id=row["restaurant_id"].strip(),
                    latitude=lat,
                    longitude=lon,
                    name=row.get("name", "").strip(),
                    average_preparation_time=prep_time,
                )
            )
        return processed

    def process_customers(self) -> List[ProcessedCustomer]:
        raw = self._read_csv("customers.csv")
        processed = []
        for row in raw:
            if not row.get("customer_id") or not row.get("latitude") or not row.get("longitude"):
                continue
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue

            processed.append(
                ProcessedCustomer(
                    customer_id=row["customer_id"].strip(),
                    latitude=lat,
                    longitude=lon,
                    name=row.get("name", "").strip(),
                )
            )
        return processed

    def process_riders(self) -> List[ProcessedRider]:
        raw = self._read_csv("riders.csv")
        processed = []
        for row in raw:
            if not row.get("rider_id") or not row.get("latitude") or not row.get("longitude"):
                continue
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue
            capacity = max(1, int(row.get("capacity", 2)))

            processed.append(
                ProcessedRider(
                    rider_id=row["rider_id"].strip(),
                    latitude=lat,
                    longitude=lon,
                    capacity=capacity,
                    status=row.get("status", "AVAILABLE").strip(),
                )
            )
        return processed

    def process_orders(
        self,
        valid_restaurant_ids: set,
        valid_customer_ids: set,
    ) -> List[ProcessedOrder]:
        raw = self._read_csv("orders.csv")
        processed = []
        for row in raw:
            oid = row.get("order_id", "").strip()
            rest_id = row.get("restaurant_id", "").strip()
            cust_id = row.get("customer_id", "").strip()

            if not oid or rest_id not in valid_restaurant_ids or cust_id not in valid_customer_ids:
                continue

            try:
                order_time_str = row["order_time"].strip()
                deadline_str = row["deadline"].strip()
                order_time_min = self._to_sim_minutes(order_time_str)
                deadline_min = self._to_sim_minutes(deadline_str)
                prep_time = max(1, int(row.get("preparation_time", 15)))

                if deadline_min <= order_time_min:
                    continue  # Inconsistent temporal order

                processed.append(
                    ProcessedOrder(
                        order_id=oid,
                        restaurant_id=rest_id,
                        customer_id=cust_id,
                        order_time=order_time_str,
                        order_time_min=order_time_min,
                        preparation_time=prep_time,
                        deadline=deadline_str,
                        deadline_min=deadline_min,
                        order_status=row.get("order_status", "PENDING").strip(),
                    )
                )
            except (ValueError, KeyError):
                continue

        # Sort chronologically by order_time_min
        processed.sort(key=lambda o: o.order_time_min)
        return processed

    def run(self) -> PreprocessingResult:
        restaurants = self.process_restaurants()
        customers = self.process_customers()
        riders = self.process_riders()

        valid_rest_ids = {r.restaurant_id for r in restaurants}
        valid_cust_ids = {c.customer_id for c in customers}

        orders = self.process_orders(valid_rest_ids, valid_cust_ids)

        return PreprocessingResult(
            restaurants=restaurants,
            customers=customers,
            orders=orders,
            riders=riders,
            stats={
                "restaurants": len(restaurants),
                "customers": len(customers),
                "orders": len(orders),
                "riders": len(riders),
            },
        )

    def save_processed(self, output_dir: Path) -> Dict[str, Path]:
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        result = self.run()
        saved_paths = {}

        for name, items in [
            ("restaurants", result.restaurants),
            ("customers", result.customers),
            ("orders", result.orders),
            ("riders", result.riders),
        ]:
            if not items:
                continue
            file_path = output_dir / f"{name}.csv"
            dict_rows = [asdict(item) for item in items]
            fieldnames = list(dict_rows[0].keys())

            with open(file_path, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(dict_rows)

            saved_paths[name] = file_path

        return saved_paths


def main():
    import argparse
    from backend.routing.graph import generate_synthetic_road_network

    parser = argparse.ArgumentParser(description="Preprocess food delivery data and generate road graph.")
    parser.add_argument("--raw-dir", type=str, default="backend/data/raw", help="Path to raw datasets directory")
    parser.add_argument("--processed-dir", type=str, default="backend/data/processed", help="Path to output processed directory")
    args = parser.parse_args()

    print(f"Starting data preprocessing from: {args.raw_dir}")
    pipeline = PreprocessingPipeline(Path(args.raw_dir))
    saved_files = pipeline.save_processed(Path(args.processed_dir))

    for entity, path in saved_files.items():
        print(f"  - Processed {entity}: {path}")

    print("Generating synthetic city road network graph...")
    graph = generate_synthetic_road_network()
    graph_path = Path(args.processed_dir) / "road_graph.json"
    graph.save_to_json(graph_path)
    print(f"  - Road graph saved: {graph_path} ({len(graph.nodes)} nodes, {len(graph.edges)} edges)")
    print("Preprocessing completed successfully!")


if __name__ == "__main__":
    main()
