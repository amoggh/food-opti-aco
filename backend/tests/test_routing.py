"""Unit and integration tests for road graph, traffic model, and routing engine."""
import shutil
import tempfile
from pathlib import Path

import numpy as np
import pytest

from backend.config.data_config import DataGenerationConfig
from backend.routing.graph import (
    RoadEdge,
    RoadGraph,
    RoadNode,
    generate_synthetic_road_network,
    haversine_distance_km,
)
from backend.routing.router import RouteResult, RoutingEngine
from backend.routing.traffic import TrafficLevel, TrafficModel


def test_haversine_distance():
    # Distance between Bangalore center (12.9716, 77.5946) and a point ~1.1 km away
    d = haversine_distance_km(12.9716, 77.5946, 12.9816, 77.5946)
    assert 1.0 <= d <= 1.2


def test_road_graph_construction_and_serialization():
    temp_dir = Path(tempfile.mkdtemp(prefix="food_delivery_graph_test_"))
    try:
        graph = RoadGraph()
        n1 = RoadNode("N1", 12.9700, 77.5900)
        n2 = RoadNode("N2", 12.9800, 77.5900)
        graph.add_node(n1)
        graph.add_node(n2)

        edge = RoadEdge("E1", "N1", "N2", distance_km=1.1, base_speed_kmh=40.0)
        graph.add_edge(edge, bidirectional=True)

        assert len(graph.nodes) == 2
        assert len(graph.edges) == 2  # Bidirectional adds rev edge
        assert graph.get_edge("N1", "N2") is not None
        assert graph.get_edge("N2", "N1") is not None

        # Nearest node snapping
        assert graph.find_nearest_node(12.9705, 77.5905) == "N1"
        assert graph.find_nearest_node(12.9795, 77.5905) == "N2"

        # Save and reload
        json_path = temp_dir / "graph.json"
        graph.save_to_json(json_path)
        loaded_graph = RoadGraph.load_from_json(json_path)

        assert len(loaded_graph.nodes) == 2
        assert len(loaded_graph.edges) == 2
        assert loaded_graph.get_edge("N1", "N2").distance_km == 1.1
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_synthetic_road_network_generation():
    config = DataGenerationConfig(random_seed=42)
    graph = generate_synthetic_road_network(config, grid_rows=6, grid_cols=6)

    # 36 nodes
    assert len(graph.nodes) == 36
    assert len(graph.edges) > 50

    # Ensure every node has outgoing neighbors
    for nid in graph.nodes:
        assert len(graph.get_neighbors(nid)) > 0


def test_routing_engine_shortest_path():
    config = DataGenerationConfig(random_seed=42)
    graph = generate_synthetic_road_network(config, grid_rows=5, grid_cols=5)
    engine = RoutingEngine(graph)

    # Route from bottom-left corner to top-right corner
    route = engine.find_route_between_nodes("NODE_0001", "NODE_0025", criterion="distance")

    assert route.start_node == "NODE_0001"
    assert route.end_node == "NODE_0025"
    assert len(route.path_nodes) >= 2
    assert route.total_distance_km > 0.0
    assert route.total_time_minutes > 0.0


def test_traffic_model_impact_on_travel_time():
    graph = RoadGraph()
    n1 = RoadNode("N1", 12.9700, 77.5900)
    n2 = RoadNode("N2", 12.9800, 77.5900)
    graph.add_node(n1)
    graph.add_node(n2)

    edge = RoadEdge("E1", "N1", "N2", distance_km=10.0, base_speed_kmh=60.0)
    graph.add_edge(edge, bidirectional=False)

    traffic_model = TrafficModel()
    engine = RoutingEngine(graph, traffic_model)

    # Normal free-flow: 10 km at 60 km/h = 10 minutes
    route_low = engine.find_route_between_nodes("N1", "N2", criterion="time")
    assert round(route_low.total_time_minutes, 1) == 10.0

    # Apply heavy traffic (0.4x speed = 24 km/h -> 25 minutes)
    traffic_model.set_edge_traffic("E1", TrafficLevel.HIGH)
    route_high = engine.find_route_between_nodes("N1", "N2", criterion="time")

    assert route_high.total_distance_km == route_low.total_distance_km  # Distance unchanged
    assert route_high.total_time_minutes > route_low.total_time_minutes  # Time increased
    assert round(route_high.total_time_minutes, 1) == 25.0


def test_coordinate_routing_with_access_buffers():
    config = DataGenerationConfig(random_seed=42)
    graph = generate_synthetic_road_network(config, grid_rows=6, grid_cols=6)
    engine = RoutingEngine(graph)

    # Random coordinate points within city bounds
    start_lat, start_lon = 12.9200, 77.5400
    end_lat, end_lon = 13.0100, 77.6500

    route = engine.find_route_between_coordinates(start_lat, start_lon, end_lat, end_lon)

    assert len(route.path_coordinates) >= 3
    assert route.total_distance_km > 0.0
    assert route.total_time_minutes > 0.0


def test_distance_and_time_matrix_computation():
    config = DataGenerationConfig(random_seed=42)
    graph = generate_synthetic_road_network(config, grid_rows=5, grid_cols=5)
    engine = RoutingEngine(graph)

    coords = [
        (12.9200, 77.5400),
        (12.9500, 77.5800),
        (12.9900, 77.6200),
        (13.0100, 77.6500),
    ]

    dist_matrix = engine.compute_distance_matrix(coords)
    time_matrix = engine.compute_travel_time_matrix(coords)

    assert dist_matrix.shape == (4, 4)
    assert time_matrix.shape == (4, 4)

    # Diagonal is zero
    assert np.allclose(np.diag(dist_matrix), 0.0)
    assert np.allclose(np.diag(time_matrix), 0.0)

    # Non-diagonal elements are positive
    assert np.all(dist_matrix[~np.eye(4, dtype=bool)] > 0.0)
    assert np.all(time_matrix[~np.eye(4, dtype=bool)] > 0.0)
