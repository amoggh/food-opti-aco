import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

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

    // CartoDB Dark Matter tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);

    // Initialize layer groups
    layersRef.current.roadNetwork = L.layerGroup().addTo(map);
    layersRef.current.routes = L.layerGroup().addTo(map);
    layersRef.current.restaurants = L.layerGroup().addTo(map);
    layersRef.current.customers = L.layerGroup().addTo(map);
    layersRef.current.riders = L.layerGroup().addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Render Road Network
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.roadNetwork || !roadGraph?.edges) return;

    const layer = layersRef.current.roadNetwork;
    layer.clearLayers();

    // Map node coordinates
    const nodeLookup = {};
    if (roadGraph.nodes) {
      roadGraph.nodes.forEach(n => {
        nodeLookup[n.id] = [n.latitude, n.longitude];
      });
    }

    roadGraph.edges.forEach(edge => {
      const uCoords = nodeLookup[edge.source];
      const vCoords = nodeLookup[edge.target];
      if (!uCoords || !vCoords) return;

      const isClosed = edge.is_closed || false;
      const traffic = edge.traffic_multiplier || 1.0;

      let color = 'rgba(56, 189, 248, 0.22)';
      let weight = 1.5;
      let dashArray = null;

      if (isClosed) {
        color = '#ef4444';
        weight = 2.5;
        dashArray = '5, 5';
      } else if (traffic > 1.8) {
        color = '#f97316';
        weight = 2.5;
      } else if (traffic > 1.2) {
        color = '#eab308';
        weight = 2.0;
      }

      const poly = L.polyline([uCoords, vCoords], {
        color,
        weight,
        dashArray,
        opacity: isClosed ? 0.9 : 0.6
      });

      poly.bindPopup(`
        <div style="font-size: 11px;">
          <strong>Road Segment</strong>: ${edge.source} &rarr; ${edge.target}<br/>
          <strong>Length</strong>: ${edge.length_km?.toFixed(2)} km<br/>
          <strong>Traffic Multiplier</strong>: ${traffic.toFixed(2)}x<br/>
          <strong>Status</strong>: ${isClosed ? '<span style="color:#f43f5e">BLOCKED</span>' : 'OPEN'}
        </div>
      `);

      poly.addTo(layer);
    });
  }, [roadGraph]);

  // 3. Render Static Entities (Restaurants & Customers)
  useEffect(() => {
    if (!mapRef.current) return;

    // Restaurants
    const restLayer = layersRef.current.restaurants;
    restLayer.clearLayers();

    restaurants.forEach(r => {
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

      const marker = L.marker([r.latitude, r.longitude], { icon });
      marker.bindPopup(`
        <div style="font-size: 12px; line-height: 1.4;">
          <strong style="color: #f59e0b;">${r.name || r.restaurant_id}</strong><br/>
          <span style="color: #94a3b8;">ID: ${r.restaurant_id}</span><br/>
          Avg Prep Time: <strong>${r.average_preparation_time_min || 15} min</strong><br/>
          Coord: ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}
        </div>
      `);
      marker.addTo(restLayer);
    });

    // Customers
    const custLayer = layersRef.current.customers;
    custLayer.clearLayers();

    customers.forEach(c => {
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

      const marker = L.marker([c.latitude, c.longitude], { icon });
      marker.bindPopup(`
        <div style="font-size: 12px; line-height: 1.4;">
          <strong style="color: #38bdf8;">${c.name || c.customer_id}</strong><br/>
          <span style="color: #94a3b8;">Customer ID: ${c.customer_id}</span><br/>
          Coord: ${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}
        </div>
      `);
      marker.addTo(custLayer);
    });
  }, [restaurants, customers]);

  // 4. Render Active Delivery Routes & Live Riders
  useEffect(() => {
    if (!mapRef.current) return;

    const routeLayer = layersRef.current.routes;
    const riderLayer = layersRef.current.riders;
    routeLayer.clearLayers();
    riderLayer.clearLayers();

    // Map rider routes from bestPlan or live riders
    const riderRoutesMap = {};
    if (bestPlan?.routes) {
      bestPlan.routes.forEach(rt => {
        riderRoutesMap[rt.rider_id] = rt.stops || [];
      });
    }

    riders.forEach((rider, idx) => {
      const color = RIDER_COLORS[idx % RIDER_COLORS.length];
      const isSelected = selectedRiderId === rider.rider_id;

      // Draw Planned Route Polylines
      const stops = rider.route || riderRoutesMap[rider.rider_id] || [];
      if (stops.length > 0) {
        const latlngs = [[rider.current_lat, rider.current_lon]];
        stops.forEach(s => {
          if (s.lat && s.lon) {
            latlngs.push([s.lat, s.lon]);
          }
        });

        if (latlngs.length > 1) {
          const poly = L.polyline(latlngs, {
            color: color,
            weight: isSelected ? 4 : 2,
            opacity: isSelected ? 0.95 : 0.45,
            dashArray: rider.status === 'IDLE' ? '4, 6' : null
          });
          poly.addTo(routeLayer);
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

      const marker = L.marker([rider.current_lat, rider.current_lon], { icon });
      marker.on('click', () => onSelectRider(rider.rider_id));

      marker.bindPopup(`
        <div style="font-size: 12px; line-height: 1.4;">
          <strong style="color: ${color};">${rider.rider_id}</strong>
          <span style="font-size: 10px; background:#1e293b; padding:2px 6px; border-radius:4px; margin-left:4px;">
            ${rider.status}
          </span><br/>
          Load: <strong>${(rider.current_load_kg || 0).toFixed(1)} / ${(rider.capacity_kg || 15).toFixed(1)} kg</strong><br/>
          Distance Covered: <strong>${(rider.distance_traveled_km || 0).toFixed(1)} km</strong><br/>
          Remaining Stops: <strong>${stops.length}</strong>
        </div>
      `);

      marker.addTo(riderLayer);
    });
  }, [riders, bestPlan, selectedRiderId, onSelectRider]);

  return (
    <div className="map-card">
      <div className="map-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Bangalore Metropolitan Road Network & Live Fleet</span>
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
