"""Offline tests for road-closure geometry (no OSRM calls)."""
from backend.routing.closures import RoadClosure, closure_from_path, nearest_distance_km, path_hits

# A straight east-west road ~1.1 km long, and a parallel road ~330 m north of it
ROAD = [[12.9700, 77.6000 + i * 0.001] for i in range(11)]
PARALLEL = [[12.9730, 77.6000 + i * 0.001] for i in range(11)]


def test_closure_is_cut_from_the_clicked_road():
    coords = closure_from_path(ROAD, (12.97005, 77.6050))
    assert coords is not None
    # ~240 m stretch centred on the click, lying on the road
    assert 12.9699 < min(p[0] for p in coords) and max(p[0] for p in coords) < 12.9701
    assert min(p[1] for p in coords) < 77.6050 < max(p[1] for p in coords)
    assert max(p[1] for p in coords) - min(p[1] for p in coords) < 0.0035


def test_click_far_from_any_route_is_rejected():
    assert closure_from_path(ROAD, (12.9800, 77.6050)) is None
    assert nearest_distance_km(ROAD, (12.9800, 77.6050)) > 1.0


def test_path_hits_only_paths_using_the_closed_road():
    closure = RoadClosure("C1", closure_from_path(ROAD, (12.9700, 77.6050)))
    assert path_hits(ROAD, [closure]) is closure
    assert path_hits(PARALLEL, [closure]) is None


def test_courier_already_on_the_closure_is_not_trapped():
    closure = RoadClosure("C1", closure_from_path(ROAD, (12.9700, 77.6050)))
    assert path_hits(ROAD[5:], [closure], skip_near=(12.9700, 77.6050)) is None


def test_crossing_a_closed_road_at_an_intersection_is_allowed():
    closure = RoadClosure("C1", closure_from_path(ROAD, (12.9700, 77.6050)))
    north_south = [[12.9650, 77.6050], [12.9700, 77.6050], [12.9750, 77.6050]]
    assert path_hits(north_south, [closure]) is None


def test_stop_on_the_closed_street_counts_as_access_only():
    closure = RoadClosure("C1", closure_from_path(ROAD, (12.9700, 77.6050)))
    # comes down a side street, then drives ~200 m along the closed road to a stop on it
    approach = PARALLEL[:3] + [[12.9715, 77.6025], [12.9700, 77.6030], [12.9700, 77.6040], [12.9700, 77.6050]]
    assert path_hits(approach, [closure]) is closure
    assert path_hits(approach, [closure], ignore_near=[(12.9700, 77.6050)]) is None
