"""Data validator for food delivery dataset."""
import argparse
import csv
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Set


@dataclass
class ValidationReport:
    is_valid: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    entity_counts: Dict[str, int] = field(default_factory=dict)

    def add_error(self, message: str) -> None:
        self.errors.append(message)
        self.is_valid = False

    def add_warning(self, message: str) -> None:
        self.warnings.append(message)


class DataValidator:
    """Validates data integrity, references, and domain constraints for Phase 1 datasets."""

    REQUIRED_FILES = ["restaurants.csv", "customers.csv", "orders.csv", "riders.csv"]

    REQUIRED_FIELDS = {
        "restaurants": ["restaurant_id", "latitude", "longitude", "name", "average_preparation_time"],
        "customers": ["customer_id", "latitude", "longitude", "name"],
        "orders": ["order_id", "restaurant_id", "customer_id", "order_time", "preparation_time", "deadline", "order_status"],
        "riders": ["rider_id", "latitude", "longitude", "capacity", "status"],
    }

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)

    def _read_csv(self, filename: str) -> List[Dict[str, str]]:
        file_path = self.data_dir / filename
        if not file_path.exists():
            raise FileNotFoundError(f"Missing required dataset file: {file_path}")
        with open(file_path, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return list(reader)

    def validate(self) -> ValidationReport:
        report = ValidationReport()

        # 1. Check all required files exist
        for req_file in self.REQUIRED_FILES:
            file_path = self.data_dir / req_file
            if not file_path.exists():
                report.add_error(f"Missing dataset file: {req_file}")
                return report

        # Load datasets
        try:
            restaurants = self._read_csv("restaurants.csv")
            customers = self._read_csv("customers.csv")
            orders = self._read_csv("orders.csv")
            riders = self._read_csv("riders.csv")
        except Exception as e:
            report.add_error(f"Error parsing CSV files: {e}")
            return report

        report.entity_counts = {
            "restaurants": len(restaurants),
            "customers": len(customers),
            "orders": len(orders),
            "riders": len(riders),
        }

        # Check for empty datasets
        for name, records in [
            ("restaurants", restaurants),
            ("customers", customers),
            ("orders", orders),
            ("riders", riders),
        ]:
            if not records:
                report.add_error(f"Dataset '{name}' is empty (0 records).")

        # 2. Check required headers
        for entity, required_cols in self.REQUIRED_FIELDS.items():
            records = locals().get(entity, [])
            if records:
                actual_cols = set(records[0].keys())
                missing = set(required_cols) - actual_cols
                if missing:
                    report.add_error(f"Dataset '{entity}' is missing required columns: {sorted(missing)}")

        # 3. Validate Restaurants
        restaurant_ids: Set[str] = set()
        for idx, row in enumerate(restaurants, 1):
            rid = row.get("restaurant_id", "").strip()
            if not rid:
                report.add_error(f"restaurants.csv line {idx}: Empty restaurant_id")
            elif rid in restaurant_ids:
                report.add_error(f"restaurants.csv: Duplicate restaurant_id '{rid}'")
            else:
                restaurant_ids.add(rid)

            self._validate_coordinate(row, "latitude", -90.0, 90.0, f"restaurants.csv ({rid})", report)
            self._validate_coordinate(row, "longitude", -180.0, 180.0, f"restaurants.csv ({rid})", report)

            try:
                avg_prep = int(row.get("average_preparation_time", 0))
                if avg_prep <= 0:
                    report.add_error(f"restaurants.csv ({rid}): average_preparation_time must be positive, got {avg_prep}")
            except (ValueError, TypeError):
                report.add_error(f"restaurants.csv ({rid}): Invalid average_preparation_time '{row.get('average_preparation_time')}'")

        # 4. Validate Customers
        customer_ids: Set[str] = set()
        for idx, row in enumerate(customers, 1):
            cid = row.get("customer_id", "").strip()
            if not cid:
                report.add_error(f"customers.csv line {idx}: Empty customer_id")
            elif cid in customer_ids:
                report.add_error(f"customers.csv: Duplicate customer_id '{cid}'")
            else:
                customer_ids.add(cid)

            self._validate_coordinate(row, "latitude", -90.0, 90.0, f"customers.csv ({cid})", report)
            self._validate_coordinate(row, "longitude", -180.0, 180.0, f"customers.csv ({cid})", report)

        # 5. Validate Riders
        rider_ids: Set[str] = set()
        for idx, row in enumerate(riders, 1):
            rider_id = row.get("rider_id", "").strip()
            if not rider_id:
                report.add_error(f"riders.csv line {idx}: Empty rider_id")
            elif rider_id in rider_ids:
                report.add_error(f"riders.csv: Duplicate rider_id '{rider_id}'")
            else:
                rider_ids.add(rider_id)

            self._validate_coordinate(row, "latitude", -90.0, 90.0, f"riders.csv ({rider_id})", report)
            self._validate_coordinate(row, "longitude", -180.0, 180.0, f"riders.csv ({rider_id})", report)

            try:
                capacity = int(row.get("capacity", 0))
                if capacity <= 0:
                    report.add_error(f"riders.csv ({rider_id}): capacity must be positive (>0), got {capacity}")
                elif capacity > 10:
                    report.add_warning(f"riders.csv ({rider_id}): unusually large capacity ({capacity})")
            except (ValueError, TypeError):
                report.add_error(f"riders.csv ({rider_id}): Invalid capacity '{row.get('capacity')}'")

        # 6. Validate Orders
        order_ids: Set[str] = set()
        for idx, row in enumerate(orders, 1):
            oid = row.get("order_id", "").strip()
            if not oid:
                report.add_error(f"orders.csv line {idx}: Empty order_id")
            elif oid in order_ids:
                report.add_error(f"orders.csv: Duplicate order_id '{oid}'")
            else:
                order_ids.add(oid)

            # Foreign key integrity
            rest_ref = row.get("restaurant_id", "").strip()
            if rest_ref not in restaurant_ids:
                report.add_error(f"orders.csv ({oid}): restaurant_id '{rest_ref}' not found in restaurants.csv")

            cust_ref = row.get("customer_id", "").strip()
            if cust_ref not in customer_ids:
                report.add_error(f"orders.csv ({oid}): customer_id '{cust_ref}' not found in customers.csv")

            # Preparation time must be positive
            prep_time = 0
            try:
                prep_time = int(row.get("preparation_time", 0))
                if prep_time <= 0:
                    report.add_error(f"orders.csv ({oid}): preparation_time must be positive, got {prep_time}")
            except (ValueError, TypeError):
                report.add_error(f"orders.csv ({oid}): Invalid preparation_time '{row.get('preparation_time')}'")

            # Temporal consistency
            try:
                order_time = datetime.strptime(row["order_time"], "%Y-%m-%d %H:%M:%S")
                deadline = datetime.strptime(row["deadline"], "%Y-%m-%d %H:%M:%S")

                if deadline <= order_time:
                    report.add_error(
                        f"orders.csv ({oid}): deadline ({deadline}) must occur after order_time ({order_time})"
                    )

                # Deadline should also allow for preparation time
                prep_delta_seconds = prep_time * 60
                if (deadline - order_time).total_seconds() < prep_delta_seconds:
                    report.add_error(
                        f"orders.csv ({oid}): deadline is earlier than order_time + preparation_time "
                        f"({prep_time} min)"
                    )
            except Exception as e:
                report.add_error(f"orders.csv ({oid}): Timestamp format error: {e}")

        return report

    def _validate_coordinate(
        self,
        row: Dict[str, str],
        field_name: str,
        min_val: float,
        max_val: float,
        context: str,
        report: ValidationReport,
    ) -> None:
        val_str = row.get(field_name, "")
        try:
            val = float(val_str)
            if not (min_val <= val <= max_val):
                report.add_error(f"{context}: {field_name} {val} out of valid range [{min_val}, {max_val}]")
        except (ValueError, TypeError):
            report.add_error(f"{context}: Invalid {field_name} number '{val_str}'")


def main():
    parser = argparse.ArgumentParser(description="Validate Phase 1 food delivery CSV datasets.")
    parser.add_argument(
        "--data-dir",
        type=str,
        default="backend/data/raw",
        help="Directory containing the CSV datasets to validate",
    )
    args = parser.parse_args()

    validator = DataValidator(Path(args.data_dir))
    report = validator.validate()

    print(f"\n--- Validation Report for: {args.data_dir} ---")
    print(f"Entity counts: {report.entity_counts}")
    print(f"Status: {'PASSED' if report.is_valid else 'FAILED'}")

    if report.warnings:
        print(f"\nWarnings ({len(report.warnings)}):")
        for w in report.warnings:
            print(f"  [WARN] {w}")

    if report.errors:
        print(f"\nErrors ({len(report.errors)}):")
        for e in report.errors:
            print(f"  [ERROR] {e}")
        exit(1)
    else:
        print("\nAll data integrity, reference, coordinate, and temporal validation checks passed successfully!")


if __name__ == "__main__":
    main()
