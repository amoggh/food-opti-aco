"""Ant candidate solution constructor for Food Delivery PDPTW."""
import random
from typing import Dict, List, Optional, Set, Tuple

from backend.config.aco_config import ACOConfig
from backend.aco.cost import CostEvaluator
from backend.aco.models import ACOTaskNode, DeliveryPlan, RiderTour
from backend.aco.pheromone import PheromoneMatrix


class Ant:
    """An artificial ant that constructs a feasible multi-rider delivery plan."""

    def __init__(
        self,
        ant_id: int,
        config: ACOConfig,
        task_nodes: Dict[str, ACOTaskNode],
        pickup_nodes: Dict[str, ACOTaskNode],
        dropoff_nodes: Dict[str, ACOTaskNode],
        rider_start_nodes: Dict[str, ACOTaskNode],
        rider_capacities: Dict[str, int],
        distance_matrix: Dict[Tuple[str, str], float],
        time_matrix: Dict[Tuple[str, str], float],
        pheromone_matrix: PheromoneMatrix,
        cost_evaluator: CostEvaluator,
        rng: random.Random,
    ):
        self.ant_id = ant_id
        self.config = config
        self.task_nodes = task_nodes
        self.pickup_nodes = pickup_nodes
        self.dropoff_nodes = dropoff_nodes
        self.rider_start_nodes = rider_start_nodes
        self.rider_capacities = rider_capacities
        self.distance_matrix = distance_matrix
        self.time_matrix = time_matrix
        self.pheromones = pheromone_matrix
        self.evaluator = cost_evaluator
        self.rng = rng

    def _calculate_heuristic(
        self, current_node: ACOTaskNode, candidate: ACOTaskNode, current_time: float
    ) -> float:
        """Calculates heuristic visibility eta_ij based on travel time, wait time, and urgency."""
        travel_time = self.time_matrix.get((current_node.node_id, candidate.node_id), 5.0)
        arrival_time = current_time + travel_time

        if candidate.task_type == "dropoff":
            # Priority to orders approaching their deadlines
            urgency_slack = max(1.0, candidate.deadline_min - arrival_time)
            urgency_factor = 1.0 + (30.0 / urgency_slack)
            return (1.0 / (travel_time + 0.1)) * urgency_factor

        elif candidate.task_type == "pickup":
            # Penalize excessive idle waiting at restaurant if food is not ready
            idle_wait = max(0.0, candidate.ready_time_min - arrival_time)
            return 1.0 / (travel_time + 0.5 * idle_wait + 0.1)

        return 1.0 / (travel_time + 0.1)

    def construct_solution(self, all_order_ids: List[str]) -> DeliveryPlan:
        """Constructs a feasible delivery plan satisfying capacity, precedence, and time constraints."""
        rider_ids = sorted(list(self.rider_start_nodes.keys()))

        # Initialize rider tours
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

        # Rider dynamic state tracking
        rider_current_node: Dict[str, ACOTaskNode] = {r: self.rider_start_nodes[r] for r in rider_ids}
        rider_current_time: Dict[str, float] = {r: 0.0 for r in rider_ids}
        rider_current_load: Dict[str, int] = {r: 0 for r in rider_ids}
        rider_bag: Dict[str, Set[str]] = {r: set() for r in rider_ids}  # Order IDs carried

        # Global remaining orders
        unpicked_orders: Set[str] = set(all_order_ids)
        undelivered_orders: Set[str] = set(all_order_ids)

        # Iterate until all orders are delivered or no more moves can be made
        max_steps = len(all_order_ids) * 3 + len(rider_ids) * 5
        steps = 0

        while undelivered_orders and steps < max_steps:
            steps += 1

            # Pick the rider who is currently available earliest in simulation time
            available_riders = [
                r for r in rider_ids
                if (rider_current_load[r] < self.rider_capacities[r] and unpicked_orders) or rider_bag[r]
            ]
            if not available_riders:
                break

            r = min(available_riders, key=lambda rid: rider_current_time[rid])
            curr_node = rider_current_node[r]
            curr_time = rider_current_time[r]
            curr_load = rider_current_load[r]
            cap = self.rider_capacities[r]

            # Determine feasible candidate next stops for rider r:
            # 1. Any unpicked order (if bag has space)
            # 2. Any dropoff for orders currently carried in this rider's bag
            candidates: List[ACOTaskNode] = []
            if curr_load < cap:
                for oid in unpicked_orders:
                    candidates.append(self.pickup_nodes[oid])
            for oid in rider_bag[r]:
                candidates.append(self.dropoff_nodes[oid])

            if not candidates:
                break

            # Calculate ACO transition probabilities P_ij = (tau^alpha * eta^beta) / sum
            weights: List[float] = []
            for cand in candidates:
                tau = self.pheromones.get_pheromone(curr_node.node_id, cand.node_id)
                eta = self._calculate_heuristic(curr_node, cand, curr_time)
                weight = (tau ** self.config.alpha) * (eta ** self.config.beta)
                weights.append(max(1e-6, weight))

            # Select candidate using roulette wheel / random choices
            total_weight = sum(weights)
            probs = [w / total_weight for w in weights]
            selected: ACOTaskNode = self.rng.choices(candidates, weights=probs, k=1)[0]

            # Execute transition to selected node
            travel_dist = self.distance_matrix.get((curr_node.node_id, selected.node_id), 1.0)
            travel_time = self.time_matrix.get((curr_node.node_id, selected.node_id), 5.0)

            arrival_time = curr_time + travel_time
            # Food readiness wait constraint: rider cannot depart before food is ready
            start_service_time = max(arrival_time, selected.ready_time_min)
            departure_time = start_service_time + selected.service_time_min

            # Update state based on task type
            if selected.task_type == "pickup":
                oid = selected.order_id
                unpicked_orders.remove(oid)
                rider_bag[r].add(oid)
                curr_load += 1
            elif selected.task_type == "dropoff":
                oid = selected.order_id
                rider_bag[r].remove(oid)
                undelivered_orders.remove(oid)
                tours[r].orders_delivered.append(oid)
                curr_load -= 1

            # Record in rider tour
            tours[r].stops.append(selected)
            tours[r].arrival_times.append(round(arrival_time, 2))
            tours[r].departure_times.append(round(departure_time, 2))
            tours[r].loads.append(curr_load)
            tours[r].total_distance_km += travel_dist
            tours[r].total_time_min = departure_time

            rider_current_node[r] = selected
            rider_current_time[r] = departure_time
            rider_current_load[r] = curr_load

        # Evaluate complete plan against multi-objective cost function
        plan = self.evaluator.evaluate(
            tours=tours,
            all_order_ids=all_order_ids,
            pickup_nodes=self.pickup_nodes,
            dropoff_nodes=self.dropoff_nodes,
        )
        return plan
