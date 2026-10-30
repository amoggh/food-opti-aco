import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { getStreetRoute } from '../../services/osrm';
import { api } from '../../services/api';
import { 
  Crosshair, 
  Ban, 
  RotateCcw, 
  X, 
  CheckCircle, 
  AlertTriangle, 
  Navigation,
  Layers,
  Eye,
  EyeOff
} from 'lucide-react';

// Minimalist palette for courier lines
const RIDER_COLORS = [
  '#38bdf8', '#818cf8', '#34d399', '#fb7185', '#fbbf24',
  '#a855f7', '#22d3ee', '#f472b6', '#2dd4bf', '#f97316',
  '#60a5fa', '#c084fc', '#4ade80', '#e879f9', '#fde047',
  '#14b8a6', '#a78bfa', '#fb923c', '#06b6d4', '#a3e635'
];

export default function DeliveryMap({
  restaurants = [],
  customers = [],
  roadGraph = null,
  riders = [],
  orders = [],
  closedEdges = [],
  blockedEdgesInfo = [],
  bestPlan = null,
  selectedRiderId = null,
  onSelectRider = () => {},
  focusedOrderId = null,
  onSelectOrder = () => {},
  onRefreshState = () => {}
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({
    roadNetwork: null,
    routes: null,
    restaurants: null,
    customers: null,
    riders: null,
    detour: null,
    roadblock: null
  });

  const [hideOtherEntities, setHideOtherEntities] = useState(true);
  const [isBlockingRoute, setIsBlockingRoute] = useState(false);
  const [blockStatusMsg, setBlockStatusMsg] = useState(null);

  // Identify focused order details
  const focusedOrder = useMemo(() => {
    return orders.find(o => o.order_id === focusedOrderId) || null;
  }, [orders, focusedOrderId]);

  const focusedPickupRest = useMemo(() => {
    if (!focusedOrder) return null;
    return restaurants.find(r => r.restaurant_id === focusedOrder.restaurant_id) || null;
  }, [restaurants, focusedOrder]);

  const focusedDropoffCust = useMemo(() => {
    if (!focusedOrder) return null;
    return customers.find(c => c.customer_id === focusedOrder.customer_id) || null;
  }, [customers, focusedOrder]);

  const focusedAssignedRider = useMemo(() => {
    if (!focusedOrder) return null;
    return riders.find(r => r.rider_id === focusedOrder.assigned_rider_id) ||
      riders.find(r => (r.assigned_stops || []).some(s => s.order_id === focusedOrder.order_id)) ||
      riders.find(r => (r.carried_orders || []).includes(focusedOrder.order_id)) ||
      (riders.length > 0 ? riders[0] : null);
  }, [riders, focusedOrder]);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Bangalore simulation center
    const map = L.map(mapContainerRef.current, {
      center: [12.9716, 77.5946],
      zoom: 13,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const osmDark = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      className: 'dark-tiles'
    });

    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    });

    osmDark.addTo(map);

    layersRef.current.roadNetwork = L.layerGroup();
    layersRef.current.routes = L.layerGroup().addTo(map);
    layersRef.current.detour = L.layerGroup().addTo(map);
    layersRef.current.roadblock = L.layerGroup().addTo(map);
    layersRef.current.restaurants = L.layerGroup().addTo(map);
    layersRef.current.customers = L.layerGroup().addTo(map);
    layersRef.current.riders = L.layerGroup().addTo(map);

    const baseMaps = { 'Dark Map': osmDark, 'Standard OSM': osmStandard };
    const overlayMaps = {
      'Road Routes': layersRef.current.routes,
      'Couriers': layersRef.current.riders,
      'Restaurants': layersRef.current.restaurants,
      'Customers': layersRef.current.customers,
      'Grid Graph': layersRef.current.roadNetwork
    };
    L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Auto-Fit Map Bounds when an order is focused
  useEffect(() => {
    if (!mapRef.current || !focusedOrder) return;

    const boundsPoints = [];
    if (focusedPickupRest) {
      boundsPoints.push([focusedPickupRest.latitude, focusedPickupRest.longitude]);
    }
    if (focusedDropoffCust) {
      boundsPoints.push([focusedDropoffCust.latitude, focusedDropoffCust.longitude]);
    }
    if (focusedAssignedRider) {
      boundsPoints.push([focusedAssignedRider.current_lat, focusedAssignedRider.current_lon]);
    }

    if (boundsPoints.length >= 2) {
      try {
        const bounds = L.latLngBounds(boundsPoints);
        mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      } catch (e) {
        // ignore
      }
    }
  }, [focusedOrderId, focusedPickupRest, focusedDropoffCust, focusedAssignedRider]);

  // 3. Render Static Entities (Restaurants & Customers) with Focus Filtering
  useEffect(() => {
    if (!mapRef.current) return;

    const restLayer = layersRef.current.restaurants;
    const custLayer = layersRef.current.customers;
    restLayer.clearLayers();
    custLayer.clearLayers();

    // In Focus Mode with Hide Others: only show the relevant pickup and dropoff
    const restsToRender = (focusedOrder && hideOtherEntities)
      ? (focusedPickupRest ? [focusedPickupRest] : [])
      : restaurants;

    const custsToRender = (focusedOrder && hideOtherEntities)
      ? (focusedDropoffCust ? [focusedDropoffCust] : [])
      : customers;

    // Render Restaurants
    restsToRender.forEach(r => {
      const lat = typeof r.latitude === 'number' ? r.latitude : parseFloat(r.latitude);
      const lon = typeof r.longitude === 'number' ? r.longitude : parseFloat(r.longitude);
      if (isNaN(lat) || isNaN(lon)) return;

      const isTarget = focusedOrder && r.restaurant_id === focusedOrder.restaurant_id;

      const icon = L.divIcon({
        className: 'custom-rest-marker',
        html: `
          <div style="
            background: ${isTarget ? '#fafafa' : '#18181b'};
            color: ${isTarget ? '#09090b' : '#fafafa'};
            border: 2px solid ${isTarget ? '#38bdf8' : '#3f3f46'};
            width: ${isTarget ? '26px' : '20px'};
            height: ${isTarget ? '26px' : '20px'};
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: ${isTarget ? '0 0 12px rgba(56, 189, 248, 0.6)' : '0 1px 4px rgba(0,0,0,0.4)'};
            font-size: ${isTarget ? '13px' : '10px'};
            cursor: pointer;
          ">🏪</div>
        `,
        iconSize: [isTarget ? 26 : 20, isTarget ? 26 : 20],
        iconAnchor: [isTarget ? 13 : 10, isTarget ? 13 : 10]
      });

      const marker = L.marker([lat, lon], { icon });
      marker.bindPopup(`
        <div style="font-size: 12px; font-family: var(--font-sans); line-height: 1.4;">
          <strong>${isTarget ? '⭐ Pickup Location: ' : ''}${r.name || r.restaurant_id}</strong><br/>
          <span style="color: #a1a1aa; font-size: 11px;">Restaurant ID: ${r.restaurant_id}</span><br/>
          Avg Prep: <strong>${r.average_preparation_time_min || r.preparation_time || 15} min</strong>
        </div>
      `);
      marker.addTo(restLayer);
    });

    // Render Customers
    custsToRender.forEach(c => {
      const lat = typeof c.latitude === 'number' ? c.latitude : parseFloat(c.latitude);
      const lon = typeof c.longitude === 'number' ? c.longitude : parseFloat(c.longitude);
      if (isNaN(lat) || isNaN(lon)) return;

      const isTarget = focusedOrder && c.customer_id === focusedOrder.customer_id;

      const icon = L.divIcon({
        className: 'custom-cust-marker',
        html: `
          <div style="
            background: ${isTarget ? '#38bdf8' : 'rgba(56, 189, 248, 0.6)'};
            width: ${isTarget ? '16px' : '9px'};
            height: ${isTarget ? '16px' : '9px'};
            border-radius: 50%;
            border: 2px solid ${isTarget ? '#ffffff' : '#09090b'};
            box-shadow: ${isTarget ? '0 0 10px rgba(56, 189, 248, 0.8)' : 'none'};
            cursor: pointer;
          "></div>
        `,
        iconSize: [isTarget ? 16 : 9, isTarget ? 16 : 9],
        iconAnchor: [isTarget ? 8 : 4.5, isTarget ? 8 : 4.5]
      });

      const marker = L.marker([lat, lon], { icon });
      marker.bindPopup(`
        <div style="font-size: 12px; font-family: var(--font-sans); line-height: 1.4;">
          <strong>${isTarget ? '🎯 Delivery Target: ' : ''}${c.name || c.customer_id}</strong><br/>
          <span style="color: #a1a1aa; font-size: 11px;">Customer ID: ${c.customer_id}</span>
        </div>
      `);
      marker.addTo(custLayer);
    });
  }, [restaurants, customers, focusedOrder, hideOtherEntities, focusedPickupRest, focusedDropoffCust]);

  // 4. Render Active Delivery Routes & Couriers with Focus Filtering & Detour Highlight
  useEffect(() => {
    if (!mapRef.current) return;

    const routeLayer = layersRef.current.routes;
    const riderLayer = layersRef.current.riders;
    const roadblockLayer = layersRef.current.roadblock;
    routeLayer.clearLayers();
    riderLayer.clearLayers();
    roadblockLayer.clearLayers();

    // Draw active roadblocks
    if (roadblockLayer) {
      roadblockLayer.clearLayers();

      const nodeLookup = {};
      (roadGraph?.nodes || []).forEach(n => {
        nodeLookup[n.node_id || n.id] = [n.lat, n.lon];
      });

      const renderedBlocks = new Set();

      // 1. Render from structured blockedEdgesInfo if provided
      (blockedEdgesInfo || []).forEach(b => {
        if (b && b.coords && b.coords.length === 2) {
          const uCoord = b.coords[0];
          const vCoord = b.coords[1];
          const key = `${b.u}_${b.v}`;
          if (renderedBlocks.has(key)) return;
          renderedBlocks.add(key);
          renderedBlocks.add(`${b.v}_${b.u}`);

          L.polyline([uCoord, vCoord], {
            color: '#ef4444',
            weight: 7,
            opacity: 0.95,
            dashArray: '5, 5'
          }).bindPopup(`
            <div style="font-size: 12px; font-family: var(--font-sans); color: #ef4444;">
              <strong>⛔ Emergency Road Block Active</strong><br/>
              Segment: ${b.u} &rarr; ${b.v}<br/>
              Status: Impassable to vehicles
            </div>
          `).addTo(roadblockLayer);

          const midLat = (uCoord[0] + vCoord[0]) / 2;
          const midLon = (uCoord[1] + vCoord[1]) / 2;
          const barrierIcon = L.divIcon({
            className: 'custom-barrier-icon',
            html: `<div style="background:#ef4444; color:#ffffff; font-size:11px; border-radius:4px; padding:2px 6px; border:1px solid #ffffff; font-weight:700; box-shadow:0 0 10px rgba(239,68,68,0.9); white-space:nowrap;">⛔ ROAD CLOSED</div>`,
            iconSize: [85, 22],
            iconAnchor: [42, 11]
          });
          L.marker([midLat, midLon], { icon: barrierIcon }).addTo(roadblockLayer);
        }
      });

      // 2. Also render from closedEdges
      (closedEdges || []).forEach(edgeId => {
        if (renderedBlocks.has(edgeId)) return;
        const parts = edgeId.split('_');
        let uCoord, vCoord;
        if (parts.length >= 2 && nodeLookup[parts[0]] && nodeLookup[parts[1]]) {
          uCoord = nodeLookup[parts[0]];
          vCoord = nodeLookup[parts[1]];
        } else {
          const edge = (roadGraph?.edges || []).find(e => e.edge_id === edgeId || `${e.u}_${e.v}` === edgeId);
          if (edge) {
            uCoord = nodeLookup[edge.u];
            vCoord = nodeLookup[edge.v];
          }
        }
        if (uCoord && vCoord) {
          renderedBlocks.add(edgeId);
          renderedBlocks.add(`${parts[1]}_${parts[0]}`);

          L.polyline([uCoord, vCoord], {
            color: '#ef4444',
            weight: 7,
            opacity: 0.95,
            dashArray: '5, 5'
          }).bindPopup(`
            <div style="font-size: 12px; font-family: var(--font-sans); color: #ef4444;">
              <strong>⛔ Emergency Road Block Active</strong><br/>
              Segment: ${edgeId}<br/>
              Status: Closed
            </div>
          `).addTo(roadblockLayer);

          const midLat = (uCoord[0] + vCoord[0]) / 2;
          const midLon = (uCoord[1] + vCoord[1]) / 2;
          const barrierIcon = L.divIcon({
            className: 'custom-barrier-icon',
            html: `<div style="background:#ef4444; color:#ffffff; font-size:11px; border-radius:4px; padding:2px 6px; border:1px solid #ffffff; font-weight:700; box-shadow:0 0 10px rgba(239,68,68,0.9); white-space:nowrap;">⛔ ROAD CLOSED</div>`,
            iconSize: [85, 22],
            iconAnchor: [42, 11]
          });
          L.marker([midLat, midLon], { icon: barrierIcon }).addTo(roadblockLayer);
        }
      });
    }

    // Determine which riders to display
    const ridersToRender = (focusedOrder && hideOtherEntities)
      ? (focusedAssignedRider ? [focusedAssignedRider] : [])
      : riders;

    ridersToRender.forEach((rider, idx) => {
      const color = RIDER_COLORS[idx % RIDER_COLORS.length];
      const isSelected = selectedRiderId === rider.rider_id;
      const isFocusedCourier = focusedAssignedRider && rider.rider_id === focusedAssignedRider.rider_id;

      const rLat = typeof rider.current_lat === 'number' ? rider.current_lat : parseFloat(rider.current_lat);
      const rLon = typeof rider.current_lon === 'number' ? rider.current_lon : parseFloat(rider.current_lon);
      if (isNaN(rLat) || isNaN(rLon)) return;

      const roadPath = rider.road_path || [];

      // Render route line
      if (roadPath && roadPath.length > 1) {
        const pts = roadPath.map(p => [parseFloat(p[0]), parseFloat(p[1])]).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
        if (pts.length > 1) {
          const isDetourActive = closedEdges.length > 0;
          
          // Glow layer for focused route
          if (isFocusedCourier) {
            L.polyline(pts, {
              color: isDetourActive ? '#10b981' : '#38bdf8',
              weight: 8,
              opacity: 0.25,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(routeLayer);
          }

          const poly = L.polyline(pts, {
            color: isFocusedCourier ? (isDetourActive ? '#10b981' : '#fafafa') : color,
            weight: isFocusedCourier ? 4.0 : 2.2,
            opacity: isFocusedCourier ? 1.0 : 0.6,
            dashArray: isDetourActive && isFocusedCourier ? '6, 6' : null,
            lineCap: 'round',
            lineJoin: 'round',
          });

          poly.bindPopup(`
            <div style="font-size: 11px; font-family: var(--font-sans); line-height: 1.4;">
              <strong>Courier ${rider.rider_id}</strong><br/>
              ${isDetourActive && isFocusedCourier ? '<span style="color:#10b981; font-weight:600;">✨ Alternate ACO Detour Active</span><br/>' : ''}
              Status: <span style="text-transform: capitalize;">${rider.status.toLowerCase()}</span><br/>
              Remaining Stops: <strong>${(rider.assigned_stops || []).length}</strong>
            </div>
          `);
          poly.addTo(routeLayer);
        }
      }

      // Draw Courier Marker
      const isUnavailable = rider.status === 'UNAVAILABLE';
      const icon = L.divIcon({
        className: 'custom-rider-marker',
        html: `
          <div style="
            background: ${isUnavailable ? '#ef4444' : isFocusedCourier ? '#fafafa' : color};
            color: ${isFocusedCourier ? '#09090b' : '#ffffff'};
            width: ${isFocusedCourier ? '28px' : '18px'};
            height: ${isFocusedCourier ? '28px' : '18px'};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid ${isFocusedCourier ? '#38bdf8' : '#09090b'};
            box-shadow: ${isFocusedCourier ? '0 0 14px rgba(56, 189, 248, 0.7)' : '0 1px 4px rgba(0, 0, 0, 0.4)'};
            font-size: ${isFocusedCourier ? '13px' : '9px'};
            cursor: pointer;
            transition: transform 0.15s ease;
          ">🛵</div>
        `,
        iconSize: [isFocusedCourier ? 28 : 18, isFocusedCourier ? 28 : 18],
        iconAnchor: [isFocusedCourier ? 14 : 9, isFocusedCourier ? 14 : 9]
      });

      const marker = L.marker([rLat, rLon], { icon });
      marker.on('click', () => onSelectRider(rider.rider_id));

      marker.bindPopup(`
        <div style="font-size: 12px; font-family: var(--font-sans); line-height: 1.4;">
          <strong>Courier ${rider.rider_id}</strong>
          ${isFocusedCourier ? ' <span style="color:#38bdf8;">(Focused Courier)</span>' : ''}<br/>
          Load: <strong>${(rider.current_load_kg || 0).toFixed(1)} / ${(rider.capacity_kg || 15).toFixed(0)} kg</strong><br/>
          Distance Covered: <strong>${(rider.distance_traveled_km || 0).toFixed(1)} km</strong><br/>
          Stops: <strong>${(rider.assigned_stops || []).length}</strong>
        </div>
      `);

      marker.addTo(riderLayer);
    });
  }, [riders, selectedRiderId, focusedOrder, focusedAssignedRider, hideOtherEntities, closedEdges, roadGraph]);

  // Handle Action: Simulate Emergency Roadblock on the Focused Order's Route
  const handleBlockOrderRoute = async () => {
    if (!focusedOrderId) return;
    setIsBlockingRoute(true);
    setBlockStatusMsg('Injecting emergency roadblock along route...');
    try {
      const res = await api.blockOrderRoute(focusedOrderId);
      setBlockStatusMsg(`Roadblock placed! ACO recomputed alternate optimal detour.`);
      onRefreshState();
    } catch (err) {
      console.error('Failed to block route:', err);
      setBlockStatusMsg(`Blockage error: ${err.message}`);
    } finally {
      setIsBlockingRoute(false);
    }
  };

  // Handle Action: Clear Roadblock
  const handleClearRoadblocks = async () => {
    setIsBlockingRoute(true);
    setBlockStatusMsg('Clearing road closures...');
    try {
      await api.clearRoadClosures();
      setBlockStatusMsg('Roadblock cleared. Direct road path restored.');
      onRefreshState();
    } catch (err) {
      console.error('Failed to clear road closures:', err);
    } finally {
      setIsBlockingRoute(false);
    }
  };

  const hasActiveBlockage = closedEdges && closedEdges.length > 0;

  return (
    <div className="map-card-shadcn">
      {/* Top Header */}
      <div className="map-header-shadcn">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontWeight: 600, color: '#fafafa' }}>
            {focusedOrder ? `Tracking Order ${focusedOrder.order_id}` : 'Bangalore Fleet Operations'}
          </span>

          {focusedOrder ? (
            <span style={{ 
              fontSize: '0.7rem', 
              background: 'rgba(56, 189, 248, 0.15)', 
              color: '#38bdf8', 
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '4px',
              padding: '1px 6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px'
            }}>
              <Crosshair size={11} /> Single-Order Focus
            </span>
          ) : (
            <span className="status-pill-minimal online" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
              <span className="status-dot-minimal"></span>
              <span>All Couriers Active</span>
            </span>
          )}
        </div>

        {/* Quick Focus Selector & Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {focusedOrder && (
            <button 
              className={`btn-shadcn ${hideOtherEntities ? 'secondary' : 'outline'}`}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
              onClick={() => setHideOtherEntities(!hideOtherEntities)}
              title={hideOtherEntities ? 'Show all other couriers and dots' : 'Hide background clutter to isolate this order'}
            >
              {hideOtherEntities ? <EyeOff size={12} /> : <Eye size={12} />}
              <span>{hideOtherEntities ? 'Isolating Order' : 'Show All'}</span>
            </button>
          )}

          {/* Quick Dropdown to Select Order to Focus */}
          <select 
            className="select-shadcn"
            style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
            value={focusedOrderId || ''}
            onChange={(e) => onSelectOrder(e.target.value || null)}
          >
            <option value="">-- Focus Single Order --</option>
            {orders.slice(0, 40).map(o => (
              <option key={o.order_id} value={o.order_id}>
                Focus {o.order_id} ({o.restaurant_id} &rarr; {o.customer_id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Focused Order Inspector Banner with Real-Time Roadblock & Detour Actions */}
      {focusedOrder && (
        <div style={{
          background: '#18181b',
          borderBottom: '1px solid var(--border)',
          padding: '0.55rem 0.95rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          fontSize: '0.75rem'
        }}>
          {/* Order Details */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div>
              <span style={{ color: '#71717a' }}>Pickup: </span>
              <strong style={{ color: '#fafafa' }}>{focusedPickupRest?.name || focusedOrder.restaurant_id}</strong>
              <span style={{ color: '#71717a', margin: '0 5px' }}>&rarr;</span>
              <span style={{ color: '#71717a' }}>Destination: </span>
              <strong style={{ color: '#fafafa' }}>{focusedDropoffCust?.name || focusedOrder.customer_id}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ color: '#71717a' }}>Courier: </span>
              <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {focusedAssignedRider?.rider_id || 'Pending Dispatch'}
              </span>
            </div>

            <div>
              <span style={{ color: '#71717a' }}>Status: </span>
              <span style={{ color: '#10b981', fontWeight: 600, textTransform: 'capitalize' }}>
                {(focusedOrder.status || 'Placed').toLowerCase()}
              </span>
            </div>
          </div>

          {/* Interactive Roadblock Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {!hasActiveBlockage ? (
              <button 
                className="btn-shadcn destructive"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
                onClick={handleBlockOrderRoute}
                disabled={isBlockingRoute}
                title="Closes a road segment directly on this order's path to test ACO route recalculation"
              >
                <Ban size={12} />
                <span>Simulate Road Block on Route</span>
              </button>
            ) : (
              <button 
                className="btn-shadcn outline"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)' }}
                onClick={handleClearRoadblocks}
                disabled={isBlockingRoute}
                title="Clears the road blockage and restores the direct street path"
              >
                <RotateCcw size={12} />
                <span>Clear Roadblock</span>
              </button>
            )}

            <button 
              className="btn-shadcn outline"
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
              onClick={() => onSelectOrder(null)}
              title="Close focus mode and show all deliveries"
            >
              <X size={12} />
              <span>Unfocus</span>
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Detour Status Notice */}
      {hasActiveBlockage && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
          padding: '0.35rem 0.95rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.72rem',
          color: '#fca5a5'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <AlertTriangle size={13} color="#ef4444" />
            <span>
              <strong>Emergency Roadblock Active:</strong> Road segment blocked. ACO dynamic dispatch has calculated an alternate optimal detour (shown in green/dashed).
            </span>
          </div>
          {blockStatusMsg && <span style={{ color: '#fafafa' }}>{blockStatusMsg}</span>}
        </div>
      )}

      {/* Leaflet Map Canvas */}
      <div ref={mapContainerRef} className="map-viewport" />
    </div>
  );
}