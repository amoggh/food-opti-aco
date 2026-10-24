"""Data generation and validation configuration for Phase 1 synthetic dataset."""
from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class CommercialHub:
    name: str
    lat: float
    lon: float
    weight: float = 1.0  # Relative popularity/density


@dataclass
class ResidentialZone:
    name: str
    lat: float
    lon: float
    weight: float = 1.0


@dataclass
class DataGenerationConfig:
    """Configurable parameters for synthetic food delivery data generation."""

    # Entity counts
    num_restaurants: int = 25
    num_customers: int = 120
    num_orders: int = 150
    num_riders: int = 20

    # Determinism
    random_seed: int = 42

    # City geographic framework
    city_name: str = "Metro City"
    center_lat: float = 12.9716
    center_lon: float = 77.5946
    lat_min: float = 12.9000
    lat_max: float = 13.0500
    lon_min: float = 77.5200
    lon_max: float = 77.6800

    # Commercial and dining hubs for realistic restaurant clustering
    commercial_hubs: List[CommercialHub] = field(
        default_factory=lambda: [
            CommercialHub("Central Downtown Food Square", 12.9750, 77.6000, weight=1.5),
            CommercialHub("Tech Park Dine Hub", 12.9350, 77.6180, weight=1.2),
            CommercialHub("Northside Shopping District", 13.0100, 77.5750, weight=1.0),
            CommercialHub("Eastside Gourmet Lane", 12.9600, 77.6450, weight=1.0),
        ]
    )

    # Residential clusters for customer dispersion
    residential_zones: List[ResidentialZone] = field(
        default_factory=lambda: [
            ResidentialZone("Southpark Residential Enclave", 12.9150, 77.6100, weight=1.3),
            ResidentialZone("West End Suburbs", 12.9800, 77.5450, weight=1.1),
            ResidentialZone("Midtown Towers", 12.9650, 77.5900, weight=1.5),
            ResidentialZone("Greenwood Colony", 13.0250, 77.6200, weight=1.0),
            ResidentialZone("East Valley Condos", 12.9450, 77.6600, weight=1.1),
        ]
    )

    # Time parameters
    simulation_start_iso: str = "2026-10-01 12:00:00"
    order_time_window_minutes: int = 120  # Duration of order intake (e.g. 2-hour peak lunch)
    min_prep_time_minutes: int = 10
    max_prep_time_minutes: int = 30
    min_delivery_buffer_minutes: int = 20  # Travel buffer after prep
    max_delivery_buffer_minutes: int = 45

    # Rider parameters
    min_rider_capacity: int = 2
    max_rider_capacity: int = 4
    default_rider_status: str = "AVAILABLE"

    # Order parameters
    default_order_status: str = "PENDING"
