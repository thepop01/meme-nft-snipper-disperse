// REST client for the backend NFT mint engine.
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

export const nftApi = {
  drops: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/nft/drops${q ? '?' + q : ''}`);
  },
  lookupDrop: (slug) => request('GET', `/api/nft/drops/lookup?slug=${encodeURIComponent(slug)}`),
  refreshDrops: () => request('POST', '/api/nft/drops/refresh'),
  gas: (chain) => request('GET', `/api/nft/gas?chain=${chain}`),
  eligibility: (payload) => request('POST', '/api/nft/eligibility', payload),
  jobs: () => request('GET', '/api/nft/jobs'),
  job: (id) => request('GET', `/api/nft/jobs/${id}`),
  schedule: (payload) => request('POST', '/api/nft/jobs', payload),
  arm: (id, keys) => request('POST', `/api/nft/jobs/${id}/arm`, { keys }),
  cancel: (id) => request('POST', `/api/nft/jobs/${id}/cancel`),
};
