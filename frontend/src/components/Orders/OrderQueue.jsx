import React, { useState, useMemo } from 'react';
import { Package, Search, Clock, Crosshair, X, ArrowRight } from 'lucide-react';

export default function OrderQueue({ 
  orders = [], 
  currentTimeMinutes = 0,
  focusedOrderId = null,
  onSelectOrder = () => {}
}) {
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const focusedOrder = useMemo(() => {
    return orders.find(o => o.order_id === focusedOrderId) || null;
  }, [orders, focusedOrderId]);

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
    <div className="panel-shadcn" style={{ height: '50%' }}>
      <div className="panel-header-shadcn">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <Package size={14} />
          <span>Active Orders</span>
          <span style={{ 
            fontSize: '0.7rem', 
            color: '#a1a1aa', 
            background: '#27272a', 
            padding: '1px 6px', 
            borderRadius: '4px',
            fontFamily: 'var(--font-mono)' 
          }}>
            {filteredOrders.length}
          </span>
        </div>
        
        {/* Status filter dropdown */}
        <select 
          className="select-shadcn" 
          style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="ALL">All Status</option>
          <option value="PLACED">Placed</option>
          <option value="PREPARING">Preparing</option>
          <option value="READY">Ready</option>
          <option value="PICKED_UP">In Transit</option>
          <option value="DELIVERED">Delivered</option>
          <option value="LATE">Late Only</option>
        </select>
      </div>

      {/* Focused Order Highlight Card */}
      {focusedOrder && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'rgba(56, 189, 248, 0.08)',
          borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
              <Crosshair size={13} />
              <span>Tracking Focus: {focusedOrder.order_id}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#a1a1aa', marginTop: '1px' }}>
              {focusedOrder.restaurant_id} &rarr; {focusedOrder.customer_id} &bull; Courier: {focusedOrder.assigned_rider_id || 'Pending Dispatch'}
            </div>
          </div>
          <button 
            className="btn-shadcn outline" 
            style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', height: '22px' }}
            onClick={() => onSelectOrder(null)}
          >
            Clear Focus
          </button>
        </div>
      )}

      {/* Minimal Search Input */}
      <div style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={12} color="#71717a" style={{ position: 'absolute', left: '8px', top: '7px' }} />
          <input 
            type="text" 
            className="input-shadcn" 
            placeholder="Search order ID, restaurant, customer..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '26px', fontSize: '0.74rem', height: '26px' }}
          />
        </div>
      </div>

      {/* Orders List */}
      <div className="panel-list">
        {filteredOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.75rem', color: '#71717a', fontSize: '0.78rem' }}>
            No matching orders in queue
          </div>
        ) : (
          filteredOrders.map(order => {
            const isFocused = focusedOrderId === order.order_id;
            const statusLower = order.status ? order.status.toLowerCase() : 'placed';
            const deadlineRemaining = order.deadline_min - currentTimeMinutes;
            const isLate = order.is_late || (order.delivered_time_min && order.delivered_time_min > order.deadline_min) || (deadlineRemaining < 0 && order.status !== 'DELIVERED');

            return (
              <div 
                key={order.order_id} 
                className={`item-card-shadcn ${isFocused ? 'selected' : ''}`}
                style={{
                  borderLeft: isFocused ? '3px solid #38bdf8' : undefined,
                  background: isFocused ? 'rgba(56, 189, 248, 0.05)' : undefined
                }}
              >
                <div className="item-row">
                  <span className="item-id" style={{ color: isFocused ? '#38bdf8' : undefined }}>
                    {order.order_id}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className={`status-pill ${isLate && order.status !== 'DELIVERED' ? 'late' : statusLower}`}>
                      {isLate && order.status !== 'DELIVERED' ? 'Late SLA' : (order.status || 'PLACED').toLowerCase()}
                    </span>
                    <button
                      className="btn-shadcn ghost"
                      style={{ 
                        padding: '1px 5px', 
                        fontSize: '0.68rem', 
                        color: isFocused ? '#38bdf8' : '#71717a',
                        height: '20px'
                      }}
                      onClick={() => onSelectOrder(isFocused ? null : order.order_id)}
                      title={isFocused ? 'Unfocus this order' : 'Focus and inspect route'}
                    >
                      <Crosshair size={11} style={{ marginRight: '2px' }} />
                      {isFocused ? 'Focused' : 'Focus'}
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: '0.74rem', color: '#a1a1aa' }}>
                  <span>{order.restaurant_id} &rarr; {order.customer_id}</span>
                </div>

                <div className="item-row" style={{ fontSize: '0.7rem', color: '#71717a' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Clock size={11} /> 
                    {order.status === 'DELIVERED' ? (
                      <span>Delivered in {order.delivered_time_min ? (order.delivered_time_min - order.order_time_min).toFixed(0) : '--'}m</span>
                    ) : (
                      <span>
                        Due at {order.deadline_min?.toFixed(0)}m 
                        {deadlineRemaining > 0 ? ` (${deadlineRemaining.toFixed(0)}m left)` : ` (+${Math.abs(deadlineRemaining).toFixed(0)}m late)`}
                      </span>
                    )}
                  </span>
                  <span>{order.package_weight_kg ? `${order.package_weight_kg.toFixed(1)} kg` : '1.0 kg'}</span>
                </div>

                {order.assigned_rider_id && (
                  <div style={{ fontSize: '0.68rem', color: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ color: '#71717a' }}>Courier:</span>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{order.assigned_rider_id}</strong>
                    </div>
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