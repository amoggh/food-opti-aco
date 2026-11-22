"""Cost and multi-objective fitness evaluation for ACO delivery plans."""
from typing import Dict, List

from backend.config.aco_config import ACOConfig
from backend.aco.models import ACOTaskNode, DeliveryPlan, RiderTour


class CostEvaluator:
    """Evaluates the multi-objective fitness cost of a candidate delivery plan."""

    def __init__(self, config: ACOConfig):
        self.config = config

    def evaluate(
        self,
        tours: Dict[str, RiderTour],
        all_order_ids: List[str],
        pickup_nodes: Dict[str, ACOTaskNode],
        dropoff_nodes: Dict[str, ACOTaskNode],
    ) -> DeliveryPlan:
        total_distance = sum(tour.total_distance_km for tour in tours.values())
        total_time = sum(tour.total_time_min for tour in tours.values())

        late_penalty = 0.0
        freshness_penalty = 0.0
        late_orders_count = 0
        served_order_ids = set()

        for tour in tours.values():
            for idx, stop in enumerate(tour.stops):
                if stop.task_type == "dropoff" and stop.order_id:
                    delivery_time = tour.arrival_times[idx]
                    served_order_ids.add(stop.order_id)

                    # Lateness penalty
                    deadline = stop.deadline_min
                    if delivery_time > deadline:
                        delay = delivery_time - deadline
                        late_penalty += delay
                        late_orders_count += 1

                    # Freshness penalty (time from food ready to customer delivery)
                    ready_time = pickup_nodes[stop.order_id].ready_time_min
                    transit_and_waiting = max(0.0, delivery_time - ready_time)
                    freshness_penalty += transit_and_waiting

        unserved_orders_count = len(all_order_ids) - len(served_order_ids)
        unserved_penalty = unserved_orders_count * self.config.unserved_order_penalty

        # Fitness cost formula from phases.md:
        # Cost = distance_weight * total_distance + time_weight * total_delivery_time +
        #        late_weight * late_delivery_penalty + freshness_weight * freshness_penalty
        fitness_cost = (
            self.config.distance_weight * total_distance
            + self.config.time_weight * total_time
            + self.config.late_weight * late_penalty
            + self.config.freshness_weight * freshness_penalty
            + unserved_penalty
        )

        return DeliveryPlan(
            tours=tours,
            total_distance_km=round(total_distance, 3),
            total_delivery_time_min=round(total_time, 2),
            late_delivery_penalty=round(late_penalty, 2),
            freshness_penalty=round(freshness_penalty, 2),
            late_orders_count=late_orders_count,
            unserved_orders_count=unserved_orders_count,
            fitness_cost=round(fitness_cost, 2),
        )
