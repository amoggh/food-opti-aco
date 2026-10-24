"""Unit tests for the evaluation metrics and benchmark runner."""
from backend.config.aco_config import ACOConfig
from backend.aco.colony import ACOEngine
from backend.evaluation.benchmark import BenchmarkRunner
from backend.evaluation.metrics import EvaluationMetrics
from backend.preprocessing.pipeline import (
    ProcessedCustomer,
    ProcessedOrder,
    ProcessedRestaurant,
    ProcessedRider,
)


def test_evaluation_metrics_calculation():
    restaurants = [ProcessedRestaurant("REST_001", 12.9750, 77.6000, "Spice Villa", 15)]
    customers = [ProcessedCustomer("CUST_0001", 12.9800, 77.6050, "Aarav Sharma")]
    orders = [ProcessedOrder("ORD_0001", "REST_001", "CUST_0001", "2026-10-01 12:05:00", 5.0, 15, "2026-10-01 12:50:00", 50.0, "PENDING")]
    riders = [ProcessedRider("RIDER_001", 12.9700, 77.6000, 3, "AVAILABLE")]

    aco = ACOEngine(config=ACOConfig())
    aco.setup_problem(restaurants, customers, orders, riders)
    res = aco.optimize()

    metrics = EvaluationMetrics.from_delivery_plan(
        plan=res.best_plan,
        algorithm="ACO Test",
        problem_size=1,
        seed=42,
        runtime_seconds=0.05,
    )

    assert metrics.algorithm == "ACO Test"
    assert metrics.problem_size == 1
    assert metrics.total_distance_km >= 0.0
    assert metrics.runtime_seconds == 0.05
    assert 0.0 <= metrics.late_deliveries_percentage <= 100.0


def test_benchmark_runner_single_experiment():
    runner = BenchmarkRunner()
    # Run a fast mini-instance with 5 orders, 2 riders
    metrics_list = runner.run_single_experiment(
        problem_size=5,
        seed=42,
        num_riders=2,
        aco_iterations=5,
        aco_ants=5,
    )

    assert len(metrics_list) == 3
    algos = {m.algorithm for m in metrics_list}
    assert algos == {"Nearest Neighbor", "Greedy Priority", "Ant Colony Optimization"}

    for m in metrics_list:
        assert m.total_distance_km > 0.0
        assert m.runtime_seconds >= 0.0
