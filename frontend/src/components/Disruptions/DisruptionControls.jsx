import React, { useState } from 'react';
import { 
  PackagePlus, 
  TrafficCone, 
  Ban, 
  UserX, 
  Check, 
  Activity, 
  Zap,
  Loader2,
  Crosshair,
  RotateCcw
} from 'lucide-react';
import { api } from '../../services/api';

export default function DisruptionControls({
  restaurants = [],
  customers = [],
  riders = [],
  orders = [],
  roadGraph = null,
  simTimeMinutes = 0,
  focusedOrderId = null,
  onSelectOrder = () => {},
  onEventTriggered = () => {}
}) {
  // New Order State
  const [selectedRest, setSelectedRest] = useState(restaurants[0]?.restaurant_id || 'R001');
  const [selectedCust, setSelectedCust] = useState(customers[0]?.customer_id || 'C001');
  const [packageWeight, setPackageWeight] = useState(1.5);
  const [deadlineMin, setDeadlineMin] = useState(45);

  // Traffic Spike State
  const [trafficSource, setTrafficSource] = useState(roadGraph?.edges?.[0]?.source || 'NODE_0001');
  const [trafficTarget, setTrafficTarget] = useState(roadGraph?.edges?.[0]?.target || 'NODE_0002');
  const [trafficMultiplier, setTrafficMultiplier] = useState(2.5);

  // Road Closure State
  const [closureSource, setClosureSource] = useState(roadGraph?.edges?.[1]?.source || 'NODE_0002');
  const [closureTarget, setClosureTarget] = useState(roadGraph?.edges?.[1]?.target || 'NODE_0003');

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
      await api.injectNewOrder({
        order_id: orderId,
        restaurant_id: selectedRest,
        customer_id: selectedCust,
        package_weight_kg: parseFloat(packageWeight),
        order_time_min: simTimeMinutes,
        preparation_time_min: 15.0,
        deadline_min: simTimeMinutes + parseFloat(deadlineMin),
        trigger_reoptimization: true
      });
      addLog(`Dynamic Order: ${orderId}`, 'success', `Injected from ${selectedRest} to ${selectedCust}. ACO re-dispatched.`);
      onEventTriggered();
    } catch (err) {
      addLog('Order Injection Failed', 'error', err.message);
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
      addLog('Traffic Congestion', 'warning', `Segment ${trafficSource} &rarr; ${trafficTarget} congestion scaled to ${trafficMultiplier}x.`);
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
      addLog('Road Closure Alert', 'danger', `Edge ${closureSource} &rarr; ${closureTarget} closed. Couriers rerouted.`);
      onEventTriggered();
    } catch (err) {
      addLog('Road Closure Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. Inject Roadblock directly for Focused Order
  const handleBlockFocusedOrder = async () => {
    if (!focusedOrderId) return;
    setIsSubmitting(true);
    try {
      const res = await api.blockOrderRoute(focusedOrderId);
      addLog(`Roadblock on ${focusedOrderId}`, 'danger', `Emergency barrier placed on route. ACO recomputed alternate optimal detour.`);
      onEventTriggered();
    } catch (err) {
      addLog('Route Blockage Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Clear All Closures
  const handleClearClosures = async () => {
    setIsSubmitting(true);
    try {
      await api.clearRoadClosures();
      addLog('Roadblock Cleared', 'success', 'All road closures removed. Standard shortest paths restored.');
      onEventTriggered();
    } catch (err) {
      addLog('Clear Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Inject Rider Unavailable
  const handleInjectRiderFailure = async () => {
    setIsSubmitting(true);
    try {
      await api.injectRiderUnavailable(selectedRider, 'Mechanical Breakdown');
      addLog(`Courier Offline: ${selectedRider}`, 'danger', `Rider offline. Undelivered orders reassigned via ACO.`);
      onEventTriggered();
    } catch (err) {
      addLog('Rider Failure Failed', 'error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Focused Order Quick-Action Panel */}
      <div className="chart-card-shadcn" style={{ 
        background: focusedOrderId ? 'rgba(56, 189, 248, 0.04)' : undefined,
        borderColor: focusedOrderId ? 'rgba(56, 189, 248, 0.3)' : undefined
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.92rem', fontWeight: 600, color: '#fafafa' }}>
              <Crosshair size={15} style={{ color: focusedOrderId ? '#38bdf8' : '#a1a1aa' }} />
              <span>Single-Order Route Testing & Dynamic Detour</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#a1a1aa' }}>
              {focusedOrderId 
                ? `Currently analyzing route for ${focusedOrderId}. Test how ACO adapts when an emergency closure is placed on its path.`
                : 'Select an order to simulate a targeted road closure directly along its physical transit route.'}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <select 
              className="select-shadcn"
              style={{ fontSize: '0.75rem' }}
              value={focusedOrderId || ''}
              onChange={(e) => onSelectOrder(e.target.value || null)}
            >
              <option value="">-- Choose Order to Focus --</option>
              {orders.slice(0, 30).map(o => (
                <option key={o.order_id} value={o.order_id}>
                  {o.order_id} ({o.restaurant_id} &rarr; {o.customer_id})
                </option>
              ))}
            </select>

            <button 
              className="btn-shadcn destructive"
              onClick={handleBlockFocusedOrder}
              disabled={!focusedOrderId || isSubmitting}
              style={{ fontSize: '0.74rem' }}
            >
              <Ban size={12} />
              <span>Block Route</span>
            </button>

            <button 
              className="btn-shadcn outline"
              onClick={handleClearClosures}
              disabled={isSubmitting}
              style={{ fontSize: '0.74rem' }}
            >
              <RotateCcw size={12} />
              <span>Clear All Closures</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4 General Disruption Cards Grid */}
      <div className="disruption-grid">
        {/* Card 1: Add New Order */}
        <div className="disruption-card-shadcn">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 600, color: '#fafafa' }}>
            <PackagePlus size={15} />
            <span>Dynamic Customer Order</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#a1a1aa' }}>
            Inject an on-demand order into the active simulation to trigger dynamic ACO re-routing.
          </div>

          <div className="form-group">
            <label className="form-label">Pickup Restaurant</label>
            <select className="select-shadcn" value={selectedRest} onChange={(e) => setSelectedRest(e.target.value)}>
              {restaurants.map(r => (
                <option key={r.restaurant_id} value={r.restaurant_id}>{r.name || r.restaurant_id}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Delivery Destination</label>
            <select className="select-shadcn" value={selectedCust} onChange={(e) => setSelectedCust(e.target.value)}>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>{c.name || c.customer_id}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div className="form-group">
              <label className="form-label">Weight (kg)</label>
              <input type="number" step="0.5" className="input-shadcn" value={packageWeight} onChange={(e) => setPackageWeight(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Deadline (+min)</label>
              <input type="number" step="5" className="input-shadcn" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value)} />
            </div>
          </div>

          <button className="btn-shadcn primary" onClick={handleInjectOrder} disabled={isSubmitting} style={{ marginTop: '0.25rem', width: '100%' }}>
            {isSubmitting ? <Loader2 className="animate-spin" size={13} /> : <Zap size={13} />}
            <span>Inject Order & Reroute</span>
          </button>
        </div>

        {/* Card 2: Traffic Spike */}
        <div className="disruption-card-shadcn">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 600, color: '#fafafa' }}>
            <TrafficCone size={15} />
            <span>Traffic Congestion Spike</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#a1a1aa' }}>
            Slows down transit times along a chosen road segment to simulate peak-hour delays.
          </div>

          <div className="form-group">
            <label className="form-label">Road Segment</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <input type="text" className="input-shadcn" placeholder="From Node" value={trafficSource} onChange={(e) => setTrafficSource(e.target.value)} />
              <input type="text" className="input-shadcn" placeholder="To Node" value={trafficTarget} onChange={(e) => setTrafficTarget(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Delay Multiplier (x)</label>
            <input type="number" step="0.5" min="1.0" max="5.0" className="input-shadcn" value={trafficMultiplier} onChange={(e) => setTrafficMultiplier(e.target.value)} />
          </div>

          <button className="btn-shadcn outline" onClick={handleInjectTraffic} disabled={isSubmitting} style={{ marginTop: 'auto', width: '100%' }}>
            <TrafficCone size={13} />
            <span>Apply Congestion Delay</span>
          </button>
        </div>

        {/* Card 3: Road Closure */}
        <div className="disruption-card-shadcn">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 600, color: '#fafafa' }}>
            <Ban size={15} />
            <span>Manual Road Closure</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#a1a1aa' }}>
            Blocks a specific road segment by node IDs, forcing all active couriers to calculate alternative physical routes.
          </div>

          <div className="form-group">
            <label className="form-label">Blocked Road Segment</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <input type="text" className="input-shadcn" placeholder="From Node" value={closureSource} onChange={(e) => setClosureSource(e.target.value)} />
              <input type="text" className="input-shadcn" placeholder="To Node" value={closureTarget} onChange={(e) => setClosureTarget(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginTop: 'auto' }}>
            <button className="btn-shadcn destructive" onClick={handleInjectClosure} disabled={isSubmitting}>
              <Ban size={13} />
              <span>Close Road</span>
            </button>
            <button className="btn-shadcn outline" onClick={handleClearClosures} disabled={isSubmitting}>
              <RotateCcw size={13} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Card 4: Rider Unavailable */}
        <div className="disruption-card-shadcn">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 600, color: '#fafafa' }}>
            <UserX size={15} />
            <span>Courier Breakdown</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#a1a1aa' }}>
            Simulates vehicle mechanical failure. Undelivered orders are reassigned to nearby available couriers.
          </div>

          <div className="form-group">
            <label className="form-label">Select Courier</label>
            <select className="select-shadcn" value={selectedRider} onChange={(e) => setSelectedRider(e.target.value)}>
              {riders.map(r => (
                <option key={r.rider_id} value={r.rider_id}>
                  {r.rider_id} ({r.status}) - {(r.current_load_kg || 0).toFixed(1)} kg
                </option>
              ))}
            </select>
          </div>

          <button className="btn-shadcn destructive" onClick={handleInjectRiderFailure} disabled={isSubmitting} style={{ marginTop: 'auto', width: '100%' }}>
            <UserX size={13} />
            <span>Simulate Breakdown</span>
          </button>
        </div>
      </div>

      {/* Disruption Audit Log */}
      <div className="chart-card-shadcn" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.65rem' }}>
          <Activity size={14} />
          <span style={{ fontWeight: 600, color: '#fafafa' }}>Operational Disruption & Re-Routing Audit Log</span>
        </div>

        {eventLog.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#71717a', fontSize: '0.78rem' }}>
            No disruption events recorded yet. Trigger an event above to observe real-time system adaptation.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {eventLog.map(entry => (
              <div 
                key={entry.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  padding: '0.55rem 0.8rem',
                  background: '#18181b',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  fontSize: '0.76rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ 
                    fontFamily: 'var(--font-mono)', 
                    color: '#fafafa', 
                    background: '#27272a',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontSize: '0.7rem'
                  }}>
                    {entry.time}
                  </span>
                  <strong style={{ color: '#fafafa' }}>{entry.title}</strong>
                  <span style={{ color: '#a1a1aa' }}>{entry.detail}</span>
                </div>
                <Check size={13} style={{ color: '#10b981' }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}