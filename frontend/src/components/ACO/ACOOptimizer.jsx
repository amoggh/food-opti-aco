import React, { useState } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { Sliders, Sparkles, Check, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../../services/api';

export default function ACOOptimizer({ bestPlan, onOptimizationComplete }) {
  // ACO Hyperparameters
  const [numAnts, setNumAnts] = useState(20);
  const [iterations, setIterations] = useState(30);
  const [alpha, setAlpha] = useState(1.2);
  const [beta, setBeta] = useState(2.5);
  const [evaporation, setEvaporation] = useState(0.15);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [activePreset, setActivePreset] = useState('balanced');
  const [convergenceHistory, setConvergenceHistory] = useState(
    bestPlan?.convergence_history?.map((cost, idx) => ({ iteration: idx + 1, cost })) || [
      { iteration: 1, cost: 4890.2 },
      { iteration: 5, cost: 4120.4 },
      { iteration: 10, cost: 3680.1 },
      { iteration: 15, cost: 3340.5 },
      { iteration: 20, cost: 3210.0 },
      { iteration: 25, cost: 3140.2 },
      { iteration: 30, cost: 3121.3 },
    ]
  );
  const [statusMsg, setStatusMsg] = useState(null);

  const applyPreset = (preset) => {
    setActivePreset(preset);
    if (preset === 'fast') {
      setNumAnts(10);
      setIterations(15);
      setAlpha(1.0);
      setBeta(3.0);
      setEvaporation(0.20);
    } else if (preset === 'balanced') {
      setNumAnts(20);
      setIterations(30);
      setAlpha(1.2);
      setBeta(2.5);
      setEvaporation(0.15);
    } else if (preset === 'deep') {
      setNumAnts(35);
      setIterations(50);
      setAlpha(1.5);
      setBeta(2.0);
      setEvaporation(0.10);
    }
  };

  const handleRunACO = async () => {
    setIsOptimizing(true);
    setStatusMsg('Colony ants exploring probabilistic delivery paths...');
    try {
      const result = await api.runOptimization({
        num_ants: parseInt(numAnts),
        iterations: parseInt(iterations),
        alpha: parseFloat(alpha),
        beta: parseFloat(beta),
        evaporation_rate: parseFloat(evaporation),
        random_seed: 42,
        dynamic: false,
      });

      if (result?.convergence_history) {
        const historyData = result.convergence_history.map((cost, idx) => ({
          iteration: idx + 1,
          cost: parseFloat(cost.toFixed(1))
        }));
        setConvergenceHistory(historyData);
      }

      setStatusMsg(`Optimization complete. Best solution score: ${result.best_cost?.toFixed(1)}`);
      if (onOptimizationComplete) {
        onOptimizationComplete(result);
      }
    } catch (err) {
      console.error('ACO Run Error:', err);
      setStatusMsg(`Error during optimization: ${err.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const currentBestCost = convergenceHistory.length > 0 
    ? convergenceHistory[convergenceHistory.length - 1].cost 
    : bestPlan?.best_cost?.toFixed(1) || '3,121.3';

  return (
    <div className="aco-view-layout">
      {/* Left Panel: Hyperparameter Controls */}
      <div className="chart-card-shadcn" style={{ gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Sliders size={15} />
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fafafa' }}>Optimizer Settings</span>
          </div>
        </div>

        {/* Quick Presets */}
        <div>
          <div className="form-label" style={{ marginBottom: '0.4rem' }}>Configuration Presets</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
            <button 
              className={`btn-shadcn ${activePreset === 'fast' ? 'primary' : 'outline'}`}
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.4rem' }}
              onClick={() => applyPreset('fast')}
            >
              Fast
            </button>
            <button 
              className={`btn-shadcn ${activePreset === 'balanced' ? 'primary' : 'outline'}`}
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.4rem' }}
              onClick={() => applyPreset('balanced')}
            >
              Balanced
            </button>
            <button 
              className={`btn-shadcn ${activePreset === 'deep' ? 'primary' : 'outline'}`}
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.4rem' }}
              onClick={() => applyPreset('deep')}
            >
              Thorough
            </button>
          </div>
        </div>

        {/* 1. Number of Ants */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
            <span style={{ color: '#a1a1aa' }}>Colony Ants (m)</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{numAnts}</strong>
          </div>
          <input 
            type="range" 
            min="5" 
            max="50" 
            step="5"
            value={numAnts}
            onChange={(e) => { setNumAnts(e.target.value); setActivePreset('custom'); }}
            className="param-slider"
          />
        </div>

        {/* 2. Iterations */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
            <span style={{ color: '#a1a1aa' }}>Iterations (T)</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{iterations}</strong>
          </div>
          <input 
            type="range" 
            min="10" 
            max="100" 
            step="5"
            value={iterations}
            onChange={(e) => { setIterations(e.target.value); setActivePreset('custom'); }}
            className="param-slider"
          />
        </div>

        {/* 3. Alpha */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
            <span style={{ color: '#a1a1aa' }}>Pheromone Weight (&alpha;)</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{alpha}</strong>
          </div>
          <input 
            type="range" 
            min="0.1" 
            max="5.0" 
            step="0.1"
            value={alpha}
            onChange={(e) => { setAlpha(e.target.value); setActivePreset('custom'); }}
            className="param-slider"
          />
          <span style={{ fontSize: '0.68rem', color: '#71717a' }}>Importance of historical successful trails</span>
        </div>

        {/* 4. Beta */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
            <span style={{ color: '#a1a1aa' }}>Heuristic Weight (&beta;)</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{beta}</strong>
          </div>
          <input 
            type="range" 
            min="0.5" 
            max="5.0" 
            step="0.1"
            value={beta}
            onChange={(e) => { setBeta(e.target.value); setActivePreset('custom'); }}
            className="param-slider"
          />
          <span style={{ fontSize: '0.68rem', color: '#71717a' }}>Priority given to nearby deliveries and deadlines</span>
        </div>

        {/* 5. Evaporation */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
            <span style={{ color: '#a1a1aa' }}>Evaporation Rate (&rho;)</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{evaporation}</strong>
          </div>
          <input 
            type="range" 
            min="0.01" 
            max="0.5" 
            step="0.02"
            value={evaporation}
            onChange={(e) => { setEvaporation(e.target.value); setActivePreset('custom'); }}
            className="param-slider"
          />
          <span style={{ fontSize: '0.68rem', color: '#71717a' }}>How quickly trails decay to escape local minima</span>
        </div>

        {/* Run Button */}
        <button 
          className="btn-shadcn primary" 
          onClick={handleRunACO}
          disabled={isOptimizing}
          style={{ width: '100%', padding: '0.55rem', marginTop: '0.35rem' }}
        >
          {isOptimizing ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          <span>{isOptimizing ? 'Finding Optimal Paths...' : 'Execute ACO Solver'}</span>
        </button>

        {statusMsg && (
          <div style={{ 
            fontSize: '0.74rem', 
            padding: '0.5rem 0.65rem', 
            background: '#18181b', 
            border: '1px solid var(--border)', 
            borderRadius: '6px',
            color: '#a1a1aa'
          }}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* Right Panel: Convergence Curve & Intuitive Guide */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Convergence Curve Card */}
        <div className="chart-card-shadcn" style={{ height: '360px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="chart-title-shadcn">Colony Convergence Trajectory</div>
              <div className="chart-desc-shadcn">Optimization cost minimization as ants share trail information</div>
            </div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              background: '#18181b', 
              padding: '0.25rem 0.6rem', 
              borderRadius: '6px', 
              border: '1px solid var(--border)' 
            }}>
              <Check size={12} style={{ color: '#10b981' }} />
              <span style={{ fontSize: '0.74rem', color: '#fafafa', fontFamily: 'var(--font-mono)' }}>
                Best Score: {currentBestCost}
              </span>
            </div>
          </div>

          <div style={{ width: '100%', height: '260px', marginTop: '0.5rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergenceHistory} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis 
                  dataKey="iteration" 
                  stroke="#71717a" 
                  fontSize={11} 
                  tickLine={false}
                />
                <YAxis 
                  stroke="#71717a" 
                  fontSize={11} 
                  tickLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip 
                  contentStyle={{ background: '#18181b', borderColor: '#27272a', borderRadius: '6px', fontSize: '12px' }}
                  labelStyle={{ color: '#fafafa' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="cost" 
                  name="Fleet Cost Score" 
                  stroke="#fafafa" 
                  strokeWidth={2} 
                  dot={{ r: 2.5, fill: '#fafafa' }} 
                  activeDot={{ r: 5, fill: '#fafafa', stroke: '#09090b' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Clear Conceptual Guide: How ACO works */}
        <div className="chart-card-shadcn">
          <div className="chart-title-shadcn">How Ant Colony Optimization Works in Delivery Logistics</div>
          <div className="chart-desc-shadcn">A multi-agent, bio-inspired heuristic for solving complex Vehicle Routing Problems (VRP)</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '0.35rem' }}>
            <div style={{ background: '#18181b', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 600 }}>Step 1</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fafafa', margin: '2px 0 4px' }}>Probabilistic Route Building</div>
              <div style={{ fontSize: '0.72rem', color: '#a1a1aa' }}>
                Virtual ants construct courier tours by balancing distance proximity, prep ready-times, and promised customer deadlines.
              </div>
            </div>

            <div style={{ background: '#18181b', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 600 }}>Step 2</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fafafa', margin: '2px 0 4px' }}>Multi-Objective Scoring</div>
              <div style={{ fontSize: '0.72rem', color: '#a1a1aa' }}>
                Every solution is evaluated against three core objectives: total distance driven, deadline tardiness penalties, and food freshness.
              </div>
            </div>

            <div style={{ background: '#18181b', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 600 }}>Step 3</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fafafa', margin: '2px 0 4px' }}>Pheromone Reinforcement</div>
              <div style={{ fontSize: '0.72rem', color: '#a1a1aa' }}>
                Superior delivery sequences deposit pheromone trails, causing future ants to converge on the globally optimal courier schedule.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}