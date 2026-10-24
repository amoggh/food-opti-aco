"""Benchmark suite comparing Nearest Neighbor, Greedy Priority, and ACO across multiple problem sizes."""
import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from backend.config.aco_config import ACOConfig
from backend.aco.colony import ACOEngine
from backend.baselines.greedy import GreedyPrioritySolver
from backend.baselines.nearest_neighbor import NearestNeighborSolver
from backend.evaluation.metrics import EvaluationMetrics
from backend.preprocessing.pipeline import PreprocessingPipeline
from backend.routing.graph import RoadGraph
from backend.routing.router import RoutingEngine


class BenchmarkRunner:
    """Executes empirical performance comparisons across baseline and bio-inspired algorithms."""

    def __init__(
        self,
        raw_data_dir: Path = Path("backend/data/raw"),
        processed_data_dir: Path = Path("backend/data/processed"),
        router: Optional[RoutingEngine] = None,
    ):
        self.raw_data_dir = Path(raw_data_dir)
        self.processed_data_dir = Path(processed_data_dir)
        self.router = router

        # Load problem data
        pipeline = PreprocessingPipeline(self.raw_data_dir)
        self.data = pipeline.run()

        # Load road graph if router not provided
        if not self.router:
            graph_path = self.processed_data_dir / "road_graph.json"
            if graph_path.exists():
                graph = RoadGraph.load_from_json(graph_path)
                self.router = RoutingEngine(graph)

    def run_single_experiment(
        self,
        problem_size: int,
        seed: int,
        num_riders: int,
        aco_iterations: int = 25,
        aco_ants: int = 15,
    ) -> List[EvaluationMetrics]:
        """Runs Nearest Neighbor, Greedy, and ACO on a specific problem instance."""
        selected_orders = self.data.orders[:problem_size]
        selected_riders = self.data.riders[:num_riders]

        # Setup ACO engine to precompute common task nodes and matrices
        aco_config = ACOConfig(
            num_ants=aco_ants,
            num_iterations=aco_iterations,
            random_seed=seed,
            alpha=1.0,
            beta=2.0,
            evaporation_rate=0.15,
            q_deposit=100.0,
            distance_weight=1.0,
            time_weight=1.5,
            late_weight=10.0,
            freshness_weight=0.5,
        )
        aco = ACOEngine(config=aco_config, routing_engine=self.router)
        aco.setup_problem(
            restaurants=self.data.restaurants,
            customers=self.data.customers,
            orders=selected_orders,
            riders=selected_riders,
        )

        order_ids = [o.order_id for o in selected_orders]
        results: List[EvaluationMetrics] = []

        # 1. Nearest Neighbor
        nn_solver = NearestNeighborSolver(
            task_nodes=aco.task_nodes,
            pickup_nodes=aco.pickup_nodes,
            dropoff_nodes=aco.dropoff_nodes,
            rider_start_nodes=aco.rider_start_nodes,
            rider_capacities=aco.rider_capacities,
            distance_matrix=aco.distance_matrix,
            time_matrix=aco.time_matrix,
            cost_evaluator=aco.evaluator,
        )
        t0 = time.perf_counter()
        nn_plan = nn_solver.solve(order_ids)
        nn_time = time.perf_counter() - t0
        results.append(
            EvaluationMetrics.from_delivery_plan(nn_plan, "Nearest Neighbor", problem_size, seed, nn_time)
        )

        # 2. Greedy Priority
        greedy_solver = GreedyPrioritySolver(
            task_nodes=aco.task_nodes,
            pickup_nodes=aco.pickup_nodes,
            dropoff_nodes=aco.dropoff_nodes,
            rider_start_nodes=aco.rider_start_nodes,
            rider_capacities=aco.rider_capacities,
            distance_matrix=aco.distance_matrix,
            time_matrix=aco.time_matrix,
            cost_evaluator=aco.evaluator,
        )
        t0 = time.perf_counter()
        greedy_plan = greedy_solver.solve(order_ids)
        greedy_time = time.perf_counter() - t0
        results.append(
            EvaluationMetrics.from_delivery_plan(greedy_plan, "Greedy Priority", problem_size, seed, greedy_time)
        )

        # 3. Ant Colony Optimization
        t0 = time.perf_counter()
        aco_result = aco.optimize(verbose=False)
        aco_time = time.perf_counter() - t0
        results.append(
            EvaluationMetrics.from_delivery_plan(aco_result.best_plan, "Ant Colony Optimization", problem_size, seed, aco_time)
        )

        return results

    def run_benchmark(
        self,
        problem_sizes: List[int] = [10, 25, 50],
        seeds: List[int] = [42, 101],
        num_riders_map: Optional[Dict[int, int]] = None,
        aco_iterations: int = 25,
        aco_ants: int = 15,
        output_path: Path = Path("backend/data/processed/benchmark_results.json"),
    ) -> pd.DataFrame:
        """Executes the full benchmark across all specified problem sizes and seeds."""
        # Default rider scaling with problem size
        riders_map = num_riders_map or {10: 3, 25: 6, 50: 10, 100: 15}

        all_records: List[EvaluationMetrics] = []

        print("=" * 80)
        print("STARTING BENCHMARK: NEAREST NEIGHBOR vs. GREEDY vs. ANT COLONY OPTIMIZATION")
        print("=" * 80)

        for size in problem_sizes:
            riders = riders_map.get(size, max(3, size // 5))
            for seed in seeds:
                print(f"\nRunning benchmark: Problem Size = {size} orders | Riders = {riders} | Seed = {seed}")
                metrics = self.run_single_experiment(
                    problem_size=size,
                    seed=seed,
                    num_riders=riders,
                    aco_iterations=aco_iterations,
                    aco_ants=aco_ants,
                )
                for m in metrics:
                    print(
                        f"  -> {m.algorithm:<26}: Cost = {m.total_cost:>9.2f} | "
                        f"Dist = {m.total_distance_km:>6.2f}km | Late = {m.late_deliveries_percentage:>5.1f}% | "
                        f"Runtime = {m.runtime_seconds:>6.4f}s"
                    )
                all_records.extend(metrics)

        # Create DataFrame
        df = pd.DataFrame([m.to_dict() for m in all_records])

        # Summary aggregation by problem_size and algorithm
        summary = df.groupby(["problem_size", "algorithm"])[
            ["total_cost", "total_distance_km", "late_deliveries_percentage", "runtime_seconds"]
        ].mean().reset_index()

        print("\n" + "=" * 80)
        print("BENCHMARK SUMMARY (AVERAGED OVER RUNS)")
        print("=" * 80)
        print(summary.to_string(index=False))

        # Save to JSON
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "raw_runs": [m.to_dict() for m in all_records],
                    "summary": summary.to_dict(orient="records"),
                },
                f,
                indent=2,
            )
        print(f"\nBenchmark results saved to: {output_path}")

        return df


def main():
    parser = argparse.ArgumentParser(description="Run benchmark comparison for food delivery optimization.")
    parser.add_argument("--sizes", type=int, nargs="+", default=[10, 25, 50, 100], help="Problem sizes (order counts)")
    parser.add_argument("--seeds", type=int, nargs="+", default=[42, 101], help="Random seeds")
    parser.add_argument("--ants", type=int, default=15, help="Number of ants")
    parser.add_argument("--iterations", type=int, default=25, help="Number of iterations")
    parser.add_argument("--output", type=str, default="backend/data/processed/benchmark_results.json", help="Output JSON path")
    args = parser.parse_args()

    runner = BenchmarkRunner()
    runner.run_benchmark(
        problem_sizes=args.sizes,
        seeds=args.seeds,
        aco_ants=args.ants,
        aco_iterations=args.iterations,
        output_path=Path(args.output),
    )


if __name__ == "__main__":
    main()
