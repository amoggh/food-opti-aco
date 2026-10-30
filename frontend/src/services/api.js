/**
 * REST API client interacting with FastAPI backend (:8000).
 */

const API_BASE = '/api';

async function handleResponse(response) {
  if (!response.ok) {
    const errorText = await response.text();
    let errorJson;
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // ignore
    }
    throw new Error(errorJson?.detail || errorText || `HTTP Error ${response.status}`);
  }
  return response.json();
}

export const api = {
  // Health & static data
  async getHealth() {
    return handleResponse(await fetch(`${API_BASE}/health`));
  },
  async getRestaurants() {
    return handleResponse(await fetch(`${API_BASE}/restaurants`));
  },
  async getCustomers() {
    return handleResponse(await fetch(`${API_BASE}/customers`));
  },
  async getOrders() {
    return handleResponse(await fetch(`${API_BASE}/orders`));
  },
  async getRiders() {
    return handleResponse(await fetch(`${API_BASE}/riders`));
  },
  async getRoadGraph() {
    return handleResponse(await fetch(`${API_BASE}/graph`));
  },

  // Simulation controls
  async getSimState() {
    return handleResponse(await fetch(`${API_BASE}/simulation/state`));
  },
  async startSimulation(speedMultiplier = 1.0, stepDt = 1.0) {
    return handleResponse(await fetch(`${API_BASE}/simulation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed_multiplier: speedMultiplier, step_dt: stepDt }),
    }));
  },
  async pauseSimulation() {
    return handleResponse(await fetch(`${API_BASE}/simulation/pause`, {
      method: 'POST',
    }));
  },
  async stepSimulation(dtMinutes = 1.0) {
    return handleResponse(await fetch(`${API_BASE}/simulation/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta_time_min: dtMinutes, dt_minutes: dtMinutes }),
    }));
  },
  async resetSimulation() {
    return handleResponse(await fetch(`${API_BASE}/simulation/reset`, {
      method: 'POST',
    }));
  },

  // Dynamic disruption events
  async injectNewOrder(orderData) {
    return handleResponse(await fetch(`${API_BASE}/simulation/events/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    }));
  },
  async injectTrafficChange(trafficData) {
    return handleResponse(await fetch(`${API_BASE}/simulation/events/traffic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trafficData),
    }));
  },
  async injectRoadClosure(closureData) {
    return handleResponse(await fetch(`${API_BASE}/simulation/events/road-closure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(closureData),
    }));
  },
  async blockOrderRoute(orderId) {
    return handleResponse(await fetch(`${API_BASE}/simulation/events/block-order-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    }));
  },
  async clearRoadClosures() {
    return handleResponse(await fetch(`${API_BASE}/simulation/events/clear-closures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  },
  async focusOrder(orderId) {
    return handleResponse(await fetch(`${API_BASE}/simulation/focus-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    }));
  },
  async unfocusOrder() {
    return handleResponse(await fetch(`${API_BASE}/simulation/unfocus-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  },
  async injectRiderUnavailable(riderId, reason = 'Breakdown') {
    return handleResponse(await fetch(`${API_BASE}/simulation/events/rider-unavailable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rider_id: riderId, reason }),
    }));
  },

  // ACO Optimization & Metrics
  async runOptimization(params = {}) {
    const payload = {
      ...params,
      num_iterations: params.num_iterations || params.iterations || 20,
      iterations: params.iterations || params.num_iterations || 20,
    };
    return handleResponse(await fetch(`${API_BASE}/optimization/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
  },
  async getOptimizationMetrics() {
    return handleResponse(await fetch(`${API_BASE}/optimization/metrics`));
  },
};
