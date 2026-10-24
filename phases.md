# Food Delivery Optimization Using Ant Colony Optimization

## Project Overview

This project is a bio-inspired food delivery optimization system based on
Ant Colony Optimization (ACO).

The system simulates a food-delivery environment containing:

- Restaurants
- Customers
- Food orders
- Delivery riders
- A road/network graph
- Traffic conditions
- Delivery deadlines
- Rider capacity constraints

The main objective is to optimize the assignment and delivery sequence of
orders while minimizing:

1. Total travel distance
2. Total delivery time
3. Late deliveries
4. Food waiting/freshness penalty

The primary optimization technique is Ant Colony Optimization.

Machine Learning is optional and will only be introduced after the core
optimization system is working.

The project will be developed strictly phase-by-phase.

---

# PHASE 1 — Project Foundation & Synthetic Data

## Goal

Create the project foundation and generate a realistic synthetic food-delivery
dataset.

At the end of this phase, the project should have valid data that can be used
by later phases.

## Tasks

### 1. Project structure

Create the complete backend and frontend directory structure defined in the
project initialization specification.

Do not implement algorithms yet.

### 2. Synthetic data generation

Create synthetic datasets for:

- Restaurants
- Customers
- Orders
- Riders

Suggested fields:

### restaurants.csv

- restaurant_id
- latitude
- longitude
- name
- average_preparation_time

### customers.csv

- customer_id
- latitude
- longitude
- name

### orders.csv

- order_id
- restaurant_id
- customer_id
- order_time
- preparation_time
- deadline
- order_status

### riders.csv

- rider_id
- latitude
- longitude
- capacity
- status

## Data requirements

The generated data should represent a realistic city-like delivery
environment rather than completely random points.

Restaurants and customers should be distributed across a geographical area.

The generator should support configurable:

- Number of restaurants
- Number of customers
- Number of orders
- Number of riders
- Random seed

The random seed must allow reproducible datasets.

## Validation

The phase should provide basic validation that:

- IDs are unique
- Restaurant references in orders exist
- Customer references in orders exist
- Rider capacity is valid
- Coordinates are valid
- Deadlines occur after order creation
- Preparation times are positive

## Important restrictions

Do NOT implement:

- ACO
- Machine learning
- Routing optimization
- Frontend UI
- Simulation
- API endpoints

Those belong to later phases.

## Deliverables

At the end of Phase 1:

- Synthetic dataset generator
- Initial CSV datasets
- Basic data validation
- Project directory structure
- Documentation describing the generated data

---

# PHASE 2 — Road Network, Preprocessing & Routing Foundation

## Goal

Convert the raw delivery data into a usable representation of the delivery
environment.

The output of this phase will be consumed by the ACO algorithm in Phase 3.

## Tasks

### 1. Data preprocessing

Create preprocessing functionality for:

- Loading CSV data
- Validating data
- Handling missing values
- Validating coordinate ranges
- Converting timestamps
- Preparing order information

Do not unnecessarily modify valid data.

### 2. Road graph

Represent the delivery environment as a graph.

The graph should contain:

- Nodes
- Edges
- Distance
- Speed
- Travel time
- Traffic level

Initially, a synthetic road network may be used.

The architecture should allow a real OpenStreetMap-based network to be added
later without rewriting the ACO algorithm.

### 3. Routing

Implement basic graph routing functionality.

The routing layer should be capable of calculating:

- Shortest distance
- Travel time
- Route between two locations

Keep routing separate from ACO.

ACO should call the routing layer rather than directly manipulating the
underlying graph.

### 4. Traffic representation

Create a basic traffic model.

Traffic should affect effective travel speed and therefore travel time.

Example:

- Low traffic
- Medium traffic
- High traffic

The traffic system must be replaceable with a more sophisticated model later.

## Important restrictions

Do NOT implement:

- ACO
- Multi-rider optimization
- ML ETA prediction
- Dynamic simulation
- Frontend

Those belong to later phases.

## Deliverables

At the end of Phase 2:

- Cleaned data pipeline
- Road graph
- Routing engine
- Travel-time calculation
- Basic traffic model
- Tests for routing functionality

---

