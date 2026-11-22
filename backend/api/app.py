"""FastAPI backend service for food delivery simulation and ACO optimization."""
import asyncio
import sys
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

# Ensure project root is in sys.path regardless of execution directory
_project_root = Path(__file__).resolve().parent.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from backend.config.aco_config import ACOConfig
from backend.routing.traffic import TrafficLevel
from backend.simulation.engine import SimulationEngine
from backend.simulation.events import EventType, SimEvent
from backend.api.schemas import (
    BlockRoadRequest,
    NewOrderRequest,
    OptimizationRunRequest,
    RiderUnavailableRequest,
    RoadClosureRequest,
    SimulationStepRequest,
    TrafficEventRequest,
)

# Global simulation engine instance
sim_engine: Optional[SimulationEngine] = None
active_websockets: Set[WebSocket] = set()
# Serialises engine mutations; heavy work runs in a worker thread so the event loop stays responsive.
engine_lock = asyncio.Lock()


async def run_engine(fn, *args, **kwargs):
    async with engine_lock:
        return await run_in_threadpool(fn, *args, **kwargs)


def _resolve_edge_id(edge_id: Optional[str], source: Optional[str], target: Optional[str]) -> str:
    """Maps an edge_id or a (source, target) node pair to a real road-graph edge ID, else 404."""
    graph = sim_engine.graph
    if graph and edge_id and edge_id in graph.edges:
        return edge_id
    if graph and source and target:
        edge = graph.get_edge(source, target) or graph.get_edge(target, source)
        if edge:
            return edge.edge_id
    raise HTTPException(
        status_code=404,
        detail=f"No road segment found for edge_id={edge_id!r} source={source!r} target={target!r}.",
    )


def _schedule_warm_start() -> None:
    """Pre-runs the first dispatch in the background so Run starts moving immediately."""
    async def _warm():
        try:
            await run_engine(sim_engine.warm_start)
            await broadcast_state(sim_engine.get_snapshot())
        except Exception:
            pass
    asyncio.get_running_loop().create_task(_warm())


def _has_plan() -> bool:
    """True if an ACO plan exists or riders already carry a preloaded route."""
    return bool(sim_engine.active_plan) or any(r.assigned_stops for r in sim_engine.riders.values())


@asynccontextmanager
async def lifespan(app: FastAPI):
    global sim_engine
    # Initialize simulation engine with processed benchmark data
    sim_engine = SimulationEngine()
    _schedule_warm_start()
    yield
    active_websockets.clear()
    if sim_engine and sim_engine.router and sim_engine.router.osm_router:
        sim_engine.router.osm_router.save_cache()


app = FastAPI(
    title="Food Delivery Optimization API",
    description="Backend API for Ant Colony Optimization and dynamic food delivery simulation.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for frontend applications (e.g. Vite on localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def broadcast_state(state: Dict[str, Any]):
    """Broadcasts live state snapshots to all connected WebSocket clients."""
    if not active_websockets:
        return
    disconnected = set()
    payload = {"type": "SIM_STATE_UPDATE", "state": state}
    for ws in active_websockets:
        try:
            await ws.send_json(payload)
        except Exception:
            disconnected.add(ws)
    active_websockets.difference_update(disconnected)


# --- Health Endpoint ---
@app.get("/api/health")
def health_check():
    return {"status": "ok", "phase": 5, "sim_running": sim_engine.is_running if sim_engine else False}


# --- Static / Processed Data Endpoints ---
@app.get("/api/restaurants")
def get_restaurants():
    return [asdict(r) for r in sim_engine.restaurants.values()]


@app.get("/api/customers")
def get_customers():
    return [asdict(c) for c in sim_engine.customers.values()]


@app.get("/api/orders")
def get_orders():
    return [o.to_dict() for o in sim_engine.orders.values()]


@app.get("/api/riders")
def get_riders():
    return [r.to_dict() for r in sim_engine.riders.values()]


@app.get("/api/graph")
def get_graph():
    if not sim_engine.graph:
        raise HTTPException(status_code=404, detail="Road graph not initialized.")
    return sim_engine.graph.to_dict()


# --- Simulation Control Endpoints ---
@app.post("/api/simulation/start")
async def start_simulation():
    # If no delivery plan has been computed yet, automatically reoptimize to assign routes
    if not _has_plan():
        await run_engine(sim_engine.reoptimize, aco_ants=12, aco_iterations=15)
    sim_engine.start()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "Simulation started", "snapshot": snapshot}


