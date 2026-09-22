import { classifyWalletCategory } from './tiers.js';

function tagIncludes(wallet, needle) {
  return Array.isArray(wallet.tags) && wallet.tags.some(tag => typeof tag === 'string' && tag.includes(needle));
}

function hasTag(wallet, tag) {
  return Array.isArray(wallet.tags) && wallet.tags.includes(tag);
}

export function matchesSubfilter(wallet, subfilter) {
  if (!subfilter || subfilter === 'all') return true;
  if (subfilter === 'early_buyer' || subfilter === 'early_buyers') {
    return Boolean(wallet.earlyBuyerInfo) || hasTag(wallet, 'early_buyer') || Boolean(wallet.qualificationMethod);
  }
  if (subfilter === 'top_runners' || subfilter === 'runner_10m') {
    return (Number(wallet.earlyBuyerInfo?.athMcap) || 0) >= 10_000_000;
  }
  if (subfilter === 'snipers_alpha' || subfilter === 'snipers') {
    return classifyWalletCategory(wallet) === 'sniper'
      || tagIncludes(wallet, 'sniper')
      || tagIncludes(wallet, 'alpha_buyer')
      || tagIncludes(wallet, 'rank_1');
  }
  if (subfilter === 'profitable' || subfilter === 'positive_pnl') {
    return (Number(wallet.realizedProfitUsd ?? wallet.pnlUsd) || 0) > 0;
  }
  if (subfilter === 'high_winrate' || subfilter === 'winrate_60') {
    return (Number(wallet.winRatePct) || 0) >= 60;
  }
  if (subfilter === 'active' || subfilter === 'active_traders') {
    return Number(wallet.totalTrades ?? wallet.openTrades ?? wallet.openTradesCount ?? 0) >= 5;
  }
  if (subfilter === 'sub1m' || subfilter === 'sub1m_specialist') {
    const avg = Number(wallet.avgBuyMcap) || 0;
    return (Number(wallet.buysUnder1M) || 0) > 0 || (avg > 0 && avg < 1_000_000);
  }
  if (subfilter === 'kol' || subfilter === 'callers') {
    return tagIncludes(wallet, 'kol') || tagIncludes(wallet, 'caller') || tagIncludes(wallet, 'fomo');
  }
  if (subfilter === 'rank_1') {
    return tagIncludes(wallet, 'rank_1');
  }
  if (subfilter === 'alpha_buyer') {
    return tagIncludes(wallet, 'alpha_buyer');
  }
  if (subfilter === 'buying_mcap') {
    const avg = Number(wallet.avgBuyMcap) || 0;
    const ath = Number(wallet.earlyBuyerInfo?.athMcap);
    return wallet.qualificationMethod === 'buying_mcap'
      || (Array.isArray(wallet.methods) && wallet.methods.includes('buying_mcap'))
      || (avg > 0 && Number.isFinite(ath) && avg <= 0.25 * ath)
      || (Boolean(wallet.earlyBuyerInfo) && (Number(wallet.realizedProfitUsd) || 0) > 0)
      || wallet.qualificationMethod === 'pre_ath_early_buyer';
  }
  if (subfilter === 'first_n_buyers') {
    return wallet.qualificationMethod === 'first_n_buyers'
      || (Array.isArray(wallet.methods) && wallet.methods.includes('first_n_buyers'))
      || hasTag(wallet, 'rank_1_buyer')
      || hasTag(wallet, 'early_buyer')
      || Boolean(wallet.earlyBuyerInfo);
  }
  if (subfilter === 'both') {
    return wallet.qualificationMethod === 'both'
      || (Array.isArray(wallet.methods) && wallet.methods.includes('buying_mcap') && wallet.methods.includes('first_n_buyers'))
      || (Boolean(wallet.earlyBuyerInfo) && (Number(wallet.realizedProfitUsd) || 0) > 0);
  }
  return true;
}

