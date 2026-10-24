"""Visualization utility rendering benchmark comparison charts for the semester project report."""
import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd


def generate_benchmark_charts(
    results_path: Path = Path("backend/data/processed/benchmark_results.json"),
    output_image_path: Path = Path("backend/data/processed/benchmark_comparison.png"),
) -> None:
    if not results_path.exists():
        raise FileNotFoundError(f"Benchmark results file not found at: {results_path}")

    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    df = pd.DataFrame(data["summary"])
    if df.empty:
        print("No benchmark summary data to visualize.")
        return

    algorithms = df["algorithm"].unique()
    colors = {
        "Nearest Neighbor": "#e74c3c",       # Red
        "Greedy Priority": "#f39c12",        # Orange
        "Ant Colony Optimization": "#27ae60", # Green
    }
    markers = {
        "Nearest Neighbor": "o",
        "Greedy Priority": "s",
        "Ant Colony Optimization": "^",
    }

    fig, axs = plt.subplots(2, 2, figsize=(14, 10))
    plt.subplots_adjust(hspace=0.35, wspace=0.25)
    fig.suptitle("Algorithm Performance Benchmark Comparison\n(Food Delivery Optimization)", fontsize=16, fontweight="bold")

    # 1. Total Optimization Cost vs Problem Size
    ax = axs[0, 0]
    for algo in algorithms:
        sub = df[df["algorithm"] == algo].sort_values("problem_size")
        ax.plot(sub["problem_size"], sub["total_cost"], marker=markers.get(algo, "o"),
                color=colors.get(algo, "blue"), label=algo, linewidth=2.5, markersize=8)
    ax.set_title("Total Optimization Fitness Cost (Lower is Better)", fontweight="bold")
    ax.set_xlabel("Problem Size (Number of Orders)")
    ax.set_ylabel("Total Fitness Cost")
    ax.grid(True, linestyle="--", alpha=0.6)
    ax.legend()

    # 2. Total Distance (km) vs Problem Size
    ax = axs[0, 1]
    for algo in algorithms:
        sub = df[df["algorithm"] == algo].sort_values("problem_size")
        ax.plot(sub["problem_size"], sub["total_distance_km"], marker=markers.get(algo, "o"),
                color=colors.get(algo, "blue"), label=algo, linewidth=2.5, markersize=8)
    ax.set_title("Total Travel Distance (km) (Lower is Better)", fontweight="bold")
    ax.set_xlabel("Problem Size (Number of Orders)")
    ax.set_ylabel("Distance (km)")
    ax.grid(True, linestyle="--", alpha=0.6)
    ax.legend()

    # 3. Percentage of Late Deliveries (%)
    ax = axs[1, 0]
    for algo in algorithms:
        sub = df[df["algorithm"] == algo].sort_values("problem_size")
        ax.plot(sub["problem_size"], sub["late_deliveries_percentage"], marker=markers.get(algo, "o"),
                color=colors.get(algo, "blue"), label=algo, linewidth=2.5, markersize=8)
    ax.set_title("Late Deliveries Percentage (%) (Lower is Better)", fontweight="bold")
    ax.set_xlabel("Problem Size (Number of Orders)")
    ax.set_ylabel("Late Deliveries (%)")
    ax.grid(True, linestyle="--", alpha=0.6)
    ax.legend()

    # 4. Computational Runtime (seconds)
    ax = axs[1, 1]
    for algo in algorithms:
        sub = df[df["algorithm"] == algo].sort_values("problem_size")
        ax.plot(sub["problem_size"], sub["runtime_seconds"], marker=markers.get(algo, "o"),
                color=colors.get(algo, "blue"), label=algo, linewidth=2.5, markersize=8)
    ax.set_title("Runtime Performance (seconds)", fontweight="bold")
    ax.set_xlabel("Problem Size (Number of Orders)")
    ax.set_ylabel("Runtime (seconds)")
    ax.set_yscale("log")
    ax.grid(True, linestyle="--", alpha=0.6)
    ax.legend()

    output_image_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_image_path, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"Benchmark comparison charts saved successfully to: {output_image_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate benchmark comparison charts.")
    parser.add_argument("--results", type=str, default="backend/data/processed/benchmark_results.json", help="Results JSON path")
    parser.add_argument("--output", type=str, default="backend/data/processed/benchmark_comparison.png", help="Output PNG path")
    args = parser.parse_args()

    generate_benchmark_charts(Path(args.results), Path(args.output))


if __name__ == "__main__":
    main()
