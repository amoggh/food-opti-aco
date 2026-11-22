"""Unit and integration tests for FastAPI backend endpoints."""
import pytest
from fastapi.testclient import TestClient

from backend.api.app import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_endpoint(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["phase"] == 5


def test_data_endpoints(client):
    # Restaurants
    res_rest = client.get("/api/restaurants")
    assert res_rest.status_code == 200
    assert len(res_rest.json()) > 0

    # Customers
    res_cust = client.get("/api/customers")
    assert res_cust.status_code == 200
    assert len(res_cust.json()) > 0

    # Orders
    res_ord = client.get("/api/orders")
    assert res_ord.status_code == 200
    assert len(res_ord.json()) > 0

    # Riders
    res_rid = client.get("/api/riders")
    assert res_rid.status_code == 200
    assert len(res_rid.json()) > 0

    # Road Graph
    res_graph = client.get("/api/graph")
    assert res_graph.status_code == 200
    graph_data = res_graph.json()
    assert "nodes" in graph_data
    assert "edges" in graph_data


def test_simulation_control_endpoints(client):
    # Step simulation
    step_res = client.post("/api/simulation/step", json={"delta_time_min": 2.0})
    assert step_res.status_code == 200
    assert step_res.json()["sim_time_min"] >= 2.0

    # Start simulation
    start_res = client.post("/api/simulation/start")
    assert start_res.status_code == 200
    assert start_res.json()["snapshot"]["is_running"] is True

    # Pause simulation
    pause_res = client.post("/api/simulation/pause")
    assert pause_res.status_code == 200
    assert pause_res.json()["snapshot"]["is_running"] is False

    # Get state
    state_res = client.get("/api/simulation/state")
    assert state_res.status_code == 200
    assert "counts" in state_res.json()

    # Reset
    reset_res = client.post("/api/simulation/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["snapshot"]["sim_time_min"] == 0.0


def test_simulation_dynamic_events_endpoints(client):
    # Fetch a valid restaurant and customer ID
    rest_id = client.get("/api/restaurants").json()[0]["restaurant_id"]
    cust_id = client.get("/api/customers").json()[0]["customer_id"]

    # Trigger New Order
    order_res = client.post(
        "/api/simulation/events/new-order",
        json={
            "restaurant_id": rest_id,
            "customer_id": cust_id,
            "preparation_time": 12,
            "delivery_lead_time_min": 30,
        },
    )
    assert order_res.status_code == 200
    assert "event" in order_res.json()

    # Trigger Traffic Change
    traffic_res = client.post(
        "/api/simulation/events/traffic",
        json={"edge_id": "EDGE_00001", "traffic_level": "HIGH"},
    )
    assert traffic_res.status_code == 200

    # Trigger Road Closure
    closure_res = client.post(
        "/api/simulation/events/road-closure",
        json={"edge_id": "EDGE_00002"},
    )
    assert closure_res.status_code == 200
    assert "EDGE_00002" in closure_res.json()["snapshot"]["closed_edges"]

    # Trigger Rider Breakdown
    rider_id = client.get("/api/riders").json()[0]["rider_id"]
    rider_res = client.post(
        "/api/simulation/events/rider-unavailable",
        json={"rider_id": rider_id},
    )
    assert rider_res.status_code == 200


def test_optimization_endpoints(client):
    opt_res = client.post(
        "/api/optimization/run",
        json={"num_ants": 5, "num_iterations": 3},
    )
    assert opt_res.status_code == 200
    assert "plan" in opt_res.json()

    metrics_res = client.get("/api/optimization/metrics")
    assert metrics_res.status_code == 200
    assert "counts" in metrics_res.json()
