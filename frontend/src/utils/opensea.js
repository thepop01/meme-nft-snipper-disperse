const BASE_URL = 'https://api.opensea.io/api/v2';

const KEY_STORAGE = 'openseaKeyPool';
const KEY_INDEX = 'openseaKeyIndex';
const KEY_EXPIRY_PREFIX = 'openseaKeyExpiry_';
const REGEN_COOLDOWN_MS = 60 * 1000;

function getStaticKeys() {
  const env = import.meta.env.VITE_OPENSEA_API_KEY || '';
  return env ? [env] : [];
}

function getPool() {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePool(pool) {
  localStorage.setItem(KEY_STORAGE, JSON.stringify(pool));
}

function getKeyIndex() {
  return Number(localStorage.getItem(KEY_INDEX) || '0');
}

function saveKeyIndex(i) {
  localStorage.setItem(KEY_INDEX, String(i));
}

function isKeyExpired(key) {
  const exp = localStorage.getItem(KEY_EXPIRY_PREFIX + key);
  return exp ? Date.now() > Number(exp) : false;
}

function markKeyExpiry(key, expiresAt) {
  if (expiresAt) {
    localStorage.setItem(KEY_EXPIRY_PREFIX + key, String(new Date(expiresAt).getTime()));
  }
}

function removeKey(key) {
  localStorage.removeItem(KEY_EXPIRY_PREFIX + key);
}

export async function generateKey() {
  const res = await fetch(`${BASE_URL}/auth/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.api_key) {
    markKeyExpiry(data.api_key, data.expires_at);
    return data.api_key;
  }
  return null;
}

async function initPool() {
  const pool = getPool();
  const statics = getStaticKeys();
  let changed = false;
  for (const k of statics) {
    if (!pool.includes(k)) {
      pool.unshift(k);
      changed = true;
    }
  }
  if (pool.length === 0) {
    const fresh = await generateKey();
    if (fresh) { pool.push(fresh); changed = true; }
  }
  if (changed) savePool(pool);
  return pool;
}

function rotateKey(pool) {
  let idx = getKeyIndex();
  if (pool.length === 0) return '';
  if (idx >= pool.length) idx = 0;
  const key = pool[idx];
  if (isKeyExpired(key)) {
    removeKey(key);
    pool.splice(idx, 1);
    savePool(pool);
    if (pool.length === 0) return '';
    saveKeyIndex(idx % pool.length);
    return pool[idx % pool.length];
  }
  return key;
}

let _poolPromise = null;
let _lastRegen = 0;

async function getApiKeyAsync() {
  const manual = localStorage.getItem('openseaApiKey');
  if (manual) return manual;
  if (!_poolPromise) _poolPromise = initPool();
  const pool = await _poolPromise;
  return rotateKey(pool);
}

async function headersAsync() {
  const key = await getApiKeyAsync();
  const h = { 'Content-Type': 'application/json' };
  if (key) h['X-API-KEY'] = key;
  return h;
}

export async function autoRegenerateKey() {
  const now = Date.now();
  if (now - _lastRegen < REGEN_COOLDOWN_MS) return;
  _lastRegen = now;
  const pool = getPool();
  const fresh = await generateKey();
  if (fresh && !pool.includes(fresh)) {
    pool.push(fresh);
    savePool(pool);
    _poolPromise = Promise.resolve(pool);
  }
}

export function saveApiKey(key) {
  localStorage.setItem('openseaApiKey', key);
}

export function getStoredApiKey() {
  return localStorage.getItem('openseaApiKey') || '';
}

export function removeApiKey() {
  localStorage.removeItem('openseaApiKey');
}

export function getKeyInfo() {
  const pool = getPool();
  const statics = getStaticKeys();
  const all = [...new Set([...statics, ...pool])];
  return all.map(k => ({
    key: k,
    expired: isKeyExpired(k),
    expiry: localStorage.getItem(KEY_EXPIRY_PREFIX + k) || null,
    isStatic: statics.includes(k),
  }));
}

export async function regenerateAllKeys() {
  const pool = getPool();
  const fresh = await generateKey();
  if (fresh && !pool.includes(fresh)) {
    pool.push(fresh);
    savePool(pool);
    _poolPromise = Promise.resolve(pool);
  }
  return fresh;
}

async function apiFetch(url, options = {}) {
  const h = await headersAsync();
  const res = await fetch(url, { ...options, headers: { ...h, ...options.headers } });
  if (res.status === 429 || res.status === 403) {
    await autoRegenerateKey();
    const h2 = await headersAsync();
    const res2 = await fetch(url, { ...options, headers: { ...h2, ...options.headers } });
    if (!res2.ok) {
      const err = await res2.json().catch(() => ({ errors: [res2.statusText] }));
      throw new Error(err.errors?.[0] || `Failed: ${res2.status}`);
    }
    return res2.json();
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ errors: [res.statusText] }));
    throw new Error(err.errors?.[0] || `Failed: ${res.status}`);
  }
  return res.json();
}

export async function getDrops(type = 'upcoming', limit = 20, chain = null) {
  let url = `${BASE_URL}/drops?type=${type}&limit=${limit}`;
  if (chain) url += `&chains=${chain}`;
  return apiFetch(url);
}

export async function getDropDetails(slug) {
  return apiFetch(`${BASE_URL}/drops/${slug}`);
}

const ALL_DROPS_CACHE_KEY = 'allDropsCache';
const ALL_DROPS_TTL_MS = 5 * 60 * 1000; // 5 min — the API is key-rate-limited

// Aggregate live (active) + upcoming drops across every supported chain.
// Per-chain failures are tolerated so one rate-limited chain doesn't blank the
// whole explorer. Results are deduped by slug, tagged with chain + status, and
// cached in localStorage for 5 minutes.
export async function getAllDrops({ force = false } = {}) {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(ALL_DROPS_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < ALL_DROPS_TTL_MS) {
        return { drops: cached.drops, cachedAt: cached.ts, fromCache: true };
      }
    } catch { /* ignore malformed cache */ }
  }

  const jobs = [];
  for (const chain of CHAIN_NAMES) {
    for (const status of ['active', 'upcoming']) {
      jobs.push(
        getDrops(status, 20, chain)
          .then(data => ({ chain, status, drops: data.drops || data || [] }))
          .catch(() => ({ chain, status, drops: [] })) // tolerate per-chain failure
      );
    }
  }

  const results = await Promise.allSettled(jobs);
  const bySlug = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { chain, status, drops } = r.value;
    for (const drop of drops) {
      const slug = drop.collection_slug || drop.slug;
      if (!slug) continue;
      const existing = bySlug.get(slug);
      // Prefer a "live" tag over "upcoming" if the same collection appears in both
      if (!existing || (status === 'active' && existing.status !== 'active')) {
        bySlug.set(slug, {
          ...drop,
          collection_slug: slug,
          chain: drop.chain || chain,
          status: status === 'active' ? 'live' : 'upcoming',
        });
      }
    }
  }

  const drops = [...bySlug.values()].sort((a, b) => {
    // Live first, then soonest upcoming start
    if (a.status !== b.status) return a.status === 'live' ? -1 : 1;
    const at = a.start_time ? new Date(a.start_time).getTime() : Infinity;
    const bt = b.start_time ? new Date(b.start_time).getTime() : Infinity;
    return at - bt;
  });

  const payload = { ts: Date.now(), drops };
  try { localStorage.setItem(ALL_DROPS_CACHE_KEY, JSON.stringify(payload)); } catch { /* quota */ }
  return { drops, cachedAt: payload.ts, fromCache: false };
}

export async function buildMintTransaction(slug, minterAddress, quantity = 1) {
  return apiFetch(`${BASE_URL}/drops/${slug}/mint`, {
    method: 'POST',
    body: JSON.stringify({ minter: minterAddress, quantity }),
  });
}

export function extractSlug(input) {
  if (!input) return '';
  input = input.trim();
  if (input.startsWith('http')) {
    const match = input.match(/opensea\.io\/collection\/([^/?]+)/);
    if (match) return match[1];
    const match2 = input.match(/opensea\.io\/drops\/([^/?]+)/);
    if (match2) return match2[1];
  }
  return input.replace(/^@/, '');
}

export function getBlockExplorerUrl(chain, txHash) {
  const explorers = {
    ethereum: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    polygon: 'https://polygonscan.com/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    optimism: 'https://optimistic.etherscan.io/tx/',
    bnb: 'https://bscscan.com/tx/',
    avalanche: 'https://snowtrace.io/tx/',
    zora: 'https://explorer.zora.energy/tx/',
  };
  return (explorers[chain] || 'https://etherscan.io/tx/') + txHash;
}

export const CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  bnb: 56,
  avalanche: 43114,
  zora: 7777777,
};

export const CHAIN_NAMES = Object.keys(CHAIN_IDS);
