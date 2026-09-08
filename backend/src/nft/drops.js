// OpenSea drops cache. refreshCache() is called on a 5-minute interval from
// server.js; fetchChain is injected so tests never hit the network.
//
// Phase 1 rebuild: single unfiltered recently_minted fetch, chains filter
// client-side. Consecutive-absence pruning + hard-expire carry-forwards.
import { load, save } from '../store.js';
import { emit, log } from '../bus.js';
import { normalizeDrop, classifyStatus, mintPageUrl } from './normalize.js';

const STORE = 'nft-drops';
export const NFT_CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon',
  'avalanche', 'zora', 'robinhood', 'megaeth', 'shape', 'ape_chain'];
const NEW_WINDOW_MS = 24 * 3600_000;
const PRUNE_ENDED_AFTER_MS = 7 * 24 * 3600_000;
const HARD_EXPIRE_CARRY_MS = 24 * 3600_000;  // carry-forward drops >24h old → prune
const LIVE_PRUNE_MS = 24 * 3600_000;         // live drops >24h → prune (stale)
const CONSECUTIVE_ABSENT_LIMIT = 3;          // absent 3 cycles + not minting → ended
const OPENSEA_BASE = 'https://api.opensea.io/api/v2';

// Default fetcher: recently_minted + upcoming from OpenSea.
// Also re-fetches any previously-cached upcoming drops by slug since they
// aren't in the recently_minted feed.
// Retries once on 429 after Retry-After delay.
export async function fetchRecentlyMinted({ prevDrops = [] } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;

  async function fetchType(type) {
    let res = await fetch(`${OPENSEA_BASE}/drops?type=${type}&limit=100`, { headers });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || '5');
      log('warn', `OpenSea rate limited on ${type}, retrying in ${retryAfter}s`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      res = await fetch(`${OPENSEA_BASE}/drops?type=${type}&limit=100`, { headers });
    }
    if (!res.ok) throw new Error(`OpenSea ${type}: ${res.status}`);
    const data = await res.json();
    return data.drops || [];
  }

  async function fetchBySlug(slug) {
    let res = await fetch(`${OPENSEA_BASE}/drops/${slug}`, { headers });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || '5');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      res = await fetch(`${OPENSEA_BASE}/drops/${slug}`, { headers });
    }
    if (!res.ok) return null;
    return await res.json();
  }

  const [recent, upcoming] = await Promise.all([
    fetchType('recently_minted'),
    fetchType('upcoming').catch(err => { log('warn', `OpenSea upcoming failed: ${err.message}`); return []; }),
  ]);

  // Re-fetch previously-cached upcoming/live drops that aren't in the batch.
  // This keeps upcoming drops visible even though they're not in recently_minted.
  const batchSlugs = new Set([...recent, ...upcoming].map(d => d.collection_slug || d.slug));
  const missingSlugs = prevDrops
    .filter(d => (d.status === 'upcoming' || d.status === 'live') && !batchSlugs.has(d.slug))
    .map(d => d.slug)
    .slice(0, 20);

  const looked = await Promise.all(missingSlugs.map(s => fetchBySlug(s).catch(() => null)));
  const extra = looked.filter(Boolean);

  return [...recent, ...upcoming, ...extra];
}

export function getCachedDrops() {
  return load(STORE, { drops: [], fetchedAt: {} }).drops;
}

