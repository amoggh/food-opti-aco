"""Dynamic discrete-event food delivery simulation engine."""
import math
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.config.aco_config import ACOConfig
from backend.aco.colony import ACOEngine
from backend.aco.models import ACOTaskNode, DeliveryPlan
from backend.preprocessing.pipeline import (
    PreprocessingPipeline,
    ProcessedCustomer,
    ProcessedOrder,
    ProcessedRestaurant,
    ProcessedRider,
)
from backend.routing.graph import RoadGraph, haversine_distance_km
from backend.routing.router import RoutingEngine
from backend.routing.traffic import TrafficLevel, TrafficModel
from backend.simulation.events import EventType, SimEvent


class OrderStatus(str, Enum):
    PENDING = "PENDING"
    PREPARING = "PREPARING"
    READY = "READY"
    PICKED_UP = "PICKED_UP"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class RiderStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    BUSY = "BUSY"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass
class SimOrder:
    order_id: str
    restaurant_id: str
    customer_id: str
    order_time_min: float
    preparation_time: int
    ready_time_min: float
    deadline_min: float
    status: OrderStatus = OrderStatus.PENDING
    assigned_rider_id: Optional[str] = None
    picked_up_at_min: Optional[float] = None
    delivered_at_min: Optional[float] = None
    is_late: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        return d


@dataclass
class SimRider:
    rider_id: str
    capacity: int
    status: RiderStatus = RiderStatus.AVAILABLE
    current_lat: float = 0.0
    current_lon: float = 0.0
    carried_orders: List[str] = field(default_factory=list)
    assigned_stops: List[ACOTaskNode] = field(default_factory=list)
    total_distance_km: float = 0.0
    orders_delivered: List[str] = field(default_factory=list)
    road_path: List[List[float]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rider_id": self.rider_id,
            "capacity": self.capacity,
            "status": self.status.value,
            "current_lat": round(self.current_lat, 6),
            "current_lon": round(self.current_lon, 6),
            "carried_orders": list(self.carried_orders),
            "current_load": len(self.carried_orders),
            "remaining_stops": [s.node_id for s in self.assigned_stops],
            "assigned_stops": [
                {
                    "node_id": s.node_id,
                    "task_type": s.task_type,
                    "order_id": s.order_id,
                    "lat": s.lat,
                    "lon": s.lon,
                }
                for s in self.assigned_stops
            ],
            "road_path": self.road_path,
            "total_distance_km": round(self.total_distance_km, 3),
            "orders_delivered": list(self.orders_delivered),
        }


