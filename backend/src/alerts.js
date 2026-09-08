// Shared in-app alert center. Any subsystem pushes; the bus broadcasts
// alert:new to WS clients; last 200 persist across restarts.
import { load, save } from './store.js';
import { emit } from './bus.js';

const STORE = 'alerts';
const MAX = 200;

export function pushAlert({ type, title, body = '', severity = 'info', link = null }) {
  const alert = {
    id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type, title, body, severity, link, read: false, ts: Date.now(),
  };
  const list = load(STORE, []);
  list.unshift(alert);
  save(STORE, list.slice(0, MAX));
  emit('alert:new', { alert });
  return alert;
}

export function listAlerts() {
  return load(STORE, []);
}

export function markAllRead() {
  const list = load(STORE, []).map(a => ({ ...a, read: true }));
  save(STORE, list);
  return list;
}
