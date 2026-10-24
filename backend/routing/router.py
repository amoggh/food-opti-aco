"""Routing engine computing shortest paths, travel times, and distance/time matrices."""
import heapq
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from backend.routing.graph import RoadEdge, RoadGraph, haversine_distance_km
from backend.routing.traffic import TrafficModel


@dataclass
class RouteResult:
    start_node: str
    end_node: str
    path_nodes: List[str]
    path_coordinates: List[Tuple[float, float]]
    total_distance_km: float
    total_time_minutes: float


class RoutingEngine:
    """Graph routing engine computing optimal routes and travel matrices for delivery optimization."""

    def __init__(self, graph: RoadGraph, traffic_model: Optional[TrafficModel] = None):
        self.graph = graph
        self.traffic_model = traffic_model or TrafficModel()

    def _get_edge_weight(
        self, edge: RoadEdge, criterion: str, current_time_min: float
    ) -> float:
        if criterion == "distance":
            return edge.distance_km
        elif criterion == "time":
            return self.traffic_model.get_travel_time_minutes(
                distance_km=edge.distance_km,
                base_speed_kmh=edge.base_speed_kmh,
                edge_id=edge.edge_id,
                current_time_min=current_time_min,
            )
        else:
            raise ValueError(f"Unknown routing criterion: {criterion}. Expected 'time' or 'distance'.")

    def find_route_between_nodes(
        self,
        start_node: str,
        end_node: str,
        criterion: str = "time",
        departure_time_min: float = 0.0,
    ) -> RouteResult:
        """Finds the optimal path between two graph nodes using Dijkstra's algorithm."""
        if start_node not in self.graph.nodes:
            raise ValueError(f"Start node '{start_node}' does not exist in the road graph.")
        if end_node not in self.graph.nodes:
            raise ValueError(f"End node '{end_node}' does not exist in the road graph.")

        if start_node == end_node:
            node = self.graph.nodes[start_node]
            return RouteResult(
                start_node=start_node,
                end_node=end_node,
                path_nodes=[start_node],
                path_coordinates=[(node.lat, node.lon)],
                total_distance_km=0.0,
                total_time_minutes=0.0,
            )

        # Dijkstra priority queue: (cost, current_node_id, elapsed_time_min)
        pq = [(0.0, start_node, departure_time_min)]
        costs: Dict[str, float] = {start_node: 0.0}
        predecessors: Dict[str, Tuple[str, RoadEdge]] = {}

        while pq:
            current_cost, u, current_time = heapq.heappop(pq)

            if u == end_node:
                break

            if current_cost > costs.get(u, float("inf")):
                continue

            for edge in self.graph.get_neighbors(u):
                v = edge.v
                edge_weight = self._get_edge_weight(edge, criterion, current_time)
                new_cost = current_cost + edge_weight
                edge_time = self.traffic_model.get_travel_time_minutes(
                    edge.distance_km, edge.base_speed_kmh, edge.edge_id, current_time
                )

                if new_cost < costs.get(v, float("inf")):
                    costs[v] = new_cost
                    predecessors[v] = (u, edge)
                    heapq.heappush(pq, (new_cost, v, current_time + edge_time))

        if end_node not in predecessors:
            raise RuntimeError(f"No route found between '{start_node}' and '{end_node}'.")

        # Reconstruct path
        path_nodes = [end_node]
        path_edges: List[RoadEdge] = []
        curr = end_node
        while curr != start_node:
            prev_node, edge = predecessors[curr]
            path_edges.append(edge)
            path_nodes.append(prev_node)
            curr = prev_node

        path_nodes.reverse()
        path_edges.reverse()

        path_coords = [(self.graph.nodes[nid].lat, self.graph.nodes[nid].lon) for nid in path_nodes]
        total_dist = sum(e.distance_km for e in path_edges)

        # Calculate exact cumulative travel time
        elapsed = 0.0
        for e in path_edges:
            elapsed += self.traffic_model.get_travel_time_minutes(
                e.distance_km, e.base_speed_kmh, e.edge_id, departure_time_min + elapsed
            )

        return RouteResult(
            start_node=start_node,
            end_node=end_node,
            path_nodes=path_nodes,
            path_coordinates=path_coords,
            total_distance_km=round(total_dist, 4),
            total_time_minutes=round(elapsed, 4),
        )

    def find_route_between_coordinates(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        criterion: str = "time",
        departure_time_min: float = 0.0,
    ) -> RouteResult:
        """Snaps arbitrary start and end coordinates to the nearest graph nodes and computes route."""
        start_node = self.graph.find_nearest_node(start_lat, start_lon)
        end_node = self.graph.find_nearest_node(end_lat, end_lon)

        route = self.find_route_between_nodes(
            start_node=start_node,
            end_node=end_node,
            criterion=criterion,
            departure_time_min=departure_time_min,
        )

        # Include first-mile and last-mile connector distances (at default walking/local speed of 15 km/h)
        first_mile_km = haversine_distance_km(
            start_lat, start_lon, self.graph.nodes[start_node].lat, self.graph.nodes[start_node].lon
        )
        last_mile_km = haversine_distance_km(
            self.graph.nodes[end_node].lat, self.graph.nodes[end_node].lon, end_lat, end_lon
        )

        access_speed_kmh = 20.0
        access_time_min = ((first_mile_km + last_mile_km) / access_speed_kmh) * 60.0

        return RouteResult(
            start_node=start_node,
            end_node=end_node,
            path_nodes=route.path_nodes,
            path_coordinates=[(start_lat, start_lon)] + route.path_coordinates + [(end_lat, end_lon)],
            total_distance_km=round(route.total_distance_km + first_mile_km + last_mile_km, 4),
            total_time_minutes=round(route.total_time_minutes + access_time_min, 4),
        )

    def compute_distance_matrix(self, locations: List[Tuple[float, float]]) -> np.ndarray:
        """Computes pairwise distance matrix (in km) across a list of (lat, lon) coordinates."""
        n = len(locations)
        matrix = np.zeros((n, n), dtype=float)

        for i in range(n):
            for j in range(n):
                if i == j:
                    matrix[i, j] = 0.0
                elif i < j:
                    route = self.find_route_between_coordinates(
                        locations[i][0], locations[i][1], locations[j][0], locations[j][1], criterion="distance"
                    )
                    matrix[i, j] = route.total_distance_km
                    matrix[j, i] = route.total_distance_km  # Symmetric for bidirectional roads
        return matrix

    def compute_travel_time_matrix(
        self, locations: List[Tuple[float, float]], departure_time_min: float = 0.0
    ) -> np.ndarray:
        """Computes pairwise travel-time matrix (in minutes) across a list of (lat, lon) coordinates."""
        n = len(locations)
        matrix = np.zeros((n, n), dtype=float)

        for i in range(n):
            for j in range(n):
                if i == j:
                    matrix[i, j] = 0.0
                elif i < j:
                    route = self.find_route_between_coordinates(
                        locations[i][0], locations[i][1], locations[j][0], locations[j][1],
                        criterion="time", departure_time_min=departure_time_min
                    )
                    matrix[i, j] = route.total_time_minutes
                    matrix[j, i] = route.total_time_minutes
        return matrix
