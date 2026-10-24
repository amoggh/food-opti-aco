"""Example optimization experiment demonstrating the Ant Colony Optimization engine."""
import argparse
import json
from pathlib import Path

from backend.config.aco_config import ACOConfig
from backend.aco.colony import ACOEngine
from backend.preprocessing.pipeline import PreprocessingPipeline
from backend.routing.graph import RoadGraph
from backend.routing.router import RoutingEngine


def run_experiment(
    data_dir: Path = Path("backend/data/processed"),
    raw_dir: Path = Path("backend/data/raw"),
    num_orders: int = 15,
    num_riders: int = 4,
    num_ants: int = 15,
    num_iterations: int = 25,
    seed: int = 42,
    output_path: Path = Path("backend/data/processed/best_delivery_plan.json"),
):
    print("=" * 70)
    print("PHASE 3: ANT COLONY OPTIMIZATION - FOOD DELIVERY EXPERIMENT")
    print("=" * 70)

    # 1. Load Preprocessed Datasets
    if not (data_dir / "orders.csv").exists():
        print(f"Processed data not found in {data_dir}. Running preprocessing pipeline...")
        pipeline = PreprocessingPipeline(raw_dir)
        pipeline.save_processed(data_dir)

    pipeline = PreprocessingPipeline(raw_dir)
    data = pipeline.run()

    selected_orders = data.orders[:num_orders]
    selected_riders = data.riders[:num_riders]
    restaurants = data.restaurants
    customers = data.customers

    print(f"Problem Instance:")
    print(f"  - Orders: {len(selected_orders)}")
    print(f"  - Riders: {len(selected_riders)}")
    print(f"  - Restaurants: {len(restaurants)}")
    print(f"  - Customers: {len(customers)}")

    # 2. Load Road Graph and Routing Engine
    graph_path = data_dir / "road_graph.json"
    router = None
    if graph_path.exists():
        print(f"Loading road network graph: {graph_path}...")
        graph = RoadGraph.load_from_json(graph_path)
        router = RoutingEngine(graph)
        print(f"  - Road graph loaded: {len(graph.nodes)} nodes, {len(graph.edges)} edges.")
    else:
        print("Road graph not found; using high-fidelity geographic routing fallback.")

    # 3. Configure ACO Hyperparameters
    config = ACOConfig(
        num_ants=num_ants,
        num_iterations=num_iterations,
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

    print("\nInitializing ACO Engine and Spatial Matrices...")
    aco = ACOEngine(config=config, routing_engine=router)
    aco.setup_problem(
        restaurants=restaurants,
        customers=customers,
        orders=selected_orders,
        riders=selected_riders,
    )

    print("\nStarting Ant Colony Optimization...")
    result = aco.optimize(verbose=True)

    best = result.best_plan
    print("\n" + "=" * 70)
    print("OPTIMIZATION RESULTS SUMMARY")
    print("=" * 70)
    print(f"Runtime: {result.runtime_seconds:.2f} seconds")
    print(f"Final Best Cost: {best.fitness_cost:.2f}")
    print(f"Total Distance: {best.total_distance_km:.2f} km")
    print(f"Total Delivery Time: {best.total_delivery_time_min:.1f} minutes")
    print(f"Late Deliveries: {best.late_orders_count} (penalty: {best.late_delivery_penalty:.1f})")
    print(f"Freshness Penalty: {best.freshness_penalty:.1f}")
    print(f"Unserved Orders: {best.unserved_orders_count}")

    print("\nDispatched Rider Tour Summaries:")
    for rid, tour in best.tours.items():
        if len(tour.stops) <= 1:
            print(f"  - Rider {rid}: IDLE (no orders assigned)")
        else:
            stops_str = " -> ".join([s.node_id for s in tour.stops])
            print(
                f"  - Rider {rid}: {len(tour.orders_delivered)} orders delivered | "
                f"Dist: {tour.total_distance_km:.2f}km | Time: {tour.total_time_min:.1f}min"
            )
            print(f"    Route: {stops_str}")

    # 4. Save Solution JSON
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(best.to_dict(), f, indent=2)
    print(f"\nBest delivery plan exported to: {output_path}")

    return result


def main():
    parser = argparse.ArgumentParser(description="Run ACO food delivery optimization experiment.")
    parser.add_argument("--orders", type=int, default=15, help="Number of orders to optimize")
    parser.add_argument("--riders", type=int, default=4, help="Number of riders")
    parser.add_argument("--ants", type=int, default=15, help="Number of ants")
    parser.add_argument("--iterations", type=int, default=25, help="Number of iterations")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    run_experiment(
        num_orders=args.orders,
        num_riders=args.riders,
        num_ants=args.ants,
        num_iterations=args.iterations,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
