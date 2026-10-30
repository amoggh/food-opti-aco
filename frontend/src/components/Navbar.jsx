import React from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  StepForward, 
  MapPin, 
  Sliders, 
  AlertTriangle, 
  BarChart3, 
  Layers,
  Crosshair,
  X,
  Sparkles
} from 'lucide-react';

export default function Navbar({
  simState,
  isRunning,
  wsConnected,
  activeTab,
  setActiveTab,
  onStart,
  onPause,
  onStep,
  onReset,
  speedMultiplier,
  setSpeedMultiplier,
  focusedOrderId = null,
  onClearFocus = () => {}
}) {
  const currentMinutes = simState?.current_time_minutes || simState?.sim_time_min || 0;
  const hours = Math.floor(currentMinutes / 60) + 12; // Start from 12:00 PM
  const mins = Math.floor(currentMinutes % 60);
  const formattedTime = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} PM`;
  const relativeMins = `+${currentMinutes.toFixed(1)}m`;

  return (
    <header className="navbar">
      {/* Brand Section */}
      <div className="brand-section">
        <div className="brand-icon-wrapper">
          <Layers size={18} />
        </div>
        <div>
          <div className="brand-title">
            <span>ACO Food Logistics</span>
            <span className="brand-badge">Optimizer</span>
          </div>
        </div>
      </div>

      {/* Simulation Playback Bar */}
      <div className="sim-controls-bar">
        {/* Virtual Clock */}
        <div className="sim-clock-display" title="Virtual Simulation Clock">
          <span style={{ color: '#a1a1aa' }}>⏱</span>
          <span>{formattedTime}</span>
          <span style={{ color: '#71717a', fontSize: '0.72rem' }}>({relativeMins})</span>
        </div>

        {/* Play/Pause */}
        {isRunning ? (
          <button className="btn-shadcn destructive" onClick={onPause} title="Pause Simulation">
            <Pause size={13} />
            <span>Pause</span>
          </button>
        ) : (
          <button className="btn-shadcn primary" onClick={onStart} title="Run Simulation">
            <Play size={13} fill="currentColor" />
            <span>Run</span>
          </button>
        )}

        {/* Step Button */}
        <button className="btn-shadcn outline" onClick={() => onStep(1.0)} title="Advance 1 Minute">
          <StepForward size={13} />
          <span>+1m</span>
        </button>

        {/* Speed Selector with True Calibrated Rates */}
        <select 
          className="select-shadcn" 
          value={speedMultiplier} 
          onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
          title="Simulation Playback Speed"
        >
          <option value="1">1x speed</option>
          <option value="2">2x speed</option>
          <option value="5">5x speed</option>
          <option value="10">10x (Fast)</option>
          <option value="20">20x (Turbo)</option>
          <option value="50">50x (Ultra)</option>
        </select>

        {/* Reset */}
        <button className="btn-shadcn outline" onClick={onReset} title="Reset Simulation">
          <RotateCcw size={13} />
        </button>

        {/* Focused Order Tag */}
        {focusedOrderId && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid #3f3f46',
            borderRadius: '6px',
            padding: '2px 8px',
            fontSize: '0.72rem',
            color: '#fafafa',
            fontFamily: 'var(--font-mono)'
          }}>
            <Crosshair size={12} style={{ color: '#38bdf8' }} />
            <span>Tracking {focusedOrderId}</span>
            <button 
              onClick={onClearFocus} 
              style={{ background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', display: 'flex' }}
              title="Clear Order Focus"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Live sync dot */}
        <div className={`status-pill-minimal ${wsConnected ? 'online' : 'offline'}`} title={wsConnected ? 'WebSocket Live Connection' : 'Polling Backend'}>
          <span className="status-dot-minimal"></span>
          <span>{wsConnected ? 'LIVE' : 'POLLING'}</span>
        </div>
      </div>

      {/* View Switcher Tabs (Segmented Control) */}
      <nav className="nav-tabs">
        <button 
          className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          <MapPin size={14} />
          <span>Operations &amp; Map</span>
        </button>

        <button 
          className={`tab-btn ${activeTab === 'demo' ? 'active' : ''}`}
          onClick={() => setActiveTab('demo')}
          style={{ position: 'relative' }}
        >
          <Sparkles size={14} style={{ color: activeTab === 'demo' ? '#fafafa' : '#38bdf8' }} />
          <span>Turn-by-Turn Demo</span>
        </button>

        <button 
          className={`tab-btn ${activeTab === 'aco' ? 'active' : ''}`}
          onClick={() => setActiveTab('aco')}
        >
          <Sliders size={14} />
          <span>ACO Intelligence</span>
        </button>

        <button 
          className={`tab-btn ${activeTab === 'disruptions' ? 'active' : ''}`}
          onClick={() => setActiveTab('disruptions')}
        >
          <AlertTriangle size={14} />
          <span>Disruptions</span>
        </button>

        <button 
          className={`tab-btn ${activeTab === 'benchmarks' ? 'active' : ''}`}
          onClick={() => setActiveTab('benchmarks')}
        >
          <BarChart3 size={14} />
          <span>Benchmarks</span>
        </button>
      </nav>
    </header>
  );
}