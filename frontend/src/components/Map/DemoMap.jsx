import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import demoScenariosData from '../../data/demoScenarios.json';
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Route,
  MapPin,
  Store,
  User,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Gauge,
  Clock,
  Layers,
  Compass,
  Zap,
  TrendingUp
} from 'lucide-react';

// Computes cumulative physical road distances along GPS waypoints in meters
function getRouteDistances(points) {
  if (!points || points.length < 2) return { dists: [0], total: 0 };
  const dists = [0];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lon1] = points[i];
    const [lat2, lon2] = points[i + 1];
    const dLat = (lat2 - lat1) * 111320;
    const dLon = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
    const d = Math.sqrt(dLat * dLat + dLon * dLon);
    total += d;
    dists.push(total);
  }
  return { dists, total };
}

// Uniform physical distance interpolation along road curve
function getPointAtProgress(points, distData, progress) {
  if (!points || points.length === 0) return { coord: [0, 0], idx: 0 };
  if (points.length === 1 || !distData || distData.total <= 0) {
    return { coord: points[0], idx: 0 };
  }

  const pClamped = Math.max(0, Math.min(1, progress));
  const targetDist = pClamped * distData.total;
  const { dists } = distData;

  let idx = 0;
  while (idx < dists.length - 1 && dists[idx + 1] < targetDist) {
    idx++;
  }
  if (idx >= points.length - 1) {
    return { coord: points[points.length - 1], idx: points.length - 1 };
  }

  const segDist = dists[idx + 1] - dists[idx];
  const subRatio = segDist > 0 ? (targetDist - dists[idx]) / segDist : 0;
  const pA = points[idx];
  const pB = points[idx + 1];

  const lat = pA[0] + (pB[0] - pA[0]) * subRatio;
  const lon = pA[1] + (pB[1] - pA[1]) * subRatio;

  return { coord: [lat, lon], idx };
}

/*
 * Turn-by-turn ACO demo.
 * Three real-road routes (precomputed from OSRM, see backend/tools/build_demo_routes.py) join the
 * restaurant to the customer. A small ant colony picks the best one by
 *   cost = distance + 1.5·time + 0.5·minutes-in-bag + 5·minutes-past-the-40-min-freshness-limit.
 * Blocking a route re-runs the colony from the courier's *current* position; the courier then
 * follows real roads (back along its current road if needed) to join the best remaining route.
 */

const SIM_MIN_PER_SEC = 0.25;  // simulated minutes per real second at 1x
const FRESH_LIMIT_MIN = 40;    // food is "cold" after this long in the bag
const JOIN_KM = 0.03;          // two routes "meet" where their points are within 30 m
const COLONY = { ants: 12, iterations: 30, alpha: 1, beta: 2, rho: 0.3, tickMs: 55 };

// ---------- geometry helpers ----------
function hav(a, b) {
  const r = 6371.0088;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + hav(points[i - 1], points[i]));
  return cum;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function costOf(distKm, timeMin, bagMin) {
  const inBag = bagMin + timeMin;
  const parts = {
    distance: distKm,
    time: 1.5 * timeMin,
    fresh: 0.5 * inBag,
    cold: 5 * Math.max(0, inBag - FRESH_LIMIT_MIN),
  };
  return { ...parts, total: parts.distance + parts.time + parts.fresh + parts.cold };
}

const foodTempC = (bagMin) => Math.max(20, 85 - 35 * (bagMin / FRESH_LIMIT_MIN));

// ---------- scenario preprocessing ----------
function prepareScenario(sc) {
  const routes = {};
  sc.routes.forEach((r) => {
    const cum = cumulative(r.points);
    const total = cum[cum.length - 1];
    routes[r.id] = { ...r, cum, total, speed: total / r.duration_min }; // km per sim-minute
  });
  // near[R][T][j] = index k on T where R's point j meets T (or -1). Among T points within JOIN_KM,
  // take the one at the same progress along the shared road, so a route that loops back past
  // an earlier spot cannot be "joined" half-way through.
  const near = {};
  Object.values(routes).forEach((R) => {
    near[R.id] = {};
    Object.values(routes).forEach((T) => {
      if (T.id === R.id) return;
      near[R.id][T.id] = R.points.map((p, j) => {
        let best = -1;
        T.points.forEach((q, k) => {
          if (hav(p, q) > JOIN_KM) return;
          if (best < 0 || Math.abs(T.cum[k] - R.cum[j]) < Math.abs(T.cum[best] - R.cum[j])) best = k;
        });
        return best;
      });
    });
  });
  return { ...sc, routesById: routes, near };
}

