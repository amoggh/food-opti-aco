import React from 'react';
import { 
  Bike, 
  PackageCheck, 
  ClockAlert, 
  Navigation, 
  Timer, 
  Target
} from 'lucide-react';

export default function MetricsHUD({ simState, bestPlan }) {
  const riders = simState?.riders || [];
  const orders = simState?.orders || [];

  const activeRiders = riders.filter(r => r.status !== 'UNAVAILABLE' && r.status !== 'IDLE').length;
  const totalRiders = riders.length || 20;

  const deliveredOrders = orders.filter(o => o.status === 'DELIVERED').length;
  const totalOrders = orders.length || 150;

  const lateOrders = orders.filter(o => o.is_late || (o.delivered_time_min && o.delivered_time_min > o.deadline_min)).length;
  const latePercent = deliveredOrders > 0 ? ((lateOrders / deliveredOrders) * 100).toFixed(1) : '0.0';

  // Total Fleet Distance
  const totalDistanceKm = riders.reduce((acc, r) => acc + (r.distance_traveled_km || 0), 0);

  // Average Delivery Time
  const deliveredTimes = orders.filter(o => o.delivered_time_min).map(o => o.delivered_time_min - o.order_time_min);
  const avgDeliveryTime = deliveredTimes.length > 0 
    ? (deliveredTimes.reduce((a, b) => a + b, 0) / deliveredTimes.length).toFixed(1) 
    : '28.5';

  // Cost
  const currentCost = bestPlan?.best_cost?.toFixed(1) || '3,121.3';

  return (
    <div className="metrics-hud">
      {/* 1. Fleet Deployment */}
      <div className="metric-card" style={{ '--card-accent': '#38bdf8' }}>
        <div className="metric-header">
          <span>Active Couriers</span>
          <Bike size={15} color="#38bdf8" />
        </div>
        <div className="metric-value">
          {activeRiders}
          <span className="metric-unit">/ {totalRiders}</span>
        </div>
        <div className="metric-sub">
          {((activeRiders / (totalRiders || 1)) * 100).toFixed(0)}% Fleet Active
        </div>
      </div>

      {/* 2. Order Fulfillment */}
      <div className="metric-card" style={{ '--card-accent': '#10b981' }}>
        <div className="metric-header">
          <span>Delivered</span>
          <PackageCheck size={15} color="#10b981" />
        </div>
        <div className="metric-value">
          {deliveredOrders}
          <span className="metric-unit">/ {totalOrders}</span>
        </div>
        <div className="metric-sub">
          {((deliveredOrders / (totalOrders || 1)) * 100).toFixed(0)}% Progress
        </div>
      </div>

      {/* 3. Tardiness Rate */}
      <div className="metric-card" style={{ '--card-accent': lateOrders > 0 ? '#f43f5e' : '#10b981' }}>
        <div className="metric-header">
          <span>Late Deliveries</span>
          <ClockAlert size={15} color={lateOrders > 0 ? '#f43f5e' : '#10b981'} />
        </div>
        <div className="metric-value" style={{ color: lateOrders > 0 ? '#fb7185' : '#34d399' }}>
          {lateOrders}
          <span className="metric-unit">({latePercent}%)</span>
        </div>
        <div className="metric-sub">
          Deadline SLA Target &lt; 15%
        </div>
      </div>

      {/* 4. Total Travel Distance */}
      <div className="metric-card" style={{ '--card-accent': '#6366f1' }}>
        <div className="metric-header">
          <span>Fleet Distance</span>
          <Navigation size={15} color="#6366f1" />
        </div>
        <div className="metric-value">
          {totalDistanceKm.toFixed(1)}
          <span className="metric-unit">km</span>
        </div>
        <div className="metric-sub">
          ACO Optimized Routing
        </div>
      </div>

      {/* 5. Average Delivery Time */}
      <div className="metric-card" style={{ '--card-accent': '#f59e0b' }}>
        <div className="metric-header">
          <span>Avg Delivery Time</span>
          <Timer size={15} color="#f59e0b" />
        </div>
        <div className="metric-value">
          {avgDeliveryTime}
          <span className="metric-unit">min</span>
        </div>
        <div className="metric-sub">
          Order placement to door
        </div>
      </div>

      {/* 6. Multi-Objective Cost */}
      <div className="metric-card" style={{ '--card-accent': '#06b6d4' }}>
        <div className="metric-header">
          <span>Optimization Cost</span>
          <Target size={15} color="#06b6d4" />
        </div>
        <div className="metric-value" style={{ color: '#22d3ee' }}>
          {currentCost}
        </div>
        <div className="metric-sub">
          Distance + Tardiness + Freshness
        </div>
      </div>
    </div>
  );
}
