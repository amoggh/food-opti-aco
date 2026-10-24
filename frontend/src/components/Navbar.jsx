import React from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  FastForward, 
  MapPin, 
  Sliders, 
  AlertTriangle, 
  BarChart3, 
  Compass,
  Radio
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
  setSpeedMultiplier
}) {
  const currentMinutes = simState?.current_time_minutes || 0;
  const hours = Math.floor(currentMinutes / 60) + 12; // Start from 12:00 PM
  const mins = Math.floor(currentMinutes % 60);
  const formattedTime = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} PM (+${currentMinutes.toFixed(1)}m)`;

  return (
    <header className="navbar">
      {/* Brand Section */}
      <div className="brand-section">
        <div className="brand-icon-wrapper">
          <Compass size={22} color="#ffffff" />
        </div>
        <div>
          <div className="brand-title">ACO Food Logistics</div>
          <div className="brand-subtitle">Autonomous Multi-Agent Dispatch</div>
        </div>
      </div>

      {/* Simulation Playback Bar */}
      <div className="sim-controls-bar">
        {/* Virtual Clock */}
        <div className="sim-clock-display" title="Virtual Simulation Time">
          <span style={{ fontSize: '0.9rem' }}>⏱️</span>
          <span>{formattedTime}</span>
        </div>

        {/* Play/Pause */}
        {isRunning ? (
          <button className="btn-ctrl danger" onClick={onPause} title="Pause Simulation">
            <Pause size={14} /> Pause
          </button>
        ) : (
          <button className="btn-ctrl primary" onClick={onStart} title="Run Simulation">
            <Play size={14} /> Run
          </button>
        )}

        {/* Step Buttons */}
        <button className="btn-ctrl" onClick={() => onStep(1.0)} title="Advance 1 Minute">
          <FastForward size={14} /> +1m
        </button>
        <button className="btn-ctrl" onClick={() => onStep(5.0)} title="Advance 5 Minutes">
          <FastForward size={14} /> +5m
        </button>

        {/* Speed Selector */}
        <select 
          className="speed-select" 
          value={speedMultiplier} 
          onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
          title="Simulation Speed Multiplier"
        >
          <option value="1">1x Speed</option>
          <option value="2">2x Speed</option>
          <option value="5">5x Speed</option>
          <option value="10">10x Speed</option>
        </select>

        {/* Reset */}
        <button className="btn-ctrl" onClick={onReset} title="Reset Simulation">
          <RotateCcw size={14} /> Reset
        </button>

        {/* Connection Status */}
        <div className={`status-badge ${wsConnected ? 'live' : 'paused'}`} title={wsConnected ? 'WebSocket Connected' : 'Polling Backend'}>
          <span className="pulse-dot"></span>
          <span>{wsConnected ? 'LIVE WS' : 'POLLING'}</span>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <nav className="nav-tabs">
        <button 
          className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          <MapPin size={15} /> Operations & Map
        </button>

        <button 
          className={`tab-btn ${activeTab === 'aco' ? 'active' : ''}`}
          onClick={() => setActiveTab('aco')}
        >
          <Sliders size={15} /> ACO Convergence
        </button>

        <button 
          className={`tab-btn ${activeTab === 'disruptions' ? 'active' : ''}`}
          onClick={() => setActiveTab('disruptions')}
        >
          <AlertTriangle size={15} /> Disruptions
        </button>

        <button 
          className={`tab-btn ${activeTab === 'benchmarks' ? 'active' : ''}`}
          onClick={() => setActiveTab('benchmarks')}
        >
          <BarChart3 size={15} /> Benchmarks
        </button>
      </nav>
    </header>
  );
}
