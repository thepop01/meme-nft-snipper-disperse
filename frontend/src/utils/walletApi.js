import { getBackendUrl, authHeaders } from './sniperApi.js';

async function request(method, path, body) {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${method} ${path} failed (${response.status})`);
  return data;
}

export const walletApi = {
  directory: () => request('GET', '/api/wallets/directory'),
  replaceDirectory: directory => request('PUT', '/api/wallets/directory', { directory }),
  importDirectory: directory => request('POST', '/api/wallets/directory/import', { directory }),
  resolve: input => request('POST', '/api/wallets/resolve', input),
  audit: () => request('GET', '/api/wallets/audit'),
  addWallet: input => request('POST', '/api/wallets', input),
  updateWallet: (id, patch) => request('PATCH', `/api/wallets/${id}`, patch),
  archiveWallets: walletIds => request('POST', '/api/wallets/archive', { walletIds }),
  deleteWallet: id => request('DELETE', `/api/wallets/${encodeURIComponent(id)}`),
  deleteWallets: walletIds => request('POST', '/api/wallets/delete', { walletIds }),
  createTag: input => request('POST', '/api/wallets/tags', input),
  updateTag: (id, patch) => request('PATCH', `/api/wallets/tags/${id}`, patch),
  deleteTag: id => request('DELETE', `/api/wallets/tags/${id}`),
  mergeTags: (targetTagId, sourceTagIds) => request('POST', '/api/wallets/tags/merge', { targetTagId, sourceTagIds }),
  setMemberships: (walletIds, tagIds, assigned) => request('POST', '/api/wallets/tags/memberships', { walletIds, tagIds, assigned }),
  // Signer vault
  vaultStatus: () => request('GET', '/api/wallets/vault/status'),
  vaultInit: password => request('POST', '/api/wallets/vault/init', { password }),
  vaultUnlock: password => request('POST', '/api/wallets/vault/unlock', { password }),
  vaultLock: () => request('POST', '/api/wallets/vault/lock'),
  setWalletKey: (id, privateKey) => request('POST', `/api/wallets/${id}/key`, { privateKey }),
  removeWalletKey: id => request('DELETE', `/api/wallets/${id}/key`),
  balances: (chain, addresses) => request('POST', '/api/wallets/balances', { chain, addresses }),
};
