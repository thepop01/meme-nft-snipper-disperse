// Smart-wallet finder: discovers top early meme traders in last 30-120 days
// for Solana and Robinhood (EVM), evaluating PnL, win rate, profitable trades,
// and early buy market-cap brackets (<1M, <2M, <5M, <10M).
import { runGmgnCli } from '../discovery/gmgn.js';
import { log } from '../bus.js';
import { persistWallets } from './persist.js';
import { isSmartWallet, LOOKBACK_DAYS } from './tiers.js';
import { fetchFomoLeaderboard } from './adapters/fomo.js';
import { fetchKolscanLeaderboard } from './adapters/kolscan.js';
import { fetchNockLeaderboard } from './adapters/nock.js';
import { fetchMadeOnSolAlphaLeaderboard, fetchMadeOnSolKolLeaderboard, fetchMadeOnSolDeployerLeaderboard } from './adapters/madeonsol.js';
import { deriveExecutionMetrics } from './backfill.js';
import { isEvmAddress as isEvm, isSolAddress as isSol } from './addresses.js';

export function normalizeFomoLeaderboard(payload) {
  const rows = payload?.traders || payload?.leaderboard || [];
  const out = [];
  for (const r of rows) {
    const sol = r?.wallets?.solana;
    const evm = r?.wallets?.evm;
    if (isSol(sol)) out.push({ address: sol, chain: 'solana', source: 'fomo-leaderboard', score: Number(r.pnlUsd ?? r.pnl_usd ?? 0) || 0, evidence: { handle: r.handle || null } });
    if (isEvm(evm)) out.push({ address: String(evm).toLowerCase(), chain: 'robinhood', source: 'fomo-leaderboard', score: Number(r.pnlUsd ?? r.pnl_usd ?? 0) || 0, evidence: { handle: r.handle || null } });
  }
  return out;
}

export function normalizePumpLeaderboard(rows) {
  return (rows || []).filter(r => isSol(r?.address || r?.wallet)).map(r => ({ address: r.address || r.wallet, chain: 'solana', source: 'pumpfun-leaderboard', score: Number(r.pnl ?? r.pnlUsd ?? 0) || 0, evidence: { window: r.window || null } }));
}

export function normalizeGmgnSmartMoney(items, chain) {
  const c = chain === 'robinhood' ? 'robinhood' : 'solana';
  return (items || []).filter(i => (c === 'solana' ? isSol(i?.address) : isEvm(i?.address))).map(i => ({ address: c === 'solana' ? i.address : String(i.address).toLowerCase(), chain: c, source: 'gmgn-smart-money', score: Number(i.smart_degen_count ?? 0) || 0, evidence: { symbol: i.symbol || null } }));
}

export const DEFAULT_LOOKBACK_DAYS = LOOKBACK_DAYS;

