// Smart-wallet tracker: finds last-30-day runners (ATH >= $1M) and scores
// early-buyer wallets against EARLY_BUY_TIERS. Storage via store.js
// (backend/data/smart-wallets.json). Both chains: solana + robinhood.
import { load, save } from '../store.js';
import {
  LOOKBACK_MS,
  MIN_RUNNER_ATH,
  tierForAth,
  qualifiesEarlyBuy,
  earlyBuyerLimitForAth,
  isTradeProfitable,
} from './tiers.js';

const STORE_KEY = 'smart-wallets';

function tokenAth(token) {
  // Prefer explicit ATH fields, fall back to max of history + current mcap.
  const candidates = [
    token.ath, token.athMcap, token.maxMcap, token.marketCapUsd,
    ...(Array.isArray(token.history) ? token.history.map(h => h.marketCapUsd) : []),
  ].filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function tokenAgeOk(token, now = Date.now()) {
  const ts = token.createdAt || token.firstSeenAt || token.athTs;
  if (!ts) return true; // unknown age -> include, don't silently drop
  return now - ts <= LOOKBACK_MS;
}

/**
 * Method 1: Early buying market cap qualification.
 * Selects wallets that bought at or below 25% of ATH for a meme with ATH >= $1M.
 * Only trades that were profitable qualify.
 */
export function selectEarlyBuyersByMcap({ token = {}, buys = [], athMcap = null, requireProfitable = true }) {
  const ath = athMcap ?? tokenAth(token) ?? 0;
  if (ath < MIN_RUNNER_ATH) {
    return { athMcap: ath, count: 0, buyers: [] };
  }

  const seen = new Set();
  const earlyBuyers = [];

  for (const b of (buys || [])) {
    const addr = b.wallet || b.address || b.maker;
    if (!addr) continue;
    const norm = String(addr);
    if (seen.has(norm.toLowerCase())) continue;

    const buyMcap = b.buyMcap ?? b.marketCapUsd;
    if (!qualifiesEarlyBuy({ athMcap: ath, buyMcap })) continue;

    // Check trade profitability: only profitable trades qualify
    if (requireProfitable && !isTradeProfitable(b)) continue;

    seen.add(norm.toLowerCase());
    earlyBuyers.push({
      address: norm,
      chain: b.chain || token.chain || 'solana',
      category: 'tracked',
      source: 'early-buy-mcap',
      qualificationMethod: 'buying_mcap',
      methods: ['buying_mcap'],
      tags: ['tracked', 'early_mcap_buyer'],
      buyMcap: buyMcap ?? null,
      buyPrice: b.buyPrice ?? b.priceUsd ?? null,
      sellPrice: b.sellPrice ?? null,
      profitUsd: b.profitUsd ?? b.pnlUsd ?? b.realizedProfitUsd ?? null,
      isProfitable: true,
      buyTs: b.ts || b.timestamp || null,
      earlyBuyerInfo: {
        method: 'buying_mcap',
        mint: token.mint || token.address || null,
        symbol: token.symbol || null,
        athMcap: ath,
        buyMcap: buyMcap ?? null,
        buyPrice: b.buyPrice ?? b.priceUsd ?? null,
        sellPrice: b.sellPrice ?? null,
      },
    });
  }

  return {
    athMcap: ath,
    count: earlyBuyers.length,
    buyers: earlyBuyers,
  };
}

// Backward-compatibility wrapper for selectEarlyBuyers
export function selectEarlyBuyers({ athMcap, buys }) {
  const tier = tierForAth(athMcap);
  if (!tier) return { tier: null, buyers: [] };
  const buyers = (buys || []).filter(b => qualifiesEarlyBuy({ athMcap, buyMcap: b.buyMcap }));
  return { tier, buyers };
}

/**
 * Method 2: First N chronological buyers.
 * Selects the first N position-opening buyer wallets for a coin with ATH >= $1M:
 * - ATH >= 1M: 100 wallets base quota
 * - ATH > 1M: +20 wallets for each additional million in ATH
 * Only trades that were profitable qualify.
 */
export function selectAthEarlyBuyers({ token = {}, buys = [], athMcap = null, requireProfitable = true }) {
  const ath = athMcap ?? tokenAth(token) ?? 0;
  const quota = earlyBuyerLimitForAth(ath);
  if (quota <= 0 || !Array.isArray(buys) || buys.length === 0) {
    return { quota, athMcap: ath, count: 0, buyers: [] };
  }

  // Sort chronological
  const sorted = [...buys].sort((a, b) => {
    const tsA = a.ts || a.timestamp || a.blockTime || 0;
    const tsB = b.ts || b.timestamp || b.blockTime || 0;
    return tsA - tsB;
  });

  const seen = new Set();
  const earlyBuyers = [];
  let rank = 1;

  for (const b of sorted) {
    const addr = b.wallet || b.address || b.maker;
    if (!addr) continue;
    const norm = String(addr);
    if (seen.has(norm.toLowerCase())) continue;

    // Check trade profitability: only profitable trades qualify
    if (requireProfitable && !isTradeProfitable(b)) continue;

    seen.add(norm.toLowerCase());
    earlyBuyers.push({
      address: norm,
      chain: b.chain || token.chain || 'solana',
      category: 'tracked',
      source: 'first-n-buyers',
      qualificationMethod: 'first_n_buyers',
      methods: ['first_n_buyers'],
      tags: ['tracked', 'first_n_buyer'],
      rank,
      buyMcap: b.buyMcap ?? b.marketCapUsd ?? null,
      buyPrice: b.buyPrice ?? b.priceUsd ?? null,
      sellPrice: b.sellPrice ?? null,
      profitUsd: b.profitUsd ?? b.pnlUsd ?? b.realizedProfitUsd ?? null,
      isProfitable: true,
      buyTs: b.ts || b.timestamp || null,
      earlyBuyerInfo: {
        method: 'first_n_buyers',
        mint: token.mint || token.address || null,
        symbol: token.symbol || null,
        athMcap: ath,
        rank,
        buyMcap: b.buyMcap ?? b.marketCapUsd ?? null,
        buyPrice: b.buyPrice ?? b.priceUsd ?? null,
        sellPrice: b.sellPrice ?? null,
      },
    });

    rank++;
    if (earlyBuyers.length >= quota) break;
  }

  return {
    quota,
    athMcap: ath,
    count: earlyBuyers.length,
    buyers: earlyBuyers,
  };
}

/**
 * Dual method: captures early buyers both by Buying Mcap (<= 25% ATH)
 * AND by First N Buyers, keeping both methods.
 */
export function selectEarlyBuyersDual({ token = {}, buys = [], athMcap = null, requireProfitable = true }) {
  const mcapRes = selectEarlyBuyersByMcap({ token, buys, athMcap, requireProfitable });
  const firstNRes = selectAthEarlyBuyers({ token, buys, athMcap, requireProfitable });

  // Map to combine methods when addresses overlap while preserving both
  const combinedMap = new Map();
  for (const b of mcapRes.buyers) {
    combinedMap.set(b.address.toLowerCase(), { ...b });
  }
  for (const b of firstNRes.buyers) {
    const key = b.address.toLowerCase();
    if (combinedMap.has(key)) {
      const existing = combinedMap.get(key);
      existing.methods = Array.from(new Set([...(existing.methods || []), 'first_n_buyers']));
      existing.tags = Array.from(new Set([...(existing.tags || []), 'first_n_buyer']));
      existing.rank = b.rank;
      existing.source = 'early-buyer-dual';
      existing.earlyBuyerInfo = {
        ...existing.earlyBuyerInfo,
        ...b.earlyBuyerInfo,
        methods: ['buying_mcap', 'first_n_buyers'],
      };
    } else {
      combinedMap.set(key, { ...b });
    }
  }

  return {
    athMcap: mcapRes.athMcap || firstNRes.athMcap,
    quota: firstNRes.quota,
    mcapCount: mcapRes.count,
    firstNCount: firstNRes.count,
    mcapBuyers: mcapRes.buyers,
    firstNBuyers: firstNRes.buyers,
    allBuyers: Array.from(combinedMap.values()),
  };
}

/**
 * Build a Lineage Wallet record when a whale or existing DB wallet transfers
 * funds to a fresh wallet.
 */
export function connectLineageWallet({
  parentAddress,
  childAddress,
  chain = 'solana',
  amount = 0,
  txHash = null,
  tags = [],
  evidence = null,
}) {
  const normParent = chain === 'robinhood' ? String(parentAddress || '').toLowerCase() : String(parentAddress || '');
  const normChild = chain === 'robinhood' ? String(childAddress || '').toLowerCase() : String(childAddress || '');

  return {
    address: normChild,
    chain,
    category: 'lineage', // Lineage wallet linked to whale or smart parent
    source: 'lineage',
    score: null,
    hits: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lineageParent: normParent,
    lineageTx: txHash || null,
    lineageAmount: Number(amount) || 0,
    lineageDepth: 1,
    status: 'under_review',
    tags: Array.from(new Set(['lineage', 'whale_funded', ...tags])),
    evidence: {
      parentAddress: normParent,
      transferredAmount: Number(amount) || 0,
      txHash: txHash || null,
      transferredAt: new Date().toISOString(),
      ...(evidence || {}),
    },
  };
}

/**
 * Register a Whale Wallet (meme coin holdings > $5,000 OR balance > $5,000).
 */
export function connectWhaleWallet({
  address,
  chain = 'solana',
  balanceUsd = 0,
  memeHoldingsUsd = 0,
  tags = [],
  evidence = null,
}) {
  const norm = chain === 'robinhood' ? String(address || '').toLowerCase() : String(address || '');
  return {
    address: norm,
    chain,
    category: 'whale',
    source: 'whale-detector',
    score: null,
    hits: 1,
    balanceUsd: Number(balanceUsd) || 0,
    memeHoldingsUsd: Number(memeHoldingsUsd) || 0,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: 'active',
    tags: Array.from(new Set(['whale', ...tags])),
    evidence: evidence || {},
  };
}

// Scan registry tokens for runners (starting from 1M ATH).
export function findRunners(tokens, now = Date.now(), minAth = MIN_RUNNER_ATH) {
  return (tokens || [])
    .map(token => ({ token, ath: tokenAth(token) }))
    .filter(({ ath }) => ath != null && ath >= minAth)
    .filter(({ token }) => tokenAgeOk(token, now))
    .map(({ token, ath }) => ({
      mint: token.mint,
      chain: token.chain || 'solana',
      symbol: token.symbol || '?',
      ath,
      tier: tierForAth(ath),
      earlyBuyerLimit: earlyBuyerLimitForAth(ath),
      createdAt: token.createdAt || null,
    }));
}

let cachedWalletsDoc = null;

export function clearWalletsCache() {
  cachedWalletsDoc = null;
}

export function loadWallets() {
  if (!cachedWalletsDoc) {
    cachedWalletsDoc = load(STORE_KEY, { updatedAt: null, wallets: [], runners: [] });
  }
  return cachedWalletsDoc;
}

export function saveWallets(doc) {
  cachedWalletsDoc = doc;
  save(STORE_KEY, { ...doc, updatedAt: new Date().toISOString() });
}

export function upsertWallets(existing, newcomers) {
  const byKey = new Map(existing.map(w => [`${w.chain}:${String(w.address).toLowerCase()}`, w]));
  for (const w of newcomers) {
    const key = `${w.chain}:${String(w.address).toLowerCase()}`;
    const prev = byKey.get(key);
    const mergedMethods = Array.from(new Set([
      ...(prev?.methods || (prev?.qualificationMethod ? [prev.qualificationMethod] : [])),
      ...(w.methods || (w.qualificationMethod ? [w.qualificationMethod] : [])),
    ]));
    const mergedTags = Array.from(new Set([
      ...(prev?.tags || []),
      ...(w.tags || []),
    ]));

    byKey.set(key, {
      address: w.address,
      chain: w.chain,
      category: w.category || prev?.category || 'smart',
      source: w.source || prev?.source || 'manual',
      qualificationMethod: w.qualificationMethod || prev?.qualificationMethod || mergedMethods[0] || null,
      methods: mergedMethods,
      score: w.score ?? prev?.score ?? null,
      hits: (prev?.hits || 0) + (w.hits || 1),
      firstSeenAt: prev?.firstSeenAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      evidence: w.evidence || prev?.evidence || null,
      lineageParent: w.lineageParent || prev?.lineageParent || null,
      lineageTx: w.lineageTx || prev?.lineageTx || null,
      lineageAmount: w.lineageAmount ?? prev?.lineageAmount ?? null,
      lineageDepth: w.lineageDepth ?? prev?.lineageDepth ?? (w.lineageParent ? 1 : 0),
      earlyBuyerInfo: w.earlyBuyerInfo || prev?.earlyBuyerInfo || null,
      status: w.status || prev?.status || ((w.category || prev?.category) === 'tracked' ? 'active' : 'promoted'),
      balanceUsd: w.balanceUsd ?? prev?.balanceUsd ?? 0,
      memeHoldingsUsd: w.memeHoldingsUsd ?? prev?.memeHoldingsUsd ?? 0,
      realizedProfitUsd: w.realizedProfitUsd ?? prev?.realizedProfitUsd ?? 0,
      winRatePct: w.winRatePct ?? prev?.winRatePct ?? 0,
      profitableTrades: w.profitableTrades ?? prev?.profitableTrades ?? 0,
      totalTrades: w.totalTrades ?? prev?.totalTrades ?? 0,
      tokenNum: w.tokenNum ?? prev?.tokenNum ?? 0,
      openTrades: w.openTrades ?? prev?.openTrades ?? 0,
      avgBuyPrice: w.avgBuyPrice ?? prev?.avgBuyPrice ?? null,
      avgBuyMcap: w.avgBuyMcap ?? prev?.avgBuyMcap ?? null,
      avgSellPrice: w.avgSellPrice ?? prev?.avgSellPrice ?? null,
      avgHoldingTimeSec: w.avgHoldingTimeSec ?? prev?.avgHoldingTimeSec ?? null,
      walletType: w.walletType || prev?.walletType || 'normal',
      retardPoints: (prev?.retardPoints || 0) + (w.retardPoints || 0),
      susWalletPoints: (prev?.susWalletPoints || 0) + (w.susWalletPoints || 0),
      scamMemesInvolved: Array.from(new Set([...(prev?.scamMemesInvolved || []), ...(w.scamMemesInvolved || [])])),
      buys0to1M: w.buys0to1M ?? w.buysUnder1M ?? prev?.buys0to1M ?? prev?.buysUnder1M ?? 0,
      buys0to1MWon: w.buys0to1MWon ?? w.buysUnder1MProfitable ?? prev?.buys0to1MWon ?? prev?.buysUnder1MProfitable ?? 0,
      buys1to2M: w.buys1to2M ?? prev?.buys1to2M ?? Math.max(0, (w.buysUnder2M || prev?.buysUnder2M || 0) - (w.buysUnder1M || prev?.buysUnder1M || 0)),
      buys1to2MWon: w.buys1to2MWon ?? prev?.buys1to2MWon ?? 0,
      buys2to5M: w.buys2to5M ?? prev?.buys2to5M ?? Math.max(0, (w.buysUnder5M || prev?.buysUnder5M || 0) - (w.buysUnder2M || prev?.buysUnder2M || 0)),
      buys2to5MWon: w.buys2to5MWon ?? prev?.buys2to5MWon ?? 0,
      buys5to10M: w.buys5to10M ?? prev?.buys5to10M ?? Math.max(0, (w.buysUnder10M || prev?.buysUnder10M || 0) - (w.buysUnder5M || prev?.buysUnder5M || 0)),
      buys5to10MWon: w.buys5to10MWon ?? prev?.buys5to10MWon ?? 0,
      buysUnder1M: w.buysUnder1M ?? prev?.buysUnder1M ?? 0,
      buysUnder1MProfitable: w.buysUnder1MProfitable ?? prev?.buysUnder1MProfitable ?? 0,
      buysUnder2M: w.buysUnder2M ?? prev?.buysUnder2M ?? 0,
      buysUnder5M: w.buysUnder5M ?? prev?.buysUnder5M ?? 0,
      buysUnder10M: w.buysUnder10M ?? prev?.buysUnder10M ?? 0,
      captureRatioPct: w.captureRatioPct ?? prev?.captureRatioPct ?? null,
      soldAbove50AthPct: w.soldAbove50AthPct ?? prev?.soldAbove50AthPct ?? null,
      roundTripRatePct: w.roundTripRatePct ?? prev?.roundTripRatePct ?? null,
      roiPct: w.roiPct ?? prev?.roiPct ?? null,
      tokensTradedGt2m: w.tokensTradedGt2m ?? prev?.tokensTradedGt2m ?? null,
      tokensTradedLt2m: w.tokensTradedLt2m ?? prev?.tokensTradedLt2m ?? null,
      hitRateGt2mPct: w.hitRateGt2mPct ?? prev?.hitRateGt2mPct ?? null,
      tradedTokenCAs: Array.from(new Set([...(prev?.tradedTokenCAs || []), ...(w.tradedTokenCAs || [])])),
      lastProcessedTxSignature: w.lastProcessedTxSignature || prev?.lastProcessedTxSignature || null,
      lastProcessedTimestamp: w.lastProcessedTimestamp ?? prev?.lastProcessedTimestamp ?? null,
      tags: mergedTags.length > 0 ? mergedTags : (w.category === 'tracked' ? ['tracked_candidate'] : ['smart_degen']),
      twitterUsername: w.twitterUsername || prev?.twitterUsername || null,
      avatar: w.avatar || prev?.avatar || null,
    });
  }
  return [...byKey.values()];
}
