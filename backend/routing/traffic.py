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

    def set_edge_traffic(self, edge_id: str, level: TrafficLevel) -> None:
        """Sets a traffic congestion level for a specific road edge."""
        self._edge_traffic[edge_id] = level

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
        """Calculates travel time in minutes over a distance given base speed and traffic."""
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
