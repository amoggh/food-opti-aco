import React, { useState, useMemo } from 'react';
import { Package, Search, Clock, CheckCircle2 } from 'lucide-react';

export default function OrderQueue({ orders = [], currentTimeMinutes = 0 }) {
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Status filter
      if (filterStatus !== 'ALL') {
        if (filterStatus === 'LATE') {
          const isLate = order.is_late || (order.delivered_time_min && order.delivered_time_min > order.deadline_min);
          if (!isLate) return false;
        } else if (order.status !== filterStatus) {
          return false;
        }
      }

      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          order.order_id?.toLowerCase().includes(q) ||
          order.restaurant_id?.toLowerCase().includes(q) ||
          order.customer_id?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [orders, filterStatus, searchQuery]);

  return (
    <div className="panel-card" style={{ height: '50%' }}>
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Package size={15} color="#38bdf8" />
          <span>Active Order Queue ({filteredOrders.length})</span>
        </div>
        
        {/* Status filter dropdown */}
        <select 
          className="form-select" 
          style={{ padding: '0.2rem 0.4rem', fontSize: '0.72rem' }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="ALL">All Orders</option>
          <option value="PLACED">Placed</option>
          <option value="PREPARING">Preparing</option>
          <option value="READY">Ready</option>
          <option value="PICKED_UP">In Transit</option>
          <option value="DELIVERED">Delivered</option>
          <option value="LATE">Late Deliveries</option>
        </select>
      </div>

      {/* Search Bar */}
      <div style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} color="#64748b" style={{ position: 'absolute', left: '8px', top: '8px' }} />
          <input 
            type="text" 
            className="form-input" 
            placeholder="Search order, restaurant, customer..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', paddingLeft: '26px', fontSize: '0.75rem', height: '28px' }}
          />
        </div>
      </div>

      {/* Orders List */}
      <div className="panel-list">
        {filteredOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.78rem' }}>
            No matching orders in queue.
          </div>
        ) : (
          filteredOrders.map(order => {
            const statusLower = order.status ? order.status.toLowerCase() : 'placed';
            const deadlineRemaining = order.deadline_min - currentTimeMinutes;
            const isLate = order.is_late || (order.delivered_time_min && order.delivered_time_min > order.deadline_min) || (deadlineRemaining < 0 && order.status !== 'DELIVERED');

            return (
              <div key={order.order_id} className="item-card">
                <div className="item-row">
                  <span className="item-id">{order.order_id}</span>
                  <span className={`status-pill ${isLate && order.status !== 'DELIVERED' ? 'late' : statusLower}`}>
                    {isLate && order.status !== 'DELIVERED' ? 'LATE SLA' : order.status}
                  </span>
                </div>

                <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                  <span>{order.restaurant_id} &rarr; {order.customer_id}</span>
                </div>

                <div className="item-row" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Clock size={11} /> 
                    Deadline: {order.deadline_min?.toFixed(0)}m 
                    ({deadlineRemaining > 0 ? `+${deadlineRemaining.toFixed(0)}m left` : `${Math.abs(deadlineRemaining).toFixed(0)}m overdue`})
                  </span>
                  <span>{order.package_weight_kg ? `${order.package_weight_kg.toFixed(1)} kg` : '1.2 kg'}</span>
                </div>

                {order.assigned_rider_id && (
                  <div style={{ fontSize: '0.68rem', color: '#38bdf8' }}>
                    Assigned: <strong>{order.assigned_rider_id}</strong>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
