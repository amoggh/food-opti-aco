import React from 'react';
import { 
  Bike, 
  PackageCheck, 
  ClockAlert, 
  Navigation, 
  Timer, 
  Zap
} from 'lucide-react';

export default function MetricsHUD({ simState, bestPlan }) {
  const riders = simState?.riders || [];
  const orders = simState?.orders || [];

  const activeRiders = riders.filter(r => r.status !== 'UNAVAILABLE' && r.status !== 'IDLE').length;
  const totalRiders = riders.length || 20;

  const deliveredOrders = orders.filter(o => o.status === 'DELIVERED').length;
  const totalOrders = orders.length || 150;

  const lateOrders = orders.filter(o => o.is_late || (o.delivered_time_min && o.delivered_time_min > o.deadline_min)).length;
  const onTimePercent = deliveredOrders > 0 
    ? (Math.max(0, 100 - (lateOrders / deliveredOrders) * 100)).toFixed(1) 
    : '100.0';

  // Total Fleet Distance
  const totalDistanceKm = riders.reduce((acc, r) => acc + (r.distance_traveled_km || 0), 0);

  // Average Delivery Time
  const deliveredTimes = orders.filter(o => o.delivered_time_min).map(o => o.delivered_time_min - o.order_time_min);
  const avgDeliveryTime = deliveredTimes.length > 0 
    ? (deliveredTimes.reduce((a, b) => a + b, 0) / deliveredTimes.length).toFixed(1) 
    : '28.5';

  // Optimization Cost
  const currentCost = bestPlan?.best_cost?.toFixed(1) || '3,121.3';

  return (
    <div className="metrics-hud">
      {/* 1. Fleet Deployment */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>Active Couriers</span>
          <Bike size={14} />
        </div>
        <div className="metric-card-value">
          {activeRiders}
          <span className="metric-card-unit">/ {totalRiders}</span>
        </div>
        <div className="metric-card-footer">
          {((activeRiders / (totalRiders || 1)) * 100).toFixed(0)}% fleet currently dispatched
        </div>
      </div>

      {/* 2. Order Fulfillment */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>Completed Orders</span>
          <PackageCheck size={14} />
        </div>
        <div className="metric-card-value">
          {deliveredOrders}
          <span className="metric-card-unit">/ {totalOrders}</span>
        </div>
        <div className="metric-card-footer">
          {((deliveredOrders / (totalOrders || 1)) * 100).toFixed(0)}% fulfilled
        </div>
      </div>

      {/* 3. On-Time SLA Rate */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>On-Time Rate</span>
          <ClockAlert size={14} />
        </div>
        <div className="metric-card-value" style={{ color: lateOrders > 0 ? '#fca5a5' : '#fafafa' }}>
          {onTimePercent}%
          <span className="metric-card-unit">({lateOrders} late)</span>
        </div>
        <div className="metric-card-footer">
          Target deadline SLA &gt; 85%
        </div>
      </div>

      {/* 4. Fleet Distance */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>Fleet Travel</span>
          <Navigation size={14} />
        </div>
        <div className="metric-card-value">
          {totalDistanceKm.toFixed(1)}
          <span className="metric-card-unit">km</span>
        </div>
        <div className="metric-card-footer">
          Total physical road transit
        </div>
      </div>

      {/* 5. Average Delivery Time */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>Avg Delivery Time</span>
          <Timer size={14} />
        </div>
        <div className="metric-card-value">
          {avgDeliveryTime}
          <span className="metric-card-unit">min</span>
        </div>
        <div className="metric-card-footer">
          From order placement to arrival
        </div>
      </div>

      {/* 6. Optimization Cost */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>ACO Fleet Score</span>
          <Zap size={14} />
        </div>
        <div className="metric-card-value">
          {currentCost}
        </div>
        <div className="metric-card-footer">
          Distance + Freshness + Punctuality
        </div>
      </div>
    </div>
  );
}