export async function refreshCache({ fetchDrops = fetchRecentlyMinted, now = Date.now() } = {}) {
  const prev = load(STORE, { drops: [], fetchedAt: {}, absentCount: {} });
  const firstSeenBySlug = new Map(prev.drops.map(d => [`${d.chain}:${d.slug}`, d.firstSeen]));
  const absentCount = { ...prev.absentCount };

  // Fetch once, unfiltered — filter chains client-side
  let raws;
  try {
    raws = await fetchDrops({ prevDrops: prev.drops });
  } catch (err) {
    log('warn', `OpenSea fetch failed: ${err.message}`);
    raws = [];
  }

  const byKey = new Map();
  for (const raw of raws) {
    const d = normalizeDrop(raw, now);
    if (!d) continue;
    if (!NFT_CHAINS.includes(d.chain)) continue;
    const key = `${d.chain}:${d.slug}`;
    d.firstSeen = firstSeenBySlug.get(key) ?? now;
    // Reset absent counter — drop was seen this cycle
    absentCount[key] = 0;
    // Prefer live over upcoming when the same drop appears in both feeds
    const existing = byKey.get(key);
    if (!existing || (d.status === 'live' && existing.status !== 'live')) byKey.set(key, d);
  }

  // Carry forward previously-seen drops missing from this fetch,
  // increment their absent counter, re-classify status.
  for (const d of prev.drops) {
    const key = `${d.chain}:${d.slug}`;
    if (!byKey.has(key)) {
      d.status = classifyStatus({
        startTime: d.startTime,
        endTime: d.endTime,
        isMinting: d.isMinting,
      }, now);
      d.mintPageUrl = mintPageUrl(d.slug);
      d.openseaUrl = mintPageUrl(d.slug);
      absentCount[key] = (absentCount[key] ?? 0) + 1;
      // Prune: absent >= 3 consecutive cycles AND not minting → drop
      if (absentCount[key] >= CONSECUTIVE_ABSENT_LIMIT && !d.isMinting) {
        delete absentCount[key];
        continue;
      }
      // Prune: carry-forward older than hard-expire → drop
      if (now - (d.lastSeen ?? d.firstSeen) > HARD_EXPIRE_CARRY_MS) {
        delete absentCount[key];
        continue;
      }
      byKey.set(key, d);
    }
  }

  const drops = [...byKey.values()].filter(d => {
    if (d.status === 'ended' && d.endTime && now - d.endTime > PRUNE_ENDED_AFTER_MS) return false;
    if (d.status === 'ended' && !d.endTime && absentCount[`${d.chain}:${d.slug}`] >= CONSECUTIVE_ABSENT_LIMIT) return false;
    // Prune live drops whose active/public phase started >24h ago
    const activeStart = d.activeStartTime ?? d.startTime;
    if (d.status === 'live' && activeStart && now - activeStart > LIVE_PRUNE_MS) return false;
    return true;
  });

  save(STORE, { drops, fetchedAt: { [`${NFT_CHAINS[0]}`]: now }, absentCount });
  emit('nft:drops', { count: drops.length });
  return { drops };
}

// status: 'live' | 'upcoming' | 'all'. Default hides ended/sold-out.
export function queryDrops({ status = 'live', chain = null, q = '', now = Date.now() } = {}) {
  // Reclassify status at query time to eliminate staleness between refresh cycles.
  let drops = getCachedDrops().map(d => ({
    ...d,
    status: classifyStatus({
      startTime: d.startTime,
      endTime: d.endTime,
      isMinting: d.isMinting,
    }, now),
    mintPageUrl: mintPageUrl(d.slug),
    openseaUrl: mintPageUrl(d.slug),
  }));
  if (status === 'all') {
    // everything, including ended/sold-out
  } else if (status === 'active') {
    drops = drops.filter(d => d.status === 'live' || d.status === 'upcoming');
  } else if (status === 'live' || status === 'upcoming') {
    drops = drops.filter(d => d.status === status);
  } else {
    drops = drops.filter(d => d.status === 'live' || d.status === 'upcoming');
  }
  if (chain) drops = drops.filter(d => d.chain === chain);
  // Prune live drops whose active/public phase started >24h ago
  drops = drops.filter(d => {
    if (d.status !== 'live') return true;
    const activeStart = d.activeStartTime ?? d.startTime;
    return !(activeStart && now - activeStart > LIVE_PRUNE_MS);
  });
  if (q) {
    const needle = q.toLowerCase();
    drops = drops.filter(d => d.slug.includes(needle) || d.name.toLowerCase().includes(needle));
  }
  return drops
    .map(d => ({ ...d, isNew: now - d.firstSeen < NEW_WINDOW_MS }))
    .sort((a, b) => {
      const rank = { live: 0, upcoming: 1 };
      const ra = rank[a.status] ?? 2; const rb = rank[b.status] ?? 2;
      if (ra !== rb) return ra - rb;
      return (a.startTime ?? Infinity) - (b.startTime ?? Infinity);
    });
}
