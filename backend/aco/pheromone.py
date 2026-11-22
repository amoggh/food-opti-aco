"""Pheromone matrix representation, evaporation, and elitist deposition."""
from typing import Dict, List, Optional

import numpy as np

from backend.config.aco_config import ACOConfig
from backend.aco.models import DeliveryPlan


class PheromoneMatrix:
    """Manages pheromone trails between all task nodes with Max-Min bounds."""

    def __init__(self, node_ids: List[str], config: ACOConfig):
        self.config = config
        self.node_ids = list(node_ids)
        self.node_to_idx: Dict[str, int] = {nid: i for i, nid in enumerate(self.node_ids)}
        self.idx_to_node: Dict[int, str] = {i: nid for i, nid in enumerate(self.node_ids)}
        self.n = len(self.node_ids)

        # Active MMAS bounds (may be rescaled at runtime via set_bounds)
        self.tau_min: float = self.config.tau_min
        self.tau_max: float = self.config.tau_max
        # Scale applied to the 1/cost deposit quantity
        self.deposit_scale: float = self.config.q_deposit

        # Initialize pheromone levels to tau_max to encourage initial exploration
        self.matrix = np.full((self.n, self.n), fill_value=self.tau_max, dtype=float)

    def set_bounds(self, tau_min: float, tau_max: float, reset: bool = False) -> None:
        """Rescales the MMAS bounds; optionally resets every trail to tau_max."""
        self.tau_min = tau_min
        self.tau_max = max(tau_max, tau_min)
        if reset:
            self.matrix.fill(self.tau_max)
        else:
            np.clip(self.matrix, self.tau_min, self.tau_max, out=self.matrix)

    def get_pheromone(self, from_node: str, to_node: str) -> float:
        """Returns the current pheromone concentration on the transition between two nodes."""
        i = self.node_to_idx[from_node]
        j = self.node_to_idx[to_node]
        return float(self.matrix[i, j])

    def evaporate(self) -> None:
        """Applies pheromone evaporation across all transitions, bounded by tau_min."""
        self.matrix *= (1.0 - self.config.evaporation_rate)
        # Apply lower bound (MMAS)
        np.maximum(self.matrix, self.tau_min, out=self.matrix)

    def deposit(self, plan: DeliveryPlan, is_best: bool = False) -> None:
        """Deposits pheromones along all transitions traversed in a delivery plan."""
        if plan.fitness_cost <= 0 or not plan.tours:
            return

        delta = self.deposit_scale / max(1.0, plan.fitness_cost)
        if is_best:
            delta *= self.config.elitism_factor

        for tour in plan.tours.values():
            if len(tour.stops) < 2:
                continue
            for k in range(len(tour.stops) - 1):
                u_id = tour.stops[k].node_id
                v_id = tour.stops[k + 1].node_id
                i = self.node_to_idx[u_id]
                j = self.node_to_idx[v_id]
                self.matrix[i, j] += delta

        # Apply upper bound (MMAS)
        np.minimum(self.matrix, self.tau_max, out=self.matrix)
