import React from 'react';
import { Bike, Navigation, Weight, CheckCircle } from 'lucide-react';

export default function FleetStatus({
  riders = [],
  selectedRiderId = null,
  onSelectRider = () => {}
}) {
  return (
    <div className="panel-card" style={{ height: '50%' }}>
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Bike size={15} color="#34d399" />
          <span>Courier Fleet Deployment ({riders.length})</span>
        </div>
      </div>

      <div className="panel-list">
        {riders.map(rider => {
          const isSelected = selectedRiderId === rider.rider_id;
          const isUnavailable = rider.status === 'UNAVAILABLE';
          const currentLoad = rider.current_load_kg || 0;
          const maxCapacity = rider.capacity_kg || 15.0;
          const loadPercent = Math.min(100, (currentLoad / maxCapacity) * 100);

          return (
            <div 
              key={rider.rider_id} 
              className="item-card"
              style={{
                borderColor: isSelected ? 'var(--accent-sky)' : undefined,
                background: isSelected ? 'rgba(56, 189, 248, 0.08)' : undefined,
                cursor: 'pointer'
              }}
              onClick={() => onSelectRider(rider.rider_id)}
            >
              <div className="item-row">
                <span className="item-id" style={{ color: isUnavailable ? '#ef4444' : '#38bdf8' }}>
                  {rider.rider_id}
                </span>
                <span 
                  className="status-pill"
                  style={{
                    background: isUnavailable ? 'rgba(239, 68, 68, 0.2)' : rider.status === 'IDLE' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                    color: isUnavailable ? '#f87171' : rider.status === 'IDLE' ? '#cbd5e1' : '#34d399'
                  }}
                >
                  {rider.status}
                </span>
              </div>

              {/* Cargo Weight Bar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.7rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Weight size={11} /> Cargo Load
                  </span>
                  <span>{currentLoad.toFixed(1)} / {maxCapacity.toFixed(1)} kg ({loadPercent.toFixed(0)}%)</span>
                </div>
                <div className="progress-bar-bg">
                  <div 
                    className="progress-bar-fill" 
                    style={{ 
                      width: `${loadPercent}%`,
                      background: loadPercent > 80 ? '#f43f5e' : loadPercent > 50 ? '#f59e0b' : '#38bdf8'
                    }}
                  />
                </div>
              </div>

              {/* Stats Row */}
              <div className="item-row" style={{ fontSize: '0.68rem', color: '#64748b' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Navigation size={11} /> Traveled: {(rider.distance_traveled_km || 0).toFixed(1)} km
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <CheckCircle size={11} /> Delivered: {rider.completed_orders_count || 0}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