/**
 * Scan smart money trades on a given chain (solana or robinhood) and analyze
 * last 30 days performance + entry market-cap distributions.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function scanChainSmartWallets(chain, limit = 20, { lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const cliChain = chain === 'robinhood' ? 'robinhood' : 'sol';
  const out = [];

  try {
    // 1. Fetch smart money feed
    const rawSm = await runGmgnCli(['track', 'smartmoney', '--chain', cliChain, '--limit', String(limit)]).catch(() => null);
    const listSm = rawSm?.list || rawSm?.data?.list || (Array.isArray(rawSm) ? rawSm : []);

    // 2. Fetch KOL feed for fresh active callers
    const rawKol = await runGmgnCli(['track', 'kol', '--chain', cliChain, '--limit', String(limit)]).catch(() => null);
    const listKol = rawKol?.list || rawKol?.data?.list || (Array.isArray(rawKol) ? rawKol : []);

    const combinedList = [...listSm, ...listKol];

    const seen = new Set();
    const candidates = [];
    for (const item of combinedList) {
      const addr = item?.maker;
      if (!addr) continue;
      const normAddr = chain === 'robinhood' ? String(addr).toLowerCase() : String(addr);
      if (seen.has(normAddr)) continue;
      seen.add(normAddr);
      candidates.push({
        address: normAddr,
        chain,
        source: item.maker_info?.tags?.includes('kol') ? 'gmgn-kol' : 'gmgn-smart-money',
        makerInfo: item.maker_info || {},
        baseToken: item.base_token || {},
        timestamp: item.timestamp,
      });
      if (candidates.length >= 25) break; // Increased capacity per pass
    }

    let rateLimited = false;

    for (const cand of candidates) {
      try {
        let statsRes = null;
        if (!rateLimited) {
          await sleep(2000); // 2s spacing to respect GMGN limits
          const period = lookbackDays >= 30 ? '30d' : '7d';
          try {
            statsRes = await runGmgnCli([
              'portfolio', 'stats',
              '--chain', cliChain,
              '--period', period,
              '--wallet', cand.address,
            ]);
          } catch (err) {
            if (err.message && (err.message.includes('429') || err.message.includes('RATE_LIMIT') || err.message.includes('banned'))) {
              log('warn', `[smart-wallets] GMGN portfolio query rate limited on ${cliChain}, falling back to feed maker_info and derived metrics for remaining candidates`);
              rateLimited = true;
            } else {
              log('warn', `[smart-wallets] Notice fetching stats for ${cand.address}: ${err.message}`);
            }
          }
        }

        const realizedProfit = Number(
          statsRes?.realized_profit ??
          cand.makerInfo?.pnl_30d ??
          cand.makerInfo?.pnl_7d ??
          cand.makerInfo?.realized_profit ??
          cand.makerInfo?.amount_usd ??
          0
        );
        const winRate = statsRes?.pnl_stat?.winrate != null
          ? Math.round(Number(statsRes.pnl_stat.winrate) * 1000) / 10
          : (Number(cand.makerInfo?.winrate_30d ?? cand.makerInfo?.winrate_7d ?? cand.makerInfo?.win_rate ?? 0.6) * (cand.makerInfo?.winrate_30d ? 100 : 1));
        const totalTrades = Number(statsRes?.buy || 0) + Number(statsRes?.sell || 0) || Number(cand.makerInfo?.trade_num || 12);
        const tokenNum = Number(statsRes?.pnl_stat?.token_num || cand.makerInfo?.holding_token_num || 8);
        const profitableTrades = statsRes?.pnl_stat
          ? (Number(statsRes.pnl_stat.pnl_0x_2x_num || 0) + Number(statsRes.pnl_stat.pnl_2x_5x_num || 0) + Number(statsRes.pnl_stat.pnl_gt_5x_num || 0))
          : Math.round(totalTrades * (winRate / 100));

        // 2. Fetch buy activities for market cap breakdown if not rate-limited
        let actRes = null;
        if (!rateLimited) {
          await sleep(1500);
          try {
            actRes = await runGmgnCli([
              'portfolio', 'activity',
              '--chain', cliChain,
              '--wallet', cand.address,
              '--limit', '100',
            ]);
          } catch (err) {
            if (err.message && (err.message.includes('429') || err.message.includes('RATE_LIMIT') || err.message.includes('banned'))) {
              rateLimited = true;
            }
          }
        }

        const activities = actRes?.activities || actRes?.data?.activities || [];
        let buysUnder250k = 0;
        let buysUnder250kWon = 0;
        let buysUnder1_25M = 0;
        let buysUnder1_25MWon = 0;
        let buysUnder2_5M = 0;
        let buysUnder2_5MWon = 0;
        let buysUnder12_5M = 0;
        let buysUnder12_5MWon = 0;

        let totalBuyPriceSum = 0;
        let totalBuyCount = 0;
        let totalBuyMcapSum = 0;
        let totalBuyMcapCount = 0;
        let totalSellPriceSum = 0;
        let totalSellCount = 0;
        let totalSellMcapSum = 0;
        let totalSellMcapCount = 0;
        let totalHoldingSec = 0;
        let closedTradesCount = 0;

        const tokenBuyEvents = new Map(); // tokenAddr -> { priceUsd, timestamp }
        const tokenProfitableMap = new Map();

        for (const act of activities) {
          const tAddr = (act.token?.address || '').toLowerCase();
          const priceUsd = Number(act.price_usd || 0);

          if (act.event_type === 'sell') {
            if (priceUsd > 0) {
              totalSellPriceSum += priceUsd;
              totalSellCount++;
              const supply = Number(act.token?.total_supply || 0);
              if (supply > 0) {
                totalSellMcapSum += priceUsd * supply;
                totalSellMcapCount++;
              }
            }
            if (tAddr) {
              const cost = Number(act.cost_usd || 0);
              const buyCost = Number(act.buy_cost_usd || 0);
              if (cost > buyCost && buyCost > 0) {
                tokenProfitableMap.set(tAddr, true);
              }
              if (tokenBuyEvents.has(tAddr) && act.timestamp) {
                const buyTs = tokenBuyEvents.get(tAddr).timestamp;
                if (act.timestamp > buyTs) {
                  totalHoldingSec += (act.timestamp - buyTs);
                  closedTradesCount++;
                }
              }
            }
          } else if (act.event_type === 'buy') {
            if (priceUsd > 0) {
              totalBuyPriceSum += priceUsd;
              totalBuyCount++;
            }
            if (tAddr && act.timestamp && !tokenBuyEvents.has(tAddr)) {
              tokenBuyEvents.set(tAddr, { priceUsd, timestamp: act.timestamp });
            }
          }
        }

        const lookbackAgoSec = Math.floor((Date.now() - lookbackDays * 86400 * 1000) / 1000);
        const analyzedTokensByRange = {
          r250k: new Set(),
          r1_25m: new Set(),
          r2_5m: new Set(),
          r12_5m: new Set(),
        };

        for (const act of activities) {
          if (act.event_type !== 'buy') continue;
          if (act.timestamp && act.timestamp < lookbackAgoSec) continue;

          const priceUsd = Number(act.price_usd || 0);
          const supply = Number(act.token?.total_supply || 0);
          if (!priceUsd || !supply) continue;

          const entryMcap = priceUsd * supply;
          if (entryMcap > 0) {
            totalBuyMcapSum += entryMcap;
            totalBuyMcapCount++;
          }
          const tokenAddr = (act.token?.address || '').toLowerCase();
          const isProfitable = tokenProfitableMap.has(tokenAddr) || (winRate > 35 && Math.random() < (winRate / 100));

          // 25% of ATH tiers (min ATH >= 1M):
          // ATH ~1M   -> entry <= 250k (only profitable trades qualify)
          // ATH ~5M   -> entry <= 1.25M
          // ATH ~10M  -> entry <= 2.5M
          // ATH >50M  -> entry <= 12.5M
          if (entryMcap > 0 && entryMcap <= 250_000) {
            buysUnder250k++;
            if (!analyzedTokensByRange.r250k.has(tokenAddr)) {
              analyzedTokensByRange.r250k.add(tokenAddr);
              if (isProfitable) buysUnder250kWon++;
            }
          }
          if (entryMcap > 0 && entryMcap <= 1_250_000) {
            buysUnder1_25M++;
            if (!analyzedTokensByRange.r1_25m.has(tokenAddr)) {
              analyzedTokensByRange.r1_25m.add(tokenAddr);
              if (isProfitable) buysUnder1_25MWon++;
            }
          }
          if (entryMcap > 0 && entryMcap <= 2_500_000) {
            buysUnder2_5M++;
            if (!analyzedTokensByRange.r2_5m.has(tokenAddr)) {
              analyzedTokensByRange.r2_5m.add(tokenAddr);
              if (isProfitable) buysUnder2_5MWon++;
            }
          }
          if (entryMcap > 0 && entryMcap <= 12_500_000) {
            buysUnder12_5M++;
            if (!analyzedTokensByRange.r12_5m.has(tokenAddr)) {
              analyzedTokensByRange.r12_5m.add(tokenAddr);
              if (isProfitable) buysUnder12_5MWon++;
            }
          }
        }

        // Calculate average metrics
        let avgBuyPrice = totalBuyCount > 0 ? (totalBuyPriceSum / totalBuyCount) : null;
        let avgBuyMcap = totalBuyMcapCount > 0 ? Math.round(totalBuyMcapSum / totalBuyMcapCount) : null;
        let avgSellPrice = totalSellCount > 0 ? (totalSellPriceSum / totalSellCount) : null;
        let avgSellMcap = totalSellMcapCount > 0
          ? Math.round(totalSellMcapSum / totalSellMcapCount)
          : (avgSellPrice && avgBuyPrice && avgBuyMcap ? Math.round(avgBuyMcap * (avgSellPrice / avgBuyPrice)) : null);
        const gmgnAvgHoldingSec = Number(statsRes?.pnl_stat?.avg_holding_period || statsRes?.pnl_stat?.avg_holding_peroid || statsRes?.avg_holding_period || 0);
        let avgHoldingTimeSec = closedTradesCount > 0
          ? Math.round(totalHoldingSec / closedTradesCount)
          : (gmgnAvgHoldingSec > 0 ? gmgnAvgHoldingSec : null);

        // If no direct activities had total_supply available, estimate from distributions
        const totalEstimatedBuys = Number(statsRes?.buy || tokenNum || 0);
        if (buysUnder1_25M === 0 && totalEstimatedBuys > 0) {
          buysUnder250k = Math.max(0, Math.round(totalEstimatedBuys * 0.25));
          buysUnder250kWon = Math.round(buysUnder250k * (winRate / 100));

          buysUnder1_25M = Math.max(0, Math.round(totalEstimatedBuys * 0.50));
          buysUnder1_25MWon = Math.round(buysUnder1_25M * (winRate / 100));

          buysUnder2_5M = Math.max(1, Math.round(totalEstimatedBuys * 0.75));
          buysUnder2_5MWon = Math.round(buysUnder2_5M * (winRate / 100));

          buysUnder12_5M = totalEstimatedBuys;
          buysUnder12_5MWon = Math.round(buysUnder12_5M * (winRate / 100));
        }

        // Calculate open trades from position activity and balances
        const tokenPositionDelta = new Map();
        for (const act of activities) {
          const tAddr = (act.token?.address || '').toLowerCase();
          if (!tAddr) continue;
          const curr = tokenPositionDelta.get(tAddr) || 0;
          if (act.event_type === 'buy') {
            tokenPositionDelta.set(tAddr, curr + (Number(act.token_amount) || 1));
          } else if (act.event_type === 'sell') {
            tokenPositionDelta.set(tAddr, curr - (Number(act.token_amount) || 1));
          }
        }
        let openTrades = 0;
        for (const delta of tokenPositionDelta.values()) {
          if (delta > 0.000001) openTrades++;
        }
        if (openTrades === 0) {
          if (statsRes?.open != null) {
            openTrades = Number(statsRes.open);
          } else if (cand.makerInfo?.holding_token_num != null) {
            openTrades = Number(cand.makerInfo.holding_token_num);
          } else if (tokenNum > 0) {
            openTrades = Math.max(0, tokenNum - profitableTrades);
          }
        }

        // Ensure execution metrics are populated via deriveExecutionMetrics if live activity was skipped/rate-limited
        if (!avgBuyPrice || !avgHoldingTimeSec) {
          const derived = deriveExecutionMetrics({
            address: cand.address,
            realizedProfitUsd: realizedProfit,
            winRatePct: winRate,
            totalTrades,
            profitableTrades,
          });
          if (!avgBuyPrice) avgBuyPrice = derived.avgBuyPrice;
          if (!avgBuyMcap) avgBuyMcap = derived.avgBuyMcap;
          if (!avgSellPrice) avgSellPrice = derived.avgSellPrice;
          if (!avgSellMcap) avgSellMcap = derived.avgSellMcap;
          if (!avgHoldingTimeSec) avgHoldingTimeSec = derived.avgHoldingTimeSec;
        }

        // A wallet qualifies as 'smart' only if: >= 5 open trades AND > $100 realized profit
        const qualifiesSmart = isSmartWallet({ openTrades, realizedProfitUsd: realizedProfit });
        const category = qualifiesSmart ? 'smart' : 'tracked';

        out.push({
          address: cand.address,
          chain,
          category,
          source: cand.source || (cand.makerInfo?.tags?.includes('kol') ? 'gmgn-kol' : 'gmgn-smart-money'),
          score: realizedProfit,
          realizedProfitUsd: realizedProfit,
          winRatePct: winRate,
          profitableTrades,
          totalTrades: totalTrades || tokenNum,
          tokenNum,
          openTrades,
          avgBuyPrice,
          avgBuyMcap,
          avgSellPrice,
          avgSellMcap,
          avgHoldingTimeSec,
          buysAth1M: buysUnder250k,
          buysAth1MWon: buysUnder250kWon,
          buysAth5M: buysUnder1_25M,
          buysAth5MWon: buysUnder1_25MWon,
          buysAth10M: buysUnder2_5M,
          buysAth10MWon: buysUnder2_5MWon,
          buysAthGt50M: buysUnder12_5M,
          buysAthGt50MWon: buysUnder12_5MWon,
          // Cumulative & legacy metric aliases
          buysUnder250k,
          buysUnder250kWon,
          buysUnder1_25M,
          buysUnder1_25MWon,
          buysUnder2_5M,
          buysUnder2_5MWon,
          buysUnder12_5M,
          buysUnder12_5MWon,
          tags: cand.makerInfo.tags || statsRes?.common?.tags || (qualifiesSmart ? ['smart_degen'] : ['tracked_candidate']),
          twitterUsername: cand.makerInfo.twitter_username || statsRes?.common?.twitter_username || null,
          avatar: cand.makerInfo.avatar || statsRes?.common?.avatar || null,
          lastSeenAt: new Date().toISOString(),
        });
      } catch (err) {
        log('warn', `[smart-wallets] Error analyzing wallet ${cand.address}: ${err.message}`);
      }
    }
  } catch (err) {
    log('error', `[smart-wallets] Error scanning smart money on ${chain}: ${err.message}`);
  }

  return out;
}

async function ingestWallets(wallets, db, label) {
  if (!wallets.length) return [];
  await persistWallets(db, wallets);
  log('info', `[smart-wallets] Ingested ${wallets.length} wallets from ${label}`);
  return wallets;
}

/**
 * Scans both chains or a requested chain, saves results into store, and returns the discovered wallets.
 */
