// REST + WebSocket client for the local sniper backend.
// The backend holds the trading wallet; the browser never sees key material.

// Build-time override (Docker/nginx same-origin proxy uses an empty string).
const DEFAULT_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4517';

export function getBackendUrl() {
  const saved = localStorage.getItem('sniperBackendUrl');
  return (saved && saved !== 'null') ? saved.replace(/\/$/, '') : DEFAULT_URL;
}

export function setBackendUrl(url) {
  localStorage.setItem('sniperBackendUrl', url.replace(/\/$/, ''));
}

export function getApiToken() {
  return localStorage.getItem('sniperApiToken') || import.meta.env.VITE_API_TOKEN || '';
}

export function setApiToken(token) {
  if (token) localStorage.setItem('sniperApiToken', token);
  else localStorage.removeItem('sniperApiToken');
}

export function authHeaders() {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const res = await fetch(`${getBackendUrl()}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

export const api = {
  status: () => request('GET', '/api/status'),
  tokens: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/tokens${q ? '?' + q : ''}`);
  },
  memefinderQualified: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/memefinder/qualified${q ? '?' + q : ''}`);
  },
  bots: () => request('GET', '/api/bots'),
  createBot: (bot) => request('POST', '/api/bots', bot),
  updateBot: (id, patch) => request('PATCH', `/api/bots/${id}`, patch),
  deleteBot: (id) => request('DELETE', `/api/bots/${id}`),
  startBot: (id) => request('POST', `/api/bots/${id}/start`),
  stopBot: (id) => request('POST', `/api/bots/${id}/stop`),
  watchlist: () => request('GET', '/api/watchlist'),
  positions: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/positions${q ? `?${q}` : ''}`);
  },
  trades: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/trades${q ? `?${q}` : ''}`);
  },
  fills: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/fills${q ? `?${q}` : ''}`);
  },
  pnl: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/pnl${q ? `?${q}` : ''}`);
  },
  buy: (payload) => request('POST', '/api/trade/buy', payload),
  sell: (payload) => request('POST', '/api/trade/sell', payload),
  prepareExternalTrade: payload => request('POST', '/api/trade/external/prepare', payload),
  reconcileExternalTrade: payload => request('POST', '/api/trade/external/reconcile', payload),
  limitOrders: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/limit-orders${q ? `?${q}` : ''}`);
  },
  createLimitOrder: (payload) => request('POST', '/api/limit-orders', payload),
  cancelLimitOrder: (id) => request('DELETE', `/api/limit-orders/${id}`),
  tracked: () => request('GET', '/api/tracked'),
  trackToken: (mint) => request('POST', '/api/tracked/pin', { mint }),
  untrack: (mint) => request('DELETE', `/api/tracked/${mint}`),
  logs: () => request('GET', '/api/logs'),
  activity: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/activity${q ? `?${q}` : ''}`);
  },
  providerHealth: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/providers/health${q ? `?${q}` : ''}`);
  },
};

// --- WebSocket with auto-reconnect ---

let ws = null;
let wsListeners = [];
let reconnectTimer = null;
let wsConnected = false;

function wsUrl() {
  const base = getBackendUrl();
  const token = getApiToken();
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  // Empty backend URL = same-origin (nginx proxies /ws to the backend).
  if (!base) return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws${suffix}`;
  return base.replace(/^http/, 'ws') + '/ws' + suffix;
}

function notifyStatus() {
  wsListeners.forEach(l => l({ type: 'ws:status', connected: wsConnected }));
}

export function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    wsConnected = true;
    notifyStatus();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      wsListeners.forEach(l => l(msg));
    } catch { /* ignore malformed frames */ }
  };
  ws.onclose = () => {
    wsConnected = false;
    notifyStatus();
    scheduleReconnect();
  };
  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wsListeners.length > 0) connectWs();
  }, 3000);
}

export function subscribeWs(listener) {
  wsListeners.push(listener);
  connectWs();
  listener({ type: 'ws:status', connected: wsConnected });
  return () => {
    wsListeners = wsListeners.filter(l => l !== listener);
  };
}

export function isWsConnected() {
  return wsConnected;
}
