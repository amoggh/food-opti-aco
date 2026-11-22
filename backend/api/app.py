"""FastAPI backend service for food delivery simulation and ACO optimization."""
import asyncio
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

# Ensure project root is in sys.path regardless of execution directory
_project_root = Path(__file__).resolve().parent.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.config.aco_config import ACOConfig
from backend.routing.traffic import TrafficLevel
from backend.simulation.engine import SimulationEngine
from backend.simulation.events import EventType, SimEvent
from backend.api.schemas import (
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global sim_engine
    # Initialize simulation engine with processed benchmark data
    sim_engine = SimulationEngine()
    yield
    active_websockets.clear()


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
    payload = {"type": "SIM_STATE_UPDATE", "state": state, **state}
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
    if not sim_engine.active_plan:
        sim_engine.reoptimize(aco_ants=12, aco_iterations=15)
    sim_engine.start()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "Simulation started", "snapshot": snapshot, "state": snapshot, **snapshot}


@app.post("/api/simulation/pause")
async def pause_simulation():
    sim_engine.pause()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "Simulation paused", "snapshot": snapshot, "state": snapshot, **snapshot}


@app.post("/api/simulation/reset")
async def reset_simulation():
    sim_engine.reset()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "Simulation reset to initial state", "snapshot": snapshot, "state": snapshot, **snapshot}


@app.post("/api/simulation/step")
async def step_simulation(req: Optional[SimulationStepRequest] = None):
    dt = req.get_dt() if req else 1.0
    snapshot = sim_engine.step(delta_time_min=dt)
    await broadcast_state(snapshot)
    return {"snapshot": snapshot, "state": snapshot, **snapshot}


@app.get("/api/simulation/state")
def get_simulation_state():
    return sim_engine.get_snapshot()


# --- Dynamic Simulation Events ---
@app.post("/api/simulation/events/new-order")
async def trigger_new_order(req: NewOrderRequest):
    event = SimEvent(
        event_id=f"EVT_ORDER_{len(sim_engine.event_history) + 1}",
        event_type=EventType.NEW_ORDER,
        timestamp_min=sim_engine.sim_time_min,
        payload=req.model_dump(),
        requires_reoptimization=True,
    )
    result = sim_engine.trigger_event(event)
    await broadcast_state(result["snapshot"])
    return result


@app.post("/api/simulation/events/traffic")
async def trigger_traffic_change(req: TrafficEventRequest):
    if req.traffic_level not in [t.value for t in TrafficLevel]:
        raise HTTPException(status_code=400, detail=f"Invalid traffic level: {req.traffic_level}")
    event = SimEvent(
        event_id=f"EVT_TRAFFIC_{len(sim_engine.event_history) + 1}",
        event_type=EventType.TRAFFIC_CHANGE,
        timestamp_min=sim_engine.sim_time_min,
        payload=req.model_dump(),
        requires_reoptimization=True,
    )
    result = sim_engine.trigger_event(event)
    await broadcast_state(result["snapshot"])
    return result


@app.post("/api/simulation/events/road-closure")
async def trigger_road_closure(req: RoadClosureRequest):
    edge_id = req.get_edge_id()
    event = SimEvent(
        event_id=f"EVT_CLOSURE_{len(sim_engine.event_history) + 1}",
        event_type=EventType.ROAD_CLOSURE,
        timestamp_min=sim_engine.sim_time_min,
        payload={"edge_id": edge_id, "source": req.source, "target": req.target},
        requires_reoptimization=True,
    )
    result = sim_engine.trigger_event(event)
    await broadcast_state(result["snapshot"])
    return result


@app.post("/api/simulation/focus-order")
async def focus_order(payload: Dict[str, Any]):
    order_id = payload.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")
    snapshot = sim_engine.set_focused_order(order_id)
    await broadcast_state(snapshot)
    return {"message": f"Focused on order {order_id}", "snapshot": snapshot, "state": snapshot, **snapshot}


@app.post("/api/simulation/unfocus-order")
async def unfocus_order():
    snapshot = sim_engine.clear_focused_order()
    await broadcast_state(snapshot)
    return {"message": "Focus cleared, returned to full fleet mode", "snapshot": snapshot, "state": snapshot, **snapshot}


@app.post("/api/simulation/events/block-order-route")
async def block_order_route(payload: Dict[str, Any]):
    order_id = payload.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")
    res = sim_engine.block_order_route(order_id)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    await broadcast_state(res.get("snapshot", {}))
    return res


@app.post("/api/simulation/events/clear-closures")
async def clear_road_closures():
    sim_engine.clear_road_closures()
    snapshot = sim_engine.get_snapshot()
    await broadcast_state(snapshot)
    return {"message": "All road closures cleared", "snapshot": snapshot, "state": snapshot, **snapshot}


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
    result = sim_engine.trigger_event(event)
    await broadcast_state(result["snapshot"])
    return result


# --- Optimization & Metrics Endpoints ---
@app.post("/api/optimization/run")
async def run_optimization(req: Optional[OptimizationRunRequest] = None):
    ants = req.num_ants if req else 12
    iters = req.get_iterations() if req else 15
    plan = sim_engine.reoptimize(aco_ants=ants, aco_iterations=iters)
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

    return {
        "message": "Optimization completed",
        "plan": plan_dict,
        "best_plan": plan_dict,
        "best_cost": best_cost,
        "convergence_history": conv_hist,
        "snapshot": snapshot,
        "state": snapshot,
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
        await websocket.send_json({"type": "SIM_STATE_UPDATE", "state": snap, **snap})
        while True:
            data = await websocket.receive_json()
            cmd = data.get("command") or data.get("action")
            if cmd == "step":
                dt = data.get("delta_time_min", 1.0)
                snapshot = sim_engine.step(delta_time_min=dt)
                await broadcast_state(snapshot)
            elif cmd == "start":
                if not sim_engine.active_plan:
                    sim_engine.reoptimize(aco_ants=12, aco_iterations=15)
                sim_engine.start()
                await broadcast_state(sim_engine.get_snapshot())
            elif cmd == "pause":
                sim_engine.pause()
                await broadcast_state(sim_engine.get_snapshot())
            elif cmd == "reset":
                sim_engine.reset()
                await broadcast_state(sim_engine.get_snapshot())
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception:
        active_websockets.discard(websocket)