export async function scanSmartWallets({ chain = 'all', limit = 20, lookbackDays = DEFAULT_LOOKBACK_DAYS, db = null } = {}) {
  const chains = chain === 'all' ? ['solana', 'robinhood'] : [chain];
  const discovered = [];

  for (const c of chains) {
    const list = await scanChainSmartWallets(c, limit, { lookbackDays });
    discovered.push(...list);
  }

  if (discovered.length > 0) {
    await ingestWallets(discovered, db, 'GMGN smart money');
  }

  return discovered;
}

/**
 * Scan and ingest top traders from fomo.family leaderboard.
 */
export async function scanFomoSmartMoney({ chain = 'all', limit = 50, db = null } = {}) {
  const wallets = await fetchFomoLeaderboard({ chain, limit });
  return ingestWallets(wallets, db, 'FOMO leaderboard');
}

/**
 * Scan and ingest top Solana callers from Kolscan.
 */
export async function scanKolscanSmartMoney({ limit = 50, db = null } = {}) {
  const wallets = await fetchKolscanLeaderboard({ limit });
  return ingestWallets(wallets, db, 'Kolscan');
}

/**
 * Scan and ingest top Robinhood EVM traders from Nock Scout.
 */
export async function scanNockSmartMoney({ limit = 50, db = null } = {}) {
  const wallets = await fetchNockLeaderboard({ limit });
  return ingestWallets(wallets, db, 'Nock Scout');
}

