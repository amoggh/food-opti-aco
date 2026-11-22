import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import demoRoutes from '../../data/demoRoutes.json';
import {
  Play,
  Pause,
  RotateCcw,
  Ban,
  Undo2,
  Thermometer,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Route as RouteIcon,
} from 'lucide-react';

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
  const blockedRef = useRef(new Set());
  const colonyTimer = useRef(null);
  const runCount = useRef(0);
  const onRouteClick = useRef(() => {});

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { blockedRef.current = blocked; }, [blocked]);

  const addLog = useCallback((kind, text) => {
    const t = courier.current.simMin;
    setLog((prev) => [{ id: Date.now() + Math.random(), kind, text, t }, ...prev].slice(0, 12));
  }, []);

  // ----- planning from the courier's current state -----
  const currentAnchor = useCallback(() => {
    const c = courier.current;
    if (!c.path) return { route: routeIds[0], f: 0, pt: [sc.restaurant.lat, sc.restaurant.lon] };
    const a = anchorOf(c.path, c.travelled);
    return { ...a, pt: pointAt(c.path, c.travelled) };
  }, [sc, routeIds]);

  const candidatePlans = useCallback((blockedSet) => {
    const a = currentAnchor();
    const R = sc.routesById[a.route];
    const plans = {};
    if (!courier.current.path) {
      // Not dispatched yet: every open route is a full candidate from the restaurant
      routeIds.forEach((id) => {
        if (blockedSet.has(id)) return;
        const T = sc.routesById[id];
        plans[id] = { target: id, full: true, j: null, k: null, connectorKm: 0, remainingKm: T.total, timeMin: T.duration_min };
      });
      return { anchor: a, R, plans };
    }
    routeIds.forEach((id) => {
      if (blockedSet.has(id) && !(id === R.id && !isBlockedAhead(R, a.f, blockedSet))) return;
      const p = planOnto(sc, a.pt, R, a.f, sc.routesById[id], blockedSet);
      if (p) plans[id] = p;
    });
    return { anchor: a, R, plans };
  }, [sc, routeIds, currentAnchor]);

  // ----- the ant colony -----
  const runColony = useCallback((blockedSet, reason) => {
    clearInterval(colonyTimer.current);
    const { anchor, R, plans } = candidatePlans(blockedSet);
    const ids = Object.keys(plans);
    const bag = courier.current.simMin;
    const routeCosts = {};
    ids.forEach((id) => { routeCosts[id] = costOf(plans[id].connectorKm + plans[id].remainingKm, plans[id].timeMin, bag); });
    setCosts(routeCosts);

    if (ids.length === 0) {
      setPhase('stuck');
      addLog('danger', 'All three routes are blocked — no road to the customer. Unblock one to continue.');
      return;
    }

    setPhase('optimizing');
    addLog('info', `${reason} Colony of ${COLONY.ants} ants evaluating ${ids.length} route${ids.length > 1 ? 's' : ''}…`);

    const rng = mulberry32(7 + runCount.current++);
    const minCost = Math.min(...ids.map((id) => routeCosts[id].total));
    const eta = Object.fromEntries(ids.map((id) => [id, minCost / routeCosts[id].total]));
    const tau = Object.fromEntries(ids.map((id) => [id, 1]));
    let bestId = null;
    let it = 0;

    const normalise = () => {
      const sum = ids.reduce((s, id) => s + tau[id], 0);
      setShare(Object.fromEntries(routeIds.map((id) => [id, ids.includes(id) ? tau[id] / sum : 0])));
    };
    normalise();

    colonyTimer.current = setInterval(() => {
      it += 1;
      const counts = Object.fromEntries(ids.map((id) => [id, 0]));
      const weights = ids.map((id) => tau[id] ** COLONY.alpha * eta[id] ** COLONY.beta);
      const wSum = weights.reduce((s, w) => s + w, 0);
      for (let a = 0; a < COLONY.ants; a++) {
        let r = rng() * wSum;
        let pick = ids[ids.length - 1];
        for (let i = 0; i < ids.length; i++) { r -= weights[i]; if (r <= 0) { pick = ids[i]; break; } }
        counts[pick] += 1;
        if (!bestId || routeCosts[pick].total < routeCosts[bestId].total) bestId = pick;
      }
      ids.forEach((id) => {
        tau[id] *= 1 - COLONY.rho;                                  // evaporation
        tau[id] += (counts[id] / COLONY.ants) * eta[id];            // deposit ∝ 1/cost
      });
      tau[bestId] += 0.5 * eta[bestId];                             // elitist reinforcement
      ids.forEach((id) => { tau[id] = Math.max(0.02, tau[id]); });  // MMAS floor
      normalise();
      setIteration(it);

      if (it >= COLONY.iterations) {
        clearInterval(colonyTimer.current);
        const chosen = ids.reduce((b, id) => (tau[id] > tau[b] ? id : b), ids[0]);
        const plan = plans[chosen];
        const newPath = buildPath(sc, anchor.pt, R, anchor.f, plan);
        const c = courier.current;
        if (c.path && c.travelled > 0) {
          // keep the already-driven stretch on screen after the path is replaced
          const idx = c.path.cum.findIndex((d) => d > c.travelled);
          const driven = [...c.path.points.slice(0, idx === -1 ? c.path.points.length : idx), anchor.pt];
          c.trail = [...(c.trail || []), ...driven];
        }
        c.path = newPath;
        c.travelled = 0;
        setActiveRoute(chosen);
        const cost = routeCosts[chosen].total.toFixed(1);
        if (plan.full) {
          addLog('success', `Route ${chosen} wins (cost ${cost}). Courier departs on Route ${chosen}.`);
        } else if (chosen === R.id && plan.j === null) {
          addLog('success', `Route ${chosen} wins (cost ${cost}). Courier ${c.simMin > 0 ? 'continues' : 'departs'} on Route ${chosen}.`);
        } else if (newPath.backtrackKm > 0.005) {
          addLog('warning', `Rerouted to Route ${chosen} (cost ${cost}): back ${(newPath.backtrackKm * 1000).toFixed(0)} m along Route ${R.id}, then join Route ${chosen}.`);
        } else {
          addLog('warning', `Rerouted to Route ${chosen} (cost ${cost}): turning onto Route ${chosen} at the next junction.`);
        }
        setPhase('driving');
      }
    }, COLONY.tickMs);
  }, [sc, routeIds, candidatePlans, addLog]);

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
      className: 'dark-tiles',
    }).addTo(map);
    ['routes', 'blocks', 'markers', 'planned', 'trail', 'courier'].forEach((k) => { layers.current[k] = L.layerGroup().addTo(map); });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // fit + static markers per scenario
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    map.fitBounds(sc.bounds, { padding: [60, 60] });
    const t = setTimeout(() => { map.invalidateSize(); map.fitBounds(sc.bounds, { padding: [60, 60] }); }, 250);
    const g = layers.current.markers;
    g.clearLayers();
    const icon = (emoji, bg) => L.divIcon({
      className: '',
      html: `<div style="width:34px;height:34px;border-radius:50%;background:${bg};border:2px solid #fafafa;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 10px rgba(0,0,0,.6)">${emoji}</div>`,
      iconSize: [34, 34], iconAnchor: [17, 17],
    });
    L.marker([sc.restaurant.lat, sc.restaurant.lon], { icon: icon('🍕', '#b45309') })
      .bindTooltip(`<b>${sc.restaurant.name}</b><br/>Pickup`, { direction: 'top' }).addTo(g);
    L.marker([sc.customer.lat, sc.customer.lon], { icon: icon('🏠', '#15803d') })
      .bindTooltip(`<b>${sc.customer.name}</b><br/>Drop-off · SLA ${sc.customer.deadline} min`, { direction: 'top' }).addTo(g);
    return () => clearTimeout(t);
  }, [sc]);

  // route lines (thickness = pheromone) + closures
  useEffect(() => {
    const g = layers.current.routes;
    const gb = layers.current.blocks;
    if (!g) return;
    g.clearLayers();
    gb.clearLayers();
    sc.routes.forEach((r) => {
      const isBlocked = blocked.has(r.id);
      const s = share[r.id] ?? 1 / sc.routes.length;
      const isActive = activeRoute === r.id && !isBlocked;
      const line = L.polyline(r.points, isBlocked
        ? { color: '#a1a1aa', weight: 4, opacity: 0.8, dashArray: '6 8' }
        : { color: r.color, weight: 3 + 11 * s, opacity: isActive ? 0.95 : 0.35 + 0.5 * s, lineCap: 'round' });
      line.bindTooltip(`Route ${r.id} · ${r.distance_km} km · ${r.duration_min} min — click to ${isBlocked ? 'reopen' : 'block'}`, { sticky: true });
      line.on('click', () => onRouteClick.current(r.id));
      line.addTo(g);
      // invisible wide hit-area for easy clicking
      L.polyline(r.points, { color: '#000', weight: 22, opacity: 0.001 })
        .on('click', () => onRouteClick.current(r.id)).addTo(g);
      // route label at ~40% along
      const lp = r.points[Math.floor(r.points.length * 0.4)];
      L.marker(lp, {
        interactive: false,
        icon: L.divIcon({ className: '', html: `<div style="background:${isBlocked ? '#3f3f46' : r.color};color:#09090b;font-weight:700;font-size:12px;border-radius:6px;padding:1px 7px;border:1px solid #09090b">${r.id}</div>`, iconSize: [22, 18], iconAnchor: [11, 9] }),
      }).addTo(g);

      if (isBlocked) {
        const pts = r.points.slice(r.block.start_idx, r.block.end_idx + 1);
        L.polyline(pts, { color: '#ef4444', weight: 9, opacity: 0.95 }).addTo(gb);
        const mid = pts[Math.floor(pts.length / 2)];
        L.marker(mid, {
          icon: L.divIcon({ className: '', html: '<div style="font-size:24px;filter:drop-shadow(0 0 6px #ef4444)">⛔</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
        }).bindTooltip(`Road closed on Route ${r.id}`, { direction: 'top' }).addTo(gb);
      }
    });
  }, [sc, blocked, share, activeRoute]);

  // ----- animation loop -----
  useEffect(() => {
    let raf;
    let last = performance.now();
    let lastRender = 0;
    const courierIcon = L.divIcon({
      className: '',
      html: '<div style="width:30px;height:30px;border-radius:50%;background:#22c55e;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 14px #22c55e">🛵</div>',
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = courier.current;
      if (c.path && phaseRef.current === 'driving') {
        const a = anchorOf(c.path, c.travelled);
        const kmPerMin = sc.routesById[a.route]?.speed || 0.5;
        const simDt = dt * SIM_MIN_PER_SEC * speedRef.current;
        c.simMin += simDt;
        c.travelled += kmPerMin * simDt;
        const total = c.path.cum[c.path.cum.length - 1];
        if (c.travelled >= total) {
          c.travelled = total;
          setPhase('delivered');
          phaseRef.current = 'delivered';
          const late = c.simMin > sc.customer.deadline;
          addLog(late ? 'warning' : 'success',
            `Delivered in ${c.simMin.toFixed(1)} min — food at ${foodTempC(c.simMin).toFixed(0)}°C${late ? ' (past SLA)' : ''}.`);
        }
      }
      // draw courier, trail and remaining path
      const gC = layers.current.courier;
      if (gC) {
        const pos = c.path ? pointAt(c.path, c.travelled) : [sc.restaurant.lat, sc.restaurant.lon];
        if (!layers.current.courierMarker) {
          layers.current.courierMarker = L.marker(pos, { icon: courierIcon, zIndexOffset: 1000 }).addTo(gC);
        } else {
          layers.current.courierMarker.setLatLng(pos);
        }
        if (now - lastRender > 100) {
          lastRender = now;
          const gp = layers.current.planned;
          const gt = layers.current.trail;
          gp.clearLayers();
          gt.clearLayers();
          if (c.path) {
            const idx = c.path.cum.findIndex((d) => d > c.travelled);
            const cut = idx === -1 ? c.path.points.length : idx;
            const done = [...c.path.points.slice(0, cut), pos];
            const ahead = [pos, ...c.path.points.slice(cut)];
            if (c.trail) L.polyline(c.trail, { color: '#22c55e', weight: 4, opacity: 0.5 }).addTo(gt);
            L.polyline(done, { color: '#22c55e', weight: 5, opacity: 0.9 }).addTo(gt);
            if (ahead.length > 1) L.polyline(ahead, { color: '#fafafa', weight: 2.5, opacity: 0.9, dashArray: '4 7' }).addTo(gp);
          }
          setTick((t) => t + 1);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sc, addLog]);

  // ----- derived display values -----
  const c = courier.current;
  const bag = c.simMin;
  const temp = foodTempC(bag);
  const tempPct = Math.min(100, (bag / FRESH_LIMIT_MIN) * 100);
  const remainingKm = c.path ? Math.max(0, c.path.cum[c.path.cum.length - 1] - c.travelled) : null;
  const statusText = {
    idle: 'Ready — press Start Delivery to let the colony choose a route.',
    optimizing: `ACO optimizing… iteration ${iteration}/${COLONY.iterations}`,
    driving: `Courier on Route ${activeRoute}`,
    paused: 'Paused',
    delivered: 'Delivered',
    stuck: 'No open route',
  }[phase];

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

      {/* Control panel */}
      <div style={{ width: 360, borderLeft: '1px solid #27272a', background: '#111113', overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <select className="select-shadcn" value={scenarioKey} onChange={(e) => setScenarioKey(e.target.value)}>
          {Object.entries(demoRoutes).map(([k, s], i) => <option key={k} value={k}>{i + 1}. {s.title}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-shadcn" style={{ flex: 1 }} onClick={handlePlay}
            disabled={phase === 'optimizing' || phase === 'delivered' || phase === 'stuck'}>
            {phase === 'driving' ? <><Pause size={14} /> Pause</> : <><Play size={14} /> {phase === 'idle' ? 'Start Delivery' : 'Resume'}</>}
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
          <div style={{ color: '#a1a1aa', fontSize: 11, marginTop: 5 }}>{bag.toFixed(1)} of {FRESH_LIMIT_MIN} min in bag before the food counts as cold</div>
        </div>

        {/* Route cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', justifyContent: 'space-between' }}>
            <span>Candidate routes</span><span>{COLONY.ants} ants × {COLONY.iterations} iterations</span>
          </div>
          {sc.routes.map((r) => {
            const isBlocked = blocked.has(r.id);
            const s = share[r.id] ?? 0;
            const cost = costs[r.id];
            const isActive = activeRoute === r.id && phase !== 'idle';
            return (
              <div key={r.id} style={{ border: `1px solid ${isActive ? r.color : '#27272a'}`, borderRadius: 10, padding: '9px 11px', background: isBlocked ? '#1c1012' : '#18181b' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ background: isBlocked ? '#52525b' : r.color, color: '#09090b', fontWeight: 700, borderRadius: 5, padding: '0 7px', fontSize: 12 }}>{r.id}</span>
                    <span style={{ fontSize: 13 }}>{r.distance_km} km · {r.duration_min} min</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isBlocked ? '#f87171' : isActive ? '#22c55e' : '#71717a' }}>
                    {isBlocked ? 'BLOCKED' : isActive ? 'ACTIVE' : 'standby'}
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
