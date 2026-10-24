"""Pydantic schemas for the FastAPI backend REST endpoints."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class NewOrderRequest(BaseModel):
    restaurant_id: str
    customer_id: str
    preparation_time: int = Field(default=15, ge=1, description="Kitchen preparation time in minutes")
    delivery_lead_time_min: int = Field(default=35, ge=5, description="Allowed delivery buffer minutes after preparation")


class TrafficEventRequest(BaseModel):
    edge_id: str
    traffic_level: str = Field(default="HIGH", description="TrafficLevel: LOW, MEDIUM, HIGH, or SEVERE")


class RoadClosureRequest(BaseModel):
    edge_id: str


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
