import React, { useState, useEffect, useCallback, useRef } from 'react';
import Navbar from './components/Navbar';
import MetricsHUD from './components/MetricsHUD';
import DeliveryMap from './components/Map/DeliveryMap';
import DemoMap from './components/Map/DemoMap';
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

  // Focused Order for uncluttered route analysis
  const [focusedOrderId, setFocusedOrderId] = useState(null);

  // Playback loop and sync refs
  const playbackIntervalRef = useRef(null);
  const isRunningRef = useRef(false);
  const isTickingRef = useRef(false);

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
          isRunningRef.current = state.is_running;
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
        // Only allow server WebSocket to set is_running if client is not in an explicit paused state
        if (state.is_running !== undefined && isRunningRef.current) {
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

  // 3. Fast & Responsive Playback Loop with True Speed Multipliers
  useEffect(() => {
    if (isRunning) {
      isRunningRef.current = true;

      // True calibrated step intervals and delta-times:
      let stepIntervalMs = 500;
      let stepDt = 1.0;

      if (speedMultiplier <= 1) {
        stepIntervalMs = 1000;
        stepDt = 1.0;  // 1 min / sec
      } else if (speedMultiplier === 2) {
        stepIntervalMs = 500;
        stepDt = 1.0;  // 2 min / sec
      } else if (speedMultiplier === 5) {
        stepIntervalMs = 300;
        stepDt = 1.5;  // 5 min / sec
      } else if (speedMultiplier === 10) {
        stepIntervalMs = 200;
        stepDt = 2.0;  // 10 min / sec (fast!)
      } else if (speedMultiplier === 20) {
        stepIntervalMs = 150;
        stepDt = 3.0;  // 20 min / sec
      } else {
        stepIntervalMs = 100;
        stepDt = 5.0;  // 50 min / sec (turbo!)
      }

      playbackIntervalRef.current = setInterval(async () => {
        if (!isRunningRef.current || isTickingRef.current) return;
        isTickingRef.current = true;
        try {
          const res = await api.stepSimulation(stepDt);
          if (isRunningRef.current) {
            const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
            if (state) {
              setSimState(state);
            }
          }
        } catch (err) {
          console.warn('Simulation step tick failed:', err);
        } finally {
          isTickingRef.current = false;
        }
      }, stepIntervalMs);
    } else {
      isRunningRef.current = false;
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    }

    return () => {
      isRunningRef.current = false;
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, [isRunning, speedMultiplier]);

  // Simulation Controls Handlers
  const handleStart = async () => {
    isRunningRef.current = true;
    setIsRunning(true);
    try {
      const res = await api.startSimulation(speedMultiplier, 1.0);
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
    }
  };

  const handlePause = async () => {
    // Synchronously stop client interval immediately
    isRunningRef.current = false;
    setIsRunning(false);
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }

    try {
      const res = await api.pauseSimulation();
      const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
      if (state) {
        setSimState(state);
      }
    } catch (err) {
      console.error('Failed to pause simulation:', err);
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
    isRunningRef.current = false;
    setIsRunning(false);
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }

    try {
      const res = await api.resetSimulation();
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

  const handleSelectOrder = async (orderId) => {
    if (!orderId || orderId === focusedOrderId) {
      setFocusedOrderId(null);
      try {
        const res = await api.unfocusOrder();
        const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
        if (state) setSimState(state);
      } catch (err) {
        console.warn('Unfocus order error:', err);
      }
    } else {
      setFocusedOrderId(orderId);
      try {
        const res = await api.focusOrder(orderId);
        const state = res?.state || res?.snapshot || (res?.sim_time_min !== undefined ? res : null);
        if (state) setSimState(state);
      } catch (err) {
        console.warn('Focus order error:', err);
      }
    }
  };

  const handleOptimizationComplete = (result) => {
    if (result) {
      const plan = result.plan || result.best_plan || result;
      setBestPlan(plan);
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
        focusedOrderId={focusedOrderId}
        onClearFocus={() => handleSelectOrder(null)}
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
              closedEdges={simState?.closed_edges || []}
              blockedEdgesInfo={simState?.blocked_edges_info || []}
              bestPlan={bestPlan}
              selectedRiderId={selectedRiderId}
              onSelectRider={(id) => setSelectedRiderId(id === selectedRiderId ? null : id)}
              focusedOrderId={focusedOrderId}
              onSelectOrder={handleSelectOrder}
              onRefreshState={() => api.getSimState().then(setSimState).catch(console.warn)}
              onOpenDemo={() => setActiveTab('demo')}
            />

            <div className="sidebar-panels">
              <OrderQueue 
                orders={simState?.orders || []} 
                currentTimeMinutes={simState?.current_time_minutes || simState?.sim_time_min || 0}
                focusedOrderId={focusedOrderId}
                onSelectOrder={handleSelectOrder}
              />
              <FleetStatus 
                riders={simState?.riders || []}
                selectedRiderId={selectedRiderId}
                onSelectRider={(id) => setSelectedRiderId(id === selectedRiderId ? null : id)}
                focusedOrderId={focusedOrderId}
              />
            </div>
          </div>
        )}

        {/* Tab 1.5: Clean Turn-by-Turn Demo Map */}
        {activeTab === 'demo' && (
          <DemoMap />
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
            orders={simState?.orders || []}
            roadGraph={roadGraph}
            simTimeMinutes={simState?.current_time_minutes || simState?.sim_time_min || 0}
            focusedOrderId={focusedOrderId}
            onSelectOrder={handleSelectOrder}
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