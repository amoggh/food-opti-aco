# Food Delivery Optimization Using Ant Colony Optimization

## Overview

This project focuses on solving dynamic food delivery routing and dispatching challenges using Ant Colony Optimization (ACO), a metaheuristic inspired by the foraging behavior of real ants. By simulating artificial ants depositing and following pheromone trails across a road network, the system aims to optimize delivery routes under real-world constraints such as order readiness, delivery time windows, rider capacities, and dynamic traffic fluctuations.

## Main Objective

To model, simulate, and optimize urban food delivery operations by deploying a dynamic Ant Colony Optimization algorithm capable of efficiently assigning and routing multi-order deliveries while minimizing total delivery time, customer wait times, and travel costs.

## Bio-Inspired Algorithm

- **Ant Colony Optimization (ACO)**: Metaheuristic utilized for combinatorial path and schedule optimization on dynamic road graphs, featuring pheromone update rules, distance and traffic-based heuristics, and constraint handling.

## Development Approach

The project follows a phased development roadmap:

- **Phase 1**: Project foundation and synthetic data
- **Phase 2**: Preprocessing, road network, traffic model, and routing
- **Phase 3**: Ant Colony Optimization
- **Phase 4**: Baselines, evaluation, and optional ETA ML model
- **Phase 5**: Dynamic simulation and backend API
- **Phase 6**: Interactive frontend and final integration

---

## Getting Started

### Prerequisites

- **Python 3.10+**
- **Node.js 18+ & npm**

---

### Running the Backend

The backend is built with FastAPI and Uvicorn, serving REST endpoints and a real-time WebSocket connection.

1. **Activate the virtual environment**:

   - **Windows (PowerShell)**:
     ```powershell
     .\backend\.venv\Scripts\Activate.ps1
     ```
   - **Linux / macOS**:
     ```bash
     source backend/.venv/bin/activate
     ```

   *(If not installed yet, run `pip install -r backend/requirements.txt`)*
2. **Start the API server**:
   From the project root:

   ```bash
   uvicorn backend.api.app:app --reload --port 8000
   ```

   Or directly with the venv Python:

   ```powershell
   .\backend\.venv\Scripts\python -m uvicorn backend.api.app:app --reload --port 8000
   ```

- **Backend API & Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Simulation WebSocket**: `ws://localhost:8000/api/ws/simulation`

---

### Running the Frontend

The frontend is a React + Vite application featuring Leaflet map visualization and live telemetry dashboards.

1. **Navigate to the frontend directory & install dependencies** (first time only):

   ```bash
   cd frontend
   npm install
   ```
2. **Start the Vite development server**:

   ```bash
   npm run dev
   ```

   *(Or from the project root: `npm --prefix frontend run dev`)*

- **Frontend Dashboard**: [http://localhost:5173/](http://localhost:5173/)
- *Note: Vite automatically proxies `/api` requests and WebSocket connections to `http://127.0.0.1:8000`.*

---

### Running Both Concurrently

Open two terminal windows/tabs:

- **Terminal 1 (Backend)**:

  ```powershell
  .\backend\.venv\Scripts\python -m uvicorn backend.api.app:app --reload --port 8000
  ```
- **Terminal 2 (Frontend)**:

  ```powershell
  cd frontend
  npm run dev
  ```

#### Windows PowerShell One-Liner (Launches Both in Separate Windows)

From the project root:

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", ".\backend\.venv\Scripts\python -m uvicorn backend.api.app:app --reload --port 8000"; Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"
```
