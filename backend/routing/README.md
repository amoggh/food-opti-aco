# Routing Module

This module manages road network graph representations, dynamic traffic modeling, Dijkstra/A* pathfinding, and pairwise distance/travel-time matrix calculations.

## Architecture and Components

### 1. `graph.py`
- **`RoadNode`**: Spatial intersection node with `node_id`, `lat`, and `lon`.
- **`RoadEdge`**: Directed street segment with `edge_id`, `u`, `v`, `distance_km`, `base_speed_kmh`, `road_type`, and `traffic_level`.
- **`RoadGraph`**: Directed adjacency-list graph supporting:
  - Spatial snapping (`find_nearest_node(lat, lon)`).
  - Strongly connected synthetic urban network generator (`generate_synthetic_road_network()`).
  - JSON serialization (`save_to_json()` / `load_from_json()`).
  - Extensible design allowing future OpenStreetMap (OSM) networks to be plugged in seamlessly.

### 2. `traffic.py`
- **`TrafficLevel`**: Congestion categories (`LOW`: 1.0x, `MEDIUM`: 0.70x, `HIGH`: 0.40x, `SEVERE`: 0.20x speed).
- **`TrafficModel`**: Pluggable engine calculating dynamic effective speed ($v_{\text{eff}} = v_{\text{base}} \times \text{multiplier}$) and travel times ($t = \frac{d}{v_{\text{eff}}} \times 60$).

### 3. `router.py`
- **`RoutingEngine`**: Graph routing layer decoupled from graph storage and future ACO solvers.
  - **`find_route_between_nodes`**: Dijkstra shortest-path and fastest-time algorithms.
  - **`find_route_between_coordinates`**: Snaps arbitrary coordinates to the road network and includes door-to-door access buffers.
  - **`compute_distance_matrix`**: Computes pairwise distance matrix ($N \times N$) across coordinates.
  - **`compute_travel_time_matrix`**: Computes pairwise travel-time matrix ($N \times N$) under dynamic traffic.

## Programmatic Usage for ACO (Phase 3)

```python
from pathlib import Path
from backend.routing.graph import RoadGraph
from backend.routing.traffic import TrafficModel
from backend.routing.router import RoutingEngine

# Load road graph
graph = RoadGraph.load_from_json(Path("backend/data/processed/road_graph.json"))
traffic_model = TrafficModel()
router = RoutingEngine(graph, traffic_model)

# Compute door-to-door delivery route
route = router.find_route_between_coordinates(
    start_lat=12.9805, start_lon=77.6008,  # Restaurant
    end_lat=12.9457, end_lon=77.6521,      # Customer
    criterion="time"
)
print(f"Distance: {route.total_distance_km} km, Travel time: {route.total_time_minutes} mins")

# Compute distance and time matrices for ACO heuristic visibility (eta_ij)
locations = [(12.98, 77.60), (12.94, 77.65), (12.93, 77.61)]
dist_matrix = router.compute_distance_matrix(locations)
time_matrix = router.compute_travel_time_matrix(locations, departure_time_min=15.0)
```