// Courier position on a composite path -> (route, fractional index on that route)
function anchorOf(path, travelled) {
  const { cum, meta } = path;
  let s = 0;
  while (s < cum.length - 2 && cum[s + 1] < travelled) s++;
  const a = meta[s];
  const b = meta[s + 1] || a;
  if (a.route === b.route) {
    const segLen = cum[s + 1] - cum[s] || 1;
    const t = Math.min(1, Math.max(0, (travelled - cum[s]) / segLen));
    return { route: a.route, f: a.idx + (b.idx - a.idx) * t, seg: s };
  }
  return { route: b.route, f: b.idx, seg: s };
}

function pointAt(path, travelled) {
  const { points, cum } = path;
  if (travelled <= 0) return points[0];
  if (travelled >= cum[cum.length - 1]) return points[points.length - 1];
  let s = 0;
  while (s < cum.length - 2 && cum[s + 1] < travelled) s++;
  const t = (travelled - cum[s]) / (cum[s + 1] - cum[s] || 1);
  return [points[s][0] + (points[s + 1][0] - points[s][0]) * t, points[s][1] + (points[s + 1][1] - points[s][1]) * t];
}

function isBlockedAhead(R, f, blocked) {
  // Forward travel on R is cut if R is blocked and the courier has not yet reached the closed stretch
  return blocked.has(R.id) && f < R.block.start_idx;
}

// Best plan from the courier's position (on route R at fractional index f) onto target route T.
function planOnto(sc, startPt, R, f, T, blocked) {
  const fwdLimit = isBlockedAhead(R, f, blocked) ? R.block.start_idx - 1 : R.points.length - 1;
  const cumAt = (idx) => R.cum[Math.floor(idx)] + (R.cum[Math.ceil(idx)] - R.cum[Math.floor(idx)]) * (idx % 1);
  const here = cumAt(f);

  if (T.id === R.id) {
    if (fwdLimit < R.points.length - 1) return null;
    return { target: T.id, j: null, k: null, connectorKm: 0, remainingKm: R.total - here, timeMin: (R.total - here) / R.speed };
  }

  let best = null;
  const table = sc.near[R.id][T.id];
  for (let j = 0; j < R.points.length; j++) {
    const k = table[j];
    if (k < 0) continue;
    if (j > f && j > fwdLimit) continue;               // can't drive through the closure
    const connectorKm = Math.abs(R.cum[j] - here);
    const remainingKm = T.total - T.cum[k];
    const timeMin = connectorKm / R.speed + remainingKm / T.speed;
    if (!best || timeMin < best.timeMin) best = { target: T.id, j, k, connectorKm, remainingKm, timeMin };
  }
  return best;
}

function buildPath(sc, startPt, R, f, plan) {
  const T = sc.routesById[plan.target];
  if (plan.full) {
    return { points: T.points, meta: T.points.map((_, i) => ({ route: T.id, idx: i })), cum: T.cum, target: T.id, backtrackKm: 0 };
  }
  const points = [startPt];
  const meta = [{ route: R.id, idx: f }];
  const push = (route, idx) => {
    const p = sc.routesById[route].points[idx];
    const last = points[points.length - 1];
    if (last[0] === p[0] && last[1] === p[1]) return;
    points.push(p);
    meta.push({ route, idx });
  };
  if (plan.j === null) {
    for (let i = Math.ceil(f); i < R.points.length; i++) push(R.id, i);
  } else {
    if (plan.j >= f) for (let i = Math.ceil(f); i <= plan.j; i++) push(R.id, i);
    else for (let i = Math.floor(f); i >= plan.j; i--) push(R.id, i);
    for (let k = plan.k; k < T.points.length; k++) push(T.id, k);
  }
  return { points, meta, cum: cumulative(points), target: T.id, backtrackKm: plan.j !== null && plan.j < f ? plan.connectorKm : 0 };
}

