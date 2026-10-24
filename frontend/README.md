# Frontend — Ant Colony Food Logistics Optimizer

The interactive web dashboard for visualizing, controlling, and analyzing the bio-inspired food delivery routing simulation powered by Ant Colony Optimization (ACO).

## Architecture

- **Core Framework**: React 18 + Vite
- **Styling**: Vanilla CSS with Cyber-Logistics Mission Control Dark Theme (`index.css`)
- **Interactive Mapping**: Leaflet with CartoDB Dark Matter tiles, custom SVG markers, and live polyline layers
- **Charting & Analytics**: Recharts (ACO convergence line curves and multi-algorithm benchmark bar charts)
- **Icons**: Lucide React
- **Communications**: Real-time WebSocket (`/api/ws/simulation`) with REST polling fallback (`/api/simulation/*`)

## Project Structure

```
frontend/
├── index.html                  # HTML entry point with Google Fonts & Leaflet CSS
├── vite.config.js              # Vite configuration with /api backend proxy
├── package.json                # React, Leaflet, Recharts, and dependencies
├── src/
│   ├── main.jsx                # React root mount
│   ├── App.jsx                 # Main state coordinator & tab router
│   ├── index.css               # Design system, glassmorphic cards, animations
│   ├── services/
│   │   ├── api.js              # REST client communicating with FastAPI (:8000)
│   │   └── websocket.js        # Resilient WebSocket client for live sim ticks
│   └── components/
│       ├── Navbar.jsx          # Header with clock, playback controls, tab switcher
│       ├── MetricsHUD.jsx      # Live telemetry banner (Couriers, Delivered, SLA, Distance, Cost)
│       ├── Map/
│       │   └── DeliveryMap.jsx # Interactive Leaflet map with couriers, routes, and road network
│       ├── Orders/
│       │   └── OrderQueue.jsx  # Active order queue with status filter and SLA countdowns
│       ├── Fleet/
│       │   └── FleetStatus.jsx # Courier cards, live capacity bars, and distance tracked
│       ├── ACO/
│       │   └── ACOOptimizer.jsx# Hyperparameter tuning sliders & Recharts convergence curve
│       ├── Disruptions/
│       │   └── DisruptionControls.jsx # Urgent order, traffic spike, closure & breakdown modals
│       └── Benchmark/
│           └── BenchmarkComparison.jsx# Comparative charts and tables for ACO, Greedy, and NN
```

## Running the Frontend

### Prerequisites
Make sure dependencies are installed:
```bash
cd frontend
npm install
```

### Development Server
```bash
npm run dev
```
Accessible at `http://127.0.0.1:5173/`.

### Production Build
```bash
npm run build
```
Builds optimized bundle to `frontend/dist/`.
