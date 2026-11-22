"""Pydantic schemas for the FastAPI backend REST endpoints."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class NewOrderRequest(BaseModel):
    order_id: Optional[str] = None
    restaurant_id: str
    customer_id: str
    preparation_time: int = Field(default=15, ge=1, description="Kitchen preparation time in minutes")
    delivery_lead_time_min: int = Field(default=35, ge=5, description="Allowed delivery buffer minutes after preparation")


class TrafficEventRequest(BaseModel):
    """Identify the road by edge_id, or by its source/target node IDs."""
    edge_id: Optional[str] = None
    source: Optional[str] = None
    target: Optional[str] = None
    traffic_level: Optional[str] = Field(default=None, description="TrafficLevel: LOW, MEDIUM, HIGH, or SEVERE")
    multiplier: Optional[float] = Field(default=None, gt=0, description="Travel-time multiplier, mapped to a TrafficLevel")
    trigger_reoptimization: Optional[bool] = True

    def get_level(self) -> str:
        if self.traffic_level:
            return self.traffic_level.upper()
        m = self.multiplier or 2.5
        if m >= 4.0:
            return "SEVERE"
        if m >= 2.0:
            return "HIGH"
        if m >= 1.3:
            return "MEDIUM"
        return "LOW"


class RoadClosureRequest(BaseModel):
    edge_id: Optional[str] = None
    source: Optional[str] = None
    target: Optional[str] = None
    trigger_reoptimization: Optional[bool] = True



class RiderUnavailableRequest(BaseModel):
    rider_id: str


class SimulationStepRequest(BaseModel):
    delta_time_min: float = Field(default=1.0, gt=0.0, description="Minutes to advance simulation clock")
    dt_minutes: Optional[float] = None

    def get_dt(self) -> float:
        return self.dt_minutes if self.dt_minutes is not None else self.delta_time_min


class OptimizationRunRequest(BaseModel):
    num_ants: int = Field(default=15, ge=2, le=100)
    num_iterations: int = Field(default=25, ge=1, le=200)
    iterations: Optional[int] = None
    alpha: float = Field(default=1.0, ge=0.0)
    beta: float = Field(default=2.0, ge=0.0)
    evaporation_rate: float = Field(default=0.15, ge=0.01, le=0.99)
    random_seed: Optional[int] = None
    dynamic: Optional[bool] = False

    def get_iterations(self) -> int:
        return self.iterations if self.iterations is not None else self.num_iterations


class BlockRoadRequest(BaseModel):
    """Close the road nearest a map point (must be on/near a courier's route)."""
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    rider_id: Optional[str] = None
