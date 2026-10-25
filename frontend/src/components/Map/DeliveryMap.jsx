import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { getStreetRoute } from '../../services/osrm';

// Color palette for rider routes
const RIDER_COLORS = [
  '#38bdf8', '#818cf8', '#34d399', '#f43f5e', '#fbbf24',
  '#a855f7', '#22d3ee', '#ec4899', '#14b8a6', '#f97316',
  '#60a5fa', '#c084fc', '#4ade80', '#fb7185', '#fde047',
  '#2dd4bf', '#a78bfa', '#f472b6', '#38bdf8', '#84cc16'
];

export default function DeliveryMap({
  restaurants = [],
  customers = [],
  roadGraph = null,
  riders = [],
  orders = [],
  bestPlan = null,
  selectedRiderId = null,
  onSelectRider = () => {}
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({
    roadNetwork: null,
    routes: null,
    restaurants: null,
    customers: null,
    riders: null
  });

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Bangalore simulation center
    const map = L.map(mapContainerRef.current, {
      center: [12.9716, 77.5946],
      zoom: 13,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Tile layers (Free OpenStreetMap by default - No API key required)
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY;

    const osmDark = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'dark-tiles'
    });

    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    });

    const baseMaps = {
      'Dark Map (Free)': osmDark,
      'Standard OSM': osmStandard
    };

    if (cartoKey) {
      baseMaps['CARTO Dark'] = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${cartoKey}`,
        {
          attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
          subdomains: 'abcd'
        }
      );
    }

    osmDark.addTo(map);

    // Initialize layer groups - Road Network is available as an overlay layer without obscuring physical streets
    layersRef.current.routes = L.layerGroup().addTo(map);
    layersRef.current.restaurants = L.layerGroup().addTo(map);
    layersRef.current.customers = L.layerGroup().addTo(map);
    layersRef.current.riders = L.layerGroup().addTo(map);
    layersRef.current.roadNetwork = L.layerGroup(); // Not added by default to preserve clean physical streets

    const overlayMaps = {
      '🛣️ Real Road Routes': layersRef.current.routes,
      '🛵 Active Couriers': layersRef.current.riders,
      '🏪 Restaurants': layersRef.current.restaurants,
      '📍 Customers': layersRef.current.customers,
      '🕸️ Grid Graph (Synthetic)': layersRef.current.roadNetwork
    };

    L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Render Road Network Overlay (Optional Grid)
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.roadNetwork || !roadGraph?.edges) return;

    const layer = layersRef.current.roadNetwork;
    layer.clearLayers();

    // Map node coordinates
    const nodeLookup = {};
    if (roadGraph.nodes && Array.isArray(roadGraph.nodes)) {
      roadGraph.nodes.forEach(n => {
        const id = n.node_id || n.id;
        const lat = typeof n.lat === 'number' ? n.lat : (typeof n.latitude === 'number' ? n.latitude : parseFloat(n.lat || n.latitude));
        const lon = typeof n.lon === 'number' ? n.lon : (typeof n.longitude === 'number' ? n.longitude : parseFloat(n.lon || n.longitude));
        if (id && !isNaN(lat) && !isNaN(lon)) {
          nodeLookup[id] = [lat, lon];
        }
      });
    }

    if (roadGraph.edges && Array.isArray(roadGraph.edges)) {
      roadGraph.edges.forEach(edge => {
        const u = edge.u || edge.source;
        const v = edge.v || edge.target;
        const uCoords = nodeLookup[u];
        const vCoords = nodeLookup[v];
        if (!uCoords || !vCoords) return;
        if (typeof uCoords[0] !== 'number' || typeof uCoords[1] !== 'number' || typeof vCoords[0] !== 'number' || typeof vCoords[1] !== 'number') return;

        const isClosed = edge.is_closed || false;
        const trafficLevel = edge.traffic_level || 'LOW';
        const traffic = edge.traffic_multiplier || (trafficLevel === 'SEVERE' ? 2.5 : trafficLevel === 'HIGH' ? 1.8 : trafficLevel === 'MEDIUM' ? 1.3 : 1.0);

        let color = 'rgba(56, 189, 248, 0.22)';
        let weight = 1.5;
        let dashArray = null;

        if (isClosed || trafficLevel === 'SEVERE') {
          color = '#ef4444';
          weight = 2.5;
          dashArray = '5, 5';
        } else if (traffic > 1.6) {
          color = '#f97316';
          weight = 2.5;
        } else if (traffic > 1.2) {
          color = '#eab308';
          weight = 2.0;
        }

        try {
          const poly = L.polyline([uCoords, vCoords], {
            color,
            weight,
            dashArray,
            opacity: isClosed ? 0.9 : 0.6
          });

          const dist = edge.distance_km ?? edge.length_km ?? 0;
          poly.bindPopup(`
            <div style="font-size: 11px;">
              <strong>Road Segment</strong>: ${u} &rarr; ${v}<br/>
              <strong>Length</strong>: ${dist ? dist.toFixed(2) : '--'} km<br/>
              <strong>Traffic</strong>: ${trafficLevel} (${traffic.toFixed(2)}x)<br/>
              <strong>Status</strong>: ${isClosed ? '<span style="color:#f43f5e">BLOCKED</span>' : 'OPEN'}
            </div>
          `);

          poly.addTo(layer);
        } catch (e) {
          // ignore polyline render error
        }
      });
    }
  }, [roadGraph]);

  // 3. Render Static Entities (Restaurants & Customers)
  useEffect(() => {
    if (!mapRef.current) return;

    // Restaurants
    const restLayer = layersRef.current.restaurants;
    restLayer.clearLayers();

    restaurants.forEach(r => {
      const lat = typeof r.latitude === 'number' ? r.latitude : (typeof r.lat === 'number' ? r.lat : parseFloat(r.latitude || r.lat));
      const lon = typeof r.longitude === 'number' ? r.longitude : (typeof r.lon === 'number' ? r.lon : parseFloat(r.longitude || r.lon));
      if (isNaN(lat) || isNaN(lon)) return;

      const icon = L.divIcon({
        className: 'custom-rest-marker',
        html: `
          <div style="
            background: linear-gradient(135deg, #f59e0b, #d97706);
            width: 22px;
            height: 22px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid #ffffff;
            box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);
            font-size: 11px;
            cursor: pointer;
          ">🏪</div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const marker = L.marker([lat, lon], { icon });
      marker.bindPopup(`
        <div style="font-size: 12px; line-height: 1.4;">
          <strong style="color: #f59e0b;">${r.name || r.restaurant_id}</strong><br/>
          <span style="color: #94a3b8;">ID: ${r.restaurant_id}</span><br/>
          Avg Prep Time: <strong>${r.average_preparation_time_min || r.preparation_time || 15} min</strong><br/>
          Coord: ${lat.toFixed(4)}, ${lon.toFixed(4)}
        </div>
      `);
      marker.addTo(restLayer);
    });

    // Customers
    const custLayer = layersRef.current.customers;
    custLayer.clearLayers();

    customers.forEach(c => {
      const lat = typeof c.latitude === 'number' ? c.latitude : (typeof c.lat === 'number' ? c.lat : parseFloat(c.latitude || c.lat));
      const lon = typeof c.longitude === 'number' ? c.longitude : (typeof c.lon === 'number' ? c.lon : parseFloat(c.longitude || c.lon));
      if (isNaN(lat) || isNaN(lon)) return;

      const icon = L.divIcon({
        className: 'custom-cust-marker',
        html: `
          <div style="
            background: rgba(6, 182, 212, 0.85);
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 2px solid #ffffff;
            box-shadow: 0 0 8px rgba(6, 182, 212, 0.5);
            cursor: pointer;
          "></div>
        `,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      const marker = L.marker([lat, lon], { icon });
      marker.bindPopup(`
        <div style="font-size: 12px; line-height: 1.4;">
          <strong style="color: #38bdf8;">${c.name || c.customer_id}</strong><br/>
          <span style="color: #94a3b8;">Customer ID: ${c.customer_id}</span><br/>
          Coord: ${lat.toFixed(4)}, ${lon.toFixed(4)}
        </div>
      `);
      marker.addTo(custLayer);
    });
  }, [restaurants, customers]);

  // 4. Render Active Delivery Routes & Live Riders along Real Physical Roads
  useEffect(() => {
    if (!mapRef.current) return;

    const routeLayer = layersRef.current.routes;
    const riderLayer = layersRef.current.riders;
    routeLayer.clearLayers();
    riderLayer.clearLayers();

    // Map rider routes from bestPlan or live riders
    const riderRoutesMap = {};
    if (bestPlan?.tours) {
      Object.entries(bestPlan.tours).forEach(([rId, tour]) => {
        riderRoutesMap[rId] = tour.stops || [];
      });
    } else if (bestPlan?.routes) {
      bestPlan.routes.forEach(rt => {
        riderRoutesMap[rt.rider_id] = rt.stops || [];
      });
    }

    const renderCourierPolyline = (points, courierColor, isSelected, rider) => {
      if (!points || points.length < 2) return;

      // Glow halo layer
      L.polyline(points, {
        color: courierColor,
        weight: isSelected ? 8 : 5,
        opacity: 0.3,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeLayer);

      // Core street-following line
      const poly = L.polyline(points, {
        color: courierColor,
        weight: isSelected ? 4.5 : 2.8,
        opacity: isSelected ? 1.0 : 0.88,
        dashArray: rider.status === 'AVAILABLE' && (!rider.assigned_stops || rider.assigned_stops.length === 0) ? '4, 6' : null,
        lineCap: 'round',
        lineJoin: 'round',
      });

      poly.bindPopup(`
        <div style="font-size: 11px; line-height: 1.4;">
          <strong style="color: ${courierColor};">Courier ${rider.rider_id}</strong><br/>
          Status: <strong>${rider.status}</strong><br/>
          Remaining Stops: <strong>${(rider.assigned_stops || []).length}</strong><br/>
          Navigation: <span style="color:#10b981; font-weight:600;">OpenStreetMap Real Road Network</span>
        </div>
      `);
      poly.addTo(routeLayer);
    };

    riders.forEach((rider, idx) => {
      const color = RIDER_COLORS[idx % RIDER_COLORS.length];
      const isSelected = selectedRiderId === rider.rider_id;

      const rLat = typeof rider.current_lat === 'number' ? rider.current_lat : parseFloat(rider.current_lat);
      const rLon = typeof rider.current_lon === 'number' ? rider.current_lon : parseFloat(rider.current_lon);
      if (isNaN(rLat) || isNaN(rLon)) return;

      // Assigned stops for rider
      const stops = (rider.assigned_stops && rider.assigned_stops.length > 0)
        ? rider.assigned_stops
        : (rider.route || riderRoutesMap[rider.rider_id] || []);

      // Draw Planned Route Polylines along the road network
      const roadPath = (rider.road_path && Array.isArray(rider.road_path) && rider.road_path.length > 1)
        ? rider.road_path
        : (bestPlan?.tours?.[rider.rider_id]?.road_path || []);

      if (roadPath && roadPath.length > 1) {
        const latlngs = roadPath.map(pt => [
          typeof pt[0] === 'number' ? pt[0] : parseFloat(pt[0]),
          typeof pt[1] === 'number' ? pt[1] : parseFloat(pt[1])
        ]).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
        renderCourierPolyline(latlngs, color, isSelected, rider);
      } else if (stops.length > 0) {
        // Asynchronously query real physical road turn-by-turn coordinates instead of drawing straight chords
        const waypoints = [[rLat, rLon]];
        stops.forEach(s => {
          const sLat = typeof s.lat === 'number' ? s.lat : (typeof s.latitude === 'number' ? s.latitude : parseFloat(s.lat || s.latitude));
          const sLon = typeof s.lon === 'number' ? s.lon : (typeof s.longitude === 'number' ? s.longitude : parseFloat(s.lon || s.longitude));
          if (!isNaN(sLat) && !isNaN(sLon)) {
            waypoints.push([sLat, sLon]);
          }
        });

        if (waypoints.length > 1) {
          getStreetRoute(waypoints).then(streetPts => {
            if (streetPts && streetPts.length > 1) {
              renderCourierPolyline(streetPts, color, isSelected, rider);
            }
          });
        }
      }

      // Draw Live Rider Marker
      const isUnavailable = rider.status === 'UNAVAILABLE';
      const icon = L.divIcon({
        className: 'custom-rider-marker',
        html: `
          <div style="
            background: ${isUnavailable ? '#ef4444' : color};
            width: ${isSelected ? '28px' : '22px'};
            height: ${isSelected ? '28px' : '22px'};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid #ffffff;
            box-shadow: 0 0 ${isSelected ? '16px' : '8px'} ${isUnavailable ? '#ef4444' : color};
            font-size: ${isSelected ? '13px' : '11px'};
            cursor: pointer;
            transition: all 0.2s ease;
          ">🛵</div>
        `,
        iconSize: [isSelected ? 28 : 22, isSelected ? 28 : 22],
        iconAnchor: [isSelected ? 14 : 11, isSelected ? 14 : 11]
      });

      const marker = L.marker([rLat, rLon], { icon });
      marker.on('click', () => onSelectRider(rider.rider_id));

      marker.bindPopup(`
        <div style="font-size: 12px; line-height: 1.4;">
          <strong style="color: ${color};">${rider.rider_id}</strong>
          <span style="font-size: 10px; background:#1e293b; padding:2px 6px; border-radius:4px; margin-left:4px;">
            ${rider.status}
          </span><br/>
          Load: <strong>${rider.current_load ?? rider.carried_orders?.length ?? 0} / ${rider.capacity || 15}</strong><br/>
          Distance Covered: <strong>${(rider.total_distance_km || 0).toFixed(1)} km</strong><br/>
          Remaining Stops: <strong>${stops.length}</strong>
        </div>
      `);

      marker.addTo(riderLayer);
    });
  }, [riders, bestPlan, selectedRiderId, onSelectRider]);

  return (
    <div className="map-card">
      <div className="map-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span>Bangalore Metropolitan Road Network & Live Fleet</span>
          <span style={{
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#10b981',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
            Real OSM Road Routing
          </span>
        </div>
        <div className="map-legend">
          <div className="legend-item">
            <span className="legend-badge" style={{ background: '#f59e0b' }}></span>
            <span>Restaurant</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge" style={{ background: '#06b6d4' }}></span>
            <span>Customer</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge" style={{ background: '#38bdf8' }}></span>
            <span>Courier (🛵)</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge" style={{ background: '#ef4444' }}></span>
            <span>Disruption / Closure</span>
          </div>
        </div>
      </div>
      <div ref={mapContainerRef} className="map-viewport" />
    </div>
  );
}
