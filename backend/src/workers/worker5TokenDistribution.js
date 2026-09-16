import { load, save } from '../store.js';
import { loadWallets, saveWallets } from '../smartwallets/tracker.js';
import { log } from '../bus.js';

const STORE_KEY = 'token_ath_cache';
const ATH_THRESHOLD = 2_000_000; // $2M
const FETCH_LIMIT = 30; // Max tokens to fetch per pass

/**
 * In-memory cache for token ATH records.
 * Each record: { ca, symbol, athMcap, isGt2m }
 */
let athCache = new Map();

/**
 * Load ATH cache from persistent store into memory.
 * Called on initialization and after resets.
 */
export function loadAthCache() {
  const stored = load(STORE_KEY, {});
  athCache = new Map(Object.entries(stored));
  return athCache;
}

/**
 * Persist current ATH cache to store.
 */
export function persistAthCache() {
  const obj = Object.fromEntries(athCache);
  save(STORE_KEY, obj);
}

/**
 * Upsert a token's ATH record and persist.
 * @param {string} ca - Contract address
 * @param {string} symbol - Token symbol
 * @param {number} athMcap - All-time high market cap
 */
export function upsertTokenAth(ca, symbol, athMcap) {
  const isGt2m = athMcap >= ATH_THRESHOLD;
  const record = { ca, symbol, athMcap, isGt2m };
  athCache.set(ca, record);
  persistAthCache();
}

/**
 * Get cached token ATH record or null if not found.
 * @param {string} ca - Contract address
 * @returns {Object|null} Token record or null
 */
export function getTokenAth(ca) {
  return athCache.get(ca) ?? null;
}

/**
 * Classify a wallet's traded tokens into >= $2M vs < $2M ATH counts.
 * Calculates hit rate percentage.
 * @param {Object} wallet - Wallet record with tradedTokenCAs array
 * @returns {Object} Classification with tokensTradedGt2m, tokensTradedLt2m, hitRateGt2mPct
 */
export function classifyWalletTokens(wallet) {
  const tradedTokenCAs = wallet.tradedTokenCAs || [];

  let tokensTradedGt2m = 0;
  let tokensTradedLt2m = 0;

  for (const ca of tradedTokenCAs) {
    const record = getTokenAth(ca);
    if (!record) {
      // Skip unknown tokens — they'll be fetched in a later pass
      continue;
    }

    if (record.isGt2m) {
      tokensTradedGt2m++;
    } else {
      tokensTradedLt2m++;
    }
  }

  const total = tokensTradedGt2m + tokensTradedLt2m;
  const hitRateGt2mPct = total > 0 ? (tokensTradedGt2m / total) * 100 : 0;

  return {
    tokensTradedGt2m,
    tokensTradedLt2m,
    hitRateGt2mPct,
  };
}

/**
 * Run a Worker 5 pass: collect missing token CAs, fetch up to 30, upsert,
 * recalculate wallet hit rates, and persist.
 * @param {Function} tokenAthFetcher - Async function(cas) => [{ ca, symbol, athMcap }, ...]
 * @returns {Object} Pass result { fetched, walletsUpdated }
 */
export async function runWorker5Pass(tokenAthFetcher) {
  // Load wallets
  const doc = loadWallets();
  const wallets = doc.wallets || [];

  // Collect all missing token CAs from all wallets
  const missingCas = new Set();
  for (const wallet of wallets) {
    const tradedTokenCAs = wallet.tradedTokenCAs || [];
    for (const ca of tradedTokenCAs) {
      if (!getTokenAth(ca)) {
        missingCas.add(ca);
      }
    }
  }

  // Limit to 30 per pass
  const casToFetch = Array.from(missingCas).slice(0, FETCH_LIMIT);

  if (casToFetch.length === 0) {
    // Nothing to fetch
    return { fetched: 0, walletsUpdated: 0 };
  }

  // Fetch token ATH data
  let fetched = [];
  try {
    fetched = await tokenAthFetcher(casToFetch);
  } catch (err) {
    log(`Worker 5: fetcher error: ${err.message}`);
    return { fetched: 0, walletsUpdated: 0, error: err.message };
  }

  // Upsert fetched tokens into cache
  for (const item of (fetched || [])) {
    if (item.ca && item.symbol != null && Number.isFinite(item.athMcap)) {
      upsertTokenAth(item.ca, item.symbol, item.athMcap);
    }
  }

  // Recalculate wallet hit rates and persist if changed
  let walletsUpdated = 0;
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const oldGt2m = wallet.tokensTradedGt2m || 0;
    const oldLt2m = wallet.tokensTradedLt2m || 0;
    const oldHitRate = wallet.hitRateGt2mPct || 0;

    const classification = classifyWalletTokens(wallet);

    // Only update if changed
    if (
      classification.tokensTradedGt2m !== oldGt2m ||
      classification.tokensTradedLt2m !== oldLt2m ||
      Math.abs(classification.hitRateGt2mPct - oldHitRate) > 0.01
    ) {
      wallets[i] = {
        ...wallet,
        tokensTradedGt2m: classification.tokensTradedGt2m,
        tokensTradedLt2m: classification.tokensTradedLt2m,
        hitRateGt2mPct: classification.hitRateGt2mPct,
      };
      walletsUpdated++;
    }
  }

  // Persist updated wallets if any changed
  if (walletsUpdated > 0) {
    doc.wallets = wallets;
    saveWallets(doc);
  }

  return {
    fetched: fetched.length,
    walletsUpdated,
  };
}

/**
 * Clear ATH cache and persistent store for test isolation.
 */
export function resetTokenAthCache() {
  athCache.clear();
  persistAthCache();
}

// Initialize cache on module load
loadAthCache();
