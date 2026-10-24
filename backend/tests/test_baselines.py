"""Unit tests for baseline algorithms (Nearest Neighbor and Greedy Priority)."""
import pytest

from backend.config.aco_config import ACOConfig
from backend.aco.colony import ACOEngine
from backend.baselines.greedy import GreedyPrioritySolver
from backend.baselines.nearest_neighbor import NearestNeighborSolver
from backend.preprocessing.pipeline import (
    ProcessedCustomer,
    ProcessedOrder,
    ProcessedRestaurant,
    ProcessedRider,
)


@pytest.fixture
def mock_problem():
    restaurants = [
        ProcessedRestaurant("REST_001", 12.9750, 77.6000, "Spice Villa", 15),
        ProcessedRestaurant("REST_002", 12.9350, 77.6180, "Tech Grill", 12),
    ]
    customers = [
        ProcessedCustomer("CUST_0001", 12.9800, 77.6050, "Aarav Sharma"),
        ProcessedCustomer("CUST_0002", 12.9400, 77.6200, "Priya Nair"),
        ProcessedCustomer("CUST_0003", 12.9650, 77.5900, "Rahul Kumar"),
        ProcessedCustomer("CUST_0004", 12.9500, 77.6100, "Neha Gupta"),
    ]
    orders = [
        ProcessedOrder("ORD_0001", "REST_001", "CUST_0001", "2026-10-01 12:05:00", 5.0, 15, "2026-10-01 12:50:00", 50.0, "PENDING"),
        ProcessedOrder("ORD_0002", "REST_002", "CUST_0002", "2026-10-01 12:10:00", 10.0, 12, "2026-10-01 12:55:00", 55.0, "PENDING"),
        ProcessedOrder("ORD_0003", "REST_001", "CUST_0003", "2026-10-01 12:12:00", 12.0, 15, "2026-10-01 13:00:00", 60.0, "PENDING"),
        ProcessedOrder("ORD_0004", "REST_002", "CUST_0004", "2026-10-01 12:15:00", 15.0, 12, "2026-10-01 13:05:00", 65.0, "PENDING"),
    ]
    riders = [
        ProcessedRider("RIDER_001", 12.9700, 77.6000, 3, "AVAILABLE"),
        ProcessedRider("RIDER_002", 12.9300, 77.6150, 3, "AVAILABLE"),
    ]

    aco = ACOEngine(config=ACOConfig())
    aco.setup_problem(restaurants, customers, orders, riders)
    return aco


def test_nearest_neighbor_constraint_enforcement(mock_problem):
    aco = mock_problem
    nn_solver = NearestNeighborSolver(
        task_nodes=aco.task_nodes,
        pickup_nodes=aco.pickup_nodes,
        dropoff_nodes=aco.dropoff_nodes,
        rider_start_nodes=aco.rider_start_nodes,
        rider_capacities=aco.rider_capacities,
        distance_matrix=aco.distance_matrix,
        time_matrix=aco.time_matrix,
        cost_evaluator=aco.evaluator,
    )

    plan = nn_solver.solve(aco.order_ids)

    assert plan.unserved_orders_count == 0
    assert plan.total_distance_km > 0.0

    for rid, tour in plan.tours.items():
        # Verify capacity
        for load in tour.loads:
            assert 0 <= load <= tour.capacity

        # Verify precedence
        seen_pickups = set()
        for stop in tour.stops:
            if stop.task_type == "pickup":
                seen_pickups.add(stop.order_id)
            elif stop.task_type == "dropoff":
                assert stop.order_id in seen_pickups


def test_greedy_priority_constraint_enforcement(mock_problem):
    aco = mock_problem
    greedy_solver = GreedyPrioritySolver(
        task_nodes=aco.task_nodes,
        pickup_nodes=aco.pickup_nodes,
        dropoff_nodes=aco.dropoff_nodes,
        rider_start_nodes=aco.rider_start_nodes,
        rider_capacities=aco.rider_capacities,
        distance_matrix=aco.distance_matrix,
        time_matrix=aco.time_matrix,
        cost_evaluator=aco.evaluator,
    )

    plan = greedy_solver.solve(aco.order_ids)

    assert plan.unserved_orders_count == 0
    assert plan.total_distance_km > 0.0

    for rid, tour in plan.tours.items():
        for load in tour.loads:
            assert 0 <= load <= tour.capacity

        seen_pickups = set()
        for stop in tour.stops:
            if stop.task_type == "pickup":
                seen_pickups.add(stop.order_id)
            elif stop.task_type == "dropoff":
                assert stop.order_id in seen_pickups
