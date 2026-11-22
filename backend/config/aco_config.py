"""Centralized configuration for Ant Colony Optimization (ACO) algorithm."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class ACOConfig:
    """Hyper-parameters and fitness weights for the ACO delivery optimization engine."""

    # Colony settings
    num_ants: int = 20
    num_iterations: int = 40
    random_seed: Optional[int] = 42

    # Pheromone parameters
    alpha: float = 1.0            # Pheromone importance exponent
    beta: float = 2.0             # Heuristic visibility importance exponent
    evaporation_rate: float = 0.1 # Pheromone evaporation fraction rho (0.0 < rho < 1.0)
    q_deposit: float = 100.0      # Base pheromone deposit quantity Q
    tau_min: float = 0.05         # Minimum pheromone bound (MMAS)
    tau_max: float = 10.0         # Maximum pheromone bound (MMAS)
    elitism_factor: float = 2.0   # Weight multiplier for global best solution reinforcement

    # Search enhancements
    dynamic_bounds: bool = True           # MMAS: tau_max = 1 / (rho * best_cost), tau_min = tau_max / (2n)
    seed_with_greedy: bool = True         # Start from the greedy-priority plan as the incumbent
    local_search: bool = True             # Relocate-based local search on the final best plan
    local_search_time_limit_s: float = 2.0  # Wall-clock budget for local search

    # Multi-objective fitness function weights (Cost formulation from phases.md)
    distance_weight: float = 1.0          # Weight for total distance traveled (km)
    time_weight: float = 1.5              # Weight for total delivery & travel time (minutes)
    late_weight: float = 10.0             # Penalty weight per minute of late delivery past deadline
    freshness_weight: float = 0.5         # Penalty weight per minute of food waiting/in-transit
    freshness_limit_min: float = 40.0     # Food is "cold" once it has waited this long since it was ready
    cold_food_weight: float = 5.0         # Extra penalty per minute beyond freshness_limit_min
    unserved_order_penalty: float = 5000.0 # Heavy penalty per unserved order
