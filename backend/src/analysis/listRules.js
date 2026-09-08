// Custom-list rule evaluation. All present rules AND together; blank rules
// are ignored. A rule whose required token data is missing FAILS (no false
// positives from incomplete data).

export const RULE_FIELDS = [
  { key: 'minLiquidityUsd', label: 'Min liquidity ($)', type: 'number' },
  { key: 'maxLiquidityUsd', label: 'Max liquidity ($)', type: 'number' },
  { key: 'minSafetyScore', label: 'Min safety score', type: 'number' },
  { key: 'minTractionScore', label: 'Min traction score', type: 'number' },
  { key: 'maxTop10HolderPct', label: 'Max top-10 holders (%)', type: 'number' },
  { key: 'maxAgeMin', label: 'Max age (minutes)', type: 'number' },
  { key: 'minAgeMin', label: 'Min age (minutes)', type: 'number' },
  { key: 'minMarketCapUsd', label: 'Min market cap ($)', type: 'number' },
  { key: 'maxMarketCapUsd', label: 'Max market cap ($)', type: 'number' },
  { key: 'minVolume5mUsd', label: 'Min 5m volume ($)', type: 'number' },
  { key: 'minVolume1hUsd', label: 'Min 1h volume ($)', type: 'number' },
  { key: 'minVolume24hUsd', label: 'Min 24h volume ($)', type: 'number' },
  { key: 'minBuySellRatio', label: 'Min buy / sell ratio', type: 'number' },
  { key: 'minPriceChange5mPct', label: 'Min 5m price change (%)', type: 'number' },
  { key: 'minPriceChange1hPct', label: 'Min 1h price change (%)', type: 'number' },
  { key: 'maxPriceChange1hPct', label: 'Max 1h price change (%)', type: 'number' },
  { key: 'maxBundlerPct', label: 'Max bundler exposure (%)', type: 'number' },
  { key: 'minSmartWallets', label: 'Min smart wallets', type: 'number' },
  { key: 'minWhales', label: 'Min whales', type: 'number' },
  { key: 'minSnipers', label: 'Min snipers', type: 'number' },
  { key: 'minFreshWallets', label: 'Min fresh wallets', type: 'number' },
  { key: 'chain', label: 'Chain (legacy exact match)', type: 'select', options: ['solana', 'monad', 'robinhood'] },
  { key: 'source', label: 'Source (legacy exact match)', type: 'select', options: ['pumpfun', 'raydium', 'revival', 'gecko-monad', 'gecko-robinhood'] },
  { key: 'chainsInclude', label: 'Included chains', type: 'multi', options: ['solana', 'monad', 'robinhood'] },
  { key: 'chainsExclude', label: 'Excluded chains', type: 'multi', options: ['solana', 'monad', 'robinhood'] },
  { key: 'sourcesInclude', label: 'Included sources', type: 'multi', options: ['pumpfun', 'raydium', 'revival', 'gecko-monad', 'gecko-robinhood'] },
  { key: 'sourcesExclude', label: 'Excluded sources', type: 'multi', options: ['pumpfun', 'raydium', 'revival', 'gecko-monad', 'gecko-robinhood'] },
  { key: 'keywordsInclude', label: 'Name/symbol contains any of', type: 'keywords' },
  { key: 'keywordsExclude', label: 'Name/symbol contains none of', type: 'keywords' },
  { key: 'minHolderCount', label: 'Min holder count', type: 'number' },
  { key: 'requireSocials', label: 'Require socials', type: 'boolean' },
  { key: 'requireWebsite', label: 'Require website', type: 'boolean' },
  { key: 'requireTwitter', label: 'Require X / Twitter', type: 'boolean' },
];

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

