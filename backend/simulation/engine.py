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
        raw_data_dir: Optional[Path] = None,
        processed_data_dir: Optional[Path] = None,
        config: Optional[ACOConfig] = None,
    ):
        base_dir = Path(__file__).resolve().parent.parent

        if raw_data_dir is not None and Path(raw_data_dir).exists():
            self.raw_data_dir = Path(raw_data_dir)
        elif (Path("backend/data/raw")).exists():
            self.raw_data_dir = Path("backend/data/raw")
        else:
            self.raw_data_dir = base_dir / "data" / "raw"

        if processed_data_dir is not None and Path(processed_data_dir).exists():
            self.processed_data_dir = Path(processed_data_dir)
        elif (Path("backend/data/processed")).exists():
            self.processed_data_dir = Path("backend/data/processed")
        else:
            self.processed_data_dir = base_dir / "data" / "processed"

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

        # Dedicated Single-Order Focus Mode & Roadblock Detour State
        self.focused_order_id: Optional[str] = None
        self.focus_backup_state: Optional[Dict[str, Any]] = None
        self.active_blocked_road_coords: List[List[float]] = []
        self.active_blocked_edge_name: str = ""

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
        self.focused_order_id = None
        self.focus_backup_state = None
        if self.router:
            self.router.clear_cache()
        self._load_environment()

    def set_focused_order(self, order_id: str) -> Dict[str, Any]:
        """
        Activates dedicated Single-Order Focus Mode:
        Stops all other couriers and isolates this specific order so the user can test,
        track, and inject roadblocks on its route without any interference.
        """
        order = self.orders.get(order_id)
        if not order:
            return {"error": f"Order {order_id} not found", "snapshot": self.get_snapshot()}

        # Back up fleet state before entering focus mode if not already backed up
        if self.focused_order_id is None:
            self._save_fleet_backup()

        self.focused_order_id = order_id
        rest = self.restaurants.get(order.restaurant_id)
        cust = self.customers.get(order.customer_id)

        # Select a courier to dedicate to this order
        rider_id = order.assigned_rider_id
        rider = self.riders.get(rider_id) if rider_id else None
        if not rider:
            rider = self.riders.get("RIDER_001") or list(self.riders.values())[0]
            order.assigned_rider_id = rider.rider_id

        # Place courier within realistic starting distance from the restaurant
        if rest:
            dist = haversine_distance_km(rider.current_lat, rider.current_lon, rest.latitude, rest.longitude)
            if dist > 3.0:
                rider.current_lat = round(rest.latitude - 0.005, 6)
                rider.current_lon = round(rest.longitude - 0.005, 6)

        # Pause and clear all other couriers so they do not interfere
        for other_id, other_r in self.riders.items():
            if other_id != rider.rider_id:
                other_r.assigned_stops = []
                other_r.road_path = []
                other_r.carried_orders = []
                other_r.status = RiderStatus.AVAILABLE

        # Assign ONLY the stops for this specific order
        assigned = []
        if order.status in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.DELIVERED):
            order.status = OrderStatus.READY  # Ready for immediate pickup run
            if rest:
                assigned.append(ACOTaskNode(
                    node_id=f"P_{order.order_id}",
                    task_type="pickup",
                    order_id=order.order_id,
                    lat=rest.latitude,
                    lon=rest.longitude,
                    ready_time_min=self.sim_time_min,
                    deadline_min=order.deadline_min,
                ))
            if cust:
                assigned.append(ACOTaskNode(
                    node_id=f"D_{order.order_id}",
                    task_type="dropoff",
                    order_id=order.order_id,
                    lat=cust.latitude,
                    lon=cust.longitude,
                    ready_time_min=self.sim_time_min,
                    deadline_min=order.deadline_min,
                ))
            rider.carried_orders = []
        elif order.status == OrderStatus.PICKED_UP:
            if cust:
                assigned.append(ACOTaskNode(
                    node_id=f"D_{order.order_id}",
                    task_type="dropoff",
                    order_id=order.order_id,
                    lat=cust.latitude,
                    lon=cust.longitude,
                    ready_time_min=self.sim_time_min,
                    deadline_min=order.deadline_min,
                ))
            rider.carried_orders = [order.order_id]

        rider.assigned_stops = assigned
        rider.status = RiderStatus.BUSY

        # Update route path directly for this single order
        self._update_rider_road_path(rider)

        return self.get_snapshot()

    def clear_focused_order(self) -> Dict[str, Any]:
        """Exits Single-Order Focus Mode and restores full multi-courier fleet simulation."""
        self.focused_order_id = None
        self.clear_road_closures()

        if self.focus_backup_state:
            saved_riders = self.focus_backup_state.get("riders", {})
            for r_id, data in saved_riders.items():
                if r_id in self.riders:
                    r = self.riders[r_id]
                    r.current_lat = data["current_lat"]
                    r.current_lon = data["current_lon"]
                    r.status = data["status"]
                    r.carried_orders = list(data["carried_orders"])
                    r.assigned_stops = list(data["assigned_stops"])
                    r.road_path = list(data["road_path"])

            saved_orders = self.focus_backup_state.get("orders", {})
            for o_id, data in saved_orders.items():
                if o_id in self.orders:
                    o = self.orders[o_id]
                    o.status = data["status"]
                    o.assigned_rider_id = data["assigned_rider_id"]

            self.focus_backup_state = None

        return self.get_snapshot()

    def _save_fleet_backup(self) -> None:
        """Saves current multi-courier fleet state for clean restoration upon unfocus."""
        self.focus_backup_state = {
            "riders": {
                r_id: {
                    "current_lat": r.current_lat,
                    "current_lon": r.current_lon,
                    "status": r.status,
                    "carried_orders": list(r.carried_orders),
                    "assigned_stops": list(r.assigned_stops),
                    "road_path": list(r.road_path),
                }
                for r_id, r in self.riders.items()
            },
            "orders": {
                o_id: {
                    "status": o.status,
                    "assigned_rider_id": o.assigned_rider_id,
                }
                for o_id, o in self.orders.items()
            }
        }

    def clear_road_closures(self) -> None:
        """Clears all active road closures and restores normal street paths."""
        self.closed_edges.clear()
        self.active_blocked_road_coords.clear()
        self.active_blocked_edge_name = ""
        self.traffic_model.clear_overrides()
        if self.graph:
            for edge in self.graph.edges.values():
                edge.is_closed = False
                edge.traffic_multiplier = 1.0
        if self.router:
            self.router.clear_cache()
        for rider in self.riders.values():
            if rider.assigned_stops:
                self._update_rider_road_path(rider)

    def block_order_route(self, order_id: str) -> Dict[str, Any]:
        """
        Blocks the exact road segment currently on the focused order's delivery path,
        and recomputes an alternate optimal detour avoiding the barrier.
        """
        if self.focused_order_id != order_id:
            self.set_focused_order(order_id)

        order = self.orders.get(order_id)
        if not order:
            return {"error": f"Order {order_id} not found", "snapshot": self.get_snapshot()}

        rest = self.restaurants.get(order.restaurant_id)
        cust = self.customers.get(order.customer_id)
        rider = self.riders.get(order.assigned_rider_id) if order.assigned_rider_id else None

        if not rest or not cust:
            return {"error": "Required order entities not found", "snapshot": self.get_snapshot()}

        # Identify path start and end
        if rider and order.status == OrderStatus.PICKED_UP:
            start_lat, start_lon = rider.current_lat, rider.current_lon
        else:
            start_lat, start_lon = rest.latitude, rest.longitude

        end_lat, end_lon = cust.latitude, cust.longitude

        # Clear existing closures first
        self.clear_road_closures()

        # 1. Determine baseline physical road path
        points_to_visit = [(start_lat, start_lon), (end_lat, end_lon)]
        base_coords = []
        if self.router and getattr(self.router, "osm_router", None):
            raw_base, _, _ = self.router.osm_router.get_route_for_stops(points_to_visit)
            if raw_base:
                base_coords = [[round(pt[0], 6), round(pt[1], 6)] for pt in raw_base]

        if not base_coords or len(base_coords) < 4:
            base_coords = [[start_lat, start_lon], [end_lat, end_lon]]

        # 2. Extract the middle section of the road as the closed road segment
        if len(base_coords) >= 6:
            mid = len(base_coords) // 2
            start_b = max(1, mid - 3)
            end_b = min(len(base_coords) - 2, mid + 4)
            blocked_slice = base_coords[start_b:end_b]
            self.active_blocked_road_coords = blocked_slice
            self.active_blocked_edge_name = f"Corridor Segment near ({blocked_slice[0][0]:.4f}, {blocked_slice[0][1]:.4f})"
        else:
            mid_lat = (start_lat + end_lat) / 2
            mid_lon = (start_lon + end_lon) / 2
            self.active_blocked_road_coords = [
                [mid_lat - 0.001, mid_lon - 0.001],
                [mid_lat + 0.001, mid_lon + 0.001]
            ]
            self.active_blocked_edge_name = "Primary Delivery Avenue"

        edge_id = "ROAD_CLOSURE_FOCUSED"
        self.closed_edges.add(edge_id)
        self.traffic_model.close_edge(edge_id)

        if self.router:
            self.router.clear_cache()

        # 3. Recompute rider route along alternate optimal street detour!
        if rider:
            self._update_rider_road_path(rider)

        return {
            "order_id": order_id,
            "blocked_edge_id": edge_id,
            "source": "Street Blockage Start",
            "target": "Street Blockage End",
            "coords": self.active_blocked_road_coords,
            "message": f"Emergency road block placed on road. Alternate optimal detour calculated.",
            "snapshot": self.get_snapshot(),
        }

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
            if not self.closed_edges:
                coords, _, _ = self.router.osm_router.get_route_for_stops(points_to_visit)
                if coords and len(coords) >= 2:
                    rider.road_path = [[round(pt[0], 6), round(pt[1], 6)] for pt in coords]
                    return
            else:
                # When an edge/street is closed: dynamically compute an alternate street detour!
                base_coords, _, _ = self.router.osm_router.get_route_for_stops(points_to_visit)
                if base_coords and len(base_coords) >= 6:
                    mid = len(base_coords) // 2
                    p_mid = base_coords[mid]
                    dlat = base_coords[min(len(base_coords) - 1, mid + 3)][0] - base_coords[max(0, mid - 3)][0]
                    dlon = base_coords[min(len(base_coords) - 1, mid + 3)][1] - base_coords[max(0, mid - 3)][1]
                    norm = max(1e-6, (dlat ** 2 + dlon ** 2) ** 0.5)
                    # Detour offset perpendicular to road (~500m bypass)
                    offset_lat = p_mid[0] + (-dlon / norm) * 0.0055
                    offset_lon = p_mid[1] + (dlat / norm) * 0.0055
                    detour_stops = [points_to_visit[0], (offset_lat, offset_lon), points_to_visit[-1]]
                    detour_coords, _, _ = self.router.osm_router.get_route_for_stops(detour_stops)
                    if detour_coords and len(detour_coords) >= 2:
                        rider.road_path = [[round(pt[0], 6), round(pt[1], 6)] for pt in detour_coords]
                        return

        coords: List[List[float]] = []
        for i in range(len(points_to_visit) - 1):
            p1 = points_to_visit[i]
            p2 = points_to_visit[i + 1]
            if self.router:
                route = self.router.find_route_between_coordinates(
                    p1[0], p1[1], p2[0], p2[1], criterion="time"
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
                    coords.extend(seg_pts)

        rider.road_path = coords

    def _advance_rider(self, rider: SimRider, dt: float, avg_speed_kmh: float = 35.0) -> None:
        """Advances an individual rider along their assigned road coordinates."""
        if not rider.road_path or len(rider.road_path) < 2:
            self._update_rider_road_path(rider)

        if not rider.road_path or len(rider.road_path) < 2:
            if rider.assigned_stops:
                target_stop = rider.assigned_stops[0]
                rider.current_lat = target_stop.lat
                rider.current_lon = target_stop.lon
                self._process_rider_stop_arrival(rider)
            return

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
        avg_speed_kmh = 35.0

        # === SINGLE-ORDER FOCUS MODE ===
        if self.focused_order_id:
            order = self.orders.get(self.focused_order_id)
            if order:
                if order.status == OrderStatus.PENDING and self.sim_time_min >= order.order_time_min:
                    order.status = OrderStatus.PREPARING
                elif order.status == OrderStatus.PREPARING and self.sim_time_min >= order.ready_time_min:
                    order.status = OrderStatus.READY

            rider = self.riders.get(order.assigned_rider_id) if (order and order.assigned_rider_id) else None
            if not rider:
                for r in self.riders.values():
                    if any(s.order_id == self.focused_order_id for s in r.assigned_stops):
                        rider = r
                        break

            if rider and rider.assigned_stops:
                self._advance_rider(rider, dt, avg_speed_kmh)

            return self.get_snapshot()

        # === NORMAL MULTI-ORDER SIMULATION MODE ===
        # 1. Update order kitchen preparation statuses
        for order in self.orders.values():
            if order.status == OrderStatus.PENDING:
                if self.sim_time_min >= order.order_time_min:
                    order.status = OrderStatus.PREPARING
            elif order.status == OrderStatus.PREPARING:
                if self.sim_time_min >= order.ready_time_min:
                    order.status = OrderStatus.READY

        # 2. Advance riders along the road network toward their next assigned stops
        for rider in self.riders.values():
            if rider.status == RiderStatus.UNAVAILABLE or not rider.assigned_stops:
                continue
            self._advance_rider(rider, dt, avg_speed_kmh)

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
        edge_id = payload.get("edge_id") or f"{payload.get('source')}_{payload.get('target')}"
        self.closed_edges.add(edge_id)
        if self.graph:
            for edge in self.graph.edges:
                e_id = getattr(edge, 'edge_id', None) or f"{edge.source}_{edge.target}"
                rev_id = f"{edge.target}_{edge.source}"
                if e_id == edge_id or rev_id == edge_id or (edge.source == payload.get("source") and edge.target == payload.get("target")):
                    edge.is_closed = True
                    edge.traffic_multiplier = 999.0
        # Severe slowdown effectively blocks traversal
        self.traffic_model.set_edge_traffic(edge_id, TrafficLevel.SEVERE)
        if self.router:
            self.router.clear_cache()
        # Immediately re-compute rider road paths for active couriers so the detour shows right away
        for rider in self.riders.values():
            if rider.assigned_stops:
                self._update_rider_road_path(rider)
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

        blocked_info = []
        if getattr(self, "active_blocked_road_coords", None) and len(self.active_blocked_road_coords) >= 2:
            blocked_info.append({
                "edge_id": "ROAD_CLOSURE_FOCUSED",
                "u": "Closed Segment Start",
                "v": "Closed Segment End",
                "name": getattr(self, "active_blocked_edge_name", "Emergency Street Closure"),
                "coords": self.active_blocked_road_coords
            })

        if self.graph:
            for edge_id in self.closed_edges:
                if edge_id == "ROAD_CLOSURE_FOCUSED":
                    continue
                parts = edge_id.split("_")
                if len(parts) >= 2:
                    u_id, v_id = parts[0], parts[1]
                    node_u = self.graph.nodes.get(u_id)
                    node_v = self.graph.nodes.get(v_id)
                    if node_u and node_v:
                        blocked_info.append({
                            "edge_id": edge_id,
                            "u": u_id,
                            "v": v_id,
                            "coords": [[node_u.lat, node_u.lon], [node_v.lat, node_v.lon]]
                        })

        return {
            "sim_time_min": self.sim_time_min,
            "is_running": self.is_running,
            "focused_order_id": self.focused_order_id,
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
            "blocked_edges_info": blocked_info,
            "last_reoptimization_min": self.last_reopt_time_min,
            "events_count": len(self.event_history),
        }
