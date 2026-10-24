"""Greedy priority baseline algorithm for food delivery dispatching."""
from typing import Dict, List, Set, Tuple

from backend.aco.cost import CostEvaluator
from backend.aco.models import ACOTaskNode, DeliveryPlan, RiderTour


class GreedyPrioritySolver:
    """Solves multi-rider pickup and delivery by selecting the highest priority stop based on urgency and transit cost."""

    def __init__(
        self,
        task_nodes: Dict[str, ACOTaskNode],
        pickup_nodes: Dict[str, ACOTaskNode],
        dropoff_nodes: Dict[str, ACOTaskNode],
        rider_start_nodes: Dict[str, ACOTaskNode],
        rider_capacities: Dict[str, int],
        distance_matrix: Dict[Tuple[str, str], float],
        time_matrix: Dict[Tuple[str, str], float],
        cost_evaluator: CostEvaluator,
    ):
        self.task_nodes = task_nodes
        self.pickup_nodes = pickup_nodes
        self.dropoff_nodes = dropoff_nodes
        self.rider_start_nodes = rider_start_nodes
        self.rider_capacities = rider_capacities
        self.distance_matrix = distance_matrix
        self.time_matrix = time_matrix
        self.evaluator = cost_evaluator

    def _score_candidate(self, curr_node: ACOTaskNode, candidate: ACOTaskNode, curr_time: float) -> float:
        """Calculates immediate priority score combining deadline urgency and travel cost."""
        travel_time = self.time_matrix.get((curr_node.node_id, candidate.node_id), 5.0)
        arrival_time = curr_time + travel_time

        if candidate.task_type == "dropoff":
            slack = candidate.deadline_min - arrival_time
            if slack <= 0:
                # High priority for already-late orders
                urgency = 50.0 + abs(slack)
            else:
                urgency = 1.0 + (30.0 / max(1.0, slack))
            return urgency / (travel_time + 0.1)

        elif candidate.task_type == "pickup":
            wait_time = max(0.0, candidate.ready_time_min - arrival_time)
            # Find associated customer deadline to gauge order urgency
            d_node = self.dropoff_nodes.get(candidate.order_id)
            deadline = d_node.deadline_min if d_node else float("inf")
            slack = max(1.0, deadline - (arrival_time + wait_time))
            urgency = 1.0 + (20.0 / slack)
            return urgency / (travel_time + 0.5 * wait_time + 0.1)

        return 1.0 / (travel_time + 0.1)

    def solve(self, order_ids: List[str]) -> DeliveryPlan:
        """Constructs a delivery plan using the greedy urgency priority heuristic."""
        rider_ids = sorted(list(self.rider_start_nodes.keys()))

        tours: Dict[str, RiderTour] = {}
        for r_id in rider_ids:
            start_node = self.rider_start_nodes[r_id]
            tours[r_id] = RiderTour(
                rider_id=r_id,
                capacity=self.rider_capacities[r_id],
                stops=[start_node],
                arrival_times=[0.0],
                departure_times=[0.0],
                loads=[0],
            )

        rider_current_node = {r: self.rider_start_nodes[r] for r in rider_ids}
        rider_current_time = {r: 0.0 for r in rider_ids}
        rider_current_load = {r: 0 for r in rider_ids}
        rider_bag: Dict[str, Set[str]] = {r: set() for r in rider_ids}

        unpicked_orders: Set[str] = set(order_ids)
        undelivered_orders: Set[str] = set(order_ids)

        max_steps = len(order_ids) * 3 + len(rider_ids) * 5
        steps = 0

        while undelivered_orders and steps < max_steps:
            steps += 1

            available_riders = [
                r for r in rider_ids
                if (rider_current_load[r] < self.rider_capacities[r] and unpicked_orders) or rider_bag[r]
            ]
            if not available_riders:
                break

            # Select rider available earliest
            r = min(available_riders, key=lambda rid: rider_current_time[rid])
            curr_node = rider_current_node[r]
            curr_time = rider_current_time[r]
            curr_load = rider_current_load[r]
            cap = self.rider_capacities[r]

            candidates: List[ACOTaskNode] = []
            if curr_load < cap:
                for oid in unpicked_orders:
                    candidates.append(self.pickup_nodes[oid])
            for oid in rider_bag[r]:
                candidates.append(self.dropoff_nodes[oid])

            if not candidates:
                break

            # Greedy Choice: pick candidate with maximum priority score
            best_cand = max(
                candidates,
                key=lambda cand: self._score_candidate(curr_node, cand, curr_time),
            )

            travel_dist = self.distance_matrix.get((curr_node.node_id, best_cand.node_id), 1.0)
            travel_time = self.time_matrix.get((curr_node.node_id, best_cand.node_id), 5.0)

            arrival_time = curr_time + travel_time
            start_service_time = max(arrival_time, best_cand.ready_time_min)
            departure_time = start_service_time + best_cand.service_time_min

            if best_cand.task_type == "pickup":
                oid = best_cand.order_id
                unpicked_orders.remove(oid)
                rider_bag[r].add(oid)
                curr_load += 1
            elif best_cand.task_type == "dropoff":
                oid = best_cand.order_id
                rider_bag[r].remove(oid)
                undelivered_orders.remove(oid)
                tours[r].orders_delivered.append(oid)
                curr_load -= 1

            tours[r].stops.append(best_cand)
            tours[r].arrival_times.append(round(arrival_time, 2))
            tours[r].departure_times.append(round(departure_time, 2))
            tours[r].loads.append(curr_load)
            tours[r].total_distance_km += travel_dist
            tours[r].total_time_min = departure_time

            rider_current_node[r] = best_cand
            rider_current_time[r] = departure_time
            rider_current_load[r] = curr_load

        return self.evaluator.evaluate(
            tours=tours,
            all_order_ids=order_ids,
            pickup_nodes=self.pickup_nodes,
            dropoff_nodes=self.dropoff_nodes,
        )
