# Simulation Module

This module implements a dynamic discrete-event simulation engine modeling the urban food delivery environment under time-varying traffic conditions and operational disruptions.

## Architecture

The simulation engine coordinates virtual time, courier movement along the road network, order life-cycle transitions, and real-time disruptions.

```
                  ┌────────────────────────┐
                  │    SimulationEngine    │
                  └───────────┬────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
  [Virtual Clock]     [State Tracker]      [Disruption Handlers]
  • Current sim time  • 150 Orders         • NEW_ORDER
  • Delta stepping    • 20 Couriers        • TRAFFIC_CHANGE
  • Event queue       • Live GPS / nodes   • ROAD_CLOSURE
                      • Picked up / loads  • RIDER_UNAVAILABLE
                              │
                              ▼
                     [ACO Re-optimizer]
                     • Dynamic re-dispatch
                     • Re-route from courier GPS
```

## Core Components

- **`engine.py` (`SimulationEngine`)**:
  - Manages discrete simulation steps (`step(dt_minutes=1.0)`).
  - Advances virtual clock and courier progress along planned route sequences.
  - Updates courier GPS coordinates (`current_lat`, `current_lon`), speed, distance covered, and current cargo weight.
  - Transitions order states through `PLACED` $\to$ `PREPARING` $\to$ `READY` $\to$ `PICKED_UP` $\to$ `DELIVERED`.
  - Dynamically triggers ACO re-optimization (`reoptimize()`) starting from live courier coordinates and remaining unserviced orders.

- **`events.py` (`SimEvent`, `EventType`)**:
  - `NEW_ORDER`: Injects an urgent or on-demand order into the active simulation.
  - `TRAFFIC_CHANGE`: Modifies road edge multipliers (congestion or speed-up) affecting traversal times.
  - `ROAD_CLOSURE`: Blocks road segments, removing edges and re-routing affected riders.
  - `RIDER_UNAVAILABLE`: Models courier vehicle breakdown or shift end, automatically reallocating pending deliveries.

## Order Lifecycle

1. **`PLACED`**: Order entered into the system.
2. **`PREPARING`**: Restaurant is cooking the meal.
3. **`READY`**: Meal ready for courier pickup.
4. **`PICKED_UP`**: Courier has collected the food; cargo load updated.
5. **`DELIVERED`**: Order handed over to customer within or past deadline.

## Dynamic ACO Re-optimization

When disruption events occur (e.g. unexpected orders, road closures, courier breakdowns), the engine invokes the ACO engine with an active horizon:
- In-transit orders remain assigned to their current courier.
- Available active couriers serve as starting points with their live GPS coordinates.
- Remaining pending orders are reassigned and sequenced optimizing the multi-objective cost function.
