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
        self._load_environment()

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

        # 2. Advance riders toward their next assigned stop
        avg_speed_kmh = 35.0

        for rider in self.riders.values():
            if rider.status == RiderStatus.UNAVAILABLE or not rider.assigned_stops:
                continue

            target_stop = rider.assigned_stops[0]
            dist_to_target = haversine_distance_km(
                rider.current_lat, rider.current_lon, target_stop.lat, target_stop.lon
            )

            # Move distance in delta time
            speed = self.traffic_model.get_effective_speed(avg_speed_kmh)
            travel_dist = (speed / 60.0) * dt

            if dist_to_target <= travel_dist:
                # Rider reached target stop
                rider.current_lat = target_stop.lat
                rider.current_lon = target_stop.lon
                rider.total_distance_km += dist_to_target

                # Process stop action
                if target_stop.task_type == "pickup":
                    oid = target_stop.order_id
                    order = self.orders.get(oid)
                    # Rider picks up meal if ready
                    if order and order.status in (OrderStatus.READY, OrderStatus.PREPARING):
                        order.status = OrderStatus.PICKED_UP
                        order.picked_up_at_min = self.sim_time_min
                        order.assigned_rider_id = rider.rider_id
                        rider.carried_orders.append(oid)
                        rider.assigned_stops.pop(0)

                elif target_stop.task_type == "dropoff":
                    oid = target_stop.order_id
                    order = self.orders.get(oid)
                    if order:
                        order.status = OrderStatus.DELIVERED
                        order.delivered_at_min = self.sim_time_min
                        order.is_late = self.sim_time_min > order.deadline_min
                        if oid in rider.carried_orders:
                            rider.carried_orders.remove(oid)
                        rider.orders_delivered.append(oid)
                    rider.assigned_stops.pop(0)

                elif target_stop.task_type == "rider_start":
                    rider.assigned_stops.pop(0)

            else:
                # Interpolate linear position along segment
                ratio = travel_dist / dist_to_target
                rider.current_lat += (target_stop.lat - rider.current_lat) * ratio
                rider.current_lon += (target_stop.lon - rider.current_lon) * ratio
                rider.total_distance_km += travel_dist

            # Update status
            rider.status = RiderStatus.BUSY if rider.assigned_stops or rider.carried_orders else RiderStatus.AVAILABLE

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
            self.reoptimize()

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
        return f"Traffic on edge {edge_id} updated to {level.value}."

    def _handle_road_closure(self, payload: Dict[str, Any]) -> str:
        edge_id = payload["edge_id"]
        self.closed_edges.add(edge_id)
        # Severe slowdown effectively blocks traversal
        self.traffic_model.set_edge_traffic(edge_id, TrafficLevel.SEVERE)
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

    def reoptimize(
        self,
        aco_ants: int = 10,
        aco_iterations: int = 12,
        max_orders: Optional[int] = 30,
    ) -> Optional[DeliveryPlan]:
        """Runs ACO with riders starting from their current spatial locations to route all remaining orders."""
        # Active orders requiring delivery
        active_orders = [
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
            for o in self.orders.values()
            if o.status in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY)
        ]

        if max_orders is not None and len(active_orders) > max_orders:
            active_orders.sort(key=lambda o: (o.order_time_min, o.deadline_min))
            active_orders = active_orders[:max_orders]

        # Available riders with live positions
        active_riders = [
            ProcessedRider(
                rider_id=r.rider_id,
                latitude=r.current_lat,
                longitude=r.current_lon,
                capacity=max(1, r.capacity - len(r.carried_orders)),
                status="AVAILABLE",
            )
            for r in self.riders.values()
            if r.status != RiderStatus.UNAVAILABLE
        ]

        if not active_orders or not active_riders:
            return None

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
            orders=active_orders,
            riders=active_riders,
        )
        result = aco.optimize(verbose=False)
        self.active_plan = result.best_plan
        self.last_reopt_result = result
        self.last_reopt_time_min = self.sim_time_min

        # Re-assign new tour stops to riders
        for r_id, tour in self.active_plan.tours.items():
            if r_id in self.riders:
                # Exclude the dummy rider_start node
                stops_to_assign = [s for s in tour.stops if s.task_type != "rider_start"]
                self.riders[r_id].assigned_stops = stops_to_assign
                for s in stops_to_assign:
                    if s.order_id and s.order_id in self.orders:
                        self.orders[s.order_id].assigned_rider_id = r_id

        return self.active_plan

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
