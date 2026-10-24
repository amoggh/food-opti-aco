import React, { useState } from 'react';
import { 
  PackagePlus, 
  TrafficCone, 
  Ban, 
  UserX, 
  RotateCcw, 
  AlertCircle, 
  CheckCircle2, 
  Zap,
  Activity
} from 'lucide-react';
import { api } from '../../services/api';

export default function DisruptionControls({
  restaurants = [],
  customers = [],
  riders = [],
  roadGraph = null,
  simTimeMinutes = 0,
  onEventTriggered = () => {}
}) {
  // New Order State
  const [selectedRest, setSelectedRest] = useState(restaurants[0]?.restaurant_id || 'R001');
  const [selectedCust, setSelectedCust] = useState(customers[0]?.customer_id || 'C001');
  const [packageWeight, setPackageWeight] = useState(1.5);
  const [deadlineMin, setDeadlineMin] = useState(45);

  // Traffic Spike State
  const [trafficSource, setTrafficSource] = useState(roadGraph?.edges[0]?.source || 'N00');
  const [trafficTarget, setTrafficTarget] = useState(roadGraph?.edges[0]?.target || 'N01');
  const [trafficMultiplier, setTrafficMultiplier] = useState(2.5);

  // Road Closure State
  const [closureSource, setClosureSource] = useState(roadGraph?.edges[1]?.source || 'N01');
  const [closureTarget, setClosureTarget] = useState(roadGraph?.edges[1]?.target || 'N02');

  // Rider Unavailable State
  const [selectedRider, setSelectedRider] = useState(riders[0]?.rider_id || 'RIDER_001');

  // Logs & Loading
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [eventLog, setEventLog] = useState([]);

  const addLog = (title, status, detail) => {
    const entry = {
      id: Date.now(),
      time: `+${simTimeMinutes.toFixed(1)}m`,
      title,
      status,
      detail
    };
    setEventLog(prev => [entry, ...prev.slice(0, 15)]);
  };

  // 1. Inject New Urgent Order
  const handleInjectOrder = async () => {
    setIsSubmitting(true);
    try {
      const orderId = `DYN_ORD_${Math.floor(Math.random() * 9000 + 1000)}`;
      const res = await api.injectNewOrder({
        order_id: orderId,
        restaurant_id: selectedRest,
        customer_id: selectedCust,
        package_weight_kg: parseFloat(packageWeight),
        order_time_min: simTimeMinutes,
        preparation_time_min: 15.0,
        deadline_min: simTimeMinutes + parseFloat(deadlineMin),
        trigger_reoptimization: true
      });
      addLog(`New Urgent Order: ${orderId}`, 'success', `Injected at ${selectedRest} &rarr; ${selectedCust}. ACO dynamic re-optimization invoked!`);
      onEventTriggered();
    } catch (err) {
      addLog('Failed New Order Injection', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2. Inject Traffic Spike
  const handleInjectTraffic = async () => {
    setIsSubmitting(true);
    try {
      await api.injectTrafficChange({
        source: trafficSource,
        target: trafficTarget,
        multiplier: parseFloat(trafficMultiplier),
        trigger_reoptimization: true
      });
      addLog(`Traffic Congestion Spike`, 'warning', `Segment ${trafficSource} &rarr; ${trafficTarget} congestion scaled to ${trafficMultiplier}x.`);
      onEventTriggered();
    } catch (err) {
      addLog('Traffic Spike Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Inject Road Closure
  const handleInjectClosure = async () => {
    setIsSubmitting(true);
    try {
      await api.injectRoadClosure({
        source: closureSource,
        target: closureTarget,
        trigger_reoptimization: true
      });
      addLog(`Road Closure Alert`, 'danger', `Edge ${closureSource} &rarr; ${closureTarget} closed. Couriers automatically rerouted.`);
      onEventTriggered();
    } catch (err) {
      addLog('Road Closure Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. Inject Rider Unavailable
  const handleInjectRiderFailure = async () => {
    setIsSubmitting(true);
    try {
      await api.injectRiderUnavailable(selectedRider, 'Mechanical Breakdown / Flat Tire');
      addLog(`Courier Breakdown: ${selectedRider}`, 'danger', `Rider marked unavailable. Pending assignments reclaimed and re-dispatched via ACO!`);
      onEventTriggered();
    } catch (err) {
      addLog('Rider Failure Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* 4 Cards Grid for Events */}
      <div className="disruption-grid">
        {/* Card 1: Add New Urgent Order */}
        <div className="disruption-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: '#38bdf8' }}>
            <PackagePlus size={16} />
            <span>Inject Dynamic Order</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#94a3b8' }}>
            Injects an on-demand delivery into the live environment and triggers ACO route reconfiguration.
          </div>

          <div className="form-group">
            <label className="form-label">Pickup Restaurant</label>
            <select className="form-select" value={selectedRest} onChange={(e) => setSelectedRest(e.target.value)}>
              {restaurants.map(r => (
                <option key={r.restaurant_id} value={r.restaurant_id}>{r.name || r.restaurant_id}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Delivery Destination</label>
            <select className="form-select" value={selectedCust} onChange={(e) => setSelectedCust(e.target.value)}>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>{c.name || c.customer_id}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div className="form-group">
              <label className="form-label">Weight (kg)</label>
              <input type="number" step="0.5" className="form-input" value={packageWeight} onChange={(e) => setPackageWeight(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Deadline (+min)</label>
              <input type="number" step="5" className="form-input" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value)} />
            </div>
          </div>

          <button className="btn-ctrl primary" onClick={handleInjectOrder} disabled={isSubmitting} style={{ marginTop: '0.25rem', justifyContent: 'center' }}>
            <Zap size={14} /> Inject Order & Re-route
          </button>
        </div>

        {/* Card 2: Traffic Spike */}
        <div className="disruption-card warning">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: '#f59e0b' }}>
            <TrafficCone size={16} />
            <span>Traffic Congestion Spike</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#94a3b8' }}>
            Scales travel times along a road segment modeling real-time congestion or adverse weather.
          </div>

          <div className="form-group">
            <label className="form-label">Congested Road Segment</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <input type="text" className="form-input" placeholder="From Node" value={trafficSource} onChange={(e) => setTrafficSource(e.target.value)} />
              <input type="text" className="form-input" placeholder="To Node" value={trafficTarget} onChange={(e) => setTrafficTarget(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Congestion Multiplier (x)</label>
            <input type="number" step="0.5" min="1.0" max="5.0" className="form-input" value={trafficMultiplier} onChange={(e) => setTrafficMultiplier(e.target.value)} />
          </div>

          <button className="btn-ctrl" onClick={handleInjectTraffic} disabled={isSubmitting} style={{ marginTop: 'auto', justifyContent: 'center', borderColor: '#f59e0b', color: '#fbbf24' }}>
            <TrafficCone size={14} /> Apply Congestion
          </button>
        </div>

        {/* Card 3: Road Closure */}
        <div className="disruption-card danger">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: '#f43f5e' }}>
            <Ban size={16} />
            <span>Emergency Road Closure</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#94a3b8' }}>
            Completely blocks a road segment due to construction or accident, forcing detour calculations.
          </div>

          <div className="form-group">
            <label className="form-label">Blocked Road Segment</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <input type="text" className="form-input" placeholder="From Node" value={closureSource} onChange={(e) => setClosureSource(e.target.value)} />
              <input type="text" className="form-input" placeholder="To Node" value={closureTarget} onChange={(e) => setClosureTarget(e.target.value)} />
            </div>
          </div>

          <button className="btn-ctrl danger" onClick={handleInjectClosure} disabled={isSubmitting} style={{ marginTop: 'auto', justifyContent: 'center' }}>
            <Ban size={14} /> Close Road & Recalculate
          </button>
        </div>

        {/* Card 4: Rider Unavailable */}
        <div className="disruption-card danger">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: '#f43f5e' }}>
            <UserX size={16} />
            <span>Courier Breakdown Event</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#94a3b8' }}>
            Simulates vehicle mechanical failure. In-transit orders are preserved while undelivered orders are reassigned.
          </div>

          <div className="form-group">
            <label className="form-label">Select Courier</label>
            <select className="form-select" value={selectedRider} onChange={(e) => setSelectedRider(e.target.value)}>
              {riders.map(r => (
                <option key={r.rider_id} value={r.rider_id}>
                  {r.rider_id} ({r.status}) - {(r.current_load_kg || 0).toFixed(1)} kg
                </option>
              ))}
            </select>
          </div>

          <button className="btn-ctrl danger" onClick={handleInjectRiderFailure} disabled={isSubmitting} style={{ marginTop: 'auto', justifyContent: 'center' }}>
            <UserX size={14} /> Simulate Breakdown
          </button>
        </div>
      </div>

      {/* Real-Time Disruption Audit Log */}
      <div className="panel-card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontWeight: 600 }}>
          <Activity size={16} color="#38bdf8" />
          <span>Real-Time Disruption & ACO Dynamic Dispatch Audit Log</span>
        </div>

        {eventLog.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.8rem' }}>
            No dynamic disruptions triggered yet. Use the controls above to simulate real-world operational challenges.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {eventLog.map(entry => (
              <div 
                key={entry.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  padding: '0.6rem 0.85rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  fontSize: '0.78rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ 
                    fontFamily: 'var(--font-mono)', 
                    color: '#38bdf8', 
                    background: 'rgba(2, 132, 199, 0.15)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    {entry.time}
                  </span>
                  <strong>{entry.title}</strong>
                  <span style={{ color: '#94a3b8' }}>{entry.detail}</span>
                </div>
                <CheckCircle2 size={15} color="#10b981" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