@app.post("/api/simulation/pause")
async def pause_simulation():
    sim_engine.pause()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "Simulation paused", "snapshot": snapshot}


@app.post("/api/simulation/reset")
async def reset_simulation():
    await run_engine(sim_engine.reset)
    _schedule_warm_start()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "Simulation reset to initial state", "snapshot": snapshot}


@app.post("/api/simulation/step")
async def step_simulation(req: Optional[SimulationStepRequest] = None):
    dt = req.get_dt() if req else 1.0
    snapshot = await run_engine(sim_engine.step, delta_time_min=dt)
    await broadcast_state(snapshot)
    return snapshot


@app.get("/api/simulation/state")
def get_simulation_state():
    return sim_engine.get_snapshot()


# --- Dynamic Simulation Events ---
@app.post("/api/simulation/events/new-order")
async def trigger_new_order(req: NewOrderRequest):
    if req.restaurant_id not in sim_engine.restaurants or req.customer_id not in sim_engine.customers:
        raise HTTPException(status_code=404, detail="Unknown restaurant_id or customer_id.")
    event = SimEvent(
        event_id=f"EVT_ORDER_{len(sim_engine.event_history) + 1}",
        event_type=EventType.NEW_ORDER,
        timestamp_min=sim_engine.sim_time_min,
        payload=req.model_dump(),
        requires_reoptimization=True,
    )
    result = await run_engine(sim_engine.trigger_event, event)
    await broadcast_state(result["snapshot"])
    return result


@app.post("/api/simulation/events/traffic")
async def trigger_traffic_change(req: TrafficEventRequest):
    level = req.get_level()
    if level not in [t.value for t in TrafficLevel]:
        raise HTTPException(status_code=400, detail=f"Invalid traffic level: {level}")
    edge_id = _resolve_edge_id(req.edge_id, req.source, req.target)
    event = SimEvent(
        event_id=f"EVT_TRAFFIC_{len(sim_engine.event_history) + 1}",
        event_type=EventType.TRAFFIC_CHANGE,
        timestamp_min=sim_engine.sim_time_min,
        payload={"edge_id": edge_id, "traffic_level": level},
        requires_reoptimization=bool(req.trigger_reoptimization),
    )
    result = await run_engine(sim_engine.trigger_event, event)
    await broadcast_state(result["snapshot"])
    return result


@app.post("/api/simulation/events/road-closure")
async def trigger_road_closure(req: RoadClosureRequest):
    edge_id = _resolve_edge_id(req.edge_id, req.source, req.target)
    event = SimEvent(
        event_id=f"EVT_CLOSURE_{len(sim_engine.event_history) + 1}",
        event_type=EventType.ROAD_CLOSURE,
        timestamp_min=sim_engine.sim_time_min,
        payload={"edge_id": edge_id},
        requires_reoptimization=bool(req.trigger_reoptimization),
    )
    result = await run_engine(sim_engine.trigger_event, event)
    await broadcast_state(result["snapshot"])
    return result


@app.post("/api/simulation/focus-order")
async def focus_order(payload: Dict[str, Any]):
    order_id = payload.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")
    snapshot = await run_engine(sim_engine.set_focused_order, order_id)
    await broadcast_state(snapshot)
    return {"message": f"Focused on order {order_id}", "snapshot": snapshot}


@app.post("/api/simulation/unfocus-order")
async def unfocus_order():
    snapshot = await run_engine(sim_engine.clear_focused_order)
    await broadcast_state(snapshot)
    return {"message": "Focus cleared, returned to full fleet mode", "snapshot": snapshot}


@app.post("/api/simulation/events/block-order-route")
async def block_order_route(payload: Dict[str, Any]):
    order_id = payload.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")
    res = await run_engine(sim_engine.block_order_route, order_id)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    await broadcast_state(res.get("snapshot", {}))
    return res


