"""Unit tests for the data preprocessing pipeline."""
import shutil
import tempfile
from pathlib import Path

import pytest

from backend.config.data_config import DataGenerationConfig
from backend.data.generator import SyntheticDataGenerator
from backend.preprocessing.pipeline import PreprocessingPipeline


@pytest.fixture
def sample_raw_data_dir():
    temp_dir = Path(tempfile.mkdtemp(prefix="food_delivery_raw_test_"))
    config = DataGenerationConfig(
        random_seed=42,
        num_restaurants=10,
        num_customers=20,
        num_orders=25,
        num_riders=5,
    )
    SyntheticDataGenerator(config).save_datasets_to_csv(temp_dir)
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_preprocessing_pipeline_run(sample_raw_data_dir):
    pipeline = PreprocessingPipeline(sample_raw_data_dir)
    result = pipeline.run()

    assert len(result.restaurants) == 10
    assert len(result.customers) == 20
    assert len(result.orders) == 25
    assert len(result.riders) == 5

    # Verify simulation minute conversions
    for order in result.orders:
        assert order.order_time_min >= 0.0
        assert order.deadline_min > order.order_time_min
        assert order.deadline_min >= order.order_time_min + order.preparation_time

    # Verify order sorting chronologically
    for i in range(len(result.orders) - 1):
        assert result.orders[i].order_time_min <= result.orders[i + 1].order_time_min


def test_preprocessing_save_processed(sample_raw_data_dir):
    output_dir = Path(tempfile.mkdtemp(prefix="food_delivery_proc_test_"))
    try:
        pipeline = PreprocessingPipeline(sample_raw_data_dir)
        saved = pipeline.save_processed(output_dir)

        assert "restaurants" in saved and saved["restaurants"].exists()
        assert "customers" in saved and saved["customers"].exists()
        assert "orders" in saved and saved["orders"].exists()
        assert "riders" in saved and saved["riders"].exists()
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)
