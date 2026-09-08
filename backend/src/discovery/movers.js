// Movers & Revivals discovery: catches AGED tokens that wake up with fresh
// momentum — the class the launch feeds (pump.fun / raydium) structurally miss
// because they only observe tokens at creation.
//
// Case study: Udin (2aQK…hpump) launched 2025-03, sat dormant ~16 months, then
// revived to ~$893k ATH in 2026-07. No launch-time feed could have caught that;
// only a market-wide momentum scan can. When an old coin wakes the signals are
// visible on free APIs *after* momentum starts — exactly when we want it.
//
// Sources (both free, keyless):
//   - GeckoTerminal /networks/solana/trending_pools — momentum ranking, age-agnostic
//   - DexScreener token-boosts/latest — paid-attention ("narrative arrived") signal
//
// A candidate becomes a "revival" when it is old enough to not be a fresh launch,
// has real liquidity, and shows a volume surge (h1 annualised >> h24) OR is boosted
// OR ranks in the trending top slots. Revivals register into the normal pipeline
// and auto-promote into the tracked tier, so the existing sleeper-wake and
// slow-climber detectors take over ongoing monitoring.
import { emit, log } from '../bus.js';
import { registerToken, getTokenByMint } from './registry.js';
import { promoteToTracked, getTrackedByMint } from '../analysis/tracked.js';
import { pushAlert } from '../alerts.js';

const GECKO_TRENDING_URL = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token';
const DEX_BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/latest/v1';

const POLL_INTERVAL_MS = 3 * 60_000; // 3 min — well inside both APIs' free limits
const MIN_AGE_MS = 24 * 3600_000;    // < 24h old = a fresh launch, leave it to pump/raydium
const MIN_LIQUIDITY_USD = 20_000;    // aged revivals need real depth to be tradable
const HEAT_RATIO = 2.5;              // h1 annualised volume >= 2.5x h24 => surge
const TRENDING_TOP_N = 20;           // top-N trending pools count as hot regardless of ratio

let timer = null;