function matchesSearch(wallet, search) {
  if (!search) return true;
  const tags = Array.isArray(wallet.tags) ? wallet.tags : [];
  return (
    (wallet.address && wallet.address.toLowerCase().includes(search))
    || (wallet.twitterUsername && wallet.twitterUsername.toLowerCase().includes(search))
    || (wallet.lineageParent && wallet.lineageParent.toLowerCase().includes(search))
    || (wallet.symbol && wallet.symbol.toLowerCase().includes(search))
    || (wallet.earlyBuyerInfo?.symbol && String(wallet.earlyBuyerInfo.symbol).toLowerCase().includes(search))
    || tags.some(tag => String(tag).toLowerCase().includes(search))
  );
}

function emptyChainCounts() {
  return { total: 0, smart: 0, tracked: 0, whale: 0, lineage: 0, sniper: 0 };
}

export function queryWallets(wallets, {
  chain = null,
  walletType = null,
  category = 'all',
  subfilter = 'all',
  search = '',
  consistentOnly = false,
  page = 1,
  pageSize = 50,
} = {}) {
  const all = Array.isArray(wallets) ? wallets : [];
  const countsByChain = { solana: emptyChainCounts(), robinhood: emptyChainCounts() };
  let totalRealizedProfitUsd = 0;

  for (const wallet of all) {
    const bucket = wallet.chain === 'robinhood' ? 'robinhood' : 'solana';
    const kind = classifyWalletCategory(wallet);
    countsByChain[bucket].total += 1;
    if (countsByChain[bucket][kind] != null) countsByChain[bucket][kind] += 1;
    if (kind === 'smart') {
      totalRealizedProfitUsd += Number(wallet.realizedProfitUsd || wallet.pnlUsd) || 0;
    }
  }

  let chainFiltered = chain ? all.filter(wallet => wallet.chain === chain) : all;
  if (walletType) {
    chainFiltered = chainFiltered.filter(wallet => (wallet.walletType || 'normal') === walletType);
  }

  const smartCount = chainFiltered.filter(wallet => classifyWalletCategory(wallet) === 'smart').length;
  const trackedCount = chainFiltered.filter(wallet => classifyWalletCategory(wallet) === 'tracked').length;
  const whaleCount = chainFiltered.filter(wallet => classifyWalletCategory(wallet) === 'whale').length;
  const lineageCount = chainFiltered.filter(wallet => classifyWalletCategory(wallet) === 'lineage').length;
  const sniperCount = chainFiltered.filter(wallet => classifyWalletCategory(wallet) === 'sniper').length;
  const scamCount = chainFiltered.filter(wallet => wallet.walletType === 'scam_wallet').length;

  let filtered = chainFiltered;
  if (category && category !== 'all') {
    filtered = filtered.filter(wallet => classifyWalletCategory(wallet) === category);
  }
  if (subfilter && subfilter !== 'all') {
    filtered = filtered.filter(wallet => matchesSubfilter(wallet, subfilter));
  }
  if (consistentOnly) {
    filtered = filtered.filter(wallet => {
      const trades = Number(wallet.totalTrades ?? wallet.openTrades ?? wallet.openTradesCount ?? wallet.tradesCount ?? wallet.tokenNum ?? 0);
      const pnl = Number(wallet.realizedProfitUsd ?? wallet.realizedPnlUsd ?? wallet.pnlUsd ?? wallet.score ?? 0);
      return trades >= 5 && pnl > 100;
    });
  }
  if (search) filtered = filtered.filter(wallet => matchesSearch(wallet, search));

  const total = filtered.length;
  const safePageSize = Math.max(1, Number(pageSize) || 50);
  const safePage = Math.max(1, Number(page) || 1);
  const totalPages = Math.ceil(total / safePageSize) || 1;
  const start = (safePage - 1) * safePageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    count: total,
    smartCount,
    trackedCount,
    whaleCount,
    lineageCount,
    sniperCount,
    scamCount,
    totalRealizedProfitUsd,
    countsByChain,
    wallets: filtered.slice(start, start + safePageSize),
  };
}
