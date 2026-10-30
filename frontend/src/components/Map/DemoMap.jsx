import React, { useState, useEffect, useRef, useMemo } from 'react';
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

export default function DemoMap() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const animationFrameRef = useRef(null);
  const courierMarkerRef = useRef(null);

  // Scenarios: scenario_1, scenario_2, scenario_3
  const [selectedScenarioKey, setSelectedScenarioKey] = useState('scenario_1');
  const scenario = demoScenariosData[selectedScenarioKey] || demoScenariosData.scenario_1;

  // Roadblock state
  const [roadblockActive, setRoadblockActive] = useState(false);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 1x, 2x, 5x
  const [courierProgress, setCourierProgress] = useState(0); // 0.0 to 1.0

  // Animation refs to avoid closure stalls
  const progressRef = useRef(0);
  const isPlayingRef = useRef(false);
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

  // Sync state to refs
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    progressRef.current = courierProgress;
  }, [courierProgress]);

  // 1. Initialize Leaflet Map (Free OSM with Shadcn Dark Mode CSS Filter, Zero API Key required)
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: scenario.center,
      zoom: scenario.zoom,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const osmDark = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
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

  // 2. Center and Zoom on Scenario change
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

    const restMarker = L.marker([scenario.restaurant.lat, scenario.restaurant.lon], { icon: restIcon });
    restMarker.bindPopup(`
      <div style="font-size: 12px; font-family: var(--font-sans); color: #fafafa; line-height: 1.4;">
        <strong style="color: #38bdf8; font-size: 13px;">🏪 Source Restaurant</strong><br/>
        <strong>${scenario.restaurant.name}</strong><br/>
        <span style="color: #a1a1aa;">Order Prep: ${scenario.restaurant.prep_time} min</span>
      </div>
    `);
    restMarker.addTo(restLayer);

    // Destination Customer Marker
    const custIcon = L.divIcon({
      className: 'demo-cust-marker',
      html: `
        <div style="
          background: #18181b;
          border: 2px solid #10b981;
          color: #fafafa;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 18px rgba(16, 185, 129, 0.7);
          font-size: 17px;
          cursor: pointer;
          position: relative;
        ">
          📍
          <span style="
            position: absolute;
            top: -7px;
            right: -7px;
            background: #059669;
            color: white;
            font-size: 9px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 4px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.5);
          ">DEST</span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const custMarker = L.marker([scenario.customer.lat, scenario.customer.lon], { icon: custIcon });
    custMarker.bindPopup(`
      <div style="font-size: 12px; font-family: var(--font-sans); color: #fafafa; line-height: 1.4;">
        <strong style="color: #10b981; font-size: 13px;">🎯 Customer Destination</strong><br/>
        <strong>${scenario.customer.name}</strong><br/>
        <span style="color: #a1a1aa;">Delivery SLA: &le; ${scenario.customer.deadline} min</span>
      </div>
    `);
    custMarker.addTo(custLayer);
  }, [scenario]);

  // 4. Render Routes & Roadblocks Directly Along Physical Street Geometry
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
    <div className="demo-map-container" style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: 'calc(100vh - 120px)',
      background: '#09090b',
      color: '#fafafa',
      fontFamily: 'var(--font-sans)',
      position: 'relative'
    }}>
      {/* Top Controls Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 18px',
        background: '#18181b',
        borderBottom: '1px solid #27272a',
        flexWrap: 'wrap',
        gap: '12px',
        zIndex: 10
      }}>
        {/* Scenario Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={16} style={{ color: '#38bdf8' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Corridor:</span>
          </div>

          <select
            className="select-shadcn"
            value={selectedScenarioKey}
            onChange={(e) => {
              setSelectedScenarioKey(e.target.value);
              setRoadblockActive(false);
            }}
            style={{ minWidth: '300px', fontWeight: 500 }}
          >
            <option value="scenario_1">📍 1. Indiranagar (Toit Brewpub &rarr; Defence Colony)</option>
            <option value="scenario_2">📍 2. Koramangala (Truffles 5th Blk &rarr; Wipro Park)</option>
            <option value="scenario_3">📍 3. CBD Corridor (Church St &rarr; Richmond Town)</option>
          </select>
        </div>

        {/* Dynamic Roadblock Toggle Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {roadblockActive ? (
            <button
              onClick={handleToggleRoadblock}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 15px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 0 14px rgba(16, 185, 129, 0.5)'
              }}
              title="Remove the simulated road closure and restore direct primary path"
            >
              <CheckCircle2 size={16} />
              <span>Clear Roadblock &amp; Restore Direct Road</span>
            </button>
          ) : (
            <button
              onClick={handleToggleRoadblock}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 15px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 0 16px rgba(239, 68, 68, 0.6)'
              }}
              title="Close the street segment to trigger ACO dynamic detour calculation"
            >
              <AlertTriangle size={16} />
              <span>Block Street &amp; Compute Alternate Optimal Detour</span>
            </button>
          )}
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

          <select
            className="select-shadcn"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            style={{ width: '75px', padding: '4px 6px' }}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="5">5x</option>
          </select>
        </div>
      </div>

      {/* Main Map View Area */}
      <div style={{ position: 'relative', flex: 1, width: '100%' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#09090b' }} />

        {/* Floating Telemetry & Analysis HUD */}
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          background: 'rgba(24, 24, 27, 0.94)',
          backdropFilter: 'blur(10px)',
          border: '1px solid #27272a',
          borderRadius: '8px',
          padding: '14px 18px',
          maxWidth: '380px',
          width: '100%',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7)',
          zIndex: 500,
          pointerEvents: 'auto'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#a1a1aa', fontWeight: 600 }}>
              ACO Routing Telemetry
            </span>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '3px 9px',
              borderRadius: '4px',
              background: roadblockActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
              color: roadblockActive ? '#10b981' : '#38bdf8',
              border: `1px solid ${roadblockActive ? '#10b981' : '#38bdf8'}`
            }}>
              {roadblockActive ? 'ACO DETOUR ACTIVE' : 'OPTIMAL DIRECT PATH'}
            </span>
          </div>

          {/* Locations */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.82rem', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Store size={14} style={{ color: '#38bdf8' }} />
              <span style={{ fontWeight: 600 }}>{scenario.restaurant.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '4px' }}>
              <div style={{ width: '1px', height: '12px', background: '#3f3f46', marginLeft: '2px' }} />
              <span style={{ color: '#71717a', fontSize: '0.74rem' }}>
                {roadblockActive ? 'Alternate street corridor' : 'Direct physical arterial route'} ({activePoints.length} GPS vertices)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={14} style={{ color: '#10b981' }} />
              <span style={{ fontWeight: 600 }}>{scenario.customer.name}</span>
            </div>
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
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#71717a' }}>Est. Travel Time</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {activeRoute.duration_min} min
                {roadblockActive && (
                  <span style={{ fontSize: '0.72rem', color: '#f59e0b', marginLeft: '4px', fontWeight: 500 }}>
                    (+{timeDelta}m)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Courier Progress Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#a1a1aa', marginBottom: '4px' }}>
              <span>Courier Transit</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(courierProgress * 100)}%</span>
            </div>
            <div style={{
              width: '100%',
              height: '6px',
              background: '#27272a',
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${courierProgress * 100}%`,
                height: '100%',
                background: roadblockActive ? '#10b981' : '#38bdf8',
                transition: 'width 0.1s linear'
              }} />
            </div>
          </div>
        </div>

        {/* Legend Overlay at Bottom Left */}
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '16px',
          background: 'rgba(24, 24, 27, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #27272a',
          borderRadius: '6px',
          padding: '8px 14px',
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          zIndex: 500,
          pointerEvents: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '4px', background: '#38bdf8', borderRadius: '2px' }} />
            <span>Direct Street Route</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '4px', background: '#10b981', borderRadius: '2px' }} />
            <span>ACO Detour Route</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '4px', background: '#ef4444', borderRadius: '2px' }} />
            <span>Closed Road Segment</span>
          </div>
        </div>
      </div>
    </div>
  );
}
