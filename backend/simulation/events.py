"""Dynamic event models and types for the food delivery simulation."""
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict


class EventType(str, Enum):
    NEW_ORDER = "NEW_ORDER"
    TRAFFIC_CHANGE = "TRAFFIC_CHANGE"
    ROAD_CLOSURE = "ROAD_CLOSURE"
    RIDER_UNAVAILABLE = "RIDER_UNAVAILABLE"
    RIDER_AVAILABLE = "RIDER_AVAILABLE"


@dataclass
class SimEvent:
    """Represents a discrete dynamic event occurring in the delivery environment."""
    event_id: str
    event_type: EventType
    timestamp_min: float
    payload: Dict[str, Any] = field(default_factory=dict)
    requires_reoptimization: bool = True

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["event_type"] = self.event_type.value
        return data
