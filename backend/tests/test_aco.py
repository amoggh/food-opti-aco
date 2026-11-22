"""Unit and integration tests for Ant Colony Optimization engine and components."""
import random
from typing import Dict, List

import pytest

from backend.config.aco_config import ACOConfig
from backend.aco.ant import Ant
from backend.aco.colony import ACOEngine
from backend.aco.cost import CostEvaluator
from backend.aco.models import ACOTaskNode, DeliveryPlan, RiderTour
from backend.aco.pheromone import PheromoneMatrix
from backend.preprocessing.pipeline import (
    ProcessedCustomer,
    ProcessedOrder,
    ProcessedRestaurant,
    ProcessedRider,
)


@pytest.fixture
def mock_aco_config():
    return ACOConfig(
        num_ants=8,
        num_iterations=12,
        random_seed=42,
        alpha=1.0,
        beta=2.0,
        evaporation_rate=0.2,
        q_deposit=50.0,
        tau_min=0.1,
        tau_max=5.0,
        distance_weight=1.0,
        time_weight=1.5,
        late_weight=10.0,
        freshness_weight=0.5,
    )


@pytest.fixture
def sample_delivery_problem():
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
    return restaurants, customers, orders, riders


def test_pheromone_matrix_bounds_and_evaporation(mock_aco_config):
    nodes = ["N1", "N2", "N3"]
    p_mat = PheromoneMatrix(nodes, mock_aco_config)

    # Initial value is tau_max
    assert p_mat.get_pheromone("N1", "N2") == mock_aco_config.tau_max

    # Evaporate
    p_mat.evaporate()
    expected = mock_aco_config.tau_max * (1.0 - mock_aco_config.evaporation_rate)
    assert round(p_mat.get_pheromone("N1", "N2"), 4) == round(expected, 4)

    # Repeat evaporation to verify tau_min floor bound
    for _ in range(50):
        p_mat.evaporate()
    assert p_mat.get_pheromone("N1", "N2") == mock_aco_config.tau_min


def test_cost_evaluator_formula(mock_aco_config):
    evaluator = CostEvaluator(mock_aco_config)

    p_node = ACOTaskNode("P_ORD_001", "pickup", "ORD_001", ready_time_min=20.0)
    d_node = ACOTaskNode("D_ORD_001", "dropoff", "ORD_001", deadline_min=45.0)

    tour = RiderTour(
        rider_id="R1",
        capacity=3,
        stops=[p_node, d_node],
        arrival_times=[20.0, 50.0],  # 5 min late past deadline 45.0
        departure_times=[23.0, 53.0],
        loads=[1, 0],
        total_distance_km=10.0,
        total_time_min=30.0,
        orders_delivered=["ORD_001"],
    )

    plan = evaluator.evaluate(
        tours={"R1": tour},
        all_order_ids=["ORD_001"],
        pickup_nodes={"ORD_001": p_node},
        dropoff_nodes={"ORD_001": d_node},
    )

    # Expected:
    # distance: 1.0 * 10 = 10.0
    # time: 1.5 * 30 = 45.0
    # late penalty: 50 - 45 = 5.0 mins -> late_weight 10.0 * 5 = 50.0
    # freshness penalty: 50 - 20 = 30.0 mins -> freshness_weight 0.5 * 30 = 15.0
    # unserved: 0
    # total: 10 + 45 + 50 + 15 = 120.0
    assert plan.total_distance_km == 10.0
    assert plan.late_orders_count == 1
    assert plan.late_delivery_penalty == 5.0
    assert plan.freshness_penalty == 30.0
    assert plan.fitness_cost == 120.0


def test_ant_constraint_enforcement(mock_aco_config, sample_delivery_problem):
    restaurants, customers, orders, riders = sample_delivery_problem
    aco = ACOEngine(config=mock_aco_config)
    aco.setup_problem(restaurants, customers, orders, riders)

    ant = Ant(
        ant_id=1,
        config=mock_aco_config,
        task_nodes=aco.task_nodes,
        pickup_nodes=aco.pickup_nodes,
        dropoff_nodes=aco.dropoff_nodes,
        rider_start_nodes=aco.rider_start_nodes,
        rider_capacities=aco.rider_capacities,
        distance_matrix=aco.distance_matrix,
        time_matrix=aco.time_matrix,
        pheromone_matrix=aco.pheromones,
        cost_evaluator=aco.evaluator,
        rng=random.Random(42),
    )

    plan = ant.construct_solution(aco.order_ids)

    assert plan.unserved_orders_count == 0

    # Verify constraints across each rider's tour
    for rid, tour in plan.tours.items():
        assert len(tour.stops) == len(tour.arrival_times) == len(tour.loads)

        # 1. Capacity constraint: load never exceeds bag capacity
        for load in tour.loads:
            assert 0 <= load <= tour.capacity

        # 2. Precedence constraint: pickup must precede dropoff
        seen_pickups = set()
        for stop in tour.stops:
            if stop.task_type == "pickup":
                seen_pickups.add(stop.order_id)
            elif stop.task_type == "dropoff":
                assert stop.order_id in seen_pickups, f"Dropoff of {stop.order_id} occurred before pickup!"

        # 3. Time progression: arrival times are non-decreasing
        for k in range(len(tour.arrival_times) - 1):
            assert tour.arrival_times[k] <= tour.arrival_times[k + 1]


def test_aco_engine_optimization_convergence(mock_aco_config, sample_delivery_problem):
    restaurants, customers, orders, riders = sample_delivery_problem
    aco = ACOEngine(config=mock_aco_config)
    aco.setup_problem(restaurants, customers, orders, riders)

    result = aco.optimize(verbose=False)

    assert result.best_plan is not None
    assert result.best_plan.unserved_orders_count == 0
    assert len(result.convergence_history) == mock_aco_config.num_iterations

    # Convergence verification: best cost must be monotonically non-increasing
    best_costs = [entry["best_cost"] for entry in result.convergence_history]
    for i in range(len(best_costs) - 1):
        assert best_costs[i] >= best_costs[i + 1]


def test_aco_seed_determinism(mock_aco_config, sample_delivery_problem):
    restaurants, customers, orders, riders = sample_delivery_problem

    aco1 = ACOEngine(config=mock_aco_config)
    aco1.setup_problem(restaurants, customers, orders, riders)
    res1 = aco1.optimize()

    aco2 = ACOEngine(config=mock_aco_config)
    aco2.setup_problem(restaurants, customers, orders, riders)
    res2 = aco2.optimize()

    assert res1.best_plan.fitness_cost == res2.best_plan.fitness_cost
    assert res1.best_plan.total_distance_km == res2.best_plan.total_distance_km
