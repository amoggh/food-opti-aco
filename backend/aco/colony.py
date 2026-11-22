"""ACO Colony and top-level Optimization Engine."""
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from backend.config.aco_config import ACOConfig
from backend.aco.ant import Ant
from backend.aco.cost import CostEvaluator
from backend.aco.models import ACOTaskNode, DeliveryPlan
from backend.aco.pheromone import PheromoneMatrix
from backend.preprocessing.pipeline import (
    ProcessedCustomer,
    ProcessedOrder,
    ProcessedRestaurant,
    ProcessedRider,
)
from backend.routing.graph import haversine_distance_km
from backend.routing.router import RoutingEngine


@dataclass
class OptimizationResult:
    """Outcome of an ACO optimization run."""
    best_plan: DeliveryPlan
    convergence_history: List[Dict[str, Any]] = field(default_factory=list)
    runtime_seconds: float = 0.0
    config: Optional[ACOConfig] = None


class ACOEngine:
    """Ant Colony Optimization engine coordinating ants, pheromone matrices, and solution convergence."""

    def __init__(
        self,
        config: Optional[ACOConfig] = None,
        routing_engine: Optional[RoutingEngine] = None,
    ):
        self.config = config or ACOConfig()
        self.routing_engine = routing_engine
        self.rng = random.Random(self.config.random_seed)

        self.task_nodes: Dict[str, ACOTaskNode] = {}
        self.pickup_nodes: Dict[str, ACOTaskNode] = {}
        self.dropoff_nodes: Dict[str, ACOTaskNode] = {}
        self.rider_start_nodes: Dict[str, ACOTaskNode] = {}
        self.rider_capacities: Dict[str, int] = {}
        self.order_ids: List[str] = []

        self.distance_matrix: Dict[Tuple[str, str], float] = {}
        self.time_matrix: Dict[Tuple[str, str], float] = {}
        self.pheromones: Optional[PheromoneMatrix] = None
        self.evaluator = CostEvaluator(self.config)

    def setup_problem(
        self,
        restaurants: List[ProcessedRestaurant],
        customers: List[ProcessedCustomer],
        orders: List[ProcessedOrder],
        riders: List[ProcessedRider],
    ) -> None:
        """Constructs the ACO task graph, computes spatial matrices, and initializes pheromones."""
        rest_dict = {r.restaurant_id: r for r in restaurants}
        cust_dict = {c.customer_id: c for c in customers}

        self.task_nodes.clear()
        self.pickup_nodes.clear()
        self.dropoff_nodes.clear()
        self.rider_start_nodes.clear()
        self.rider_capacities.clear()
        self.order_ids = [o.order_id for o in orders]

        # 1. Register Rider Start Nodes
        for r in riders:
            nid = f"R_{r.rider_id}"
            node = ACOTaskNode(
                node_id=nid,
                task_type="rider_start",
                rider_id=r.rider_id,
                lat=r.latitude,
                lon=r.longitude,
                ready_time_min=0.0,
                deadline_min=float("inf"),
                service_time_min=0.0,
            )
            self.task_nodes[nid] = node
            self.rider_start_nodes[r.rider_id] = node
            self.rider_capacities[r.rider_id] = r.capacity

        # 2. Register Order Pickup and Dropoff Nodes
        for o in orders:
            rest = rest_dict[o.restaurant_id]
            cust = cust_dict[o.customer_id]

            p_nid = f"P_{o.order_id}"
            p_node = ACOTaskNode(
                node_id=p_nid,
                task_type="pickup",
                order_id=o.order_id,
                lat=rest.latitude,
                lon=rest.longitude,
                ready_time_min=o.order_time_min + o.preparation_time,
                deadline_min=float("inf"),
                service_time_min=3.0,
            )
            self.task_nodes[p_nid] = p_node
            self.pickup_nodes[o.order_id] = p_node

            d_nid = f"D_{o.order_id}"
            d_node = ACOTaskNode(
                node_id=d_nid,
                task_type="dropoff",
                order_id=o.order_id,
                lat=cust.latitude,
                lon=cust.longitude,
                ready_time_min=o.order_time_min,
                deadline_min=o.deadline_min,
                service_time_min=3.0,
            )
            self.task_nodes[d_nid] = d_node
            self.dropoff_nodes[o.order_id] = d_node

        # 3. Precompute Distance and Travel-Time Matrices between all task nodes
        all_nodes = list(self.task_nodes.values())
        avg_city_speed_kmh = 35.0

        for i in range(len(all_nodes)):
            for j in range(len(all_nodes)):
                u = all_nodes[i]
                v = all_nodes[j]
                if i == j:
                    self.distance_matrix[(u.node_id, v.node_id)] = 0.0
                    self.time_matrix[(u.node_id, v.node_id)] = 0.0
                elif (u.node_id, v.node_id) not in self.distance_matrix:
                    if self.routing_engine:
                        route = self.routing_engine.find_route_between_coordinates(
                            u.lat, u.lon, v.lat, v.lon, criterion="time", use_real_roads=False
                        )
                        dist = route.total_distance_km
                        ttime = route.total_time_minutes
                    else:
                        dist = haversine_distance_km(u.lat, u.lon, v.lat, v.lon)
                        ttime = (dist / avg_city_speed_kmh) * 60.0

                    self.distance_matrix[(u.node_id, v.node_id)] = dist
                    self.time_matrix[(u.node_id, v.node_id)] = ttime
                    self.distance_matrix[(v.node_id, u.node_id)] = dist
                    self.time_matrix[(v.node_id, u.node_id)] = ttime

        # 4. Initialize Pheromone Matrix
        node_ids = list(self.task_nodes.keys())
        self.pheromones = PheromoneMatrix(node_ids=node_ids, config=self.config)

    def optimize(self, verbose: bool = False) -> OptimizationResult:
        """Executes the Ant Colony Optimization loop over the configured number of iterations."""
        if not self.task_nodes or self.pheromones is None:
            raise RuntimeError("Problem must be initialized via setup_problem() before optimize().")

        start_time = time.time()
        global_best_plan: Optional[DeliveryPlan] = None
        convergence_history: List[Dict[str, Any]] = []

        if self.config.random_seed is not None:
            self.rng = random.Random(self.config.random_seed)

        for it in range(1, self.config.num_iterations + 1):
            iteration_plans: List[DeliveryPlan] = []

            # 1. Ant tour construction
            for ant_idx in range(self.config.num_ants):
                # Derive deterministic seed per ant for reproducibility
                ant_seed = self.rng.randint(0, 1000000)
                ant = Ant(
                    ant_id=ant_idx + 1,
                    config=self.config,
                    task_nodes=self.task_nodes,
                    pickup_nodes=self.pickup_nodes,
                    dropoff_nodes=self.dropoff_nodes,
                    rider_start_nodes=self.rider_start_nodes,
                    rider_capacities=self.rider_capacities,
                    distance_matrix=self.distance_matrix,
                    time_matrix=self.time_matrix,
                    pheromone_matrix=self.pheromones,
                    cost_evaluator=self.evaluator,
                    rng=random.Random(ant_seed),
                )
                plan = ant.construct_solution(self.order_ids)
                iteration_plans.append(plan)

            # 2. Evaluate iteration performance
            iteration_plans.sort(key=lambda p: p.fitness_cost)
            iter_best = iteration_plans[0]
            avg_cost = sum(p.fitness_cost for p in iteration_plans) / len(iteration_plans)

            if global_best_plan is None or iter_best.fitness_cost < global_best_plan.fitness_cost:
                global_best_plan = iter_best

            # 3. Pheromone updates (evaporation + deposit + elitist reinforcement)
            self.pheromones.evaporate()

            # Deposit pheromone for top-performing ants of this iteration
            top_k = max(1, self.config.num_ants // 4)
            for p in iteration_plans[:top_k]:
                self.pheromones.deposit(p, is_best=False)

            # Elitist reinforcement for global best solution
            self.pheromones.deposit(global_best_plan, is_best=True)

            # Track convergence
            convergence_history.append({
                "iteration": it,
                "best_cost": global_best_plan.fitness_cost,
                "iter_best_cost": iter_best.fitness_cost,
                "avg_cost": round(avg_cost, 2),
                "best_distance_km": global_best_plan.total_distance_km,
                "best_time_min": global_best_plan.total_delivery_time_min,
                "late_orders": global_best_plan.late_orders_count,
                "unserved": global_best_plan.unserved_orders_count,
            })

            if verbose and (it == 1 or it % 10 == 0 or it == self.config.num_iterations):
                print(
                    f"Iteration {it:02d}/{self.config.num_iterations}: "
                    f"Best Cost={global_best_plan.fitness_cost:.2f}, "
                    f"Distance={global_best_plan.total_distance_km:.2f}km, "
                    f"Late Orders={global_best_plan.late_orders_count}, "
                    f"Unserved={global_best_plan.unserved_orders_count}"
                )

        if global_best_plan and self.routing_engine:
            for tour in global_best_plan.tours.values():
                stops = [(s.lat, s.lon) for s in tour.stops]
                if hasattr(self.routing_engine, "osm_router") and self.routing_engine.osm_router:
                    coords, _, _ = self.routing_engine.osm_router.get_route_for_stops(stops)
                    if coords and len(coords) >= 2:
                        tour.road_path_coordinates = coords
                        continue

                coords = []
                for idx in range(len(tour.stops) - 1):
                    s1 = tour.stops[idx]
                    s2 = tour.stops[idx + 1]
                    res = self.routing_engine.find_route_between_coordinates(
                        s1.lat, s1.lon, s2.lat, s2.lon, criterion="distance", use_real_roads=True
                    )
                    if res and res.path_coordinates:
                        if coords and coords[-1] == res.path_coordinates[0]:
                            coords.extend(res.path_coordinates[1:])
                        else:
                            coords.extend(res.path_coordinates)
                    else:
                        coords.extend([(s1.lat, s1.lon), (s2.lat, s2.lon)])
                tour.road_path_coordinates = coords

        elapsed = time.time() - start_time

        return OptimizationResult(
            best_plan=global_best_plan,
            convergence_history=convergence_history,
            runtime_seconds=round(elapsed, 3),
            config=self.config,
        )
