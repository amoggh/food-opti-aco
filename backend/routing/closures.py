"""Road closures on real (OSRM) road geometry, and detours that provably avoid them.

The public OSRM server cannot be told to avoid a road, so a detour is found by routing through
via-points placed either side of the closure and keeping the shortest candidate whose geometry
stays clear of every closed stretch.
"""
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

from backend.routing.osm_router import OSMRouter, haversine_distance_km

LatLon = Tuple[float, float]

HIT_TOLERANCE_KM = 0.02      # a path "uses" a closure if it passes within 20 m of it
DETOUR_OFFSETS_KM = (0.35, 0.6, 1.0, 1.6)      # via-points beside the middle of the closure
END_OFFSETS_KM = (0.15, 0.3, 0.5, 0.8)          # via-points beside each end of the closure
ACCESS_KM = 0.3              # a stop this close to a closure may only be reachable through it
MIN_OVERLAP_KM = 0.06        # driving ≥ 60 m along a closure counts as using it (a crossing is ~40 m)


@dataclass
class RoadClosure:
    closure_id: str
    coords: List[List[float]]
    name: str = "Road closure"
    dense: List[LatLon] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.dense = densify(self.coords, step_km=0.02)

    @property
    def center(self) -> LatLon:
        return tuple(self.coords[len(self.coords) // 2])  # type: ignore[return-value]

    def to_dict(self) -> dict:
        return {"edge_id": self.closure_id, "name": self.name, "coords": self.coords}


def _xy(p: Sequence[float], lat0: float) -> Tuple[float, float]:
    """Local equirectangular projection in km."""
    return (p[1] * 111.320 * math.cos(math.radians(lat0)), p[0] * 110.574)


def densify(coords: Sequence[Sequence[float]], step_km: float) -> List[LatLon]:
    out: List[LatLon] = []
    for a, b in zip(coords, coords[1:]):
        d = haversine_distance_km(a[0], a[1], b[0], b[1])
        n = max(1, int(d / step_km))
        for i in range(n):
            t = i / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if coords:
        out.append((coords[-1][0], coords[-1][1]))
    return out


def _point_segment_km(p: LatLon, a: Sequence[float], b: Sequence[float]) -> float:
    lat0 = p[0]
    px, py = _xy(p, lat0)
    ax, ay = _xy(a, lat0)
    bx, by = _xy(b, lat0)
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def _dist_to_polyline_km(p: LatLon, line: Sequence[Sequence[float]]) -> float:
    return min(_point_segment_km(p, a, b) for a, b in zip(line, line[1:]))


def path_hits(path: Sequence[Sequence[float]], closures: Sequence[RoadClosure],
              tol_km: float = HIT_TOLERANCE_KM, skip_near: Optional[LatLon] = None,
              ignore_near: Sequence[LatLon] = (), min_overlap_km: float = MIN_OVERLAP_KM) -> Optional[RoadClosure]:
    """Returns the first closure the path drives *along* (≥ min_overlap_km within tol of it).

    Crossing a closed road at an intersection is allowed. Closures the courier is already on
    (`skip_near`) are ignored, and so are path segments within ACCESS_KM of any `ignore_near` point.
    """
    for c in closures:
        if skip_near and min(haversine_distance_km(skip_near[0], skip_near[1], q[0], q[1]) for q in c.dense) < 0.05:
            continue
        lats = [q[0] for q in c.dense]
        lons = [q[1] for q in c.dense]
        pad = 0.0005
        box = (min(lats) - pad, max(lats) + pad, min(lons) - pad, max(lons) + pad)
        overlap = 0.0
        for a, b in zip(path, path[1:]):
            if max(a[0], b[0]) < box[0] or min(a[0], b[0]) > box[1] or max(a[1], b[1]) < box[2] or min(a[1], b[1]) > box[3]:
                continue
            if ignore_near and any(min(haversine_distance_km(a[0], a[1], z[0], z[1]),
                                       haversine_distance_km(b[0], b[1], z[0], z[1])) <= ACCESS_KM for z in ignore_near):
                continue
            seg_km = haversine_distance_km(a[0], a[1], b[0], b[1])
            n = max(1, int(seg_km / 0.005))                      # sample every ~5 m
            inside = 0
            for i in range(n):
                t = (i + 0.5) / n
                q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                if _dist_to_polyline_km(q, c.coords) <= tol_km:
                    inside += 1
            overlap += seg_km * inside / n
            if overlap >= min_overlap_km:
                return c
    return None


def closure_from_path(path: Sequence[Sequence[float]], click: LatLon, half_len_km: float = 0.12,
                      max_snap_km: float = 0.15) -> Optional[List[List[float]]]:
    """The stretch of `path` within ±half_len_km (along the road) of the point nearest the click."""
    if len(path) < 2:
        return None
    best_i, best_d = 0, float("inf")
    for i, (a, b) in enumerate(zip(path, path[1:])):
        d = _point_segment_km(click, a, b)
        if d < best_d:
            best_i, best_d = i, d
    if best_d > max_snap_km:
        return None
    dense = densify(path, step_km=0.01)
    # index of dense point nearest the click
    k = min(range(len(dense)), key=lambda j: haversine_distance_km(click[0], click[1], dense[j][0], dense[j][1]))
    lo, acc = k, 0.0
    while lo > 0 and acc < half_len_km:
        acc += haversine_distance_km(dense[lo][0], dense[lo][1], dense[lo - 1][0], dense[lo - 1][1])
        lo -= 1
    hi, acc = k, 0.0
    while hi < len(dense) - 1 and acc < half_len_km:
        acc += haversine_distance_km(dense[hi][0], dense[hi][1], dense[hi + 1][0], dense[hi + 1][1])
        hi += 1
    seg = dense[lo:hi + 1]
    step = max(1, len(seg) // 12)
    pts = seg[::step]
    if pts[-1] != seg[-1]:
        pts.append(seg[-1])
    return [[round(p[0], 6), round(p[1], 6)] for p in pts]


def _via_candidates(closure: RoadClosure) -> List[LatLon]:
    a, b = closure.coords[0], closure.coords[-1]
    m = closure.center
    lat0 = m[0]
    ax, ay = _xy(a, lat0)
    bx, by = _xy(b, lat0)
    dx, dy = bx - ax, by - ay
    norm = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / norm, dx / norm                       # unit normal in km space
    kx = 111.320 * math.cos(math.radians(lat0))
    vias = []
    for anchor, offsets in ((m, DETOUR_OFFSETS_KM), (a, END_OFFSETS_KM), (b, END_OFFSETS_KM)):
        for off in offsets:
            for side in (1, -1):
                vias.append((anchor[0] + ny * off * side / 110.574, anchor[1] + nx * off * side / kx))
    return vias


def route_avoiding(router: OSMRouter, start: LatLon, end: LatLon, closures: Sequence[RoadClosure],
                   skip_near: Optional[LatLon] = None,
                   base: Optional[List[LatLon]] = None) -> Tuple[List[LatLon], str]:
    """Road path start→end avoiding all closures.

    Tries, in order: OSRM's own alternative routes (one request), via-points beside the middle
    of the closure, then via-points beside each end. Only real OSRM geometry is accepted.

    Status: "clear" (base path never touched a closure), "detoured", "access" (the only crossing
    is the final/initial approach to a stop on the closed street — unavoidable), or "blocked".
    """
    if base is None:
        base, _, _ = router.get_route(start[0], start[1], end[0], end[1])
    hit = path_hits(base, closures, skip_near=skip_near)
    if hit is None:
        return list(base), "clear"

    relaxed: List[Tuple[float, List[LatLon]]] = []

    def judge(routes) -> Optional[List[LatLon]]:
        strict = []
        for coords, dist, _ in routes:
            if not coords or len(coords) < 2:
                continue
            if path_hits(coords, closures, skip_near=skip_near) is None:
                strict.append((dist, coords))
            elif path_hits(coords, closures, skip_near=skip_near, ignore_near=(start, end)) is None:
                relaxed.append((dist, coords))
        return min(strict, key=lambda x: x[0])[1] if strict else None

    found = judge(router.query_routes([start, end], alternatives=True))
    if found:
        return found, "detoured"

    vias = _via_candidates(hit)
    for stage in (vias[: len(DETOUR_OFFSETS_KM) * 2], vias[len(DETOUR_OFFSETS_KM) * 2:]):
        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = list(pool.map(lambda v: router.query_routes([start, v, end], timeout=3.0), stage))
        found = judge([r for batch in batches for r in batch])
        if found:
            return found, "detoured"

    if path_hits(base, closures, skip_near=skip_near, ignore_near=(start, end)) is None:
        return list(base), "access"
    if relaxed:
        return min(relaxed, key=lambda x: x[0])[1], "access"
    return list(base), "blocked"


def nearest_distance_km(path: Sequence[Sequence[float]], p: LatLon) -> float:
    if len(path) < 2:
        return float("inf")
    return min(_point_segment_km(p, a, b) for a, b in zip(path, path[1:]))


def fix_path_for_closures(router: OSMRouter, path: Sequence[Sequence[float]], stops: Sequence[LatLon],
                          closures: Sequence[RoadClosure], current: LatLon) -> Tuple[List[LatLon], set]:
    """Keeps every leg of an existing multi-stop path that is clear, and re-routes only the legs
    that cross a closure. `stops` are the remaining stops in visiting order; `path` starts at `current`."""
    if len(path) < 2 or not stops:
        return [tuple(p) for p in path], set()
    # Split the path into legs at the vertex nearest each stop (searching forward)
    cut = [0]
    for s in stops:
        lo = cut[-1]
        j = min(range(lo, len(path)), key=lambda i: haversine_distance_km(s[0], s[1], path[i][0], path[i][1]))
        cut.append(j)
    cut[-1] = len(path) - 1
    out: List[LatLon] = []
    statuses = set()
    leg_starts = [current] + list(stops[:-1])
    for n, (a_i, b_i) in enumerate(zip(cut, cut[1:])):
        piece = [tuple(p) for p in path[a_i:b_i + 1]]
        if len(piece) < 2:
            piece = [leg_starts[n], stops[n]]
        skip = current if n == 0 else None
        if path_hits(piece, closures, skip_near=skip) is not None:
            piece, status = route_avoiding(router, leg_starts[n], stops[n], closures, skip_near=skip, base=piece)
            statuses.add(status)
        if out and piece and out[-1] == tuple(piece[0]):
            piece = piece[1:]
        out.extend(tuple(p) for p in piece)
    return out, statuses