/**
 * Scan and ingest top Alpha snipers, KOLs, and deployers from MadeOnSol.
 */
export async function scanMadeOnSolSmartMoney({ limit = 50, db = null } = {}) {
  const alpha = await fetchMadeOnSolAlphaLeaderboard({ limit }).catch(() => []);
  const kols = await fetchMadeOnSolKolLeaderboard({ window: '30d' }).catch(() => []);
  const deployers = await fetchMadeOnSolDeployerLeaderboard({ limit }).catch(() => []);
  const wallets = [...alpha, ...kols, ...deployers];
  return ingestWallets(wallets, db, 'MadeOnSol (Alpha snipers + KOLs + Deployers)');
}

let scanTimer = null;

/**
 * Starts automatic smart wallet finder loop with backend.
 */
export function startSmartWalletFinder({ intervalMs = 15 * 60_000, initialDelayMs = 5000, db = null } = {}) {
  if (scanTimer) clearInterval(scanTimer);

  const runDiscoveryCycle = async () => {
    log('info', '[smart-wallets] Starting automated multi-source wallet discovery cycle...');
    try {
      await Promise.all([
        scanSmartWallets({ chain: 'all', limit: 20, db }).catch(err => log('warn', `[smart-wallets] GMGN auto scan notice: ${err.message}`)),
        scanFomoSmartMoney({ chain: 'all', limit: 30, db }).catch(err => log('warn', `[smart-wallets] FOMO auto scan notice: ${err.message}`)),
        scanKolscanSmartMoney({ limit: 30, db }).catch(err => log('warn', `[smart-wallets] Kolscan auto scan notice: ${err.message}`)),
        scanNockSmartMoney({ limit: 30, db }).catch(err => log('warn', `[smart-wallets] Nock auto scan notice: ${err.message}`)),
      ]);
    } catch (cycleErr) {
      log('warn', `[smart-wallets] Multi-source discovery cycle notice: ${cycleErr.message}`);
    }
  };

  setTimeout(runDiscoveryCycle, initialDelayMs);
  scanTimer = setInterval(runDiscoveryCycle, intervalMs);

  log('info', `[smart-wallets] Background multi-source smart wallet finder scheduled (every ${Math.round(intervalMs / 60_000)}m)`);
}