# PHASE 3 — Ant Colony Optimization Engine

## Goal

Implement the core Bio-Inspired Algorithm.

ACO is the central component of this project.

## Problem formulation

One ant represents one possible delivery plan.

A delivery plan determines:

- Which orders are assigned to riders
- The order in which deliveries are performed
- The route used between delivery locations

The algorithm must search for a solution with minimum overall cost.

## Cost function

The initial fitness/cost function should consider:

    Cost =
        distance_weight × total_distance
        +
        time_weight × total_delivery_time
        +
        late_weight × late_delivery_penalty
        +
        freshness_weight × freshness_penalty

Weights must be configurable.

Do not hard-code them throughout the codebase.

## ACO components

Implement:

### Ant

Responsible for constructing a candidate solution.

### Colony

Responsible for managing multiple ants and iterations.

### Pheromone matrix

Stores pheromone levels associated with possible transitions.

### Heuristic information

Use factors such as:

- Travel time
- Distance
- Delivery urgency

### Pheromone update

Implement:

- Evaporation
- Pheromone deposition
- Best-solution reinforcement

### Configurable parameters

At minimum:

- Number of ants
- Number of iterations
- Alpha
- Beta
- Evaporation rate
- Pheromone deposit factor
- Fitness weights

## Constraints

The algorithm should support:

- Rider capacity
- Order preparation time
- Delivery deadlines

Invalid solutions must receive an appropriate penalty or be prevented
during solution construction.

## Initial scope

Start with:

- Static traffic
- Fixed orders
- Fixed riders
- No real-time events

The objective is to get a correct and testable ACO implementation first.

## Important restrictions

Do NOT implement:

- Frontend
- WebSocket simulation
- Live order events
- Rider failures
- ML ETA prediction
- Dynamic traffic events

## Deliverables

At the end of Phase 3:

- Working ACO engine
- Configurable ACO parameters
- Fitness function
- Constraint handling
- Best solution output
- Unit tests
- Example optimization experiment

---

# PHASE 4 — Baselines, Evaluation & Optional ETA Model

## Goal

Evaluate whether ACO provides useful optimization compared with simpler
approaches.

This phase is important for the academic/report component of the project.

## Baseline algorithms

Implement at least:

### 1. Nearest Neighbor

Select the closest feasible next delivery.

### 2. Greedy approach

Select the order with the highest immediate priority based on factors such
as urgency and travel cost.

### 3. ACO

Use the Phase 3 implementation.

Keep all algorithms independent.

## Evaluation metrics

Compare:

- Total distance
- Average delivery time
- Maximum delivery time
- Number of late deliveries
- Percentage of late deliveries
- Freshness/waiting penalty
- Total optimization cost
- Runtime

Run experiments with different problem sizes.

For example:

- 10 orders
- 25 orders
- 50 orders
- 100 orders

Use multiple random seeds where appropriate.

Do not fabricate results.

All reported results must come from actual experiments.

---

## Optional ML component — ETA prediction

Only implement this if the core system is already stable.

The ML model predicts travel/delivery time.

Possible inputs:

- Distance
- Traffic level
- Time of day
- Day of week
- Road characteristics
- Restaurant preparation time

Possible target:

- Travel time
- Delivery ETA

Start with a simple regression model such as:

- Random Forest Regressor

The model should be evaluated using appropriate regression metrics.

The ACO engine should then be able to use the predicted ETA as an input.

### Important

ML is a supporting component.

It must not replace ACO.

The project's primary contribution remains Bio-Inspired Optimization.

## Deliverables

- Baseline algorithms
- Evaluation framework
- Comparison metrics
- Experiment outputs
- Optional ETA prediction model
- Graphs/tables for the final report

---

# PHASE 5 — Dynamic Delivery Simulation & Backend API

## Goal

Turn the static optimization engine into a dynamic food-delivery simulation.

The simulation should model a delivery environment changing over time.

## Simulation entities

The simulation should track:

- Restaurants
- Customers
- Orders
- Riders
- Rider locations
- Order states
- Traffic
- Current routes
- Delivery progress

## Dynamic events

Support events such as:

### New order

A new order enters the system.

