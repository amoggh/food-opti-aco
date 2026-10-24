"""Road network graph representation, spatial snapping, and synthetic generator."""
import json
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.config.data_config import DataGenerationConfig
from backend.routing.traffic import TrafficLevel


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes the great-circle distance between two geographic coordinates in kilometers."""
    R = 6371.0088  # Earth mean radius in kilometers
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 4)


@dataclass
class RoadNode:
    node_id: str
    lat: float
    lon: float


@dataclass
class RoadEdge:
    edge_id: str
    u: str  # Source node ID
    v: str  # Destination node ID
    distance_km: float
    base_speed_kmh: float = 35.0
    road_type: str = "secondary"  # arterial, secondary, local
    traffic_level: TrafficLevel = TrafficLevel.LOW


class RoadGraph:
    """Directed graph representing the urban road network with spatial queries and serialization."""

    def __init__(self):
        self.nodes: Dict[str, RoadNode] = {}
        self.edges: Dict[str, RoadEdge] = {}
        self.adj: Dict[str, List[RoadEdge]] = {}
        self._edge_lookup: Dict[Tuple[str, str], RoadEdge] = {}

    def add_node(self, node: RoadNode) -> None:
        self.nodes[node.node_id] = node
        if node.node_id not in self.adj:
            self.adj[node.node_id] = []

    def add_edge(self, edge: RoadEdge, bidirectional: bool = True) -> None:
        if edge.u not in self.nodes or edge.v not in self.nodes:
            raise ValueError(f"Both nodes {edge.u} and {edge.v} must exist in the graph before adding edge.")

        self.edges[edge.edge_id] = edge
        self.adj[edge.u].append(edge)
        self._edge_lookup[(edge.u, edge.v)] = edge

        if bidirectional:
            rev_edge_id = f"{edge.edge_id}_rev"
            rev_edge = RoadEdge(
                edge_id=rev_edge_id,
                u=edge.v,
                v=edge.u,
                distance_km=edge.distance_km,
                base_speed_kmh=edge.base_speed_kmh,
                road_type=edge.road_type,
                traffic_level=edge.traffic_level,
            )
            self.edges[rev_edge_id] = rev_edge
            self.adj[edge.v].append(rev_edge)
            self._edge_lookup[(edge.v, edge.u)] = rev_edge

    def get_neighbors(self, node_id: str) -> List[RoadEdge]:
        return self.adj.get(node_id, [])

    def get_edge(self, u: str, v: str) -> Optional[RoadEdge]:
        return self._edge_lookup.get((u, v))

    def find_nearest_node(self, lat: float, lon: float) -> str:
        """Finds the nearest graph node to the given geographic coordinates."""
        if not self.nodes:
            raise ValueError("Cannot search nearest node in an empty graph.")

        best_node_id = None
        min_dist = float("inf")

        for node_id, node in self.nodes.items():
            dist = haversine_distance_km(lat, lon, node.lat, node.lon)
            if dist < min_dist:
                min_dist = dist
                best_node_id = node_id

        return best_node_id

    def to_dict(self) -> Dict[str, Any]:
        """Serializes the road graph to a dictionary."""
        return {
            "nodes": [asdict(n) for n in self.nodes.values()],
            "edges": [
                {
                    "edge_id": e.edge_id,
                    "u": e.u,
                    "v": e.v,
                    "distance_km": e.distance_km,
                    "base_speed_kmh": e.base_speed_kmh,
                    "road_type": e.road_type,
                    "traffic_level": e.traffic_level.value,
                }
                for e in self.edges.values()
            ],
        }

    def save_to_json(self, file_path: Path) -> None:
        file_path = Path(file_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load_from_json(cls, file_path: Path) -> "RoadGraph":
        file_path = Path(file_path)
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        graph = cls()
        for nd in data["nodes"]:
            graph.add_node(RoadNode(node_id=nd["node_id"], lat=nd["lat"], lon=nd["lon"]))

        for ed in data["edges"]:
            edge = RoadEdge(
                edge_id=ed["edge_id"],
                u=ed["u"],
                v=ed["v"],
                distance_km=ed["distance_km"],
                base_speed_kmh=ed.get("base_speed_kmh", 35.0),
                road_type=ed.get("road_type", "secondary"),
                traffic_level=TrafficLevel(ed.get("traffic_level", "LOW")),
            )
            # Load edges as directed since JSON contains all directed edges
            graph.edges[edge.edge_id] = edge
            graph.adj[edge.u].append(edge)
            graph._edge_lookup[(edge.u, edge.v)] = edge

        return graph


def generate_synthetic_road_network(
    config: Optional[DataGenerationConfig] = None,
    grid_rows: int = 12,
    grid_cols: int = 12,
) -> RoadGraph:
    """Generates a connected synthetic urban road network spanning the configured city area."""
    cfg = config or DataGenerationConfig()
    graph = RoadGraph()

    lat_step = (cfg.lat_max - cfg.lat_min) / (grid_rows - 1)
    lon_step = (cfg.lon_max - cfg.lon_min) / (grid_cols - 1)

    node_matrix: List[List[str]] = []
    node_counter = 1

    # 1. Create Grid Intersections (Nodes)
    for r in range(grid_rows):
        row_nodes = []
        lat = round(cfg.lat_min + r * lat_step, 6)
        for c in range(grid_cols):
            lon = round(cfg.lon_min + c * lon_step, 6)
            nid = f"NODE_{node_counter:04d}"
            graph.add_node(RoadNode(node_id=nid, lat=lat, lon=lon))
            row_nodes.append(nid)
            node_counter += 1
        node_matrix.append(row_nodes)

    edge_counter = 1

    # 2. Add Horizontal and Vertical Grid Road Segments
    for r in range(grid_rows):
        for c in range(grid_cols):
            u_id = node_matrix[r][c]
            u_node = graph.nodes[u_id]

            # Horizontal edge (East-West)
            if c + 1 < grid_cols:
                v_id = node_matrix[r][c + 1]
                v_node = graph.nodes[v_id]
                dist = haversine_distance_km(u_node.lat, u_node.lon, v_node.lat, v_node.lon)
                # Middle rows are primary arterial corridors
                is_arterial = r in (grid_rows // 3, 2 * grid_rows // 3)
                speed = 50.0 if is_arterial else (35.0 if r % 2 == 0 else 25.0)
                rtype = "arterial" if is_arterial else ("secondary" if r % 2 == 0 else "local")

                graph.add_edge(
                    RoadEdge(
                        edge_id=f"EDGE_{edge_counter:05d}",
                        u=u_id,
                        v=v_id,
                        distance_km=dist,
                        base_speed_kmh=speed,
                        road_type=rtype,
                    ),
                    bidirectional=True,
                )
                edge_counter += 1

            # Vertical edge (North-South)
            if r + 1 < grid_rows:
                v_id = node_matrix[r + 1][c]
                v_node = graph.nodes[v_id]
                dist = haversine_distance_km(u_node.lat, u_node.lon, v_node.lat, v_node.lon)
                is_arterial = c in (grid_cols // 3, 2 * grid_cols // 3)
                speed = 50.0 if is_arterial else (35.0 if c % 2 == 0 else 25.0)
                rtype = "arterial" if is_arterial else ("secondary" if c % 2 == 0 else "local")

                graph.add_edge(
                    RoadEdge(
                        edge_id=f"EDGE_{edge_counter:05d}",
                        u=u_id,
                        v=v_id,
                        distance_km=dist,
                        base_speed_kmh=speed,
                        road_type=rtype,
                    ),
                    bidirectional=True,
                )
                edge_counter += 1

    # 3. Add Diagonal / Express Arterials connecting Key Commercial Hubs
    hub_nodes = [graph.find_nearest_node(hub.lat, hub.lon) for hub in cfg.commercial_hubs]
    for i in range(len(hub_nodes)):
        for j in range(i + 1, len(hub_nodes)):
            u_id = hub_nodes[i]
            v_id = hub_nodes[j]
            if u_id != v_id and (u_id, v_id) not in graph._edge_lookup:
                u_node = graph.nodes[u_id]
                v_node = graph.nodes[v_id]
                dist = haversine_distance_km(u_node.lat, u_node.lon, v_node.lat, v_node.lon)
                graph.add_edge(
                    RoadEdge(
                        edge_id=f"EDGE_{edge_counter:05d}",
                        u=u_id,
                        v=v_id,
                        distance_km=dist,
                        base_speed_kmh=55.0,  # Express avenue connecting hubs
                        road_type="arterial",
                    ),
                    bidirectional=True,
                )
                edge_counter += 1

    return graph
