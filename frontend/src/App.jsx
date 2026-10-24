import React, { useState, useEffect, useCallback, useRef } from 'react';
import Navbar from './components/Navbar';
import MetricsHUD from './components/MetricsHUD';
import DeliveryMap from './components/Map/DeliveryMap';
import OrderQueue from './components/Orders/OrderQueue';
import FleetStatus from './components/Fleet/FleetStatus';
import ACOOptimizer from './components/ACO/ACOOptimizer';
import DisruptionControls from './components/Disruptions/DisruptionControls';
import BenchmarkComparison from './components/Benchmark/BenchmarkComparison';
import { api } from './services/api';
import { simWebSocket } from './services/websocket';

export default function App() {
  // Navigation & View
  const [activeTab, setActiveTab] = useState('map');

  // Static Data
  const [restaurants, setRestaurants] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [roadGraph, setRoadGraph] = useState(null);
  const [bestPlan, setBestPlan] = useState(null);

  // Dynamic Simulation State
  const [simState, setSimState] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [wsConnected, setWsConnected] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState(null);

  // Playback loop ref
  const playbackIntervalRef = useRef(null);

  // 1. Initial Data Fetch
  const loadInitialData = async () => {
    try {
      const [restRes, custRes, graphRes, stateRes, metricsRes] = await Promise.allSettled([
        api.getRestaurants(),
        api.getCustomers(),
        api.getRoadGraph(),
        api.getSimState(),
        api.getOptimizationMetrics()
      ]);

      if (restRes.status === 'fulfilled') {
        const val = restRes.value;
        setRestaurants(Array.isArray(val) ? val : (val?.restaurants || []));
      }
      if (custRes.status === 'fulfilled') {
        const val = custRes.value;
        setCustomers(Array.isArray(val) ? val : (val?.customers || []));
      }
      if (graphRes.status === 'fulfilled') {
        const val = graphRes.value;
        setRoadGraph(val?.graph || val || null);
      }
      if (stateRes.status === 'fulfilled') {
        const val = stateRes.value;
        const state = val?.state || val?.snapshot || val;
        setSimState(state);
        if (state?.is_running !== undefined) {
          setIsRunning(state.is_running);
        }
      }
      if (metricsRes.status === 'fulfilled') {
        const val = metricsRes.value;
        setBestPlan(val?.active_plan || val?.best_plan || val?.plan || null);
      }
    } catch (err) {
      console.warn('Initial data load warning:', err);
    }
  };

  useEffect(() => {
    loadInitialData();

    // 2. Setup WebSocket
    simWebSocket.connect();
    const unsubStatus = simWebSocket.onStatusChange(setWsConnected);
    const unsubMsg = simWebSocket.onMessage((msg) => {
      const state = msg?.state || msg?.snapshot || (msg?.sim_time_min !== undefined ? msg : null);
      if (state) {
        setSimState(state);
        if (state.is_running !== undefined) {
          setIsRunning(state.is_running);
        }
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
      simWebSocket.disconnect();
    };
  }, []);

  // 3. Polling / Playback Loop when running
  useEffect(() => {
    if (isRunning) {
      const stepIntervalMs = Math.max(200, 1000 / speedMultiplier);
      playbackIntervalRef.current = setInterval(async () => {
        try {
          const res = await api.stepSimulation(1.0);
          const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
          if (state) {
            setSimState(state);
          }
        } catch (err) {
          console.warn('Simulation step tick failed:', err);
        }
      }, stepIntervalMs);
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    }

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [isRunning, speedMultiplier]);

  // Simulation Controls Handlers
  const handleStart = async () => {
    try {
      const res = await api.startSimulation(speedMultiplier, 1.0);
      setIsRunning(true);
      const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
      if (state) {
        setSimState(state);
      }
      api.getOptimizationMetrics().then(metrics => {
        if (metrics?.active_plan) {
          setBestPlan(metrics.active_plan);
        }
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to start simulation:', err);
      // fallback to client-side ticking
      setIsRunning(true);
    }
  };

  const handlePause = async () => {
    try {
      const res = await api.pauseSimulation();
      setIsRunning(false);
      const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
      if (state) {
        setSimState(state);
      }
    } catch (err) {
      console.error('Failed to pause simulation:', err);
      setIsRunning(false);
    }
  };

  const handleStep = async (dt = 1.0) => {
    try {
      const res = await api.stepSimulation(dt);
      const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
      if (state) {
        setSimState(state);
      }
    } catch (err) {
      console.error('Failed to step simulation:', err);
    }
  };

  const handleReset = async () => {
    try {
      const res = await api.resetSimulation();
      setIsRunning(false);
      const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
      if (state) {
        setSimState(state);
      } else {
        const fresh = await api.getSimState();
        setSimState(fresh?.state || fresh);
      }
      api.getOptimizationMetrics().then(metrics => {
        setBestPlan(metrics?.active_plan || null);
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to reset simulation:', err);
    }
  };

  const handleOptimizationComplete = (result) => {
    if (result) {
      const plan = result.plan || result.best_plan || result;
      setBestPlan(plan);
      // refresh simulation state to reflect reassigned routes
      api.getSimState().then(res => {
        const state = res?.state || res?.snapshot || res;
        setSimState(state);
      }).catch(console.warn);
    }
  };

  return (
    <div className="app-container">
      {/* Top Navigation & Playback Controls */}
      <Navbar 
        simState={simState}
        isRunning={isRunning}
        wsConnected={wsConnected}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onStart={handleStart}
        onPause={handlePause}
        onStep={handleStep}
        onReset={handleReset}
        speedMultiplier={speedMultiplier}
        setSpeedMultiplier={setSpeedMultiplier}
      />

      {/* High-Level Telemetry HUD Banner */}
      <MetricsHUD simState={simState} bestPlan={bestPlan} />

      {/* Main Dynamic View Content */}
      <main className="dashboard-content">
        {/* Tab 1: Operations & Live Map */}
        {activeTab === 'map' && (
          <div className="simulation-layout">
            <DeliveryMap 
              restaurants={restaurants}
              customers={customers}
              roadGraph={roadGraph}
              riders={simState?.riders || []}
              orders={simState?.orders || []}
              bestPlan={bestPlan}
              selectedRiderId={selectedRiderId}
              onSelectRider={(id) => setSelectedRiderId(id === selectedRiderId ? null : id)}
            />

            <div className="sidebar-panels">
              <OrderQueue 
                orders={simState?.orders || []} 
                currentTimeMinutes={simState?.current_time_minutes || 0} 
              />
              <FleetStatus 
                riders={simState?.riders || []}
                selectedRiderId={selectedRiderId}
                onSelectRider={(id) => setSelectedRiderId(id === selectedRiderId ? null : id)}
              />
            </div>
          </div>
        )}

        {/* Tab 2: ACO Convergence & Hyperparameters */}
        {activeTab === 'aco' && (
          <ACOOptimizer 
            bestPlan={bestPlan} 
            onOptimizationComplete={handleOptimizationComplete} 
          />
        )}

        {/* Tab 3: Dynamic Disruption Injector */}
        {activeTab === 'disruptions' && (
          <DisruptionControls 
            restaurants={restaurants}
            customers={customers}
            riders={simState?.riders || []}
            roadGraph={roadGraph}
            simTimeMinutes={simState?.current_time_minutes || 0}
            onEventTriggered={() => {
              api.getSimState().then(setSimState).catch(console.warn);
            }}
          />
        )}

        {/* Tab 4: Benchmark Comparison */}
        {activeTab === 'benchmarks' && (
          <BenchmarkComparison />
        )}
      </main>
    </div>
  );
}
