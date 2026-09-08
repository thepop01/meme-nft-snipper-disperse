// Attention signals: DexScreener token-boosts + token-profiles.
// Polls free endpoints every 5 min to detect "narrative arrived" moments.
// https://docs.dexscreener.com/api/reference
//
// Signals:
// - boosted: token appears in DexScreener token-boosts/latest
// - profiled: token appears in DexScreener token-profiles/latest
// - socials_appeared: socials added after launch (teams add links before pushing)
import { emit, log } from '../bus.js';
import { pushAlert } from '../alerts.js';

const BOOST_URL = 'https://api.dexscreener.com/token-boosts/latest/v1';
const PROFILE_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';
const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

// In-memory cache of boosted/profiled mints, keyed chainId:address so a boost
// on one chain doesn't light up a same-address token on another.
let boostedMints = new Set();
let profiledMints = new Set();
let lastPollAt = 0;
let pollTimer = null;

// Maps our internal chain names to DexScreener's chainId slug.
const DEXSCREENER_CHAIN_ID = { solana: 'solana', monad: 'monad', robinhood: 'robinhood' };

function attentionKey(chainId, address) {
  return `${chainId}:${address}`;
}

// Cache of socials at first observation per token
const socialsSnapshot = new Map(); // mint -> { website, twitter, telegram }

/**
 * Start polling attention signals.
 */
export function startAttentionPoll() {
  pollAttention();
  pollTimer = setInterval(pollAttention, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

/**
 * Stop polling.
 */
export function stopAttentionPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function pollAttention() {
  try {
    const [boosts, profiles] = await Promise.all([
      fetchBoosts(),
      fetchProfiles(),
    ]);

    // Detect newly boosted tokens
    const newBoosts = boosts.filter(m => !boostedMints.has(m));
    boostedMints = new Set(boosts);

    // Detect newly profiled tokens
    const newProfiles = profiles.filter(m => !profiledMints.has(m));
    profiledMints = new Set(profiles);

    // Emit events for new signals (keys are chainId:address)
    for (const key of newBoosts) {
      const address = key.split(':')[1] || key;
      log('info', `BOOST DETECTED: ${address.slice(0, 8)}...`);
      emit('token:boost', { mint: address, type: 'boost' });
    }
    for (const key of newProfiles) {
      const address = key.split(':')[1] || key;
      log('info', `PROFILE DETECTED: ${address.slice(0, 8)}...`);
      emit('token:boost', { mint: address, type: 'profile' });
    }

    lastPollAt = Date.now();
    log('info', `Attention poll: ${boosts.length} boosted, ${profiles.length} profiled, ${newBoosts.length} new boosts, ${newProfiles.length} new profiles`);
  } catch (err) {
    log('warn', `Attention poll failed: ${err.message}`);
  }
}

async function fetchBoosts() {
  try {
    const res = await fetch(BOOST_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json();
    // Response is an array of { chainId, tokenAddress, icon, description, ... }
    return (data || [])
      .filter(item => item.tokenAddress && item.chainId)
      .map(item => attentionKey(item.chainId, item.tokenAddress.toLowerCase()));
  } catch {
    return [];
  }
}

async function fetchProfiles() {
  try {
    const res = await fetch(PROFILE_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json();
    // Response is an array of { chainId, tokenAddress, url, ... }
    return (data || [])
      .filter(item => item.tokenAddress && item.chainId)
      .map(item => attentionKey(item.chainId, item.tokenAddress.toLowerCase()));
  } catch {
    return [];
  }
}

/**
 * Check if a token is currently boosted or profiled.
 */
export function getAttentionSignals(mint, chain = 'solana') {
  const lower = mint?.toLowerCase();
  if (!lower) return { boosted: false, profiled: false };
  const chainId = DEXSCREENER_CHAIN_ID[chain] ?? chain;
  const key = attentionKey(chainId, lower);
  return {
    boosted: boostedMints.has(key),
    profiled: profiledMints.has(key),
  };
}

/**
 * Detect "socials appeared after launch" — teams often add social links
 * right before a push. Compare current socials against first observation.
 * Returns true if new socials appeared.
 */
export function detectSocialsAppeared(token) {
  const mint = token.mint;
  if (!mint) return false;
  const snapKey = token.key || `${token.chain || 'solana'}:${mint}`;

  const current = {
    website: token.socials?.website || null,
    twitter: token.socials?.twitter || null,
    telegram: token.socials?.telegram || null,
  };

  const prev = socialsSnapshot.get(snapKey);
  if (!prev) {
    // First observation — store snapshot
    socialsSnapshot.set(snapKey, { ...current, observedAt: Date.now() });
    return false;
  }

  // Check if any new social appeared
  const hadSocial = prev.website || prev.twitter || prev.telegram;
  const hasSocial = current.website || current.twitter || current.telegram;

  if (!hadSocial && hasSocial) {
    log('info', `SOCIALS APPEARED: ${token.symbol || mint.slice(0, 8)} — team added links`);
    emit('token:socials', { mint, symbol: token.symbol, socials: current });
    // Update snapshot
    socialsSnapshot.set(snapKey, { ...current, observedAt: Date.now() });
    return true;
  }

  return false;
}

/**
 * Apply attention-based traction bonus to a token.
 * If boosted/profiled, add bonus points to traction score.
 */
export function applyAttentionBonus(token) {
  if (!token) return;
  const signals = getAttentionSignals(token.mint, token.chain || 'solana');
  const socialsAppeared = detectSocialsAppeared(token);

  if (signals.boosted) {
    token.attentionBoost = 'boosted';
    token.attentionDetectedAt = Date.now();
  } else if (signals.profiled) {
    token.attentionBoost = 'profiled';
    token.attentionDetectedAt = Date.now();
  } else if (socialsAppeared) {
    token.attentionBoost = 'socials';
    token.attentionDetectedAt = Date.now();
  }
}

/**
 * Get the number of boosted/profiled tokens (for monitoring).
 */
export function getAttentionStats() {
  return {
    boostedCount: boostedMints.size,
    profiledCount: profiledMints.size,
    lastPollAt,
  };
}

// Prune old socials snapshots (keep last 1000) to avoid memory leak
setInterval(() => {
  if (socialsSnapshot.size > 1000) {
    const entries = [...socialsSnapshot.entries()]
      .sort((a, b) => (a[1].observedAt ?? 0) - (b[1].observedAt ?? 0));
    const toDelete = entries.slice(0, entries.length - 500);
    for (const [mint] of toDelete) socialsSnapshot.delete(mint);
  }
}, 60_000).unref?.();
