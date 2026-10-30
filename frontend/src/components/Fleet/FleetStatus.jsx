import React from 'react';
import { Bike, Navigation, Weight, Check, Crosshair } from 'lucide-react';

export default function FleetStatus({
  riders = [],
  selectedRiderId = null,
  onSelectRider = () => {},
  focusedOrderId = null
}) {
  return (
    <div className="panel-shadcn" style={{ height: '50%' }}>
      <div className="panel-header-shadcn">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <Bike size={14} />
          <span>Fleet Deployment</span>
          <span style={{ 
            fontSize: '0.7rem', 
            color: '#a1a1aa', 
            background: '#27272a', 
            padding: '1px 6px', 
            borderRadius: '4px',
            fontFamily: 'var(--font-mono)' 
          }}>
            {riders.length}
          </span>
        </div>
      </div>

      <div className="panel-list">
        {riders.map(rider => {
          const isSelected = selectedRiderId === rider.rider_id;
          const isUnavailable = rider.status === 'UNAVAILABLE';
          const currentLoad = rider.current_load_kg || 0;
          const maxCapacity = rider.capacity_kg || 15.0;
          const loadPercent = Math.min(100, (currentLoad / maxCapacity) * 100);

          const carriesFocusedOrder = focusedOrderId && (
            (rider.carried_orders || []).includes(focusedOrderId) ||
            (rider.assigned_stops || []).some(s => s.order_id === focusedOrderId)
          );

          return (
            <div 
              key={rider.rider_id} 
              className={`item-card-shadcn ${isSelected || carriesFocusedOrder ? 'selected' : ''}`}
              style={{ 
                cursor: 'pointer',
                borderColor: carriesFocusedOrder ? '#38bdf8' : undefined,
                background: carriesFocusedOrder ? 'rgba(56, 189, 248, 0.05)' : undefined
              }}
              onClick={() => onSelectRider(rider.rider_id)}
            >
              <div className="item-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className="item-id" style={{ color: isUnavailable ? '#ef4444' : carriesFocusedOrder ? '#38bdf8' : '#fafafa' }}>
                    {rider.rider_id}
                  </span>
                  {carriesFocusedOrder && (
                    <span style={{ 
                      fontSize: '0.62rem', 
                      background: 'rgba(56, 189, 248, 0.15)', 
                      color: '#38bdf8', 
                      padding: '1px 4px', 
                      borderRadius: '3px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px'
                    }}>
                      <Crosshair size={9} /> Assigned
                    </span>
                  )}
                </div>
                <span 
                  className="status-pill"
                  style={{
                    background: isUnavailable ? 'rgba(239, 68, 68, 0.15)' : rider.status === 'IDLE' ? '#27272a' : 'rgba(255, 255, 255, 0.1)',
                    color: isUnavailable ? '#fca5a5' : rider.status === 'IDLE' ? '#a1a1aa' : '#fafafa',
                    borderColor: isUnavailable ? 'rgba(239, 68, 68, 0.3)' : '#27272a'
                  }}
                >
                  {(rider.status || 'AVAILABLE').toLowerCase()}
                </span>
              </div>

              {/* Cargo Weight Bar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.7rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Weight size={11} /> Capacity
                  </span>
                  <span>{currentLoad.toFixed(1)} / {maxCapacity.toFixed(0)} kg ({loadPercent.toFixed(0)}%)</span>
                </div>
                <div className="progress-bar-bg">
                  <div 
                    className="progress-bar-fill" 
                    style={{ 
                      width: `${loadPercent}%`,
                      background: loadPercent > 80 ? '#ef4444' : loadPercent > 50 ? '#f59e0b' : '#fafafa'
                    }}
                  />
                </div>
              </div>

              {/* Stats Row */}
              <div className="item-row" style={{ fontSize: '0.68rem', color: '#71717a' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Navigation size={11} /> {(rider.distance_traveled_km || 0).toFixed(1)} km traveled
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Check size={11} /> {rider.completed_orders_count || 0} completed
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}