ACO should be able to recalculate the delivery plan.

### Traffic increase

A road or region becomes congested.

Travel time changes.

### Road closure

A road becomes unavailable.

The routing system should find alternatives.

### Rider unavailable

A rider becomes unavailable.

Their assigned orders must be reconsidered.

## Re-optimization

The system should not run ACO continuously without reason.

Re-run optimization when meaningful events occur.

Examples:

- New order
- Significant traffic change
- Rider failure
- Road closure

## Backend API

Create a FastAPI backend exposing functionality required by the frontend.

Potential endpoints:

- Get restaurants
- Get customers
- Get orders
- Get riders
- Start simulation
- Pause simulation
- Reset simulation
- Get current simulation state
- Trigger simulation event
- Run optimization
- Get optimization metrics

Use WebSockets for real-time simulation updates if required.

## Important restrictions

Do NOT build the final frontend yet.

The backend must first expose a clean and documented interface.

## Deliverables

- Simulation engine
- Event system
- Dynamic re-optimization
- FastAPI backend
- API documentation
- WebSocket support if required
- Backend tests

---

# PHASE 6 — Interactive Frontend & Final Integration

## Goal

Create a polished frontend that visualizes the entire system.

The frontend should make the algorithm understandable rather than simply
displaying a map.

## Technology

Use:

- React
- Vite
- Leaflet or Mapbox
- Recharts or another lightweight charting library

## Main interface

The application should contain:

### Map

Display:

- Restaurants
- Customers
- Riders
- Delivery routes
- Road network

### Rider visualization

Riders should visually move along their assigned routes during simulation.

### Order panel

Display:

- Order ID
- Restaurant
- Customer
- Status
- ETA
- Deadline

### Metrics panel

Display:

- Active riders
- Active orders
- Average ETA
- Total distance
- Late deliveries
- Delivered orders
- Optimization cost

### ACO panel

Display:

- Number of ants
- Iterations
- Alpha
- Beta
- Evaporation rate
- Current best cost

These values should be configurable where appropriate.

---

# ACO Visualization

The frontend should show the optimization process.

Display:

- Current iteration
- Best cost
- Cost over iterations
- Route changes
- Final best solution

Include a convergence graph:

    Iteration
        ↓
    Best Cost
        ↓
    decreasing curve

The goal is to visually demonstrate how the colony converges toward a
better solution.

---

# Dynamic Event Controls

Provide controls for:

- Add new order
- Increase traffic
- Close road
- Disable rider
- Reset simulation

When an event occurs:

1. Update the environment
2. Recalculate affected routes
3. Run ACO when required
4. Update the frontend
5. Display the resulting change

---

# Final Comparison View

The frontend should provide a comparison between:

- Nearest Neighbor
- Greedy
- ACO

Show actual experimental results.

Possible metrics:

    Total Distance
    Average Delivery Time
    Late Deliveries
    Optimization Cost
    Runtime

Never display fabricated numbers.

---

# Final Project Outcome

The completed system should demonstrate:

    Synthetic / real-world delivery data
              ↓
          Preprocessing
              ↓
          Road Network
              ↓
          Routing
              ↓
        ACO Optimization
              ↓
      Dynamic Simulation
              ↓
        Backend API
              ↓
      Interactive Frontend
              ↓
       Visual Evaluation

The final project should answer the following question:

> Can Ant Colony Optimization produce effective food-delivery plans under
> realistic constraints such as multiple riders, delivery deadlines,
> traffic, rider capacity, and changing delivery conditions?

The project should provide experimental evidence rather than assuming that
ACO is always superior.

---

# Development Rule

The project must be developed sequentially.

Complete and validate one phase before implementing the next phase.

Do not prematurely implement functionality from later phases.

When working on a specific phase:

1. Read this file.
2. Identify the requested phase.
3. Inspect existing implementation.
4. Implement only the requested phase.
5. Preserve existing working functionality.
6. Add tests where appropriate.
7. Do not fabricate data, metrics, or results.
8. Do not introduce unnecessary dependencies.
9. Do not rewrite unrelated files.
10. Clearly report what was changed.

The system should remain modular so that individual components can be
replaced without rewriting the entire application.