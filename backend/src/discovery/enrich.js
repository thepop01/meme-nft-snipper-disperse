// Market data enrichment via the free DexScreener API.
// https://docs.dexscreener.com/api/reference
import { isMetadataUri, resolveImageUrl } from './tokenMedia.js';
import { emit } from '../bus.js';

const DEXSCREENER_TOKEN_URL = 'https://api.dexscreener.com/latest/dex/tokens/';

// Maps our internal chain names to DexScreener's `chainId` slug. An EVM
// contract address can be reused across chains, so /tokens/<address> may return
// pairs from several chains — without this filter the deepest pair (often on a
// different chain) bleeds its price/liquidity onto our token.
const DEXSCREENER_CHAIN_ID = {
  solana: 'solana',
  monad: 'monad',
  robinhood: 'robinhood',
};

// Maps a token to the DexScreener `chainId` slug we expect its pairs on.
// Null = unknown chain, so identity must not be gated on it.
export function wantChainFor(token) {
  return DEXSCREENER_CHAIN_ID[token.chain] ?? (token.chain ? null : 'solana');
}

// Select the deepest pair, restricted to the token's chain when we know it.
// Falls back to all pairs if the chain is unknown or no pair matches, so we
// never regress Solana or unmapped feeds to zero data.
function pickPair(pairs, token) {
  const wantChain = wantChainFor(token);
  let pool = pairs;
  if (wantChain) {
    const sameChain = pairs.filter(p => p.chainId === wantChain);
    if (sameChain.length) pool = sameChain;
  }
  return pool.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

// Simple rate limiter: DexScreener allows ~300 req/min; stay well under.
let lastCall = 0;
const MIN_INTERVAL_MS = 350;

async function throttled(url) {
  const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  return res.json();
}

export async function enrichToken(token) {
  const data = await throttled(DEXSCREENER_TOKEN_URL + token.mint);
  const pairs = data.pairs || [];
  if (pairs.length === 0) {
    token.enrichedAt = Date.now();
    return token; // brand-new pump.fun tokens often have no pair yet
  }

  // Use the deepest pair on the token's own chain
  const pair = pickPair(pairs, token);
  if (!pair) {
    token.enrichedAt = Date.now();
    return token;
  }

  token.priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
  token.liquidityUsd = pair.liquidity?.usd ?? null;
  token.volume24hUsd = pair.volume?.h24 ?? null;
  token.marketCapUsd = pair.marketCap ?? pair.fdv ?? null;
  token.dexId = pair.dexId;
  token.pairAddress = pair.pairAddress;
  token.priceChange = pair.priceChange || {};
  // Short-window activity — raw material for traction scoring
  token.txns = pair.txns || {};           // { m5: {buys, sells}, h1: {...}, ... }
  token.volume5mUsd = pair.volume?.m5 ?? null;
  token.volume1hUsd = pair.volume?.h1 ?? null;
  if (!token.symbol && pair.baseToken?.symbol) token.symbol = pair.baseToken.symbol;
  if (!token.name && pair.baseToken?.name) token.name = pair.baseToken.name;
  // Identity (image/socials) only comes from a pair on the token's own
  // chain: EVM addresses are reused across chains, so a deepest pair from a
  // different chain would bleed the wrong image in. Price/liquidity/volume
  // still update from whatever pair was picked.
  const wantChain = wantChainFor(token);
  const chainOk = !wantChain || pair.chainId === wantChain;
  if (pair.info && chainOk) {
    token.imageUrl = pair.info.imageUrl || token.imageUrl;
    token.socials = {
      website: pair.info.websites?.[0]?.url || null,
      twitter: pair.info.socials?.find(s => s.type === 'twitter')?.url || null,
      telegram: pair.info.socials?.find(s => s.type === 'telegram')?.url || null,
    };
  }
  // Backfill: legacy tokens may still carry a metadata-JSON uri as imageUrl —
  // those render as broken <img> tags. Resolve once; resolver caches results.
  if (isMetadataUri(token.imageUrl)) {
    const pending = token.imageUrl;
    resolveImageUrl(pending)
      .then(image => { if (image && token.imageUrl === pending) { token.imageUrl = image; emit('token:update', { token }); } })
      .catch(() => { /* negative-cached; retried on a later pass */ });
  }
  token.enrichedAt = Date.now();
  return token;
}

/**
 * Merge GMGN intelligence (`gmgn-cli --raw` shapes, see discovery/gmgn.js)
 * onto a registry token. Never touches price/liquidity/volume — DexScreener
 * stays the price authority. Returns the same token object.
 */
export function mergeGmgnIntelligence(token, gmgn) {
  if (!gmgn || typeof gmgn !== 'object') return token;
  if (gmgn.holder_count != null) token.holderCount = Number(gmgn.holder_count);
  if (gmgn.smart_degen_count != null) token.smartWallets = Number(gmgn.smart_degen_count);
  if (gmgn.renowned_count != null) token.renownedCount = Number(gmgn.renowned_count);
  if (gmgn.sniper_count != null) token.snipers = Number(gmgn.sniper_count);
  if (gmgn.top_10_holder_rate != null) token.top10HolderPct = Math.round(Number(gmgn.top_10_holder_rate) * 100 * 100) / 100;
  if (gmgn.bundler_rate != null) token.bundlerPct = Math.round(Number(gmgn.bundler_rate) * 100 * 100) / 100;
  if (gmgn.rug_ratio != null) token.rugRatio = Number(gmgn.rug_ratio);
  if (gmgn.bluechip_owner_percentage != null) token.bluechipPct = Number(gmgn.bluechip_owner_percentage);
  if (gmgn.rat_trader_amount_rate != null) token.ratTraderRate = Number(gmgn.rat_trader_amount_rate);
  if (gmgn.bot_degen_rate != null) token.botDegenRate = Number(gmgn.bot_degen_rate);
  if (gmgn.renounced_mint != null) token.renouncedMint = gmgn.renounced_mint === 1;
  if (gmgn.renounced_freeze_account != null) token.renouncedFreeze = gmgn.renounced_freeze_account === 1;
  if (gmgn.is_honeypot != null) token.honeypot = gmgn.is_honeypot === 1;
  if (gmgn.is_wash_trading !== undefined) token.washTrading = Boolean(gmgn.is_wash_trading);
  if (gmgn.buy_tax != null) token.buyTax = gmgn.buy_tax;
  if (gmgn.sell_tax != null) token.sellTax = gmgn.sell_tax;
  if (gmgn.lock_percent != null) token.lockPercent = Number(gmgn.lock_percent);
  if (gmgn.creator !== undefined) token.creator = gmgn.creator || token.creator || null;
  token.gmgnUpdatedAt = Date.now();
  return token;
}

export async function fetchPriceUsd(mint) {
  try {
    const data = await throttled(DEXSCREENER_TOKEN_URL + mint);
    const pair = (data.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return pair?.priceUsd ? Number(pair.priceUsd) : null;
  } catch {
    return null;
  }
}

/**
 * Batch fetch prices for multiple mints in one request (DexScreener supports up to 30).
 * Returns Map<mint, priceUsd | null>.
 */
export async function fetchPricesBatch(mints) {
  if (mints.length === 0) return new Map();
  const results = new Map();
  // DexScreener allows up to 30 mints per request
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const data = await throttled(DEXSCREENER_TOKEN_URL + batch.join(','));
      const pairsByMint = new Map();
      for (const pair of data.pairs || []) {
        const existing = pairsByMint.get(pair.baseToken?.address);
        if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
          pairsByMint.set(pair.baseToken?.address, pair);
        }
      }
      for (const mint of batch) {
        const pair = pairsByMint.get(mint);
        results.set(mint, pair?.priceUsd ? Number(pair.priceUsd) : null);
      }
    } catch {
      for (const mint of batch) results.set(mint, null);
    }
  }
  return results;
}
