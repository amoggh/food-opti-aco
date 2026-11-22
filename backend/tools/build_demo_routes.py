"""Builds frontend/src/data/demoRoutes.json: three distinct real-road routes per demo scenario.

Routes come from the public OSRM server (driving profile), forced apart with via-waypoints placed
either side of the straight line. The output is committed so the demo runs fully offline.

    python -m backend.tools.build_demo_routes
"""
import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

OSRM = "https://router.project-osrm.org/route/v1/driving"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "src" / "data" / "demoRoutes.json"

Point = Tuple[float, float]

SCENARIOS = [
    {
        "key": "scenario_1",
        "title": "Indiranagar → Domlur",
        "restaurant": {"name": "Toit Brewpub, Indiranagar", "lat": 12.97912, "lon": 77.64065, "prep_time": 12},
        "customer": {"name": "Aditi Rao, Domlur 2nd Stage", "lat": 12.9605, "lon": 77.6395, "deadline": 30},
    },
    {
        "key": "scenario_2",
        "title": "Koramangala → HSR Layout",
        "restaurant": {"name": "Truffles, Koramangala 5th Block", "lat": 12.9352, "lon": 77.6245, "prep_time": 15},
        "customer": {"name": "Vikram Sharma, HSR Sector 2", "lat": 12.9175, "lon": 77.6400, "deadline": 35},
    },
    {
        "key": "scenario_3",
        "title": "Church Street → Richmond Town",
        "restaurant": {"name": "Church Street Social, CBD", "lat": 12.9745, "lon": 77.6045, "prep_time": 10},
        "customer": {"name": "Kavya Nair, Langford Town", "lat": 12.9560, "lon": 77.6030, "deadline": 30},
    },
]


def hav(a: Point, b: Point) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def osrm(client: httpx.Client, pts: List[Point]) -> Optional[dict]:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in pts)
    resp = client.get(f"{OSRM}/{coords}", params={"overview": "full", "geometries": "geojson"})
    if resp.status_code != 200 or not resp.json().get("routes"):
        return None
    r = resp.json()["routes"][0]
    return {
        "points": [[round(lat, 6), round(lon, 6)] for lon, lat in r["geometry"]["coordinates"]],
        "distance_km": round(r["distance"] / 1000, 2),
        "duration_min": round(r["duration"] / 60, 1),
    }


def overlap(a: List[List[float]], b: List[List[float]], tol_km: float = 0.035) -> float:
    """Fraction of a's points lying within tol of route b."""
    near = sum(1 for p in a if min(hav(p, q) for q in b) <= tol_km)
    return near / max(1, len(a))


def has_backtrack(pts: List[List[float]]) -> bool:
    """True if the route doubles back on itself (a U-turn around a via-waypoint)."""
    for i in range(0, len(pts), 2):
        for j in range(i + 8, len(pts), 2):
            if hav(pts[i], pts[j]) < 0.02:
                return True
    return False


def unique_block(route: List[List[float]], others: List[List[List[float]]]) -> Tuple[int, int]:
    """Index span of a stretch used by this route only (where a roadblock affects nobody else)."""
    uniq = [all(min(hav(p, q) for q in o) > 0.06 for o in others) for p in route]
    best, cur_start = (0, 0), None
    for i, u in enumerate(uniq + [False]):
        if u and cur_start is None:
            cur_start = i
        elif not u and cur_start is not None:
            if i - cur_start > best[1] - best[0]:
                best = (cur_start, i)
            cur_start = None
    s, e = best
    mid = (s + e) // 2
    half = max(1, min(4, (e - s) // 3))
    return max(s, mid - half), min(e - 1, mid + half)


def build(client: httpx.Client, sc: dict) -> dict:
    a = (sc["restaurant"]["lat"], sc["restaurant"]["lon"])
    b = (sc["customer"]["lat"], sc["customer"]["lon"])
    dlat, dlon = b[0] - a[0], b[1] - a[1]
    candidates = []
    direct = osrm(client, [a, b])
    if direct:
        candidates.append(direct)
    for t in (0.5, 0.35, 0.65):
        for side in (1, -1):
            for k in (0.25, 0.4, 0.55, 0.75):
                via = (a[0] + dlat * t - side * dlon * k, a[1] + dlon * t + side * dlat * k)
                r = osrm(client, [a, via, b])
                if r and not has_backtrack(r["points"]):
                    candidates.append(r)
    shortest = min(c["distance_km"] for c in candidates)
    candidates = [c for c in candidates if c["distance_km"] <= shortest * 1.9]
    candidates.sort(key=lambda c: c["duration_min"])

    chosen = [candidates[0]]
    for c in candidates[1:]:
        if all(overlap(c["points"], x["points"]) < 0.55 and overlap(x["points"], c["points"]) < 0.55 for x in chosen):
            chosen.append(c)
        if len(chosen) == 3:
            break
    if len(chosen) < 3:
        raise RuntimeError(f"{sc['key']}: only {len(chosen)} distinct routes found")

    routes = []
    for i, (rid, color) in enumerate(zip("ABC", ("#38bdf8", "#a78bfa", "#fbbf24"))):
        r = chosen[i]
        others = [chosen[j]["points"] for j in range(3) if j != i]
        bs, be = unique_block(r["points"], others)
        routes.append({"id": rid, "color": color, **r, "block": {"start_idx": bs, "end_idx": be}})

    all_pts = [p for r in routes for p in r["points"]]
    lats, lons = [p[0] for p in all_pts], [p[1] for p in all_pts]
    return {
        "title": sc["title"],
        "restaurant": sc["restaurant"],
        "customer": sc["customer"],
        "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]],
        "routes": routes,
    }


def main() -> None:
    out: Dict[str, dict] = {}
    with httpx.Client(timeout=15) as client:
        for sc in SCENARIOS:
            out[sc["key"]] = build(client, sc)
            rs = out[sc["key"]]["routes"]
            print(sc["key"], [(r["id"], r["distance_km"], r["duration_min"], len(r["points"]), r["block"]) for r in rs])
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