@app.post("/api/simulation/events/block-road")
async def block_road(req: BlockRoadRequest):
    t0 = time.perf_counter()
    async with engine_lock:
        t_lock = time.perf_counter()
        res = await run_in_threadpool(sim_engine.block_road_at, req.lat, req.lon, req.rider_id)
    res["timing_s"] = {"waited_for_engine": round(t_lock - t0, 2), "reroute": round(time.perf_counter() - t_lock, 2)}
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    await broadcast_state(res["snapshot"])
    return res


@app.post("/api/simulation/events/clear-closures")
async def clear_road_closures():
    await run_engine(sim_engine.clear_road_closures)
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "All road closures cleared", "snapshot": snapshot}


@app.post("/api/simulation/events/rider-unavailable")
async def trigger_rider_unavailable(req: RiderUnavailableRequest):
    if req.rider_id not in sim_engine.riders:
        raise HTTPException(status_code=404, detail=f"Rider {req.rider_id} not found.")
    event = SimEvent(
        event_id=f"EVT_RIDER_UNAVAIL_{len(sim_engine.event_history) + 1}",
        event_type=EventType.RIDER_UNAVAILABLE,
        timestamp_min=sim_engine.sim_time_min,
        payload=req.model_dump(),
        requires_reoptimization=True,
    )
    result = await run_engine(sim_engine.trigger_event, event)
    await broadcast_state(result["snapshot"])
    return result


# --- Optimization & Metrics Endpoints ---
@app.post("/api/optimization/run")
async def run_optimization(req: Optional[OptimizationRunRequest] = None):
    ants = req.num_ants if req else 12
    iters = req.get_iterations() if req else 15
    overrides = (
        {"alpha": req.alpha, "beta": req.beta, "evaporation_rate": req.evaporation_rate, "random_seed": req.random_seed}
        if req else None
    )
    plan = await run_engine(
        sim_engine.reoptimize,
        aco_ants=ants,
        aco_iterations=iters,
        aco_overrides=overrides,
        local_search_time_limit_s=1.0,
    )
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)

    conv_hist = []
    last_res = getattr(sim_engine, "last_reopt_result", None)
    if last_res and getattr(last_res, "convergence_history", None):
        conv_hist = [
            h.get("best_cost", h.get("cost", 0.0)) if isinstance(h, dict) else float(h)
            for h in last_res.convergence_history
        ]

    plan_dict = plan.to_dict() if plan else None
    best_cost = plan.fitness_cost if plan else 0.0
    ls_entry = getattr(last_res, "local_search_entry", None) if last_res else None

    return {
        "message": "Optimization completed",
        # Cost after the local-search polish step, shown as a separate point after the ant iterations
        "local_search_cost": ls_entry["best_cost"] if ls_entry else None,
        "plan": plan_dict,
        "best_plan": plan_dict,
        "best_cost": best_cost,
        "convergence_history": conv_hist,
        "snapshot": snapshot,
    }


@app.get("/api/optimization/metrics")
def get_optimization_metrics():
    snapshot = sim_engine.get_snapshot()
    return {
        "counts": snapshot["counts"],
        "active_plan": sim_engine.active_plan.to_dict() if sim_engine.active_plan else None,
        "last_reoptimization_min": sim_engine.last_reopt_time_min,
    }


# --- WebSocket Streaming ---
@app.websocket("/api/ws/simulation")
async def websocket_simulation_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    try:
        # Send initial state immediately
        snap = sim_engine.get_snapshot()
        await websocket.send_json({"type": "SIM_STATE_UPDATE", "state": snap})
        while True:
            data = await websocket.receive_json()
            cmd = data.get("command") or data.get("action")
            if cmd == "step":
                dt = data.get("delta_time_min", 1.0)
                snapshot = await run_engine(sim_engine.step, delta_time_min=dt)
                await broadcast_state(snapshot)
            elif cmd == "start":
                if not _has_plan():
                    await run_engine(sim_engine.reoptimize, aco_ants=12, aco_iterations=15)
                sim_engine.start()
                await broadcast_state(sim_engine.get_snapshot())
            elif cmd == "pause":
                sim_engine.pause()
                await broadcast_state(sim_engine.get_snapshot())
            elif cmd == "reset":
                await run_engine(sim_engine.reset)
                _schedule_warm_start()
                await broadcast_state(sim_engine.get_snapshot())
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception:
        active_websockets.discard(websocket)