class SimulationEngine:
    """Manages virtual delivery time, courier progression, order lifecycles, and event-driven ACO re-optimization."""

    def __init__(
        self,
        raw_data_dir: Path = Path("backend/data/raw"),
        processed_data_dir: Path = Path("backend/data/processed"),
        config: Optional[ACOConfig] = None,
    ):
        self.raw_data_dir = Path(raw_data_dir)
        self.processed_data_dir = Path(processed_data_dir)
        self.config = config or ACOConfig()

        # Core state
        self.sim_time_min: float = 0.0
        self.is_running: bool = False
        self.time_step_min: float = 0.5  # 30 seconds per simulation tick

        # Entities
        self.restaurants: Dict[str, ProcessedRestaurant] = {}
        self.customers: Dict[str, ProcessedCustomer] = {}
        self.orders: Dict[str, SimOrder] = {}
        self.riders: Dict[str, SimRider] = {}

        # Network and routing
        self.graph: Optional[RoadGraph] = None
        self.traffic_model = TrafficModel()
        self.router: Optional[RoutingEngine] = None
        self.closed_edges: Set[str] = set()

        # Telemetry & history
        self.event_history: List[SimEvent] = []
        self.active_plan: Optional[DeliveryPlan] = None
        self.last_reopt_time_min: float = 0.0
        self.last_dispatch_time_min: float = 0.0

        self._load_environment()

    def _load_environment(self) -> None:
        """Loads road graph and base datasets."""
        # Load road graph
        graph_path = self.processed_data_dir / "road_graph.json"
        if graph_path.exists():
            self.graph = RoadGraph.load_from_json(graph_path)
            self.router = RoutingEngine(self.graph, self.traffic_model)
        else:
            self.graph = RoadGraph()
            self.router = None

        # Load processed datasets
        pipeline = PreprocessingPipeline(self.raw_data_dir)
        data = pipeline.run()

        self.restaurants = {r.restaurant_id: r for r in data.restaurants}
        self.customers = {c.customer_id: c for c in data.customers}

        self.orders.clear()
        for o in data.orders:
            ready_t = o.order_time_min + o.preparation_time
            self.orders[o.order_id] = SimOrder(
                order_id=o.order_id,
                restaurant_id=o.restaurant_id,
                customer_id=o.customer_id,
                order_time_min=o.order_time_min,
                preparation_time=o.preparation_time,
                ready_time_min=ready_t,
                deadline_min=o.deadline_min,
                status=OrderStatus.PENDING,
            )

        self.riders.clear()
        for r in data.riders:
            self.riders[r.rider_id] = SimRider(
                rider_id=r.rider_id,
                capacity=r.capacity,
                status=RiderStatus.AVAILABLE,
                current_lat=r.latitude,
                current_lon=r.longitude,
            )

        # Preload initial best plan if available
        best_plan_path = self.processed_data_dir / "best_delivery_plan.json"
        if best_plan_path.exists():
            try:
                import json
                with open(best_plan_path, "r", encoding="utf-8") as f:
                    plan_data = json.load(f)
                if "tours" in plan_data:
                    for r_id, tour_info in plan_data["tours"].items():
                        if r_id in self.riders:
                            rider = self.riders[r_id]
                            stops = tour_info.get("stops", [])
                            assigned = []
                            for s in stops:
                                if s.get("task_type") == "rider_start":
                                    rider.current_lat = float(s.get("lat", rider.current_lat))
                                    rider.current_lon = float(s.get("lon", rider.current_lon))
                                else:
                                    assigned.append(ACOTaskNode(
                                        node_id=s["node_id"],
                                        task_type=s["task_type"],
                                        order_id=s.get("order_id"),
                                        lat=float(s["lat"]),
                                        lon=float(s["lon"]),
                                        ready_time_min=float(s.get("ready_time_min", 0.0) or 0.0),
                                        deadline_min=float(s.get("deadline_min", float("inf")) or float("inf")),
                                    ))
                            rider.assigned_stops = assigned
                            rider.status = RiderStatus.BUSY if assigned else RiderStatus.AVAILABLE
                            for s in assigned:
                                if s.order_id and s.order_id in self.orders:
                                    self.orders[s.order_id].assigned_rider_id = r_id
                            if tour_info.get("road_path"):
                                rider.road_path = tour_info["road_path"]
                            else:
                                self._update_rider_road_path(rider)
            except Exception as e:
                pass

    def start(self) -> None:
        self.is_running = True

    def pause(self) -> None:
        self.is_running = False

    def reset(self) -> None:
        self.is_running = False
        self.sim_time_min = 0.0
        self.closed_edges.clear()
        self.traffic_model.clear_overrides()
        self.event_history.clear()
        self.active_plan = None
        self.last_reopt_time_min = 0.0
        self.last_dispatch_time_min = 0.0
        if self.router:
            self.router.clear_cache()
        self._load_environment()

    def _update_rider_road_path(self, rider: SimRider) -> None:
        """Computes and sets the exact road network coordinate path for a rider's assigned stops."""
        if not rider.assigned_stops:
            rider.road_path = []
            return

        points_to_visit = [(rider.current_lat, rider.current_lon)] + [
            (s.lat, s.lon) for s in rider.assigned_stops
        ]

        # Use OSMRouter for real physical road coordinates
        if self.router and getattr(self.router, "osm_router", None):
            coords, _, _ = self.router.osm_router.get_route_for_stops(points_to_visit)
            if coords and len(coords) >= 2:
                rider.road_path = [[round(pt[0], 6), round(pt[1], 6)] for pt in coords]
                return

        coords: List[List[float]] = []
        for i in range(len(points_to_visit) - 1):
            p1 = points_to_visit[i]
            p2 = points_to_visit[i + 1]
            if self.router:
                route = self.router.find_route_between_coordinates(
                    p1[0], p1[1], p2[0], p2[1], criterion="distance"
                )
                if route and route.path_coordinates:
                    seg_pts = [[round(pt[0], 6), round(pt[1], 6)] for pt in route.path_coordinates]
                else:
                    seg_pts = [[round(p1[0], 6), round(p1[1], 6)], [round(p2[0], 6), round(p2[1], 6)]]
            else:
                seg_pts = [[round(p1[0], 6), round(p1[1], 6)], [round(p2[0], 6), round(p2[1], 6)]]

            if not coords:
                coords.extend(seg_pts)
            else:
                if coords[-1] == seg_pts[0]:
                    coords.extend(seg_pts[1:])
                else:
                    coords.extend(seg_pts)

        rider.road_path = coords

    def _process_rider_stop_arrival(self, rider: SimRider) -> None:
        """Handles arrival at a stop (pickup, dropoff, or rider_start) and updates route."""
        if not rider.assigned_stops:
            rider.road_path = []
            return

        target_stop = rider.assigned_stops[0]

        if target_stop.task_type == "pickup":
            oid = target_stop.order_id
            order = self.orders.get(oid)
            if order:
                order.status = OrderStatus.PICKED_UP
                order.picked_up_at_min = self.sim_time_min
                order.assigned_rider_id = rider.rider_id
                if oid not in rider.carried_orders:
                    rider.carried_orders.append(oid)
            rider.assigned_stops.pop(0)
            if not rider.road_path or len(rider.road_path) < 2:
                self._update_rider_road_path(rider)

        elif target_stop.task_type == "dropoff":
            oid = target_stop.order_id
            order = self.orders.get(oid)
            if order:
                order.status = OrderStatus.DELIVERED
                order.delivered_at_min = self.sim_time_min
                order.is_late = self.sim_time_min > order.deadline_min
                if oid in rider.carried_orders:
                    rider.carried_orders.remove(oid)
                if oid not in rider.orders_delivered:
                    rider.orders_delivered.append(oid)
            rider.assigned_stops.pop(0)
            if not rider.road_path or len(rider.road_path) < 2:
                self._update_rider_road_path(rider)

        elif target_stop.task_type == "rider_start":
            rider.assigned_stops.pop(0)
            if not rider.road_path or len(rider.road_path) < 2:
                self._update_rider_road_path(rider)

    def step(self, delta_time_min: Optional[float] = None) -> Dict[str, Any]:
        """Advances simulation by delta_time_min and updates rider/order progress."""
        dt = delta_time_min if delta_time_min is not None else self.time_step_min
        self.sim_time_min = round(self.sim_time_min + dt, 2)

        # 1. Update order kitchen preparation statuses
        for order in self.orders.values():
            if order.status == OrderStatus.PENDING:
                if self.sim_time_min >= order.order_time_min:
                    order.status = OrderStatus.PREPARING
            elif order.status == OrderStatus.PREPARING:
                if self.sim_time_min >= order.ready_time_min:
                    order.status = OrderStatus.READY

        # 2. Advance riders along the road network toward their next assigned stops
        avg_speed_kmh = 35.0

        for rider in self.riders.values():
            if rider.status == RiderStatus.UNAVAILABLE or not rider.assigned_stops:
                continue

            if not rider.road_path or len(rider.road_path) < 2:
                self._update_rider_road_path(rider)

            if not rider.road_path or len(rider.road_path) < 2:
                target_stop = rider.assigned_stops[0]
                rider.current_lat = target_stop.lat
                rider.current_lon = target_stop.lon
                self._process_rider_stop_arrival(rider)
                continue

            speed = self.traffic_model.get_effective_speed(avg_speed_kmh)
            travel_dist = (speed / 60.0) * dt

            while travel_dist > 1e-6 and len(rider.road_path) >= 2:
                next_pt = rider.road_path[1]
                seg_dist = haversine_distance_km(
                    rider.current_lat, rider.current_lon, next_pt[0], next_pt[1]
                )

                if seg_dist <= travel_dist:
                    travel_dist -= seg_dist
                    rider.total_distance_km += seg_dist
                    rider.current_lat = next_pt[0]
                    rider.current_lon = next_pt[1]
                    rider.road_path.pop(0)
                    rider.road_path[0] = [rider.current_lat, rider.current_lon]

                    # Check if reached target stop
                    if rider.assigned_stops:
                        target_stop = rider.assigned_stops[0]
                        dist_to_stop = haversine_distance_km(
                            rider.current_lat, rider.current_lon, target_stop.lat, target_stop.lon
                        )
                        if dist_to_stop <= 0.08 or len(rider.road_path) <= 1:
                            rider.current_lat = target_stop.lat
                            rider.current_lon = target_stop.lon
                            self._process_rider_stop_arrival(rider)
                            break
                else:
                    if seg_dist > 1e-6:
                        ratio = travel_dist / seg_dist
                        rider.current_lat += (next_pt[0] - rider.current_lat) * ratio
                        rider.current_lon += (next_pt[1] - rider.current_lon) * ratio
                        rider.total_distance_km += travel_dist
                        rider.road_path[0] = [round(rider.current_lat, 6), round(rider.current_lon, 6)]
                        travel_dist = 0.0

                        if rider.assigned_stops:
                            target_stop = rider.assigned_stops[0]
                            dist_to_stop = haversine_distance_km(
                                rider.current_lat, rider.current_lon, target_stop.lat, target_stop.lon
                            )
                            if dist_to_stop <= 0.05:
                                rider.current_lat = target_stop.lat
                                rider.current_lon = target_stop.lon
                                self._process_rider_stop_arrival(rider)
                    else:
                        rider.road_path.pop(0)

            rider.status = RiderStatus.BUSY if (rider.assigned_stops or rider.carried_orders) else RiderStatus.AVAILABLE

        # 3. Dynamic continuous dispatching for remaining unassigned orders
        if self.is_running or self.active_plan is not None:
            unassigned_orders = [
                o for o in self.orders.values()
                if o.assigned_rider_id is None
                and o.status in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY)
            ]

            if unassigned_orders:
                idle_riders = [
                    r for r in self.riders.values()
                    if r.status != RiderStatus.UNAVAILABLE and not r.assigned_stops and not r.carried_orders
                ]

                total_active = len([r for r in self.riders.values() if r.status != RiderStatus.UNAVAILABLE])
                should_dispatch = False

                if idle_riders:
                    if len(idle_riders) >= 4:
                        should_dispatch = True
                    elif len(unassigned_orders) <= len(idle_riders):
                        should_dispatch = True
                    elif len(idle_riders) == total_active:
                        should_dispatch = True
                    elif (self.sim_time_min - self.last_dispatch_time_min) >= 8.0:
                        should_dispatch = True

                if should_dispatch:
                    total_cap = sum(r.capacity for r in idle_riders)
                    batch_size = min(len(unassigned_orders), total_cap)
                    if batch_size > 0:
                        batch = unassigned_orders[:batch_size]
                        self.dispatch_batch(batch, idle_riders, aco_ants=8, aco_iterations=10)

        return self.get_snapshot()

    # Dynamic Event Handlers
    def trigger_event(self, event: SimEvent) -> Dict[str, Any]:
        """Dispatches an incoming event and triggers re-optimization if necessary."""
        self.event_history.append(event)
        result_msg = ""

        if event.event_type == EventType.NEW_ORDER:
            result_msg = self._handle_new_order(event.payload)
        elif event.event_type == EventType.TRAFFIC_CHANGE:
            result_msg = self._handle_traffic_change(event.payload)
        elif event.event_type == EventType.ROAD_CLOSURE:
            result_msg = self._handle_road_closure(event.payload)
        elif event.event_type == EventType.RIDER_UNAVAILABLE:
            result_msg = self._handle_rider_unavailable(event.payload)
        elif event.event_type == EventType.RIDER_AVAILABLE:
            result_msg = self._handle_rider_available(event.payload)

        # Trigger dynamic re-optimization
        if event.requires_reoptimization:
            self.reoptimize(aco_ants=4, aco_iterations=4, max_orders=8)

        return {"event": event.to_dict(), "message": result_msg, "snapshot": self.get_snapshot()}

    def _handle_new_order(self, payload: Dict[str, Any]) -> str:
        oid = payload.get("order_id", f"ORD_DYN_{len(self.orders) + 1:04d}")
        rest_id = payload["restaurant_id"]
        cust_id = payload["customer_id"]
        prep_time = int(payload.get("preparation_time", 15))
        lead_time = int(payload.get("delivery_lead_time_min", 35))

        order = SimOrder(
            order_id=oid,
            restaurant_id=rest_id,
            customer_id=cust_id,
            order_time_min=self.sim_time_min,
            preparation_time=prep_time,
            ready_time_min=self.sim_time_min + prep_time,
            deadline_min=self.sim_time_min + prep_time + lead_time,
            status=OrderStatus.PENDING,
        )
        self.orders[oid] = order
        return f"New order {oid} added to system at t={self.sim_time_min:.1f}m."

    def _handle_traffic_change(self, payload: Dict[str, Any]) -> str:
        edge_id = payload["edge_id"]
        level = TrafficLevel(payload["traffic_level"])
        self.traffic_model.set_edge_traffic(edge_id, level)
        if self.router:
            self.router.clear_cache()
        return f"Traffic on edge {edge_id} updated to {level.value}."

    def _handle_road_closure(self, payload: Dict[str, Any]) -> str:
        edge_id = payload["edge_id"]
        self.closed_edges.add(edge_id)
        # Severe slowdown effectively blocks traversal
        self.traffic_model.set_edge_traffic(edge_id, TrafficLevel.SEVERE)
        if self.router:
            self.router.clear_cache()
        return f"Road closure active on edge {edge_id}."

    def _handle_rider_unavailable(self, payload: Dict[str, Any]) -> str:
        rider_id = payload["rider_id"]
        rider = self.riders.get(rider_id)
        if not rider:
            return f"Rider {rider_id} not found."

        rider.status = RiderStatus.UNAVAILABLE
        # Extract and unassign uncompleted stops
        uncompleted_order_ids = [
            s.order_id for s in rider.assigned_stops if s.order_id and s.task_type == "pickup"
        ]
        for oid in uncompleted_order_ids:
            if oid in self.orders:
                self.orders[oid].assigned_rider_id = None
                if self.orders[oid].status == OrderStatus.PICKED_UP:
                    self.orders[oid].status = OrderStatus.READY

        rider.assigned_stops.clear()
        return f"Rider {rider_id} is now UNAVAILABLE. Unfulfilled orders unassigned."

    def _handle_rider_available(self, payload: Dict[str, Any]) -> str:
        rider_id = payload["rider_id"]
        rider = self.riders.get(rider_id)
        if rider:
            rider.status = RiderStatus.AVAILABLE
            return f"Rider {rider_id} is now AVAILABLE."
        return f"Rider {rider_id} not found."

    def dispatch_batch(
        self,
        orders_to_dispatch: List[SimOrder],
        available_riders: List[SimRider],
        aco_ants: int = 8,
        aco_iterations: int = 10,
    ) -> Optional[DeliveryPlan]:
        """Dispatches and routes a batch of orders to available couriers using ACO."""
        if not orders_to_dispatch or not available_riders:
            return None

        orders_to_dispatch = sorted(orders_to_dispatch, key=lambda o: (o.order_time_min, o.deadline_min))

        batch_orders = [
            ProcessedOrder(
                order_id=o.order_id,
                restaurant_id=o.restaurant_id,
                customer_id=o.customer_id,
                order_time=f"t={o.order_time_min}m",
                order_time_min=o.order_time_min,
                preparation_time=o.preparation_time,
                deadline=f"t={o.deadline_min}m",
                deadline_min=o.deadline_min,
                order_status=o.status.value,
            )
            for o in orders_to_dispatch
        ]

        batch_riders = [
            ProcessedRider(
                rider_id=r.rider_id,
                latitude=r.current_lat,
                longitude=r.current_lon,
                capacity=max(1, r.capacity - len(r.carried_orders)),
                status="AVAILABLE",
            )
            for r in available_riders
        ]

        aco_cfg = ACOConfig(
            num_ants=aco_ants,
            num_iterations=aco_iterations,
            random_seed=42,
            alpha=self.config.alpha,
            beta=self.config.beta,
            evaporation_rate=self.config.evaporation_rate,
        )
        aco = ACOEngine(config=aco_cfg, routing_engine=self.router)
        aco.setup_problem(
            restaurants=list(self.restaurants.values()),
            customers=list(self.customers.values()),
            orders=batch_orders,
            riders=batch_riders,
        )
        result = aco.optimize(verbose=False)
        self.active_plan = result.best_plan
        self.last_reopt_result = result
        self.last_reopt_time_min = self.sim_time_min
        self.last_dispatch_time_min = self.sim_time_min

        assigned_order_ids: Set[str] = set()

        for r_id, tour in result.best_plan.tours.items():
            stops_to_assign = [s for s in tour.stops if s.task_type != "rider_start"]
            if stops_to_assign and r_id in self.riders:
                rider = self.riders[r_id]
                rider.assigned_stops.extend(stops_to_assign)
                rider.status = RiderStatus.BUSY
                for s in stops_to_assign:
                    if s.order_id and s.order_id in self.orders:
                        self.orders[s.order_id].assigned_rider_id = r_id
                        assigned_order_ids.add(s.order_id)
                if getattr(tour, "road_path_coordinates", None):
                    rider.road_path = [[round(pt[0], 6), round(pt[1], 6)] for pt in tour.road_path_coordinates]
                else:
                    self._update_rider_road_path(rider)

        # Fallback allocation for any order in the batch not assigned by ACO
        unserved_orders = [o for o in orders_to_dispatch if o.order_id not in assigned_order_ids]
        if unserved_orders:
            affected_riders = set()
            for o in unserved_orders:
                candidates = [
                    r for r in available_riders
                    if len(r.carried_orders) + len(r.assigned_stops) // 2 < r.capacity * 2
                ]
                if not candidates:
                    candidates = available_riders
                if candidates:
                    rest = self.restaurants.get(o.restaurant_id)
                    cust = self.customers.get(o.customer_id)
                    if rest and cust:
                        best_cand = min(
                            candidates,
                            key=lambda r: (
                                len(r.assigned_stops),
                                haversine_distance_km(r.current_lat, r.current_lon, rest.latitude, rest.longitude),
                            ),
                        )
                        p_node = ACOTaskNode(
                            node_id=f"P_{o.order_id}",
                            task_type="pickup",
                            order_id=o.order_id,
                            lat=rest.latitude,
                            lon=rest.longitude,
                            ready_time_min=o.order_time_min,
                            deadline_min=o.deadline_min,
                        )
                        d_node = ACOTaskNode(
                            node_id=f"D_{o.order_id}",
                            task_type="dropoff",
                            order_id=o.order_id,
                            lat=cust.latitude,
                            lon=cust.longitude,
                            ready_time_min=o.order_time_min,
                            deadline_min=o.deadline_min,
                        )
                        best_cand.assigned_stops.extend([p_node, d_node])
                        best_cand.status = RiderStatus.BUSY
                        o.assigned_rider_id = best_cand.rider_id
                        affected_riders.add(best_cand)

            for r in affected_riders:
                self._update_rider_road_path(r)

        return self.active_plan

    def reoptimize(
        self,
        aco_ants: int = 6,
        aco_iterations: int = 6,
        max_orders: Optional[int] = 10,
    ) -> Optional[DeliveryPlan]:
        """Runs ACO with riders starting from their current spatial locations to route remaining orders."""
        active_orders = [
            o for o in self.orders.values()
            if o.status in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY)
            and o.assigned_rider_id is None
        ]

        if not active_orders:
            active_orders = [
                o for o in self.orders.values()
                if o.status in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY)
            ]

        if max_orders is not None and len(active_orders) > max_orders:
            active_orders.sort(key=lambda o: (o.order_time_min, o.deadline_min))
            active_orders = active_orders[:max_orders]

        active_riders = [
            r for r in self.riders.values()
            if r.status != RiderStatus.UNAVAILABLE
        ]

        if not active_orders or not active_riders:
            return None

        return self.dispatch_batch(
            orders_to_dispatch=active_orders,
            available_riders=active_riders,
            aco_ants=aco_ants,
            aco_iterations=aco_iterations,
        )

    def get_snapshot(self) -> Dict[str, Any]:
        """Returns the full live state representation for REST/WebSocket serialization."""
        delivered = [o for o in self.orders.values() if o.status == OrderStatus.DELIVERED]
        in_transit = [o for o in self.orders.values() if o.status == OrderStatus.PICKED_UP]
        pending = [
            o for o in self.orders.values()
            if o.status in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY)
        ]
        late = [o for o in delivered if o.is_late]
        active_riders = [r for r in self.riders.values() if r.status != RiderStatus.UNAVAILABLE]
        total_dist = sum(r.total_distance_km for r in self.riders.values())

        delivery_times = [
            o.delivered_at_min - o.order_time_min for o in delivered
            if o.delivered_at_min is not None
        ]
        avg_delivery_time = round(sum(delivery_times) / len(delivery_times), 2) if delivery_times else 0.0

        return {
            "sim_time_min": self.sim_time_min,
            "is_running": self.is_running,
            "counts": {
                "total_orders": len(self.orders),
                "pending_orders": len(pending),
                "in_transit_orders": len(in_transit),
                "delivered_orders": len(delivered),
                "late_orders": len(late),
                "late_percentage": round((len(late) / len(delivered) * 100.0), 1) if delivered else 0.0,
                "total_riders": len(self.riders),
                "active_riders": len(active_riders),
                "total_distance_km": round(total_dist, 2),
                "avg_delivery_time_min": avg_delivery_time,
            },
            "riders": [r.to_dict() for r in self.riders.values()],
            "orders": [o.to_dict() for o in self.orders.values()],
            "closed_edges": list(self.closed_edges),
            "last_reoptimization_min": self.last_reopt_time_min,
            "events_count": len(self.event_history),
        }
