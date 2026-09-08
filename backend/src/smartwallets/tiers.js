// Smart-wallet early-buyer tier rules.
// A token's ATH mcap decides the max mcap at which an early buy still counts.
// 30-day lookback for runner detection.
//
// Tiers (user-confirmed):
//   ATH ~1M        -> bought below 0.5M
//   ATH ~5M        -> bought below 1M
//   ATH ~10M       -> bought below 2M
//   ATH 10M–50M    -> bought below 5M
//   ATH >50M       -> bought below 10M
export const LOOKBACK_MS = 30 * 24 * 3600 * 1000;

export const EARLY_BUY_TIERS = [
  { minAth: 50_000_000, maxAth: Infinity, maxBuyMcap: 10_000_000, label: '>50M -> <10M' },
  // Exact ~10M tier is checked before the 10-50M band so ATH == 10M uses <2M.
  { minAth: 9_000_000, maxAth: 10_000_001, maxBuyMcap: 2_000_000, label: '~10M -> <2M' },
  { minAth: 10_000_001, maxAth: 50_000_000, maxBuyMcap: 5_000_000, label: '10-50M -> <5M' },
  { minAth: 4_000_000, maxAth: 9_000_000, maxBuyMcap: 1_000_000, label: '~5M -> <1M' },
  { minAth: 1_000_000, maxAth: 4_000_000, maxBuyMcap: 500_000, label: '~1M -> <0.5M' },
];

export function tierForAth(athMcap) {
  if (!Number.isFinite(athMcap) || athMcap < 1_000_000) return null;
  return EARLY_BUY_TIERS.find(t => athMcap >= t.minAth && athMcap < t.maxAth)
    || (athMcap >= 50_000_000 ? EARLY_BUY_TIERS[0] : null);
}

export function qualifiesEarlyBuy({ athMcap, buyMcap }) {
  const tier = tierForAth(athMcap);
  if (!tier) return false;
  if (!Number.isFinite(buyMcap)) return false;
  return buyMcap <= tier.maxBuyMcap;
}
