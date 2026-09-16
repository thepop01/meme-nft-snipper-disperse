import { load, save } from '../store.js';

const STORE_KEY = 'tracked-memes';

let memCache = null;

function loadRegistry() {
  if (!memCache) {
    const raw = load(STORE_KEY, { memes: [] });
    const list = Array.isArray(raw) ? raw : (raw?.memes || []);
    memCache = new Map(list.map(m => [m.ca, m]));
  }
  return memCache;
}

function persist() {
  if (!memCache) return;
  save(STORE_KEY, {
    memes: Array.from(memCache.values()),
    updatedAt: Date.now(),
  });
}

/**
 * Upsert a meme coin into the shared deduplicated tracked_memes registry.
 * Deduplicated by contract address (ca).
 * Merges sourceFlags without losing previous tags.
 * Preserves backfilled: true across subsequent updates.
 *
 * @param {Object} item
 * @returns {Object|null}
 */
export function upsertMeme(item) {
  if (!item || !item.ca || typeof item.ca !== 'string' || !item.ca.trim()) {
    return null;
  }

  const ca = item.ca.trim();
  const reg = loadRegistry();
  const existing = reg.get(ca) || {
    ca,
    name: item.name || 'Unknown',
    symbol: item.symbol || '?',
    chain: item.chain || 'solana',
    currentMcap: 0,
    athMcap: 0,
    athTimestamp: 0,
    volume24hUsd: 0,
    sourceFlags: [],
    backfilled: false,
    backfilledAt: null,
    createdAt: Date.now(),
  };

  if (item.name && typeof item.name === 'string') existing.name = item.name;
  if (item.symbol && typeof item.symbol === 'string') existing.symbol = item.symbol;
  if (item.chain && typeof item.chain === 'string') existing.chain = item.chain;

  if (item.currentMcap != null) {
    existing.currentMcap = Number(item.currentMcap);
  }

  if (item.athMcap != null) {
    const newAth = Number(item.athMcap);
    if (newAth >= existing.athMcap) {
      existing.athMcap = newAth;
      if (item.athTimestamp) {
        existing.athTimestamp = Number(item.athTimestamp);
      }
    }
  } else if (existing.athMcap === 0 && existing.currentMcap > 0) {
    existing.athMcap = existing.currentMcap;
    if (item.athTimestamp) {
      existing.athTimestamp = Number(item.athTimestamp);
    } else if (!existing.athTimestamp) {
      existing.athTimestamp = Date.now();
    }
  }

  // ATH cannot logically be lower than current market cap
  if (existing.currentMcap > existing.athMcap) {
    existing.athMcap = existing.currentMcap;
  }

  if (item.athTimestamp && !existing.athTimestamp) {
    existing.athTimestamp = Number(item.athTimestamp);
  }

  if (item.volume24hUsd != null) {
    existing.volume24hUsd = Number(item.volume24hUsd);
  }

  // Merge source flags
  if (!Array.isArray(existing.sourceFlags)) {
    existing.sourceFlags = [];
  }
  if (item.source && typeof item.source === 'string' && !existing.sourceFlags.includes(item.source)) {
    existing.sourceFlags.push(item.source);
  }
  if (Array.isArray(item.sourceFlags)) {
    for (const flag of item.sourceFlags) {
      if (flag && typeof flag === 'string' && !existing.sourceFlags.includes(flag)) {
        existing.sourceFlags.push(flag);
      }
    }
  }

  // Preserve backfilled state: once backfilled = true, do not overwrite back to false
  if (existing.backfilled !== true) {
    if (item.backfilled === true) {
      existing.backfilled = true;
      existing.backfilledAt = item.backfilledAt || Date.now();
    } else {
      existing.backfilled = false;
      existing.backfilledAt = null;
    }
  }

  existing.updatedAt = Date.now();

  reg.set(ca, existing);
  persist();
  return existing;
}

/**
 * Query tracked memes with optional filtering.
 *
 * @param {Object} filter
 * @returns {Array}
 */
export function getTrackedMemes(filter = {}) {
  const reg = loadRegistry();
  let list = Array.from(reg.values());

  if (filter.backfilled !== undefined && filter.backfilled !== null) {
    const isBackfilled = filter.backfilled === true || filter.backfilled === 'true';
    list = list.filter(m => m.backfilled === isBackfilled);
  }

  if (filter.source) {
    list = list.filter(m => Array.isArray(m.sourceFlags) && m.sourceFlags.includes(filter.source));
  }

  if (filter.chain) {
    list = list.filter(m => m.chain === filter.chain);
  }

  if (filter.ca) {
    list = list.filter(m => m.ca === filter.ca);
  }

  if (filter.minMcap != null) {
    list = list.filter(m => m.currentMcap >= Number(filter.minMcap));
  }

  if (filter.minAth != null) {
    list = list.filter(m => m.athMcap >= Number(filter.minAth));
  }

  return list;
}

/**
 * Retrieve unbackfilled memes awaiting early buyer extraction by Worker 3.
 *
 * @param {number} limit
 * @returns {Array}
 */
export function getUnbackfilledMemes(limit = 10) {
  const list = getTrackedMemes({ backfilled: false });
  if (limit == null) return list;
  return list.slice(0, Math.max(0, Number(limit)));
}

/**
 * Mark a meme coin as backfilled after Worker 3 has harvested qualifying early buyers.
 *
 * @param {string} ca
 * @returns {Object|null}
 */
export function markMemeBackfilled(ca) {
  if (!ca || typeof ca !== 'string') return null;
  const reg = loadRegistry();
  const m = reg.get(ca.trim());
  if (!m) return null;

  m.backfilled = true;
  m.backfilledAt = Date.now();
  m.updatedAt = Date.now();
  persist();
  return m;
}

/**
 * Reset in-memory cache and persisted store (for test isolation).
 */
export function resetMemeRegistry() {
  memCache = new Map();
  save(STORE_KEY, { memes: [], updatedAt: Date.now() });
}
