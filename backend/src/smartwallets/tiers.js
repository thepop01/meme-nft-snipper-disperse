// Smart-wallet early-buyer tier rules.
// 25% of ATH Rule (starting from 1M ATH):
// A token's ATH mcap decides the max mcap at which an early buy qualifies.
// Early buyer bought at or below 25% of the runner's All-Time High.
// Only profitable trades qualify the wallet for tracking.
// 4-month (120-day) lookback for runner and wallet transaction detection.
//
// Tiers (25% of ATH, min ATH >= 1M):
//   ATH ~1M        -> bought below 250k (<250k, 25% of 1M)
//   ATH ~5M        -> bought below 1.25M (<1.25M, 25% of 5M)
//   ATH ~10M       -> bought below 2.5M (<2.5M, 25% of 10M)
//   ATH >50M       -> bought below 12.5M (<12.5M, 25% of 50M)
export const LOOKBACK_DAYS = 120; // 4 months
export const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 3600 * 1000;
export const MIN_RUNNER_ATH = 1_000_000; // $1 Million minimum ATH

export const EARLY_BUY_TIERS = [
  { id: 'ath_gt_50m', minAth: 50_000_000, maxAth: Infinity, maxBuyMcap: 12_500_000, label: 'Ath >50M , Buy < 12.5M', athLabel: '>50M', buyLabel: '<12.5M' },
  { id: 'ath_10m', minAth: 8_000_000, maxAth: 50_000_000, maxBuyMcap: 2_500_000, label: 'Ath - 10M , Buy < 2.5M', athLabel: '~10M', buyLabel: '<2.5M' },
  { id: 'ath_5m', minAth: 3_000_000, maxAth: 8_000_000, maxBuyMcap: 1_250_000, label: 'Ath - 5M , Buy < 1.25M', athLabel: '~5M', buyLabel: '<1.25M' },
  { id: 'ath_1m', minAth: 1_000_000, maxAth: 3_000_000, maxBuyMcap: 250_000, label: 'Ath - 1M , Buy < 250k', athLabel: '~1M', buyLabel: '<250k' },
];

export function tierForAth(athMcap) {
  if (!Number.isFinite(athMcap) || athMcap < MIN_RUNNER_ATH) return null;
  return EARLY_BUY_TIERS.find(t => athMcap >= t.minAth && athMcap < t.maxAth)
    || (athMcap >= 50_000_000 ? EARLY_BUY_TIERS[0] : null);
}

export function qualifiesEarlyBuy({ athMcap, buyMcap }) {
  if (!Number.isFinite(athMcap) || athMcap < MIN_RUNNER_ATH) return false;
  if (!Number.isFinite(buyMcap)) return false;
  const tier = tierForAth(athMcap);
  if (!tier) return false;
  return buyMcap <= tier.maxBuyMcap;
}

/**
 * Checks whether a trade was profitable.
 * Requires that the trade did not lose money or was confirmed winning.
 */
export function isTradeProfitable(trade) {
  if (!trade || typeof trade !== 'object') return false;
  if (trade.isProfitable !== undefined) return Boolean(trade.isProfitable);
  if (trade.profitable !== undefined) return Boolean(trade.profitable);
  if (trade.won !== undefined) return Boolean(trade.won);
  if (Number.isFinite(trade.profitUsd)) return trade.profitUsd > 0;
  if (Number.isFinite(trade.pnlUsd)) return trade.pnlUsd > 0;
  if (Number.isFinite(trade.realizedProfitUsd)) return trade.realizedProfitUsd > 0;
  if (Number.isFinite(trade.sellPrice) && Number.isFinite(trade.buyPrice)) return trade.sellPrice > trade.buyPrice;
  if (Number.isFinite(trade.sellMcap) && Number.isFinite(trade.buyMcap)) return trade.sellMcap > trade.buyMcap;
  return false;
}

export const SNIPER_TAGS = Object.freeze([
  'sniper',
  'bundler',
  'alpha_buyer',
  'rank_1_buyer',
  'madeonsol_sniper',
  'high_profit_sniper',
  'early_sniper',
]);

