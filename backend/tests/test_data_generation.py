"""Unit and integration tests for Phase 1 synthetic data generation and validation."""
import csv
import shutil
import tempfile
from pathlib import Path

import pytest

from backend.config.data_config import DataGenerationConfig
from backend.data.generator import SyntheticDataGenerator
from backend.data.validator import DataValidator


@pytest.fixture
def temp_data_dir():
    temp_dir = Path(tempfile.mkdtemp(prefix="food_delivery_test_"))
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_generator_determinism():
    """Generating data with the same seed must produce identical outputs."""
    config = DataGenerationConfig(
        random_seed=123,
        num_restaurants=10,
        num_customers=25,
        num_orders=30,
        num_riders=5,
    )
    gen1 = SyntheticDataGenerator(config)
    data1 = gen1.generate_all()

    gen2 = SyntheticDataGenerator(config)
    data2 = gen2.generate_all()

    assert data1 == data2, "Generators with identical seed produced divergent outputs."


def test_generator_seed_variation():
    """Different seeds must produce different sets of data."""
    config1 = DataGenerationConfig(random_seed=101, num_restaurants=5, num_customers=10, num_orders=10, num_riders=3)
    config2 = DataGenerationConfig(random_seed=202, num_restaurants=5, num_customers=10, num_orders=10, num_riders=3)

    data1 = SyntheticDataGenerator(config1).generate_all()
    data2 = SyntheticDataGenerator(config2).generate_all()

    assert data1["restaurants"][0]["name"] != data2["restaurants"][0]["name"] or \
           data1["restaurants"][0]["latitude"] != data2["restaurants"][0]["latitude"]


def test_generated_data_validation(temp_data_dir):
    """The freshly generated dataset must pass all data validation rules without error."""
    config = DataGenerationConfig(
        random_seed=42,
        num_restaurants=20,
        num_customers=50,
        num_orders=70,
        num_riders=10,
    )
    generator = SyntheticDataGenerator(config)
    generator.save_datasets_to_csv(temp_data_dir)

    validator = DataValidator(temp_data_dir)
    report = validator.validate()

    assert report.is_valid, f"Validation failed with errors: {report.errors}"
    assert len(report.errors) == 0
    assert report.entity_counts["restaurants"] == 20
    assert report.entity_counts["customers"] == 50
    assert report.entity_counts["orders"] == 70
    assert report.entity_counts["riders"] == 10


def test_coordinate_boundaries(temp_data_dir):
    """All coordinates should be within expected geographic bounds."""
    config = DataGenerationConfig(random_seed=42)
    data = SyntheticDataGenerator(config).generate_all()

    for r in data["restaurants"]:
        assert config.lat_min <= r["latitude"] <= config.lat_max
        assert config.lon_min <= r["longitude"] <= config.lon_max

    for c in data["customers"]:
        assert config.lat_min <= c["latitude"] <= config.lat_max
        assert config.lon_min <= c["longitude"] <= config.lon_max

    for rider in data["riders"]:
        assert config.lat_min <= rider["latitude"] <= config.lat_max
        assert config.lon_min <= rider["longitude"] <= config.lon_max


def test_validator_catches_broken_foreign_key(temp_data_dir):
    """Validator must flag orders that reference non-existent restaurant or customer IDs."""
    config = DataGenerationConfig(random_seed=42, num_restaurants=5, num_customers=10, num_orders=10, num_riders=3)
    SyntheticDataGenerator(config).save_datasets_to_csv(temp_data_dir)

    # Corrupt orders.csv with invalid restaurant_id
    orders_path = temp_data_dir / "orders.csv"
    with open(orders_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    rows[0]["restaurant_id"] = "REST_NONEXISTENT_999"

    with open(orders_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    validator = DataValidator(temp_data_dir)
    report = validator.validate()

    assert not report.is_valid
    assert any("REST_NONEXISTENT_999" in err for err in report.errors)


def test_validator_catches_inverted_deadline(temp_data_dir):
    """Validator must flag orders whose deadline is earlier than order_time."""
    config = DataGenerationConfig(random_seed=42, num_restaurants=5, num_customers=10, num_orders=10, num_riders=3)
    SyntheticDataGenerator(config).save_datasets_to_csv(temp_data_dir)

    # Corrupt an order deadline
    orders_path = temp_data_dir / "orders.csv"
    with open(orders_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    rows[0]["deadline"] = "2026-10-01 11:00:00"  # Before order_time
    rows[0]["order_time"] = "2026-10-01 12:00:00"

    with open(orders_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    validator = DataValidator(temp_data_dir)
    report = validator.validate()

    assert not report.is_valid
    assert any("deadline" in err and "must occur after order_time" in err for err in report.errors)


def test_validator_catches_invalid_preparation_time(temp_data_dir):
    """Validator must flag orders or restaurants with negative or zero prep time."""
    config = DataGenerationConfig(random_seed=42, num_restaurants=5, num_customers=10, num_orders=10, num_riders=3)
    SyntheticDataGenerator(config).save_datasets_to_csv(temp_data_dir)

    # Corrupt preparation time in orders.csv
    orders_path = temp_data_dir / "orders.csv"
    with open(orders_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    rows[0]["preparation_time"] = "-5"

    with open(orders_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    validator = DataValidator(temp_data_dir)
    report = validator.validate()

    assert not report.is_valid
    assert any("preparation_time must be positive" in err for err in report.errors)


def test_validator_catches_duplicate_ids(temp_data_dir):
    """Validator must flag duplicate entity IDs."""
    config = DataGenerationConfig(random_seed=42, num_restaurants=5, num_customers=10, num_orders=10, num_riders=3)
    SyntheticDataGenerator(config).save_datasets_to_csv(temp_data_dir)

    # Duplicate first restaurant ID
    rest_path = temp_data_dir / "restaurants.csv"
    with open(rest_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    rows[1]["restaurant_id"] = rows[0]["restaurant_id"]

    with open(rest_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    validator = DataValidator(temp_data_dir)
    report = validator.validate()

    assert not report.is_valid
    assert any("Duplicate restaurant_id" in err for err in report.errors)
