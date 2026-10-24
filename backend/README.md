# Backend

This directory contains the server-side architecture for the Food Delivery Optimization project.

## Structure and Responsibilities
- **`data/`**: Project datasets, separated into raw and processed directories.
- **`preprocessing/`**: Data loading, cleaning, validation, and feature preparation.
- **`routing/`**: Road network representation, distance/time matrices, and shortest-path routing.
- **`aco/`**: The core Bio-Inspired Ant Colony Optimization engine (ants, colonies, pheromone management, heuristic calculation).
- **`ml/`**: Optional machine learning module for ETA estimation and predictive analytics.
- **`simulation/`**: Dynamic simulation engine managing orders, riders, traffic events, and re-optimization triggers.
- **`api/`**: FastAPI service exposing REST and WebSocket endpoints for data access and real-time visualization.
- **`config/`**: Centralized configuration management for ACO parameters, simulation settings, and optimization weights.
- **`tests/`**: Unit, integration, and performance tests for backend modules.

All modules will be developed incrementally according to the project roadmap (`phases.md`).
