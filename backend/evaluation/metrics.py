"""Metrics collection and serialization for algorithm evaluation."""
from dataclasses import asdict, dataclass
from typing import Any, Dict

from backend.aco.models import DeliveryPlan


@dataclass
class EvaluationMetrics:
    """Standardized performance metrics across optimization algorithms."""
    algorithm: str
    problem_size: int
    seed: int
    total_distance_km: float
    avg_delivery_time_min: float
    max_delivery_time_min: float
    late_deliveries_count: int
    late_deliveries_percentage: float
    freshness_penalty: float
    total_cost: float
    runtime_seconds: float
    unserved_orders: int

    @classmethod
    def from_delivery_plan(
        cls,
        plan: DeliveryPlan,
        algorithm: str,
        problem_size: int,
        seed: int,
        runtime_seconds: float,
    ) -> "EvaluationMetrics":
        total_delivered = sum(len(t.orders_delivered) for t in plan.tours.values())
        late_count = plan.late_orders_count
        late_pct = round((late_count / total_delivered * 100.0), 2) if total_delivered > 0 else 0.0

        all_delivery_times = []
        for tour in plan.tours.values():
            for idx, stop in enumerate(tour.stops):
                if stop.task_type == "dropoff":
                    all_delivery_times.append(tour.arrival_times[idx])

        avg_time = round(sum(all_delivery_times) / len(all_delivery_times), 2) if all_delivery_times else 0.0
        max_time = round(max(all_delivery_times), 2) if all_delivery_times else 0.0

        return cls(
            algorithm=algorithm,
            problem_size=problem_size,
            seed=seed,
            total_distance_km=round(plan.total_distance_km, 3),
            avg_delivery_time_min=avg_time,
            max_delivery_time_min=max_time,
            late_deliveries_count=late_count,
            late_deliveries_percentage=late_pct,
            freshness_penalty=round(plan.freshness_penalty, 2),
            total_cost=round(plan.fitness_cost, 2),
            runtime_seconds=round(runtime_seconds, 4),
            unserved_orders=plan.unserved_orders_count,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
