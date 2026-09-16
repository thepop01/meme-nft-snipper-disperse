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
 * Safe finite number parsing to avoid NaN/Infinity serializing to null in JSON.
 */
function toSafeNumber(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Canonicalize contract address.
 * EVM addresses (Robinhood or starting with '0x') are lowercased.
 * Solana Base58 addresses remain strictly case-sensitive.
 *
 * @param {string} ca
 * @param {string} [chain]
 * @returns {string}
 */
export function canonicalizeCa(ca, chain) {
  if (!ca || typeof ca !== 'string') return '';
  const trimmed = ca.trim();
  if (!trimmed) return '';
  if (chain === 'robinhood' || trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Upsert a meme coin into the shared deduplicated tracked_memes registry.
 * Deduplicated by canonicalized contract address (ca).
 * Merges sourceFlags without losing previous tags.
 * Preserves backfilled: true across subsequent updates.
 * Preserves T_ATH integrity against equal ATH polls.
 *
 * @param {Object} item
 * @returns {Object|null}
 */
export function upsertMeme(item) {
  if (!item || !item.ca || typeof item.ca !== 'string') {
    return null;
  }

  const chain = (item.chain && typeof item.chain === 'string') ? item.chain : 'solana';
  const ca = canonicalizeCa(item.ca, chain);
  if (!ca) return null;

  const reg = loadRegistry();
  const existing = reg.get(ca) || {
    ca,
    name: item.name || 'Unknown',
    symbol: item.symbol || '?',
    chain,
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
    existing.currentMcap = toSafeNumber(item.currentMcap, 0);
  }

  // ATH Market Cap & Timestamp (T_ATH) Integrity
  if (item.athMcap != null) {
    const newAth = toSafeNumber(item.athMcap, 0);
    if (newAth > existing.athMcap) {
      existing.athMcap = newAth;
      if (item.athTimestamp != null) {
        existing.athTimestamp = toSafeNumber(item.athTimestamp, 0);
      } else {
        existing.athTimestamp = Date.now();
      }
    } else if (newAth === existing.athMcap) {
      // Do NOT update athTimestamp on equal ATH (>=) polls because periodic polls
      // with current timestamps would move T_ATH forward.
      // Only set if !existing.athTimestamp
      if (!existing.athTimestamp && item.athTimestamp != null) {
        existing.athTimestamp = toSafeNumber(item.athTimestamp, 0);
      }
    }
  }

  // When currentMcap > existing.athMcap:
  // Update existing.athMcap = existing.currentMcap and set existing.athTimestamp = item.athTimestamp || Date.now()
  // Do NOT synthesize athMcap = currentMcap for Worker 1 tokens that only report currentMcap if they don't have an ATH yet;
  // keep athMcap: 0, athTimestamp: 0 until Worker 2 or an ATH source populates it.
  if (existing.athMcap > 0 && existing.currentMcap > existing.athMcap) {
    existing.athMcap = existing.currentMcap;
    existing.athTimestamp = item.athTimestamp != null ? toSafeNumber(item.athTimestamp, 0) : Date.now();
  }

  if (item.volume24hUsd != null) {
    existing.volume24hUsd = toSafeNumber(item.volume24hUsd, 0);
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
    const targetCa = canonicalizeCa(filter.ca, filter.chain);
    list = list.filter(
      m =>
        m.ca === targetCa ||
        ((m.chain === 'robinhood' || m.ca.startsWith('0x')) &&
          m.ca.toLowerCase() === targetCa.toLowerCase())
    );
  }

  if (filter.minMcap != null) {
    const minMcap = toSafeNumber(filter.minMcap, 0);
    list = list.filter(m => m.currentMcap >= minMcap);
  }

  if (filter.minAth != null) {
    const minAth = toSafeNumber(filter.minAth, 0);
    list = list.filter(m => m.athMcap >= minAth);
  }

  return list;
}

/**
 * Retrieve unbackfilled memes awaiting early buyer extraction by Worker 3.
 * Only returns memes that have athMcap > 0 since Worker 3 cannot calculate
 * buyer quotas or 25% ATH entry without a recorded ATH.
 *
 * @param {number} limit
 * @returns {Array}
 */
export function getUnbackfilledMemes(limit = 10) {
  const list = getTrackedMemes({ backfilled: false }).filter(m => m.athMcap > 0);
  if (limit == null) return list;
  const parsedLimit = toSafeNumber(limit, 10);
  return list.slice(0, Math.max(0, parsedLimit));
}

/**
 * Mark a meme coin as backfilled after Worker 3 has harvested qualifying early buyers.
 *
 * @param {string} ca
 * @returns {Object|null}
 */
export function markMemeBackfilled(ca) {
  if (!ca || typeof ca !== 'string') return null;
  const trimmed = ca.trim();
  if (!trimmed) return null;
  const reg = loadRegistry();

  let m = reg.get(trimmed);
  if (!m && (trimmed.startsWith('0x') || trimmed.startsWith('0X'))) {
    m = reg.get(trimmed.toLowerCase());
  }
  if (!m) {
    m = reg.get(trimmed.toLowerCase());
  }
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
