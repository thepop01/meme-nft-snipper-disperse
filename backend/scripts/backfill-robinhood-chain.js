#!/usr/bin/env node
/**
 * Comprehensive Robinhood Chain (EVM) Backfill:
 * 1. FOMO Leaderboards across all windows (24h, 7d, 30d, all) -> extracts EVM wallets
 * 2. GeckoTerminal Robinhood DEX Trades -> extracts active EVM traders from trending pools (with 2.5s pacing + 429 retry)
 * 3. GMGN Robinhood Smart Money & KOLs -> extracts verified smart degen and KOL EVM wallets (after rate limit cooldown)
 *
 * Persists into smart-wallets.json and Postgres.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import pg from 'pg';
import { loadWallets, saveWallets, upsertWallets } from '../src/smartwallets/tracker.js';
import { initSmartWalletsTable, upsertWalletsDb } from '../src/smartwallets/db.js';
import { runGmgnCli } from '../src/discovery/gmgn.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isEvm = v => /^0x[0-9a-fA-F]{40}$/.test(String(v || ''));

let saveLock = Promise.resolve();
async function safeSaveWallets(walletsToAdd, dbPool) {
  return new Promise((resolve, reject) => {
    saveLock = saveLock.then(async () => {
      try {
        const doc = loadWallets();
        const currentList = doc.wallets || [];
        const merged = upsertWallets(currentList, walletsToAdd);
        saveWallets({ ...doc, wallets: merged });

        if (dbPool) {
          await upsertWalletsDb(dbPool, walletsToAdd).catch(() => {});
        }
        resolve(merged);
      } catch (err) {
        reject(err);
      }
    });
  });
}

const FOMO_KEY = process.env.FOMO_API_KEY || 'fapi_94b6ee2400a462a2304dacdb14b256af4e5cac8502533b11e7304bcccde3eb1f';
const fomoHeaders = { Authorization: `Bearer ${FOMO_KEY}`, Accept: 'application/json' };
const webHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

async function fetchWithRetry(url, headers, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) {
        const wait = attempt * 2500;
        console.log(`    [429 rate limit] Backing off ${wait}ms before retry ${attempt}/${retries}...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      if (attempt === retries) return null;
      await sleep(1500);
    }
  }
  return null;
}

async function run() {
  console.log('===========================================================');
  console.log('  STARTING ROBINHOOD CHAIN (EVM) COMPREHENSIVE BACKFILL');
  console.log('===========================================================\n');

  let dbPool = null;
  if (process.env.DATABASE_URL) {
    try {
      dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await initSmartWalletsTable(dbPool).catch(() => {});
    } catch {}
  }

  const initialDoc = loadWallets();
  const initialRhc = (initialDoc.wallets || []).filter(w => w.chain === 'robinhood').length;
  console.log(`Initial Robinhood Chain wallets in DB: ${initialRhc}\n`);

  // 1. FOMO Leaderboards across all windows (24h, 7d, 30d, all)
  console.log('>>> [1/3] Harvesting FOMO Robinhood / EVM Leaderboards...');
  const windows = ['24h', '7d', '30d', 'all'];
  for (const win of windows) {
    try {
      const res = await fetch(`https://api.fomoapi.io/v2/leaderboard/${win}`, {
        headers: fomoHeaders,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) {
        console.warn(`  - FOMO (${win}) status: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const traders = data.traders || data.leaderboard || [];
      const rhcWallets = [];

      for (const t of traders) {
        const evmAddr = t.wallets?.evm;
        if (!isEvm(evmAddr)) continue;

        const pnl = Number(t.pnl_usd ?? t.pnlUsd ?? t.realized_pnl ?? 0) || 0;
        const winrate = Number(t.win_rate ?? t.winRate ?? 0) || 0;
        const trades = Number(t.trades ?? t.trades_count ?? 0) || 0;
        const openTrades = Number(t.open_trades ?? 0) || 0;
        const volume = Number(t.volume_usd ?? 0) || 0;

        rhcWallets.push({
          address: String(evmAddr).toLowerCase(),
          chain: 'robinhood',
          category: openTrades >= 5 && pnl > 100 ? 'smart' : 'tracked',
          source: 'fomo-robinhood',
          score: pnl,
          hits: 1,
          realizedProfitUsd: pnl,
          winRatePct: winrate,
          totalTrades: trades,
          openTrades,
          profitableTrades: Math.round(trades * (winrate / 100)),
          volumeUsd: volume,
          twitterUsername: t.handle || null,
          tags: [
            'robinhood_trader',
            'fomo_evm',
            pnl > 5000 ? 'top_evm_pnl' : 'active_evm_trader',
            `fomo_${win}`,
          ],
          evidence: {
            platform: 'fomo.family',
            handle: t.handle,
            window: win,
            importedAt: new Date().toISOString(),
          },
        });
      }

      if (rhcWallets.length > 0) {
        await safeSaveWallets(rhcWallets, dbPool);
        console.log(`  - FOMO Leaderboard (${win}): harvested ${rhcWallets.length} Robinhood EVM wallets`);
      }
    } catch (err) {
      console.warn(`  - FOMO (${win}) notice: ${err.message}`);
    }
    await sleep(300);
  }

  // 2. GeckoTerminal Robinhood Trending Pools & DEX Traders
  console.log('\n>>> [2/3] Harvesting GeckoTerminal Robinhood Trending Pools & DEX Traders...');
  try {
    const poolData = await fetchWithRetry('https://api.geckoterminal.com/api/v2/networks/robinhood/trending_pools', webHeaders);
    const pools = poolData?.data || [];
    console.log(`  - Found ${pools.length} trending Robinhood pools`);

    const traderStats = new Map();

    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      const poolAddr = p.attributes?.address;
      const poolName = p.attributes?.name || '';
      if (!poolAddr) continue;

      // Rate-limit pause before calling trades
      await sleep(2200);

      const tradesData = await fetchWithRetry(
        `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${poolAddr}/trades`,
        webHeaders,
        3
      );

      const trades = tradesData?.data || [];
      if (trades.length > 0) {
        let poolTraders = 0;
        for (const t of trades) {
          const fromAddr = t.attributes?.tx_from_address;
          if (!isEvm(fromAddr)) continue;
          const norm = String(fromAddr).toLowerCase();
          const vol = Number(t.attributes?.volume_in_usd ?? 0) || 0;
          const isBuy = t.attributes?.kind === 'buy';

          const stat = traderStats.get(norm) || { buys: 0, sells: 0, volumeUsd: 0, tokens: new Set() };
          if (isBuy) stat.buys++;
          else stat.sells++;
          stat.volumeUsd += vol;
          if (poolName) stat.tokens.add(poolName.split('/')[0].trim());
          traderStats.set(norm, stat);
          poolTraders++;
        }
        console.log(`    [Pool ${i + 1}/${pools.length}] ${poolName}: ${trades.length} trades, ${poolTraders} trader records`);
      }
    }

    console.log(`  - Total unique Robinhood DEX traders identified: ${traderStats.size}`);
    const dexWallets = [];
    for (const [addr, stat] of traderStats.entries()) {
      const totalTrades = stat.buys + stat.sells;
      const isWhale = stat.volumeUsd >= 5000;
      const isSmart = totalTrades >= 3 || stat.volumeUsd >= 500;

      dexWallets.push({
        address: addr,
        chain: 'robinhood',
        category: isWhale ? 'whale' : (isSmart ? 'smart' : 'tracked'),
        source: 'geckoterminal-dex',
        score: Math.round(stat.volumeUsd),
        hits: totalTrades,
        totalTrades,
        volumeUsd: Math.round(stat.volumeUsd * 100) / 100,
        tags: [
          'robinhood_trader',
          'geckoterminal_dex',
          isWhale ? 'robinhood_whale' : 'dex_trader',
          stat.buys > 0 && stat.sells === 0 ? 'net_buyer' : 'swapper',
          ...Array.from(stat.tokens).map(tok => `traded_${tok}`),
        ],
        evidence: {
          platform: 'geckoterminal.com',
          network: 'robinhood',
          buys: stat.buys,
          sells: stat.sells,
          volumeUsd: stat.volumeUsd,
          importedAt: new Date().toISOString(),
        },
      });
    }

    if (dexWallets.length > 0) {
      await safeSaveWallets(dexWallets, dbPool);
      console.log(`  - Saved ${dexWallets.length} active Robinhood DEX trading wallets`);
    }
  } catch (err) {
    console.warn(`  - GeckoTerminal notice: ${err.message}`);
  }

  // 3. GMGN Robinhood Smart Money & KOLs
  console.log('\n>>> [3/3] Harvesting GMGN Robinhood Smart Money & KOLs...');
  // Ensure rate limit cooldown is respected
  console.log('  - Waiting 10s for GMGN cooldown window...');
  await sleep(10000);

  try {
    const rawSm = await runGmgnCli(['track', 'smartmoney', '--chain', 'robinhood', '--limit', '100']).catch(() => null);
    const listSm = rawSm?.list || rawSm?.data?.list || [];
    const smWallets = [];

    for (const item of listSm) {
      const maker = item?.maker;
      if (!isEvm(maker)) continue;
      const norm = String(maker).toLowerCase();
      const amountUsd = Number(item.amount_usd ?? 0) || 0;
      const tokenSymbol = item.base_token?.symbol || '';
      const launchpad = item.base_token?.launchpad || '';
      const twitter = item.maker_info?.twitter_username || item.maker_info?.twitter_name || null;

      const tags = ['robinhood_trader', 'gmgn_smart_money', 'smart_degen'];
      if (launchpad) tags.push(`launchpad_${launchpad}`);
      if (tokenSymbol) tags.push(`token_${tokenSymbol}`);

      smWallets.push({
        address: norm,
        chain: 'robinhood',
        category: 'smart',
        source: 'gmgn-smart-money',
        score: Math.max(amountUsd, 100),
        hits: 1,
        volumeUsd: amountUsd,
        twitterUsername: twitter,
        tags,
        evidence: {
          platform: 'gmgn.ai',
          chain: 'robinhood',
          lastAction: item.side || 'buy',
          token: tokenSymbol,
          txHash: item.transaction_hash,
          importedAt: new Date().toISOString(),
        },
      });
    }

    if (smWallets.length > 0) {
      await safeSaveWallets(smWallets, dbPool);
      console.log(`  - GMGN Robinhood Smart Money: harvested ${smWallets.length} EVM wallets`);
    }
  } catch (err) {
    console.warn(`  - GMGN Smart Money notice: ${err.message}`);
  }

  try {
    const rawKol = await runGmgnCli(['track', 'kol', '--chain', 'robinhood', '--limit', '100']).catch(() => null);
    const listKol = rawKol?.list || rawKol?.data?.list || [];
    const kolWallets = [];

    for (const item of listKol) {
      const maker = item?.maker;
      if (!isEvm(maker)) continue;
      const norm = String(maker).toLowerCase();
      const amountUsd = Number(item.amount_usd ?? 0) || 0;
      const tokenSymbol = item.base_token?.symbol || '';
      const twitter = item.maker_info?.twitter_username || item.maker_info?.twitter_name || null;

      kolWallets.push({
        address: norm,
        chain: 'robinhood',
        category: 'tracked',
        source: 'gmgn-kol',
        score: Math.max(amountUsd, 200),
        hits: 1,
        volumeUsd: amountUsd,
        twitterUsername: twitter,
        tags: [
          'robinhood_trader',
          'gmgn_kol',
          'kol_caller',
          twitter ? `twitter_${twitter}` : 'verified_kol',
        ],
        evidence: {
          platform: 'gmgn.ai',
          chain: 'robinhood',
          role: 'kol',
          token: tokenSymbol,
          txHash: item.transaction_hash,
          importedAt: new Date().toISOString(),
        },
      });
    }

    if (kolWallets.length > 0) {
      await safeSaveWallets(kolWallets, dbPool);
      console.log(`  - GMGN Robinhood KOLs: harvested ${kolWallets.length} EVM wallets`);
    }
  } catch (err) {
    console.warn(`  - GMGN KOL notice: ${err.message}`);
  }

  const finalDoc = loadWallets();
  const finalRhc = (finalDoc.wallets || []).filter(w => w.chain === 'robinhood').length;
  const grandTotal = (finalDoc.wallets || []).length;

  console.log('\n===========================================================');
  console.log('  ROBINHOOD CHAIN BACKFILL COMPLETE');
  console.log(`  - Previous Robinhood Wallets: ${initialRhc}`);
  console.log(`  - New Robinhood Wallets:      ${finalRhc}`);
  console.log(`  - Net Robinhood Additions:    +${finalRhc - initialRhc}`);
  console.log(`  - Grand Total Wallets in DB:  ${grandTotal}`);
  console.log('===========================================================');

  if (dbPool) await dbPool.end().catch(() => {});
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal Robinhood backfill error:', err);
  process.exit(1);
});