export function startMoversFeed() {
  poll().catch(err => log('error', `Movers poll failed: ${err.message}`));
  timer = setInterval(() => {
    // The revival loop (registerRevival → promoteToTracked/alerts/emit) runs
    // outside inner guards; an unhandled rejection here would kill the process.
    poll().catch(err => log('error', `Movers poll failed: ${err.message}`));
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  log('info', 'Movers & Revivals feed started (3m poll)');
}

export function stopMoversFeed() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function poll() {
  const boosted = await fetchBoostedMints();
  await scanTrending(boosted);
}

// --- DexScreener boosts: set of solana mints with paid attention right now ---
async function fetchBoostedMints() {
  const set = new Set();
  try {
    const res = await fetch(DEX_BOOSTS_URL, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) { log('warn', `Movers boosts ${res.status}`); return set; }
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data?.tokens || []);
    for (const b of arr) {
      if ((b.chainId || b.chain) === 'solana' && b.tokenAddress) set.add(b.tokenAddress);
    }
  } catch (err) {
    log('warn', `Movers boosts fetch failed: ${err.message}`);
  }
  return set;
}

// --- GeckoTerminal trending: rank momentum across all ages ---
async function scanTrending(boostedMints) {
  let pools;
  try {
    const res = await fetch(GECKO_TRENDING_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) { log('warn', `Movers trending ${res.status}`); return; }
    const data = await res.json();
    pools = data?.data || [];
    var includedById = new Map((data?.included || []).map(i => [i.id, i]));
  } catch (err) {
    log('warn', `Movers trending fetch failed: ${err.message}`);
    return;
  }

  let revivals = 0;
  for (let rank = 0; rank < pools.length; rank++) {
    const candidate = normalizeTrendingPool(pools[rank], includedById, {
      rank, boostedMints,
    });
    if (!candidate) continue;
    if (registerRevival(candidate)) revivals++;
  }
  if (revivals > 0) log('info', `Movers: ${revivals} revival(s) registered this pass`);
}

/**
 * Decide whether a trending pool is an aged revival worth tracking, and shape it
 * for registerToken(). Returns null when it's a fresh launch, too illiquid, or cold.
 * Exported for unit testing (pure aside from the passed-in maps).
 */
export function normalizeTrendingPool(pool, includedById, { rank = 99, boostedMints = new Set() } = {}) {
  const attrs = pool?.attributes || {};
  const baseId = pool?.relationships?.base_token?.data?.id;
  const base = includedById.get(baseId)?.attributes || {};
  const mint = base.address || (typeof baseId === 'string' ? baseId.replace('solana_', '') : null);
  if (!mint) return null;

  const createdAt = attrs.pool_created_at ? Date.parse(attrs.pool_created_at) : NaN;
  const ageMs = Number.isNaN(createdAt) ? Infinity : Date.now() - createdAt;
  if (ageMs < MIN_AGE_MS) return null; // fresh launch — not a revival

  const liquidityUsd = attrs.reserve_in_usd != null ? Number(attrs.reserve_in_usd) : null;
  if (liquidityUsd == null || liquidityUsd < MIN_LIQUIDITY_USD) return null;

  const h1 = Number(attrs.volume_usd?.h1 ?? 0);
  const h24 = Number(attrs.volume_usd?.h24 ?? 0);
  // Annualise h1 to a 24h-equivalent and compare against actual h24: a value >>1
  // means the last hour is running far hotter than the day's average = a surge.
  const heat = h24 > 0 ? (h1 * 24) / h24 : (h1 > 0 ? Infinity : 0);
  const boosted = boostedMints.has(mint);
  const trendingHot = rank < TRENDING_TOP_N;

  if (heat < HEAT_RATIO && !boosted && !trendingHot) return null; // cold

  return {
    mint,
    symbol: base.symbol || attrs.name?.split('/')[0]?.trim() || '?',
    name: base.name || base.symbol || 'Unknown',
    imageUrl: base.image_url || null,
    source: 'revival',
    chain: 'solana',
    onCurve: false,
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    revivedAgeDays: Number.isFinite(ageMs) ? Math.round(ageMs / 86_400_000) : null,
    revivalHeat: Number.isFinite(heat) ? Math.round(heat * 10) / 10 : null,
    revivalBoosted: boosted,
    revivalRank: trendingHot ? rank + 1 : null,
    // snapshot for the alert / UI
    liquidityUsd,
    volume1hUsd: h1,
    volume24hUsd: h24,
  };
}

// Register a revival into the pipeline and promote it to tracked. Returns true
// if it was newly acted on (not already known/tracked).
function registerRevival(candidate) {
  const known = getTokenByMint(candidate.mint);
  const alreadyTracked = getTrackedByMint(candidate.mint);

  // registerToken is a no-op for an already-known mint, but we still want to
  // promote a known-but-untracked revival and fire the alert once.
  if (!known) registerToken(candidate);

  if (alreadyTracked) return false;

  const entry = promoteToTracked({
    mint: candidate.mint,
    symbol: candidate.symbol,
    name: candidate.name,
    chain: 'solana',
    priceUsd: known?.priceUsd ?? null,
    liquidityUsd: candidate.liquidityUsd,
    traction: known?.traction ?? null,
  }, 'revival');
  if (!entry) return false;

  const ageStr = candidate.revivedAgeDays != null ? `${candidate.revivedAgeDays}d old` : 'aged';
  const heatStr = candidate.revivalHeat != null ? `, h1 vol x${candidate.revivalHeat}` : '';
  const boostStr = candidate.revivalBoosted ? ', boosted' : '';
  pushAlert({
    type: 'revival',
    title: `SLEEPER REVIVAL ${candidate.symbol || candidate.mint.slice(0, 6)}`,
    body: `${ageStr}${heatStr}${boostStr} — liq $${Math.round(candidate.liquidityUsd).toLocaleString()}`,
    severity: 'info',
    link: `/memefinder/${encodeURIComponent('strategy:movers')}`,
  });
  emit('token:revival', { token: candidate });
  return true;
}
