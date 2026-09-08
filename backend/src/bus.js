// Central event bus: modules publish, server.js broadcasts to WebSocket clients.
const listeners = new Set();

export function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(type, payload = {}) {
  const event = { type, ...payload, ts: Date.now() };
  for (const fn of listeners) {
    try { fn(event); } catch { /* listener errors must not break the bus */ }
  }
}

// Rolling in-memory log exposed via GET /api/logs
const LOG_LIMIT = 500;
const logBuffer = [];

export function log(level, message, meta = {}) {
  const entry = { level, message, ...meta, ts: Date.now() };
  logBuffer.unshift(entry);
  if (logBuffer.length > LOG_LIMIT) logBuffer.pop();
  emit('log', { entry });
  const line = `[${new Date(entry.ts).toISOString()}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function getLogs() {
  return logBuffer;
}
