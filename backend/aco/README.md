# Ant Colony Optimization (ACO) Module

This module contains the central Bio-Inspired Algorithm for urban food delivery routing and dispatching, formulated as a multi-vehicle Pickup and Delivery Problem with Time Windows (PDPTW).

## Problem Formulation & Constraints

1. **Precedence Constraint**: For every order $k$, pickup at restaurant $P_k$ must strictly precede dropoff at customer $D_k$ ($P_k \prec D_k$).
2. **Capacity Constraint**: At every stop along a rider's tour, the active load cannot exceed the rider's maximum bag capacity ($\text{load} \le \text{capacity}_r$).
3. **Food Readiness**: Couriers arriving before an order's preparation completion must wait until $t^{\text{ready}}_k = \text{order\_time}_k + \text{prep\_time}_k$.
4. **Time Windows**: Deliveries completed past customer deadlines incur lateness penalties ($\max(0, t_{\text{delivery}} - \text{deadline}_k)$).

---

## Multi-Objective Fitness / Cost Formulation

As specified in `phases.md`:
$$\text{Cost} = w_d \cdot D_{\text{total}} + w_t \cdot T_{\text{total}} + w_l \cdot \text{LatePenalty} + w_f \cdot \text{FreshnessPenalty} + w_u \cdot \text{Unserved}$$

- $w_d$ (`distance_weight`): Multiplier for total travel distance (km).
- $w_t$ (`time_weight`): Multiplier for total duration and delivery time (minutes).
- $w_l$ (`late_weight`): Penalty per minute past guaranteed customer delivery deadlines.
- $w_f$ (`freshness_weight`): Penalty per minute of food waiting/in-transit ($t_{\text{delivery}} - t^{\text{ready}}_k$).
- $w_u$ (`unserved_order_penalty`): Penalty for any unserved order.

All weights and hyper-parameters are configured via `backend/config/aco_config.py`.

---

## Architecture

- **`models.py`**: Domain entities including `ACOTaskNode`, `RiderTour`, and `DeliveryPlan`.
- **`pheromone.py`**: `PheromoneMatrix` with bounded pheromones $[\tau_{\min}, \tau_{\max}]$ (MMAS), evaporation rate $\rho$, and elitist reinforcement.
- **`ant.py`**: Artificial `Ant` constructing feasible plans using probabilistic transition:
  $$p_{ij} = \frac{[\tau_{ij}]^\alpha \cdot [\eta_{ij}]^\beta}{\sum_{l \in \text{feasible}} [\tau_{il}]^\alpha \cdot [\eta_{il}]^\beta}$$
  incorporating dynamic heuristic visibility $\eta_{ij}$ (travel times, wait times, deadline urgency).
- **`cost.py`**: `CostEvaluator` calculating the multi-objective fitness score.
- **`colony.py`**: `ACOEngine` orchestrating iterations, ant dispatching, pheromone evaporation/deposit, convergence tracking, and best plan extraction.
- **`experiment.py`**: Executable optimization benchmark script.

---

## Running the Optimization Experiment

To run an optimization benchmark on processed orders:
```bash
python -m backend.aco.experiment --orders 15 --riders 4 --ants 15 --iterations 25 --seed 42
```

Results and complete tour schedules are exported to:
`backend/data/processed/best_delivery_plan.json`

## Running Tests
```bash
python -m pytest backend/tests/test_aco.py -v
```
