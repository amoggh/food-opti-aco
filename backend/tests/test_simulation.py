"""Unit tests for the dynamic simulation engine and event handling."""
import pytest

from backend.routing.traffic import TrafficLevel
from backend.simulation.engine import OrderStatus, RiderStatus, SimulationEngine
from backend.simulation.events import EventType, SimEvent


@pytest.fixture
def sim():
    engine = SimulationEngine()
    engine.reset()
    return engine


def test_simulation_initialization(sim):
    assert sim.sim_time_min == 0.0
    assert not sim.is_running
    assert len(sim.restaurants) > 0
    assert len(sim.customers) > 0
    assert len(sim.orders) > 0
    assert len(sim.riders) > 0


def test_simulation_step_advances_time_and_order_states(sim):
    initial_time = sim.sim_time_min
    snapshot = sim.step(delta_time_min=5.0)

    assert sim.sim_time_min == initial_time + 5.0
    assert snapshot["sim_time_min"] == sim.sim_time_min

    # Orders placed within first 5 mins should now be PREPARING or READY
    has_prep_or_ready = any(
        o.status in (OrderStatus.PREPARING, OrderStatus.READY)
        for o in sim.orders.values()
    )
    assert has_prep_or_ready


def test_simulation_new_order_event(sim):
    initial_count = len(sim.orders)
    first_rest = list(sim.restaurants.keys())[0]
    first_cust = list(sim.customers.keys())[0]

    event = SimEvent(
        event_id="EVT_TEST_1",
        event_type=EventType.NEW_ORDER,
        timestamp_min=sim.sim_time_min,
        payload={
            "order_id": "ORD_TEST_9999",
            "restaurant_id": first_rest,
            "customer_id": first_cust,
            "preparation_time": 10,
            "delivery_lead_time_min": 30,
        },
        requires_reoptimization=False,
    )
    result = sim.trigger_event(event)

    assert len(sim.orders) == initial_count + 1
    assert "ORD_TEST_9999" in sim.orders
    assert sim.orders["ORD_TEST_9999"].status == OrderStatus.PENDING


def test_simulation_traffic_and_road_closure_events(sim):
    edge_id = "EDGE_00001"

    # Traffic change
    sim.trigger_event(
        SimEvent(
            event_id="EVT_TRAF",
            event_type=EventType.TRAFFIC_CHANGE,
            timestamp_min=sim.sim_time_min,
            payload={"edge_id": edge_id, "traffic_level": "SEVERE"},
            requires_reoptimization=False,
        )
    )
    assert sim.traffic_model.get_edge_traffic(edge_id) == TrafficLevel.SEVERE

    # Road closure
    sim.trigger_event(
        SimEvent(
            event_id="EVT_CLOSE",
            event_type=EventType.ROAD_CLOSURE,
            timestamp_min=sim.sim_time_min,
            payload={"edge_id": edge_id},
            requires_reoptimization=False,
        )
    )
    assert edge_id in sim.closed_edges


def test_simulation_rider_unavailable_event(sim):
    rider_id = list(sim.riders.keys())[0]

    sim.trigger_event(
        SimEvent(
            event_id="EVT_UNAVAIL",
            event_type=EventType.RIDER_UNAVAILABLE,
            timestamp_min=sim.sim_time_min,
            payload={"rider_id": rider_id},
            requires_reoptimization=False,
        )
    )

    assert sim.riders[rider_id].status == RiderStatus.UNAVAILABLE
    assert len(sim.riders[rider_id].assigned_stops) == 0


def test_simulation_reoptimization(sim):
    # Run re-optimization on subset of orders
    plan = sim.reoptimize(aco_ants=6, aco_iterations=5)

    assert plan is not None
    assert sim.active_plan is not None
    assert plan.total_distance_km > 0.0

    # Verify at least one rider received assigned stops
    any_stops_assigned = any(len(r.assigned_stops) > 0 for r in sim.riders.values())
    assert any_stops_assigned
