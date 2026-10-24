import React, { useState } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { Sliders, Play, CheckCircle2, Award, Zap, Compass } from 'lucide-react';
import { api } from '../../services/api';

export default function ACOOptimizer({ bestPlan, onOptimizationComplete }) {
  // ACO Hyperparameters
  const [numAnts, setNumAnts] = useState(20);
  const [iterations, setIterations] = useState(30);
  const [alpha, setAlpha] = useState(1.2);
  const [beta, setBeta] = useState(2.5);
  const [evaporation, setEvaporation] = useState(0.15);
  const [randomSeed, setRandomSeed] = useState(42);

  const [isOptimizing, setIsOptimizing] = useState(false);
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
        random_seed: parseInt(randomSeed),
        dynamic: false,
      });

      if (result?.convergence_history) {
        const historyData = result.convergence_history.map((cost, idx) => ({
          iteration: idx + 1,
          cost: parseFloat(cost.toFixed(1))
        }));
        setConvergenceHistory(historyData);
      }

      setStatusMsg(`Optimization complete! Best Solution Cost: ${result.best_cost?.toFixed(1)}`);
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
      <div className="panel-card" style={{ padding: '1.25rem', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
          <Sliders size={18} color="#38bdf8" />
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>ACO Hyperparameters</span>
        </div>

        {/* 1. Number of Ants */}
        <div className="param-group">
          <div className="param-label">
            <span>Colony Size (Ants $m$)</span>
            <strong style={{ color: '#38bdf8' }}>{numAnts}</strong>
          </div>
          <input 
            type="range" 
            min="5" 
            max="50" 
            step="5"
            value={numAnts}
            onChange={(e) => setNumAnts(e.target.value)}
            className="param-slider"
          />
        </div>

        {/* 2. Iterations */}
        <div className="param-group">
          <div className="param-label">
            <span>Iterations ($T$)</span>
            <strong style={{ color: '#38bdf8' }}>{iterations}</strong>
          </div>
          <input 
            type="range" 
            min="10" 
            max="100" 
            step="5"
            value={iterations}
            onChange={(e) => setIterations(e.target.value)}
            className="param-slider"
          />
        </div>

        {/* 3. Alpha (Pheromone Weight) */}
        <div className="param-group">
          <div className="param-label">
            <span>Pheromone Exponent (&alpha;)</span>
            <strong style={{ color: '#818cf8' }}>{alpha}</strong>
          </div>
          <input 
            type="range" 
            min="0.1" 
            max="5.0" 
            step="0.1"
            value={alpha}
            onChange={(e) => setAlpha(e.target.value)}
            className="param-slider"
          />
        </div>

        {/* 4. Beta (Heuristic Visibility) */}
        <div className="param-group">
          <div className="param-label">
            <span>Heuristic Exponent (&beta;)</span>
            <strong style={{ color: '#34d399' }}>{beta}</strong>
          </div>
          <input 
            type="range" 
            min="0.5" 
            max="5.0" 
            step="0.1"
            value={beta}
            onChange={(e) => setBeta(e.target.value)}
            className="param-slider"
          />
        </div>

        {/* 5. Evaporation Rate */}
        <div className="param-group">
          <div className="param-label">
            <span>Pheromone Evaporation (&rho;)</span>
            <strong style={{ color: '#f59e0b' }}>{evaporation}</strong>
          </div>
          <input 
            type="range" 
            min="0.01" 
            max="0.5" 
            step="0.02"
            value={evaporation}
            onChange={(e) => setEvaporation(e.target.value)}
            className="param-slider"
          />
        </div>

        {/* Run Button */}
        <button 
          className="btn-ctrl primary" 
          onClick={handleRunACO}
          disabled={isOptimizing}
          style={{ width: '100%', justifyContent: 'center', padding: '0.65rem', marginTop: '0.5rem' }}
        >
          {isOptimizing ? <Compass className="animate-spin" size={16} /> : <Zap size={16} />}
          <span>{isOptimizing ? 'Optimizing Fleet Routes...' : 'Run ACO Solver'}</span>
        </button>

        {statusMsg && (
          <div style={{ 
            fontSize: '0.75rem', 
            padding: '0.5rem 0.75rem', 
            background: 'rgba(2, 132, 199, 0.12)', 
            border: '1px solid rgba(56, 189, 248, 0.25)', 
            borderRadius: '6px',
            color: '#7dd3fc'
          }}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* Right Panel: Convergence Curve & Solution Breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Convergence Graph Card */}
        <div className="chart-card" style={{ height: '380px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="chart-title">Colony Convergence Trajectory</div>
              <div className="chart-desc">Monotonic best cost minimization across iterations</div>
            </div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.4rem', 
              background: 'rgba(16, 185, 129, 0.12)', 
              padding: '0.3rem 0.75rem', 
              borderRadius: '20px', 
              border: '1px solid rgba(16, 185, 129, 0.3)' 
            }}>
              <Award size={14} color="#34d399" />
              <span style={{ fontSize: '0.78rem', color: '#34d399', fontWeight: 600 }}>
                Best Fitness Cost: {currentBestCost}
              </span>
            </div>
          </div>

          <div style={{ width: '100%', height: '280px', marginTop: '0.5rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergenceHistory} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis 
                  dataKey="iteration" 
                  stroke="#64748b" 
                  fontSize={11} 
                  label={{ value: 'Iteration (t)', position: 'insideBottomRight', offset: -5, fill: '#64748b', fontSize: 11 }}
                />
                <YAxis 
                  stroke="#64748b" 
                  fontSize={11} 
                  label={{ value: 'Best Cost J', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} 
                />
                <Tooltip 
                  contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#38bdf8' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                <Line 
                  type="monotone" 
                  dataKey="cost" 
                  name="Best Colony Solution Cost" 
                  stroke="#38bdf8" 
                  strokeWidth={2.5} 
                  dot={{ r: 3, fill: '#0284c7' }} 
                  activeDot={{ r: 6, fill: '#38bdf8', stroke: '#ffffff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mathematical Formulation Card */}
        <div className="chart-card">
          <div className="chart-title">Bio-Inspired Optimization Cost Breakdown</div>
          <div className="chart-desc">
            The Ant Colony System minimizes multi-objective cost: 
            <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', color: '#38bdf8' }}>
              J = &lambda;_dist &middot; D + &lambda;_late &middot; T_late + &lambda;_fresh &middot; W_fresh
            </code>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ background: '#0f172a', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase' }}>Distance Weight (&lambda;_dist)</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>1.0x</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Minimizes vehicle fuel & transit wear</div>
            </div>
            <div style={{ background: '#0f172a', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase' }}>Tardiness Penalty (&lambda;_late)</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fb7185' }}>5.0x / min</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Heavily penalizes deadline violations</div>
            </div>
            <div style={{ background: '#0f172a', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase' }}>Food Freshness Penalty (&lambda;_fresh)</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f59e0b' }}>0.5x / min</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Reduces food cooling while in courier bag</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
