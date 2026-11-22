"""Traffic model representing dynamic road congestion and speed adjustments."""
from enum import Enum
from typing import Dict, Optional


class TrafficLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    SEVERE = "SEVERE"


# Speed multipliers associated with each traffic condition
TRAFFIC_SPEED_MULTIPLIERS: Dict[TrafficLevel, float] = {
    TrafficLevel.LOW: 1.0,     # Free-flowing normal speed
    TrafficLevel.MEDIUM: 0.70, # Moderate congestion (-30% speed)
    TrafficLevel.HIGH: 0.40,   # Heavy congestion (-60% speed)
    TrafficLevel.SEVERE: 0.20, # Severe congestion / gridlock (-80% speed)
}


class TrafficModel:
    """Manages road traffic states and computes effective speeds and travel times."""

    MIN_SPEED_KMH = 5.0  # Floor speed to avoid division by zero or infinite travel time

    def __init__(self, default_level: TrafficLevel = TrafficLevel.LOW):
        self.default_level = default_level
        self._edge_traffic: Dict[str, TrafficLevel] = {}
        self._closed_edges: set = set()

    def set_edge_traffic(self, edge_id: str, level: TrafficLevel) -> None:
        """Sets a traffic congestion level for a specific road edge."""
        self._edge_traffic[edge_id] = level

    def close_edge(self, edge_id: str) -> None:
        """Completely closes an edge to vehicle traffic."""
        self._closed_edges.add(edge_id)
        self.set_edge_traffic(edge_id, TrafficLevel.SEVERE)

    def open_edge(self, edge_id: str) -> None:
        """Re-opens a previously closed edge."""
        self._closed_edges.discard(edge_id)
        self._edge_traffic.pop(edge_id, None)

    def is_edge_closed(self, edge_id: str) -> bool:
        return edge_id in self._closed_edges

    def clear_overrides(self) -> None:
        """Clears all dynamic traffic and closure overrides."""
        self._edge_traffic.clear()
        self._closed_edges.clear()

    def get_edge_traffic(self, edge_id: str, current_time_min: float = 0.0) -> TrafficLevel:
        """Returns the current traffic level for an edge, considering specific overrides."""
        return self._edge_traffic.get(edge_id, self.default_level)

    def get_speed_multiplier(self, level: TrafficLevel) -> float:
        """Returns the numerical speed multiplier for a given traffic level."""
        return TRAFFIC_SPEED_MULTIPLIERS.get(level, 1.0)

    def get_effective_speed(
        self,
        base_speed_kmh: float,
        edge_id: Optional[str] = None,
        current_time_min: float = 0.0,
        level_override: Optional[TrafficLevel] = None,
    ) -> float:
        """Computes the effective travel speed (km/h) accounting for traffic."""
        if edge_id and self.is_edge_closed(edge_id):
            return 0.1  # Virtually standstill
        level = level_override or (self.get_edge_traffic(edge_id, current_time_min) if edge_id else self.default_level)
        multiplier = self.get_speed_multiplier(level)
        return max(self.MIN_SPEED_KMH, base_speed_kmh * multiplier)

    def get_travel_time_minutes(
        self,
        distance_km: float,
        base_speed_kmh: float,
        edge_id: Optional[str] = None,
        current_time_min: float = 0.0,
        level_override: Optional[TrafficLevel] = None,
    ) -> float:
        """Calculates traversal duration (minutes) across an edge under current traffic."""
        if edge_id and self.is_edge_closed(edge_id):
            return 1e8  # Huge penalty so shortest path algorithms refuse traversal
        effective_speed = self.get_effective_speed(
            base_speed_kmh=base_speed_kmh,
            edge_id=edge_id,
            current_time_min=current_time_min,
            level_override=level_override,
        )
        return (distance_km / effective_speed) * 60.0

    def clear_overrides(self) -> None:
        """Resets all edge-specific traffic conditions back to default."""
        self._edge_traffic.clear()
