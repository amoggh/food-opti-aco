import React, { useState } from 'react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend, 
  Cell 
} from 'recharts';
import { Trophy, CheckCircle2, TrendingDown, Clock, ShieldAlert } from 'lucide-react';

// Authentic empirical data from Phase 4 benchmark runs
const BENCHMARK_DATA = {
  10: [
    { algorithm: 'Ant Colony Optimization', cost: 3121.31, distance: 149.72, late_pct: 70.0, avg_time: 75.47, runtime: 0.0418, color: '#38bdf8' },
    { algorithm: 'Greedy Priority', cost: 3614.71, distance: 162.71, late_pct: 80.0, avg_time: 81.40, runtime: 0.0002, color: '#10b981' },
    { algorithm: 'Nearest Neighbor', cost: 6012.92, distance: 152.59, late_pct: 90.0, avg_time: 102.02, runtime: 0.0001, color: '#f43f5e' }
  ],
  25: [
    { algorithm: 'Greedy Priority', cost: 10196.40, distance: 389.13, late_pct: 76.0, avg_time: 110.15, runtime: 0.0097, color: '#10b981' },
    { algorithm: 'Ant Colony Optimization', cost: 10642.77, distance: 395.71, late_pct: 82.0, avg_time: 115.30, runtime: 1.9570, color: '#38bdf8' },
    { algorithm: 'Nearest Neighbor', cost: 15219.46, distance: 335.67, late_pct: 92.0, avg_time: 132.80, runtime: 0.0100, color: '#f43f5e' }
  ],
  50: [
    { algorithm: 'Greedy Priority', cost: 23409.24, distance: 756.00, late_pct: 84.0, avg_time: 140.22, runtime: 0.0091, color: '#10b981' },
    { algorithm: 'Ant Colony Optimization', cost: 26948.30, distance: 794.80, late_pct: 86.0, avg_time: 147.50, runtime: 2.5864, color: '#38bdf8' },
    { algorithm: 'Nearest Neighbor', cost: 36097.10, distance: 617.42, late_pct: 92.0, avg_time: 168.10, runtime: 0.0049, color: '#f43f5e' }
  ],
  100: [
    { algorithm: 'Greedy Priority', cost: 57434.44, distance: 1492.03, late_pct: 87.0, avg_time: 175.40, runtime: 0.0082, color: '#10b981' },
    { algorithm: 'Ant Colony Optimization', cost: 74701.80, distance: 1620.33, late_pct: 89.0, avg_time: 182.10, runtime: 1.9241, color: '#38bdf8' },
    { algorithm: 'Nearest Neighbor', cost: 92406.64, distance: 1071.44, late_pct: 93.0, avg_time: 198.70, runtime: 0.0038, color: '#f43f5e' }
  ]
};

export default function BenchmarkComparison() {
  const [selectedSize, setSelectedSize] = useState(10);
  const currentDataset = BENCHMARK_DATA[selectedSize];

  return (
    <div className="benchmark-layout">
      {/* Header and Size Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', padding: '1rem 1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>
            <Trophy size={20} color="#f59e0b" />
            <span>Algorithmic Benchmark Evaluation</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
            Empirical comparative analysis of Ant Colony Optimization vs. Greedy Priority vs. Nearest Neighbor.
          </div>
        </div>

        {/* Size Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Problem Scale:</span>
          {[10, 25, 50, 100].map(size => (
            <button
              key={size}
              className={`btn-ctrl ${selectedSize === size ? 'primary' : ''}`}
              onClick={() => setSelectedSize(size)}
            >
              N = {size} Orders
            </button>
          ))}
        </div>
      </div>

      {/* Charts Grid */}
      <div className="benchmark-charts-grid">
        {/* Chart 1: Multi-Objective Cost */}
        <div className="chart-card">
          <div className="chart-title">Total Multi-Objective Cost (Lower is Better)</div>
          <div className="chart-desc">Combined Distance + Tardiness + Freshness penalty</div>
          <div style={{ width: '100%', height: '240px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentDataset} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="algorithm" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip 
                  contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="cost" name="Total Cost" radius={[6, 6, 0, 0]}>
                  {currentDataset.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Late Deliveries Percentage */}
        <div className="chart-card">
          <div className="chart-title">Deadline Violation Rate (Lower is Better)</div>
          <div className="chart-desc">Percentage of deliveries exceeding promised customer deadline</div>
          <div style={{ width: '100%', height: '240px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentDataset} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="algorithm" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="%" domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="late_pct" name="Late Deliveries (%)" radius={[6, 6, 0, 0]}>
                  {currentDataset.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Total Fleet Distance */}
        <div className="chart-card">
          <div className="chart-title">Total Travel Distance (km)</div>
          <div className="chart-desc">Cumulative transit kilometers traversed across all active couriers</div>
          <div style={{ width: '100%', height: '240px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentDataset} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="algorithm" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="km" />
                <Tooltip 
                  contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="distance" name="Distance (km)" radius={[6, 6, 0, 0]}>
                  {currentDataset.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Computational Runtime */}
        <div className="chart-card">
          <div className="chart-title">Solver Execution Runtime (seconds)</div>
          <div className="chart-desc">Time taken to calculate routes and sequence stops</div>
          <div style={{ width: '100%', height: '240px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentDataset} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="algorithm" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="s" />
                <Tooltip 
                  contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="runtime" name="Runtime (s)" radius={[6, 6, 0, 0]}>
                  {currentDataset.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Empirical Data Table */}
      <div className="panel-card" style={{ padding: '1.25rem' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
          Exact Benchmark Results (N = {selectedSize} Orders)
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Algorithm</th>
                <th>Total Fitness Cost</th>
                <th>Fleet Distance (km)</th>
                <th>Late Deliveries (%)</th>
                <th>Avg Delivery Time (min)</th>
                <th>Runtime (s)</th>
              </tr>
            </thead>
            <tbody>
              {currentDataset.map((row, idx) => (
                <tr key={idx} className={row.algorithm.includes('Ant Colony') ? 'highlight-row' : ''}>
                  <td><strong>{row.algorithm}</strong></td>
                  <td>{row.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td>{row.distance.toFixed(2)} km</td>
                  <td>{row.late_pct.toFixed(1)}%</td>
                  <td>{row.avg_time.toFixed(1)} min</td>
                  <td>{row.runtime.toFixed(4)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Academic Takeaways */}
        <div style={{ marginTop: '1rem', padding: '0.85rem', background: '#0f172a', borderRadius: '8px', border: '1px solid var(--border-subtle)', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6 }}>
          <strong style={{ color: '#f8fafc' }}>Research Analysis & Insights:</strong>
          <ul style={{ paddingLeft: '1.2rem', marginTop: '0.4rem' }}>
            <li><strong>Nearest Neighbor Failure</strong>: Myopically minimizes immediate Euclidean distance but incurs a disastrous 90–93% tardiness rate due to blind omission of kitchen preparation times and deadline constraints.</li>
            <li><strong>ACO Superiority in Dense Clusters</strong>: At N=10, ACO achieves the lowest total multi-objective cost (3,121.31) and reduces late deliveries by 20% compared to Nearest Neighbor through collective pheromone learning.</li>
            <li><strong>Greedy Priority Efficiency</strong>: Greedy Priority serves as an effective fast heuristic for large clusters (N=100) by strictly prioritizing approaching deadlines.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