export function matchesRules(token, rules = {}) {
  const reasons = [];
  const missing = [];
  const buys = num(token.txns?.m5?.buys);
  const sells = num(token.txns?.m5?.sells);
  const ratio = buys == null || sells == null ? null : sells > 0 ? buys / sells : buys;
  const ageMin = token.createdAt != null ? (Date.now() - token.createdAt) / 60_000 : null;
  const checks = {
    minLiquidityUsd: v => num(token.liquidityUsd) != null && token.liquidityUsd >= v,
    maxLiquidityUsd: v => num(token.liquidityUsd) != null && token.liquidityUsd <= v,
    minSafetyScore: v => num(token.safety?.score) != null && token.safety.score >= v,
    minTractionScore: v => num(token.traction?.tractionScore) != null && token.traction.tractionScore >= v,
    maxTop10HolderPct: v => num(token.top10HolderPct) != null && token.top10HolderPct <= v,
    maxAgeMin: v => ageMin != null && ageMin <= v,
    minAgeMin: v => ageMin != null && ageMin >= v,
    minMarketCapUsd: v => num(token.marketCapUsd) != null && token.marketCapUsd >= v,
    maxMarketCapUsd: v => num(token.marketCapUsd) != null && token.marketCapUsd <= v,
    minVolume5mUsd: v => num(token.volume5mUsd) != null && token.volume5mUsd >= v,
    minVolume1hUsd: v => num(token.volume1hUsd) != null && token.volume1hUsd >= v,
    minVolume24hUsd: v => num(token.volume24hUsd) != null && token.volume24hUsd >= v,
    minBuySellRatio: v => ratio != null && ratio >= v,
    minPriceChange5mPct: v => num(token.priceChange?.m5) != null && token.priceChange.m5 >= v,
    minPriceChange1hPct: v => num(token.priceChange?.h1) != null && token.priceChange.h1 >= v,
    maxPriceChange1hPct: v => num(token.priceChange?.h1) != null && token.priceChange.h1 <= v,
    maxBundlerPct: v => num(token.bundlerPct) != null && token.bundlerPct <= v,
    minSmartWallets: v => num(token.smartWallets) != null && token.smartWallets >= v,
    minWhales: v => num(token.whales) != null && token.whales >= v,
    minSnipers: v => num(token.snipers) != null && token.snipers >= v,
    minFreshWallets: v => num(token.freshWallets) != null && token.freshWallets >= v,
    chain: v => (token.chain || 'solana') === v,
    source: v => token.source === v,
    chainsInclude: v => v.includes(token.chain || 'solana'),
    chainsExclude: v => !v.includes(token.chain || 'solana'),
    sourcesInclude: v => v.includes(token.source),
    sourcesExclude: v => !v.includes(token.source),
    keywordsInclude: (v) => {
      const hay = `${token.symbol || ''} ${token.name || ''}`.toLowerCase();
      return (v || []).some(k => hay.includes(String(k).toLowerCase()));
    },
    keywordsExclude: (v) => {
      const hay = `${token.symbol || ''} ${token.name || ''}`.toLowerCase();
      return !(v || []).some(k => hay.includes(String(k).toLowerCase()));
    },
    minHolderCount: v => num(token.holderCount) != null && token.holderCount >= v,
    requireSocials: v => !v || Boolean(
      token.socials?.website || token.socials?.twitter || token.socials?.telegram),
    requireWebsite: v => !v || Boolean(token.socials?.website),
    requireTwitter: v => !v || Boolean(token.socials?.twitter),
  };

  for (const [key, value] of Object.entries(rules)) {
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) continue;
    const check = checks[key];
    if (!check) continue;
    if (!check(value)) {
      if (ruleValueMissing(token, key, { ageMin, ratio })) missing.push(key);
      return { match: false, reasons, missing };
    }
    reasons.push(key);
  }
  return { match: true, reasons, missing };
}

function ruleValueMissing(token, key, derived) {
  const paths = {
    minLiquidityUsd: token.liquidityUsd, maxLiquidityUsd: token.liquidityUsd,
    minSafetyScore: token.safety?.score, minTractionScore: token.traction?.tractionScore,
    maxTop10HolderPct: token.top10HolderPct, minHolderCount: token.holderCount,
    maxAgeMin: derived.ageMin, minAgeMin: derived.ageMin,
    minMarketCapUsd: token.marketCapUsd, maxMarketCapUsd: token.marketCapUsd,
    minVolume5mUsd: token.volume5mUsd, minVolume1hUsd: token.volume1hUsd,
    minVolume24hUsd: token.volume24hUsd, minBuySellRatio: derived.ratio,
    minPriceChange5mPct: token.priceChange?.m5,
    minPriceChange1hPct: token.priceChange?.h1, maxPriceChange1hPct: token.priceChange?.h1,
    maxBundlerPct: token.bundlerPct, minSmartWallets: token.smartWallets,
    minWhales: token.whales, minSnipers: token.snipers, minFreshWallets: token.freshWallets,
  };
  return Object.prototype.hasOwnProperty.call(paths, key) && paths[key] == null;
}
