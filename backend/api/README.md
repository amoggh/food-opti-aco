# API Module

This module houses the FastAPI backend service providing REST interfaces and real-time WebSocket communication for the delivery simulation and ACO optimization system.

## Features

- **CORS Enabled**: Configured for local development (`allow_origins=["*"]`) to seamlessly interface with frontend dashboards.
- **REST Endpoints**:
  - `GET /api/health`: System health and status check.
  - `GET /api/restaurants`: List all registered restaurant locations.
  - `GET /api/customers`: List customer delivery destinations.
  - `GET /api/orders`: Query orders with status, ready times, and deadlines.
  - `GET /api/riders`: Courier fleet roster and capacity profiles.
  - `GET /api/graph`: Road network topology (nodes, edges, traffic speed multipliers).
  - `POST /api/simulation/start`: Launch simulation execution.
  - `POST /api/simulation/pause`: Pause active simulation execution.
  - `POST /api/simulation/step`: Advance simulation clock by `dt_minutes`.
  - `POST /api/simulation/reset`: Reset simulation clock, orders, and courier states.
  - `GET /api/simulation/state`: Retrieve complete snapshot of couriers, orders, and telemetry.
  - `POST /api/simulation/events/order`: Inject a new urgent delivery order dynamically.
  - `POST /api/simulation/events/traffic`: Apply localized traffic congestion to road segments.
  - `POST /api/simulation/events/road-closure`: Simulate road closures or blockages.
  - `POST /api/simulation/events/rider-unavailable`: Mark courier breakdown/unavailability and trigger re-dispatch.
  - `POST /api/optimization/run`: Execute full or dynamic ACO route optimization on demand.
  - `GET /api/optimization/metrics`: Retrieve latest delivery performance telemetry and baseline comparisons.
- **WebSocket Protocol**:
  - `ws://localhost:8000/api/ws/simulation`
  - Accepts incoming client control commands (`step`, `start`, `pause`, `reset`).
  - Broadcasts live simulation state snapshots (`SIM_STATE_UPDATE`) and notifications.

## Running the Server

Start the API server locally using Uvicorn:

```bash
uvicorn backend.api.app:app --reload --port 8000
```

Interactive API documentation will be accessible at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
