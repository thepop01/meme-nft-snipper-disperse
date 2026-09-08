import { getBackendUrl, authHeaders } from './sniperApi.js';

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

export const disperseApi = {
  config: () => request('GET', '/api/disperse/config'),
  plan: (input) => request('POST', '/api/disperse/plan', input),
  execute: (payload) => request('POST', '/api/disperse/execute', payload),
  retry: (id, keys, plan) => request('POST', `/api/disperse/${id}/retry`, { keys, plan }),
  externalChunk: (id, payload) => request('POST', `/api/disperse/${id}/external-chunk`, payload),
  externalBridgeStatus: (id) => request('POST', `/api/disperse/${id}/external-bridge/status`),
  jobs: () => request('GET', '/api/disperse/jobs'),
  job: (id) => request('GET', `/api/disperse/jobs/${id}`),
};