// ---------- component ----------
export default function DemoMap() {
  const [scenarioKey, setScenarioKey] = useState('scenario_1');
  const sc = useMemo(() => prepareScenario(demoRoutes[scenarioKey]), [scenarioKey]);
  const routeIds = useMemo(() => sc.routes.map((r) => r.id), [sc]);

  const [blocked, setBlocked] = useState(() => new Set());
  const [share, setShare] = useState({});            // normalised pheromone per route
  const [iteration, setIteration] = useState(0);
  const [phase, setPhase] = useState('idle');        // idle | optimizing | driving | paused | delivered | stuck
  const [speed, setSpeed] = useState(1);
  const [costs, setCosts] = useState({});            // ACO cost per route from the current position
  const [activeRoute, setActiveRoute] = useState(null);
  const [log, setLog] = useState([]);
  const [, setTick] = useState(0);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layers = useRef({});
  const courier = useRef({ path: null, travelled: 0, simMin: 0 });
  const phaseRef = useRef('idle');
  const speedRef = useRef(1);

  // Layers
  const layersRef = useRef({
    primaryRoute: null,
    detourRoute: null,
    roadblockSegment: null,
    roadblockMarkers: null,
    restaurantMarker: null,
    customerMarker: null
  });

  // Calculate active points and metrics
  const activeRoute = roadblockActive ? scenario.detour : scenario.primary;
  const activePoints = activeRoute.points;

  // Identify where detour diverges from primary
  const divergenceIndex = useMemo(() => {
    const p = scenario.primary.points;
    const d = scenario.detour.points;
    let idx = 0;
    while (idx < Math.min(p.length, d.length) && p[idx][0] === d[idx][0] && p[idx][1] === d[idx][1]) {
      idx++;
    }
    return Math.max(1, idx - 1);
  }, [scenario]);

  // ----- block / unblock -----
  const toggleBlock = useCallback((id) => {
    if (phaseRef.current === 'optimizing' || phaseRef.current === 'delivered') return;
    const next = new Set(blockedRef.current);
    const wasBlocked = next.has(id);
    if (wasBlocked) next.delete(id); else next.add(id);
    setBlocked(next);
    blockedRef.current = next;

    const c = courier.current;
    if (wasBlocked) {
      if (phaseRef.current === 'stuck') runColony(next, `Route ${id} reopened.`);
      else addLog('info', `Route ${id} reopened.`);
      return;
    }

    addLog('danger', `Road closure reported on Route ${id}.`);
    if (!c.path) return;                                            // not dispatched yet: colony runs on Play
    const a = anchorOf(c.path, c.travelled);
    const aheadHits = c.path.meta.some((m, i) => {
      if (c.path.cum[i] <= c.travelled) return false;
      const T = sc.routesById[m.route];
      if (!next.has(m.route) || m.idx < T.block.start_idx || m.idx > T.block.end_idx) return false;
      return !(m.route === a.route && a.f >= T.block.start_idx);     // already inside/past it
    });
    if (aheadHits) {
      runColony(next, `Closure is ahead of the courier on Route ${id}.`);
    } else if (a.route === id) {
      addLog('info', `Courier is already past the closure on Route ${id} — no change needed.`);
    } else {
      addLog('info', `Courier is not using Route ${id} — current route unaffected.`);
    }
  }, [sc, addLog, runColony]);
  onRouteClick.current = toggleBlock;

  // ----- controls -----
  const resetState = useCallback(() => {
    clearInterval(colonyTimer.current);
    courier.current = { path: null, travelled: 0, simMin: 0, trail: null };
    setBlocked(new Set());
    blockedRef.current = new Set();
    setShare(Object.fromEntries(routeIds.map((id) => [id, 1 / routeIds.length])));
    setCosts({});
    setIteration(0);
    setActiveRoute(null);
    setPhase('idle');
    setLog([]);
  }, [routeIds]);

  useEffect(() => { resetState(); }, [scenarioKey, resetState]);

  const handlePlay = () => {
    if (phase === 'idle') runColony(blockedRef.current, 'Order picked up.');
    else if (phase === 'driving') setPhase('paused');
    else if (phase === 'paused') setPhase('driving');
  };

  // ----- map setup -----
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      className: 'dark-tiles'
    });
    osmDark.addTo(map);

    // Create layer groups
    layersRef.current.primaryRoute = L.layerGroup().addTo(map);
    layersRef.current.detourRoute = L.layerGroup().addTo(map);
    layersRef.current.roadblockSegment = L.layerGroup().addTo(map);
    layersRef.current.roadblockMarkers = L.layerGroup().addTo(map);
    layersRef.current.restaurantMarker = L.layerGroup().addTo(map);
    layersRef.current.customerMarker = L.layerGroup().addTo(map);

    mapRef.current = map;

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // fit + static markers per scenario
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.flyTo(scenario.center, scenario.zoom, { duration: 1.0 });
    // Reset playback on scenario switch
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCourierProgress(0);
    progressRef.current = 0;
  }, [selectedScenarioKey]);

  // 3. Render Static Markers: Restaurant and Customer
  useEffect(() => {
    if (!mapRef.current) return;

    const restLayer = layersRef.current.restaurantMarker;
    const custLayer = layersRef.current.customerMarker;
    restLayer.clearLayers();
    custLayer.clearLayers();

    // Source Restaurant Marker
    const restIcon = L.divIcon({
      className: 'demo-rest-marker',
      html: `
        <div style="
          background: #18181b;
          border: 2px solid #38bdf8;
          color: #fafafa;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 18px rgba(56, 189, 248, 0.7);
          font-size: 17px;
          cursor: pointer;
          position: relative;
        ">
          🏪
          <span style="
            position: absolute;
            top: -7px;
            right: -7px;
            background: #0284c7;
            color: white;
            font-size: 9px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 4px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.5);
          ">SOURCE</span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    L.marker([sc.restaurant.lat, sc.restaurant.lon], { icon: icon('🍕', '#b45309') })
      .bindTooltip(`<b>${sc.restaurant.name}</b><br/>Pickup`, { direction: 'top' }).addTo(g);
    L.marker([sc.customer.lat, sc.customer.lon], { icon: icon('🏠', '#15803d') })
      .bindTooltip(`<b>${sc.customer.name}</b><br/>Drop-off · SLA ${sc.customer.deadline} min`, { direction: 'top' }).addTo(g);
    return () => clearTimeout(t);
  }, [sc]);

  // route lines (thickness = pheromone) + closures
  useEffect(() => {
    if (!mapRef.current) return;

    const primaryLayer = layersRef.current.primaryRoute;
    const detourLayer = layersRef.current.detourRoute;
    const roadblockSegLayer = layersRef.current.roadblockSegment;
    const roadblockMarkLayer = layersRef.current.roadblockMarkers;

    primaryLayer.clearLayers();
    detourLayer.clearLayers();
    roadblockSegLayer.clearLayers();
    roadblockMarkLayer.clearLayers();

    if (!roadblockActive) {
      // ==========================================
      // NORMAL CLEAR STATE: PRIMARY ROAD IS ACTIVE
      // ==========================================
      // Ambient glow
      L.polyline(scenario.primary.points, {
        color: '#38bdf8',
        weight: 9,
        opacity: 0.3,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(primaryLayer);

      // Main crisp road polyline
      L.polyline(scenario.primary.points, {
        color: '#38bdf8',
        weight: 4.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(primaryLayer);

    } else {
      // ==========================================
      // ROADBLOCK ACTIVE: REAL STREET IS CLOSED
      // & ACO DETOUR SPRINGS INTO ACTION
      // ==========================================

      // 1. Draw the initial approach up to the diversion junction in solid cyan
      const approachPts = scenario.primary.points.slice(0, divergenceIndex + 1);
      if (approachPts.length >= 2) {
        L.polyline(approachPts, {
          color: '#38bdf8',
          weight: 4.5,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(primaryLayer);
      }

      // 2. Draw the blocked road segment directly ON THE ROAD CURVE in warning red
      const blockedRoadPts = scenario.roadblock?.points || [scenario.roadblock.start, scenario.roadblock.end];

      // Red warning glow on the road
      L.polyline(blockedRoadPts, {
        color: '#ef4444',
        weight: 12,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(roadblockSegLayer);

      // Striped / dashed impassable road segment
      L.polyline(blockedRoadPts, {
        color: '#ef4444',
        weight: 6,
        opacity: 1.0,
        dashArray: '8, 6',
        lineCap: 'round',
        lineJoin: 'round'
      }).bindPopup(`
        <div style="font-size: 12px; font-family: var(--font-sans); color: #ef4444; line-height: 1.4;">
          <strong>⛔ Emergency Road Closure Active</strong><br/>
          Street: <strong>${scenario.roadblock.location_name}</strong><br/>
          Cause: ${scenario.roadblock.title}<br/>
          Status: <strong>Impassable &bull; Blocked by Barricade</strong>
        </div>
      `).addTo(roadblockSegLayer);

      // Entrance Barricade Sign
      const entrancePt = blockedRoadPts[0];
      const exitPt = blockedRoadPts[blockedRoadPts.length - 1];
      const midPt = scenario.roadblock.barrier_pos || blockedRoadPts[Math.floor(blockedRoadPts.length / 2)];

      // Main centered barrier badge
      const barrierIcon = L.divIcon({
        className: 'demo-barrier-icon',
        html: `
          <div style="
            background: #ef4444;
            color: #ffffff;
            font-family: var(--font-sans);
            font-size: 11px;
            font-weight: 700;
            padding: 3px 9px;
            border-radius: 4px;
            border: 1.5px solid #ffffff;
            box-shadow: 0 0 16px rgba(239, 68, 68, 0.95);
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 5px;
          ">
            <span>⛔ ROAD CLOSED</span>
          </div>
        `,
        iconSize: [115, 24],
        iconAnchor: [57, 12]
      });

      L.marker(midPt, { icon: barrierIcon }).addTo(roadblockMarkLayer);

      // Barricade cones at entry/exit of closed segment
      const coneIcon = L.divIcon({
        className: 'demo-cone-icon',
        html: `<div style="font-size: 15px; filter: drop-shadow(0 0 6px #ef4444);">🚧</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      L.marker(entrancePt, { icon: coneIcon }).addTo(roadblockMarkLayer);
      L.marker(exitPt, { icon: coneIcon }).addTo(roadblockMarkLayer);

      // 3. Draw Alternate Detour Route in Vivid Emerald Green
      // Ambient Detour Glow
      L.polyline(scenario.detour.points, {
        color: '#10b981',
        weight: 10,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(detourLayer);

      // Sharp Detour Polyline
      L.polyline(scenario.detour.points, {
        color: '#10b981',
        weight: 4.5,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(detourLayer);

      // Diversion Marker at the turn
      const divPt = scenario.primary.points[divergenceIndex];
      const divIcon = L.divIcon({
        className: 'demo-div-icon',
        html: `
          <div style="
            background: #10b981;
            color: #09090b;
            font-family: var(--font-sans);
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            box-shadow: 0 0 10px #10b981;
            white-space: nowrap;
          ">
            &larr; ACO Detour Turn
          </div>
        `,
        iconSize: [95, 20],
        iconAnchor: [47, 10]
      });
      L.marker(divPt, { icon: divIcon }).addTo(detourLayer);
    }
  }, [scenario, roadblockActive, divergenceIndex]);

  // 5. Courier Position Interpolation along Active Road Polyline
  const currentCourierCoord = useMemo(() => {
    const pts = activePoints;
    if (!pts || pts.length === 0) return [scenario.restaurant.lat, scenario.restaurant.lon];
    if (pts.length === 1) return pts[0];

    const totalSegs = pts.length - 1;
    const scaled = courierProgress * totalSegs;
    const segIdx = Math.min(Math.floor(scaled), totalSegs - 1);
    const subProgress = scaled - segIdx;

    const pA = pts[segIdx];
    const pB = pts[segIdx + 1];

    const lat = pA[0] + (pB[0] - pA[0]) * subProgress;
    const lon = pA[1] + (pB[1] - pA[1]) * subProgress;
    return [lat, lon];
  }, [activePoints, courierProgress, scenario]);

  // 6. Update or Create Animated Courier Marker
  useEffect(() => {
    if (!mapRef.current) return;

    const coord = currentCourierCoord;
    const activeColor = roadblockActive ? '#10b981' : '#38bdf8';

    if (!courierMarkerRef.current) {
      const icon = L.divIcon({
        className: 'demo-courier-marker',
        html: `
          <div style="
            background: #09090b;
            border: 2.5px solid ${activeColor};
            color: #ffffff;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 18px ${activeColor};
            font-size: 17px;
            transition: border-color 0.3s;
          ">
            🛵
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      courierMarkerRef.current = L.marker(coord, { icon, zIndexOffset: 1000 }).addTo(mapRef.current);
    } else {
      courierMarkerRef.current.setLatLng(coord);
      const icon = L.divIcon({
        className: 'demo-courier-marker',
        html: `
          <div style="
            background: #09090b;
            border: 2.5px solid ${activeColor};
            color: #ffffff;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 18px ${activeColor};
            font-size: 17px;
            transition: border-color 0.3s;
          ">
            🛵
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });
      courierMarkerRef.current.setIcon(icon);
    }
  }, [currentCourierCoord, roadblockActive]);

  // 7. 60 FPS Animation Loop
  useEffect(() => {
    let lastTime = performance.now();

    const loop = (currentTime) => {
      const dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      if (isPlayingRef.current) {
        // Base travel duration: ~22 seconds full route at 1x
        const step = (dt / 22) * speedRef.current;
        let next = progressRef.current + step;
        if (next >= 1.0) {
          next = 1.0;
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
        progressRef.current = next;
        setCourierProgress(next);
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const handleTogglePlay = () => {
    if (courierProgress >= 1.0) {
      setCourierProgress(0);
      progressRef.current = 0;
    }
    setIsPlaying(prev => !prev);
  };

  const handleReset = () => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCourierProgress(0);
    progressRef.current = 0;
  };

  const handleToggleRoadblock = () => {
    setRoadblockActive(prev => {
      const next = !prev;
      // Keep courier moving or reset progress
      if (courierProgress > 0.8) {
        setCourierProgress(0);
        progressRef.current = 0;
      }
      return next;
    });
  };

  // Metric Deltas
  const distDelta = (scenario.detour.distance_km - scenario.primary.distance_km).toFixed(2);
  const timeDelta = (scenario.detour.duration_min - scenario.primary.duration_min).toFixed(1);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', background: '#09090b', color: '#fafafa', fontFamily: 'var(--font-sans)' }}>
      {/* Map */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, background: 'rgba(24,24,27,.92)', border: '1px solid #27272a', borderRadius: 10, padding: '8px 12px', fontSize: 12, maxWidth: 360 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{sc.title}</div>
          <div style={{ color: '#a1a1aa' }}>Line thickness = pheromone. Click any route on the map to block or reopen it.</div>
        </div>
      </div>

      {/* Courier Animation Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={handleTogglePlay}
          className={`btn-shadcn ${isPlaying ? 'destructive' : 'primary'}`}
          style={{ minWidth: '95px' }}
        >
          {isPlaying ? (
            <>
              <Pause size={14} />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play size={14} fill="currentColor" />
              <span>{courierProgress >= 1.0 ? 'Replay' : 'Drive'}</span>
            </>
          )}
        </button>

        <button
          onClick={handleReset}
          className="btn-shadcn outline"
          title="Reset Courier to Restaurant"
        >
          <RotateCcw size={14} />
        </button>
        <button className="btn-shadcn outline" onClick={resetState}><RotateCcw size={14} /> Reset</button>
        <select className="select-shadcn" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: 70 }}>
          <option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option>
        </select>
      </div>

      <div style={{ background: phase === 'stuck' ? '#450a0a' : '#18181b', border: '1px solid #27272a', borderRadius: 10, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
          {phase === 'optimizing' ? <Sparkles size={15} color="#38bdf8" /> : phase === 'delivered' ? <CheckCircle2 size={15} color="#22c55e" /> : phase === 'stuck' ? <AlertTriangle size={15} color="#ef4444" /> : <RouteIcon size={15} />}
          {statusText}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa', fontSize: 12, marginTop: 6 }}>
          <span>Elapsed {bag.toFixed(1)} min</span>
          <span>{remainingKm !== null ? `${remainingKm.toFixed(2)} km to go` : `SLA ${sc.customer.deadline} min`}</span>
        </div>
      </div>

      {/* Food temperature */}
      <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 10, padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Thermometer size={14} /> Food temperature</span>
          <b style={{ color: temp > 65 ? '#f97316' : temp > 50 ? '#facc15' : '#60a5fa' }}>{temp.toFixed(0)}°C</b>
        </div>
        <div style={{ height: 6, background: '#27272a', borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${tempPct}%`, height: '100%', background: tempPct < 60 ? '#22c55e' : tempPct < 100 ? '#facc15' : '#ef4444' }} />
        </div>

        {/* Roadblock Warning & ACO Dynamic Rerouting Banner */}
        {roadblockActive && scenario.roadblock && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '0.75rem',
            color: '#fca5a5',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#ef4444' }}>
              <ShieldAlert size={15} />
              <span>BLOCKED: {scenario.roadblock.location_name}</span>
            </div>
            <div style={{ color: '#e4e4e7', fontSize: '0.74rem', lineHeight: 1.35 }}>
              {scenario.roadblock.title}. Pheromone cost set to &infin;.
            </div>
            <div style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Zap size={13} />
              <span>{scenario.roadblock.bypass_corridor}</span>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
          background: 'rgba(9, 9, 11, 0.65)',
          padding: '10px',
          borderRadius: '6px',
          border: '1px solid #27272a',
          marginBottom: '10px'
        }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#71717a' }}>Travel Distance</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {activeRoute.distance_km} km
              {roadblockActive && (
                <span style={{ fontSize: '0.72rem', color: '#f59e0b', marginLeft: '4px', fontWeight: 500 }}>
                  (+{distDelta}km)
                </span>
                </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
              <div style={{ flex: 1, height: 6, background: '#27272a', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${(s * 100).toFixed(1)}%`, height: '100%', background: isBlocked ? '#52525b' : r.color, transition: 'width 60ms linear' }} />
              </div>
              <span style={{ fontSize: 11, color: '#a1a1aa', width: 70, textAlign: 'right' }}>pheromone {(s * 100).toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}>
              <span style={{ fontSize: 11, color: '#a1a1aa' }} title={cost ? `distance ${cost.distance.toFixed(1)} + time ${cost.time.toFixed(1)} + freshness ${cost.fresh.toFixed(1)} + cold ${cost.cold.toFixed(1)}` : ''}>
                {isBlocked ? 'cost ∞ (closed)' : cost ? `ACO cost ${cost.total.toFixed(1)}` : 'cost computed on dispatch'}
              </span>
              <button className="btn-shadcn outline" style={{ padding: '2px 9px', fontSize: 11 }}
                onClick={() => toggleBlock(r.id)} disabled={phase === 'optimizing' || phase === 'delivered'}>
                {isBlocked ? <><Undo2 size={12} /> Reopen</> : <><Ban size={12} /> Block</>}
              </button>
            </div>
          </div>
          );
          })}
          <div style={{ fontSize: 11, color: '#71717a' }}>
            Cost = distance + 1.5·time + 0.5·minutes in bag + 5·minutes past {FRESH_LIMIT_MIN} min (cold food). Recomputed from the courier's current position when a road closes.
          </div>
        </div>

        {/* Event log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#a1a1aa' }}>Dispatch log</div>
          {log.length === 0 && <div style={{ fontSize: 12, color: '#52525b' }}>No events yet.</div>}
          {log.map((e) => (
            <div key={e.id} style={{ fontSize: 12, borderLeft: `3px solid ${{ success: '#22c55e', warning: '#facc15', danger: '#ef4444', info: '#38bdf8' }[e.kind]}`, padding: '3px 8px', background: '#18181b', borderRadius: 4 }}>
              <span style={{ color: '#71717a' }}>{e.t.toFixed(1)}m </span>{e.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
