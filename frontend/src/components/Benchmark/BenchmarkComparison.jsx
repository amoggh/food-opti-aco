import React, { useState } from 'react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Cell 
} from 'recharts';
import { Trophy, Check } from 'lucide-react';

const BENCHMARK_DATA = {
  10: [
    { algorithm: 'Ant Colony Optimization', cost: 3121.31, distance: 149.72, late_pct: 70.0, avg_time: 75.47, runtime: 0.0418, color: '#fafafa' },
    { algorithm: 'Greedy Priority', cost: 3614.71, distance: 162.71, late_pct: 80.0, avg_time: 81.40, runtime: 0.0002, color: '#a1a1aa' },
    { algorithm: 'Nearest Neighbor', cost: 6012.92, distance: 152.59, late_pct: 90.0, avg_time: 102.02, runtime: 0.0001, color: '#52525b' }
  ],
  25: [
    { algorithm: 'Greedy Priority', cost: 10196.40, distance: 389.13, late_pct: 76.0, avg_time: 110.15, runtime: 0.0097, color: '#a1a1aa' },
    { algorithm: 'Ant Colony Optimization', cost: 10642.77, distance: 395.71, late_pct: 82.0, avg_time: 115.30, runtime: 1.9570, color: '#fafafa' },
    { algorithm: 'Nearest Neighbor', cost: 15219.46, distance: 335.67, late_pct: 92.0, avg_time: 132.80, runtime: 0.0100, color: '#52525b' }
  ],
  50: [
    { algorithm: 'Greedy Priority', cost: 23409.24, distance: 756.00, late_pct: 84.0, avg_time: 140.22, runtime: 0.0091, color: '#a1a1aa' },
    { algorithm: 'Ant Colony Optimization', cost: 26948.30, distance: 794.80, late_pct: 86.0, avg_time: 147.50, runtime: 2.5864, color: '#fafafa' },
    { algorithm: 'Nearest Neighbor', cost: 36097.10, distance: 617.42, late_pct: 92.0, avg_time: 168.10, runtime: 0.0049, color: '#52525b' }
  ],
  100: [
    { algorithm: 'Greedy Priority', cost: 57434.44, distance: 1492.03, late_pct: 87.0, avg_time: 175.40, runtime: 0.0082, color: '#a1a1aa' },
    { algorithm: 'Ant Colony Optimization', cost: 74701.80, distance: 1620.33, late_pct: 89.0, avg_time: 182.10, runtime: 1.9241, color: '#fafafa' },
    { algorithm: 'Nearest Neighbor', cost: 92406.64, distance: 1071.44, late_pct: 93.0, avg_time: 198.70, runtime: 0.0038, color: '#52525b' }
  ]
};

export default function BenchmarkComparison() {
  const [selectedSize, setSelectedSize] = useState(10);
  const currentDataset = BENCHMARK_DATA[selectedSize];

  return (
    <div className="benchmark-layout">
      {/* Header with Scale Switcher */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: 'var(--surface)', 
        padding: '0.85rem 1.15rem', 
        borderRadius: 'var(--radius-lg)', 
        border: '1px solid var(--border)' 
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.95rem', fontWeight: 600, color: '#fafafa' }}>
            <Trophy size={16} />
            <span>Algorithmic Benchmark Evaluation</span>
          </div>
          <div style={{ fontSize: '0.74rem', color: '#a1a1aa' }}>
            Comparative evaluation: Ant Colony Optimization vs. Greedy Priority vs. Nearest Neighbor
          </div>
        </div>

        {/* Size Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {[10, 25, 50, 100].map(size => (
            <button
              key={size}
              className={`btn-shadcn ${selectedSize === size ? 'primary' : 'outline'}`}
              onClick={() => setSelectedSize(size)}
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
            >
              N = {size} Orders
            </button>
          ))}
        </div>
      </div>

      {/* 2 Clear Charts Grid */}
      <div className="benchmark-charts-grid">
        {/* Chart 1: Multi-Objective Cost */}
        <div className="chart-card-shadcn">
          <div className="chart-title-shadcn">Total Fleet Cost (Lower is Better)</div>
          <div className="chart-desc-shadcn">Weighted combination of distance traveled and delay penalties</div>
          <div style={{ width: '100%', height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentDataset} margin={{ top: 10, right: 10, left: 0, bottom: 15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="algorithm" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                <Tooltip 
                  contentStyle={{ background: '#18181b', borderColor: '#27272a', borderRadius: '6px', fontSize: '12px' }}
                />
                <Bar dataKey="cost" name="Total Cost" radius={[4, 4, 0, 0]}>
                  {currentDataset.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Late Deliveries Percentage */}
        <div className="chart-card-shadcn">
          <div className="chart-title-shadcn">Deadline Violation Rate (Lower is Better)</div>
          <div className="chart-desc-shadcn">Percentage of food orders that arrived past promised customer deadline</div>
          <div style={{ width: '100%', height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentDataset} margin={{ top: 10, right: 10, left: 0, bottom: 15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="algorithm" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} unit="%" domain={[0, 100]} tickLine={false} />
                <Tooltip 
                  contentStyle={{ background: '#18181b', borderColor: '#27272a', borderRadius: '6px', fontSize: '12px' }}
                />
                <Bar dataKey="late_pct" name="Late Rate (%)" radius={[4, 4, 0, 0]}>
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
      <div className="chart-card-shadcn">
        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fafafa', marginBottom: '0.5rem' }}>
          Exact Benchmark Metrics (N = {selectedSize} Orders)
        </div>
        <div className="table-wrapper-shadcn">
          <table className="data-table-shadcn">
            <thead>
              <tr>
                <th>Algorithm</th>
                <th>Optimization Score</th>
                <th>Fleet Distance (km)</th>
                <th>Late Deliveries (%)</th>
                <th>Avg Delivery Time</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {currentDataset.map((row, idx) => (
                <tr key={idx} className={row.algorithm.includes('Ant Colony') ? 'highlight-row' : ''}>
                  <td><strong>{row.algorithm}</strong></td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{row.cost.toLocaleString('en-US', { minimumFractionDigits: 1 })}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{row.distance.toFixed(1)} km</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{row.late_pct.toFixed(1)}%</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{row.avg_time.toFixed(1)} min</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{row.runtime.toFixed(4)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Clear Takeaway Notes */}
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#18181b', borderRadius: '6px', border: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: '#a1a1aa', lineHeight: 1.6 }}>
          <strong style={{ color: '#fafafa' }}>Core Experimental Findings:</strong>
          <ul style={{ paddingLeft: '1.15rem', marginTop: '0.35rem' }}>
            <li><strong>Ant Colony Optimization (ACO)</strong> achieves the best route efficiency and lowest late delivery rates in dense urban batches (N=10) by balancing distance, kitchen preparation delay, and customer deadlines.</li>
            <li><strong>Nearest Neighbor</strong> is fast but suffers high tardiness (&gt;90%) because it blindly picks the physically closest stop without regard for kitchen cook times or deadline urgency.</li>
            <li><strong>Greedy Priority</strong> serves as an effective fast heuristic for very large batches (N=100) by strictly dispatching orders with the most pressing deadlines first.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}