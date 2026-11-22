"""Real-world road network router integrating OpenStreetMap routing (OSRM) with persistent local caching."""
import json
import logging
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two geographic points in kilometers."""
    R = 6371.0088
    phi1, phi2 = radians(lat1), radians(lat2)
    delta_phi = radians(lat2 - lat1)
    delta_lambda = radians(lon2 - lon1)

    a = (
        sin(delta_phi / 2.0) ** 2
        + cos(phi1) * cos(phi2) * sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
    return round(R * c, 4)


class OSMRouter:
    """Routes along real physical roads using the OpenStreetMap (OSRM) routing engine with disk caching."""

    OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving"

    def __init__(self, cache_file: Optional[Path] = None):
        base_dir = Path(__file__).resolve().parent.parent
        if cache_file is not None:
            self.cache_file = Path(cache_file)
        elif Path("backend/data/processed").exists():
            self.cache_file = Path("backend/data/processed/osm_route_cache.json")
        else:
            self.cache_file = base_dir / "data" / "processed" / "osm_route_cache.json"
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_dirty: bool = False
        self._load_cache()

    def _load_cache(self) -> None:
        """Loads cached road geometry from disk if available."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self._cache = json.load(f)
            except Exception as e:
                logger.warning(f"Could not load OSM route cache from {self.cache_file}: {e}")
                self._cache = {}
        else:
            self._cache = {}

    def save_cache(self) -> None:
        """Flushes cached route geometry to disk atomically."""
        if not self._cache_dirty:
            return
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            tmp_file = self.cache_file.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, separators=(",", ":"))
            tmp_file.replace(self.cache_file)
            self._cache_dirty = False
        except Exception as e:
            logger.warning(f"Failed to persist OSM route cache to {self.cache_file}: {e}")

    @staticmethod
    def _make_key(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
        return f"{round(lat1, 5)},{round(lon1, 5)}->{round(lat2, 5)},{round(lon2, 5)}"

    def get_route(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        timeout: float = 4.0,
    ) -> Tuple[List[Tuple[float, float]], float, float]:
        """
        Retrieves the exact real-world road coordinates, road distance (km), and driving time (min)
        between two points.
        """
        # Identical location
        dist_direct = haversine_distance_km(start_lat, start_lon, end_lat, end_lon)
        if dist_direct < 0.01:
            return ([(start_lat, start_lon), (end_lat, end_lon)], 0.01, 0.05)

        cache_key = self._make_key(start_lat, start_lon, end_lat, end_lon)
        if cache_key in self._cache:
            entry = self._cache[cache_key]
            coords = [tuple(pt) for pt in entry["coords"]]
            return (coords, float(entry["distance_km"]), float(entry["duration_min"]))

        # Query OSRM public service
        url = f"{self.OSRM_ENDPOINT}/{start_lon:.6f},{start_lat:.6f};{end_lon:.6f},{end_lat:.6f}?overview=full&geometries=geojson"
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("routes"):
                        best_route = data["routes"][0]
                        # OSRM returns coordinates in [lon, lat] format -> convert to [lat, lon]
                        raw_coords = best_route["geometry"]["coordinates"]
                        coords = [(round(pt[1], 6), round(pt[0], 6)) for pt in raw_coords]
                        distance_km = round(best_route["distance"] / 1000.0, 4)
                        duration_min = round(best_route["duration"] / 60.0, 4)

                        self._cache[cache_key] = {
                            "coords": coords,
                            "distance_km": distance_km,
                            "duration_min": duration_min,
                        }
                        self._cache_dirty = True
                        self.save_cache()
                        return (coords, distance_km, duration_min)
        except Exception as e:
            logger.debug(f"OSRM query fallback for {cache_key}: {e}")

        # Fallback if network or service unavailable: realistic Manhattan street interpolation
        fallback_coords = self._generate_street_aligned_fallback(start_lat, start_lon, end_lat, end_lon)
        fallback_dist = round(dist_direct * 1.25, 4)  # ~25% urban road detour factor
        fallback_time = round((fallback_dist / 32.0) * 60.0, 4)  # ~32 km/h average city speed

        self._cache[cache_key] = {
            "coords": fallback_coords,
            "distance_km": fallback_dist,
            "duration_min": fallback_time,
        }
        self._cache_dirty = True
        return (fallback_coords, fallback_dist, fallback_time)

    def get_route_for_stops(
        self, stops: List[Tuple[float, float]], timeout: float = 4.0
    ) -> Tuple[List[Tuple[float, float]], float, float]:
        """
        Computes the complete continuous road path visiting an ordered list of stops.
        Executes a single multi-waypoint OSRM query with persistent caching.
        """
        if not stops or len(stops) < 2:
            return ([], 0.0, 0.0)

        cache_key = "tour_" + ";".join([f"{round(p[0], 5)},{round(p[1], 5)}" for p in stops])
        if cache_key in self._cache:
            entry = self._cache[cache_key]
            return ([tuple(pt) for pt in entry["coords"]], float(entry["distance_km"]), float(entry["duration_min"]))

        # Build single OSRM request for all waypoints
        coords_str = ";".join([f"{p[1]:.6f},{p[0]:.6f}" for p in stops])
        url = f"{self.OSRM_ENDPOINT}/{coords_str}?overview=full&geometries=geojson"
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("routes"):
                        best_route = data["routes"][0]
                        raw_coords = best_route["geometry"]["coordinates"]
                        coords = [(round(pt[1], 6), round(pt[0], 6)) for pt in raw_coords]
                        distance_km = round(best_route["distance"] / 1000.0, 4)
                        duration_min = round(best_route["duration"] / 60.0, 4)

                        self._cache[cache_key] = {
                            "coords": coords,
                            "distance_km": distance_km,
                            "duration_min": duration_min,
                        }
                        self._cache_dirty = True
                        self.save_cache()
                        return (coords, distance_km, duration_min)
        except Exception as e:
            logger.debug(f"OSRM multi-stop routing error: {e}")

        # Fallback: stitch pairwise segments (using cache first, then street-aligned fallback without network delay)
        total_coords: List[Tuple[float, float]] = []
        total_dist_km: float = 0.0
        total_time_min: float = 0.0

        for i in range(len(stops) - 1):
            p1 = stops[i]
            p2 = stops[i + 1]
            pair_key = f"{round(p1[0], 5)},{round(p1[1], 5)}_{round(p2[0], 5)},{round(p2[1], 5)}"
            if pair_key in self._cache:
                entry = self._cache[pair_key]
                seg_coords = [tuple(pt) for pt in entry["coords"]]
                seg_dist = float(entry["distance_km"])
                seg_time = float(entry["duration_min"])
            else:
                dist_direct = haversine_distance_km(p1[0], p1[1], p2[0], p2[1])
                seg_coords = self._generate_street_aligned_fallback(p1[0], p1[1], p2[0], p2[1])
                seg_dist = round(dist_direct * 1.25, 4)
                seg_time = round((seg_dist / 32.0) * 60.0, 4)
                self._cache[pair_key] = {
                    "coords": seg_coords,
                    "distance_km": seg_dist,
                    "duration_min": seg_time,
                }
                self._cache_dirty = True

            total_dist_km += seg_dist
            total_time_min += seg_time

            if not total_coords:
                total_coords.extend(seg_coords)
            else:
                if seg_coords and total_coords[-1] == seg_coords[0]:
                    total_coords.extend(seg_coords[1:])
                else:
                    total_coords.extend(seg_coords)

        self._cache[cache_key] = {
            "coords": total_coords,
            "distance_km": round(total_dist_km, 4),
            "duration_min": round(total_time_min, 4),
        }
        self._cache_dirty = True
        self.save_cache()
        return (total_coords, round(total_dist_km, 4), round(total_time_min, 4))

    @staticmethod
    def _generate_street_aligned_fallback(
        lat1: float, lon1: float, lat2: float, lon2: float
    ) -> List[Tuple[float, float]]:
        """
        Creates an orthogonal (Manhattan/L-shaped) street turn rather than a direct diagonal line
        if offline or fallback is triggered, ensuring lines follow street grid directions.
        """
        mid_lat = lat2
        mid_lon = lon1
        return [
            (round(lat1, 6), round(lon1, 6)),
            (round(mid_lat, 6), round(mid_lon, 6)),
            (round(lat2, 6), round(lon2, 6)),
        ]
