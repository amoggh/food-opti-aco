import React from 'react';
import { 
  Bike, 
  PackageCheck, 
  ClockAlert, 
  Navigation, 
  Timer, 
  Zap,
  Thermometer
} from 'lucide-react';

export default function MetricsHUD({ simState, bestPlan }) {
  const riders = simState?.riders || [];
  const orders = simState?.orders || [];
  const counts = simState?.counts || {};

  // "Dispatched" = couriers that currently have work (BUSY), out of those not offline
  const totalRiders = riders.filter(r => r.status !== 'UNAVAILABLE').length;
  const activeRiders = riders.filter(r => r.status === 'BUSY').length;

  const delivered = orders.filter(o => o.status === 'DELIVERED');
  const deliveredOrders = delivered.length;
  const totalOrders = orders.length;

  const lateOrders = delivered.filter(o => o.is_late).length;
  const onTimePercent = deliveredOrders > 0
    ? (100 - (lateOrders / deliveredOrders) * 100).toFixed(1)
    : '—';

  const totalDistanceKm = counts.total_distance_km
    ?? riders.reduce((acc, r) => acc + (r.total_distance_km || 0), 0);

  const avgDeliveryTime = deliveredOrders > 0 && counts.avg_delivery_time_min != null
    ? Number(counts.avg_delivery_time_min).toFixed(1)
    : '—';

  // Food freshness (time food waited between being ready and reaching the customer)
  const freshLimit = counts.freshness_limit_min ?? 40;
  const coldOrders = counts.cold_orders ?? delivered.filter(o => o.is_cold).length;
  const freshPercent = deliveredOrders > 0 ? Number(counts.fresh_percentage ?? 100).toFixed(1) : '—';
  const avgFoodAge = deliveredOrders > 0 ? Number(counts.avg_food_age_min ?? 0).toFixed(1) : '—';

  // Optimization cost of the plan currently being executed
  const rawCost = simState?.active_plan_cost ?? bestPlan?.fitness_cost ?? bestPlan?.best_cost;
  const currentCost = rawCost != null && rawCost < 999999
    ? Number(rawCost).toLocaleString(undefined, { maximumFractionDigits: 1 })
    : '—';

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
          {((activeRiders / (totalRiders || 1)) * 100).toFixed(0)}% of fleet carrying orders
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
          {onTimePercent}{deliveredOrders > 0 ? '%' : ''}
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

      {/* 6. Food Freshness */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>Food Freshness</span>
          <Thermometer size={14} />
        </div>
        <div className="metric-card-value" style={{ color: coldOrders > 0 ? '#fdba74' : '#fafafa' }}>
          {freshPercent}{deliveredOrders > 0 ? '%' : ''}
          <span className="metric-card-unit">({coldOrders} cold)</span>
        </div>
        <div className="metric-card-footer">
          Avg {avgFoodAge} min in bag · cold after {freshLimit} min
        </div>
      </div>

      {/* 7. Optimization Cost */}
      <div className="metric-card-shadcn">
        <div className="metric-card-top">
          <span>ACO Fleet Score</span>
          <Zap size={14} />
        </div>
        <div className="metric-card-value">
          {currentCost}
        </div>
        <div className="metric-card-footer">
          Distance + time + lateness + food freshness
        </div>
      </div>
    </div>
  );
}