export function hasSniperTag(tags) {
  if (!Array.isArray(tags)) return false;
  return tags.some(tag => {
    if (typeof tag !== 'string') return false;
    return SNIPER_TAGS.includes(tag) || tag.includes('sniper') || tag.includes('bundler');
  });
}

export const EARLY_BUYER_RULES = Object.freeze({
  minAth: MIN_RUNNER_ATH,
  baseQuota: 100,
  perMillionBonus: 20,
  athPct: 0.25,
  methods: Object.freeze(['buying_mcap', 'first_n_buyers']),
  lookbackDays: LOOKBACK_DAYS,
});

/**
 * Calculates how many of the earliest position-opening buyer wallets qualify
 * for tracking based on the token's All-Time High market cap:
 * - ATH < 1M: 0 (does not qualify)
 * - ATH >= 1M: 100 wallets base quota
 * - ATH > 1M: +20 wallets for each full million in ATH above 1M
 *   (e.g., 1M -> 100, 2M -> 120, 5M -> 180, 10M -> 280)
 */
export function earlyBuyerLimitForAth(athMcap) {
  if (!Number.isFinite(athMcap) || athMcap < MIN_RUNNER_ATH) return 0;
  const extraMillions = Math.floor((athMcap - 1_000_000) / 1_000_000);
  return 100 + (extraMillions * 20);
}

// Smart-wallet qualification conditions:
// 1. At least 5 open trades (active positions)
// 2. Positive 30d realized PnL > $100
export const SMART_WALLET_MIN_OPEN_TRADES = 5;
export const SMART_WALLET_MIN_PNL_USD = 100;

export function isSmartWallet(walletOrStats) {
  if (!walletOrStats || typeof walletOrStats !== 'object') return false;
  const openTrades = Number(walletOrStats.openTrades ?? walletOrStats.open_trades ?? 0);
  const pnlUsd = Number(
    walletOrStats.realizedProfitUsd ??
    walletOrStats.realized_profit_usd ??
    walletOrStats.pnlUsd ??
    walletOrStats.score ??
    0
  );
  return openTrades >= SMART_WALLET_MIN_OPEN_TRADES && pnlUsd > SMART_WALLET_MIN_PNL_USD;
}

// Whale-wallet qualification condition:
// Wallets holding meme coins of > $5,000 OR having a wallet balance > $5,000
export const WHALE_WALLET_MIN_USD = 5000;

export function isWhaleWallet(walletOrStats) {
  if (!walletOrStats || typeof walletOrStats !== 'object') return false;
  const balanceUsd = Number(walletOrStats.balanceUsd ?? walletOrStats.balance_usd ?? walletOrStats.nativeBalanceUsd ?? 0);
  const memeHoldingsUsd = Number(walletOrStats.memeHoldingsUsd ?? walletOrStats.meme_holdings_usd ?? 0);
  return balanceUsd >= WHALE_WALLET_MIN_USD || memeHoldingsUsd >= WHALE_WALLET_MIN_USD;
}

/**
 * Classifies a wallet into one of the 4 distinct categories:
 * - 'lineage': Linked to or funded by a smart or whale wallet
 * - 'whale': Balance > $5,000 or meme holdings > $5,000
 * - 'smart': >= 5 open trades and > $100 realized profit
 * - 'tracked': Discovery candidates (ATH early buyers, watchlists)
 */
export function classifyWalletCategory(wallet) {
  if (!wallet || typeof wallet !== 'object') return 'tracked';
  if (wallet.category === 'lineage' || wallet.lineageParent || wallet.source === 'lineage') {
    return 'lineage';
  }
  if (wallet.category === 'whale') {
    return 'whale';
  }
  if (wallet.category === 'sniper') {
    return 'sniper';
  }
  if (wallet.category === 'smart') {
    return 'smart';
  }
  if (isWhaleWallet(wallet) || (Array.isArray(wallet.tags) && wallet.tags.includes('whale'))) {
    return 'whale';
  }
  if (wallet.flags?.is_sniper || wallet.flags?.is_bundler || hasSniperTag(wallet.tags)) {
    return 'sniper';
  }
  if (isSmartWallet(wallet)) {
    return 'smart';
  }
  return 'tracked';
}
