"""Relocate-based local search that polishes a delivery plan (best insertion of whole orders)."""
import time
from typing import Dict, List, Optional, Tuple

from backend.aco.cost import CostEvaluator
from backend.aco.models import ACOTaskNode, DeliveryPlan, RiderTour
from backend.config.aco_config import ACOConfig


class RelocateLocalSearch:
    """Moves one order (pickup + dropoff pair) at a time to its best feasible position in any rider's tour.

    The fitness is additive across tours (the unserved penalty is constant for a fixed order set),
    so a move is evaluated by re-simulating only the two affected tours.
    """

    def __init__(
        self,
        config: ACOConfig,
        pickup_nodes: Dict[str, ACOTaskNode],
        dropoff_nodes: Dict[str, ACOTaskNode],
        rider_start_nodes: Dict[str, ACOTaskNode],
        rider_capacities: Dict[str, int],
        distance_matrix: Dict[Tuple[str, str], float],
        time_matrix: Dict[Tuple[str, str], float],
        evaluator: CostEvaluator,
    ):
        self.config = config
        self.pickup_nodes = pickup_nodes
        self.dropoff_nodes = dropoff_nodes
        self.rider_start_nodes = rider_start_nodes
        self.rider_capacities = rider_capacities
        self.distance_matrix = distance_matrix
        self.time_matrix = time_matrix
        self.evaluator = evaluator
        self._cache: Dict[Tuple[str, Tuple[str, ...]], float] = {}

    # ------------------------------------------------------------------ evaluation
    def _tour_cost(self, rider_id: str, seq: List[ACOTaskNode]) -> float:
        """Weighted cost of one rider's stop sequence (excluding start); inf if capacity is violated."""
        key = (rider_id, tuple(n.node_id for n in seq))
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        cfg = self.config
        cap = self.rider_capacities[rider_id]
        cur = self.rider_start_nodes[rider_id]
        t = 0.0
        load = 0
        dist = 0.0
        late = 0.0
        fresh = 0.0
        cold = 0.0
        cost = 0.0
        for n in seq:
            pair = (cur.node_id, n.node_id)
            dist += self.distance_matrix.get(pair, 1.0)
            raw_arrival = t + self.time_matrix.get(pair, 5.0)
            arrival = round(raw_arrival, 2)  # the evaluator scores the rounded arrival
            t = max(raw_arrival, n.ready_time_min) + n.service_time_min
            if n.task_type == "pickup":
                load += 1
                if load > cap:
                    cost = float("inf")
                    break
            else:
                load -= 1
                if arrival > n.deadline_min:
                    late += arrival - n.deadline_min
                waited = max(0.0, arrival - self.pickup_nodes[n.order_id].ready_time_min)
                fresh += waited
                cold += max(0.0, waited - cfg.freshness_limit_min)
            cur = n
        else:
            cost = (
                cfg.distance_weight * dist
                + cfg.time_weight * (t if seq else 0.0)
                + cfg.late_weight * late
                + cfg.freshness_weight * fresh
                + cfg.cold_food_weight * cold
            )
        self._cache[key] = cost
        return cost

    # ------------------------------------------------------------------ search
    def improve(self, plan: DeliveryPlan, order_ids: List[str], time_limit_s: float) -> DeliveryPlan:
        """Returns an improved plan, or the original one if no improving move is found."""
        deadline = time.perf_counter() + max(0.0, time_limit_s)
        seqs: Dict[str, List[ACOTaskNode]] = {
            rid: [s for s in tour.stops if s.task_type != "rider_start"] for rid, tour in plan.tours.items()
        }
        for rid in self.rider_start_nodes:
            seqs.setdefault(rid, [])
        costs = {rid: self._tour_cost(rid, seq) for rid, seq in seqs.items()}
        if any(c == float("inf") for c in costs.values()):
            return plan

        served = {n.order_id for seq in seqs.values() for n in seq if n.task_type == "dropoff"}
        improved_any = False
        improved = True
        while improved and time.perf_counter() < deadline:
            improved = False
            for oid in order_ids:
                if oid not in served:
                    continue
                if time.perf_counter() >= deadline:
                    break
                move = self._best_move(oid, seqs, costs, deadline)
                if move is not None:
                    src, dst, new_src, new_dst, c_src, c_dst = move
                    seqs[src], costs[src] = new_src, c_src
                    seqs[dst], costs[dst] = new_dst, c_dst
                    improved = improved_any = True

        if not improved_any:
            return plan
        candidate = self._rebuild(seqs, order_ids)
        return candidate if candidate.fitness_cost < plan.fitness_cost else plan

    def _best_move(self, oid, seqs, costs, deadline):
        p_node, d_node = self.pickup_nodes[oid], self.dropoff_nodes[oid]
        src = next(r for r, s in seqs.items() if any(n.order_id == oid for n in s))
        reduced_src = [n for n in seqs[src] if n.order_id != oid]
        reduced_src_cost = self._tour_cost(src, reduced_src)
        if reduced_src_cost == float("inf"):
            return None
        base = costs[src]

        best_delta = -1e-6
        best = None
        for dst in seqs:
            base_seq = reduced_src if dst == src else seqs[dst]
            other_base = costs[dst] if dst != src else 0.0
            for i in range(len(base_seq) + 1):
                for j in range(i, len(base_seq) + 1):
                    new_seq = base_seq[:i] + [p_node] + base_seq[i:j] + [d_node] + base_seq[j:]
                    new_cost = self._tour_cost(dst, new_seq)
                    if dst == src:
                        delta = new_cost - base
                    else:
                        delta = (reduced_src_cost + new_cost) - (base + other_base)
                    if delta < best_delta:
                        best_delta = delta
                        best = (src, dst, new_seq, new_cost)
            if time.perf_counter() >= deadline:
                break
        if best is None:
            return None
        src_, dst_, new_seq, new_cost = best
        if dst_ == src_:
            return src_, dst_, new_seq, new_seq, new_cost, new_cost
        return src_, dst_, reduced_src, new_seq, reduced_src_cost, new_cost

    # ------------------------------------------------------------------ rebuild
    def _rebuild(self, seqs: Dict[str, List[ACOTaskNode]], order_ids: List[str]) -> DeliveryPlan:
        tours: Dict[str, RiderTour] = {}
        for rid in sorted(seqs):
            start = self.rider_start_nodes[rid]
            tour = RiderTour(
                rider_id=rid,
                capacity=self.rider_capacities[rid],
                stops=[start],
                arrival_times=[0.0],
                departure_times=[0.0],
                loads=[0],
            )
            cur, t, load = start, 0.0, 0
            for n in seqs[rid]:
                pair = (cur.node_id, n.node_id)
                arrival = t + self.time_matrix.get(pair, 5.0)
                dep = max(arrival, n.ready_time_min) + n.service_time_min
                if n.task_type == "pickup":
                    load += 1
                else:
                    load -= 1
                    tour.orders_delivered.append(n.order_id)
                tour.stops.append(n)
                tour.arrival_times.append(round(arrival, 2))
                tour.departure_times.append(round(dep, 2))
                tour.loads.append(load)
                tour.total_distance_km += self.distance_matrix.get(pair, 1.0)
                tour.total_time_min = dep
                cur, t = n, dep
            tours[rid] = tour
        return self.evaluator.evaluate(
            tours=tours,
            all_order_ids=order_ids,
            pickup_nodes=self.pickup_nodes,
            dropoff_nodes=self.dropoff_nodes,
        )
