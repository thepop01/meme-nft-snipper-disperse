#!/usr/bin/env node
/**
 * Harvests:
 * 1. Active KOL wallets from /kol/feed (paging backwards with next_before cursor)
 * 2. Next tier of Alpha Leaderboard snipers (offsets 1500 to 4000)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import pg from 'pg';
import { fetchMadeOnSolAlphaLeaderboard } from '../src/smartwallets/adapters/madeonsol.js';
import { loadWallets, saveWallets, upsertWallets } from '../src/smartwallets/tracker.js';
import { initSmartWalletsTable, upsertWalletsDb } from '../src/smartwallets/db.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isSol = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));

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

async function run() {
  console.log('===========================================================');
  console.log('  HARVESTING ACTIVE KOLS FROM /kol/feed & DEEPER ALPHA SNIPERS');
  console.log('===========================================================\n');

  let dbPool = null;
  if (process.env.DATABASE_URL) {
    try {
      dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await initSmartWalletsTable(dbPool).catch(() => {});
    } catch {}
  }

  const initialDoc = loadWallets();
  const initialCount = (initialDoc.wallets || []).length;
  console.log(`Initial wallet count: ${initialCount}\n`);

  const key = process.env.MADEONSOL_API_KEY;
  const headers = { 'Authorization': 'Bearer ' + key, 'x-api-key': key };

  // 1. Paging /kol/feed backwards (15 pages of 50 trades each = 750 recent trades)
  console.log('>>> [1/2] Harvesting active KOLs from /kol/feed...');
  let beforeCursor = null;
  let feedKolsFound = 0;

  for (let page = 1; page <= 15; page++) {
    try {
      let url = 'https://madeonsol.com/api/v1/kol/feed?limit=50&action=buy';
      if (beforeCursor) url += `&before=${encodeURIComponent(beforeCursor)}`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn(`  - Feed page ${page} status: ${res.status}`);
        break;
      }

      const data = await res.json();
      const trades = data.trades || [];
      if (trades.length === 0) {
        console.log('  - No more trades returned from feed.');
        break;
      }

      const kolWallets = [];
      for (const t of trades) {
        if (!isSol(t.wallet_address)) continue;
        const winrate7d = Number(t.kol_winrate_7d ?? 0);
        const winrate30d = Number(t.kol_winrate_30d ?? 0);
        const earlyPct = Number(t.kol_early_entry_pct_30d ?? 0);

        kolWallets.push({
          address: t.wallet_address,
          chain: 'solana',
          category: winrate30d >= 50 ? 'smart' : 'tracked',
          source: 'madeonsol-kol-feed',
          score: winrate30d,
          hits: 1,
          winRatePct: winrate30d || winrate7d,
          twitterUsername: t.kol_twitter ? t.kol_twitter.replace(/https?:\/\/(www\.)?(x|twitter)\.com\//, '').replace(/\/$/, '') : (t.kol_name || null),
          tags: [
            'kol',
            'active_feed_kol',
            t.kol_strategy_tag || 'trader',
            earlyPct >= 50 ? 'early_entry_kol' : null,
          ].filter(Boolean),
          evidence: {
            platform: 'madeonsol.com',
            type: 'kol_feed_trade',
            kolName: t.kol_name,
            lastToken: t.token_symbol,
            lastMcap: t.market_cap_usd_at_trade,
            earlyPct30d: earlyPct,
            importedAt: new Date().toISOString(),
          },
        });
      }

      if (kolWallets.length > 0) {
        await safeSaveWallets(kolWallets, dbPool);
        feedKolsFound += kolWallets.length;
        console.log(`  - Page ${page}: processed ${kolWallets.length} KOL buy trades (Oldest: ${trades[trades.length - 1].traded_at})`);
      }

      beforeCursor = data.next_before;
      if (!beforeCursor) break;
    } catch (err) {
      console.warn(`  - Feed page ${page} error: ${err.message}`);
    }
    await sleep(1100);
  }

  // 2. Alpha Leaderboard Deeper Pages (offsets 1500 to 4000, 100 per page = 2,600 snipers)
  console.log('\n>>> [2/2] Harvesting Deeper Alpha Snipers (offsets 1500..4000)...');
  let alphaCount = 0;
  for (let offset = 1500; offset <= 4000; offset += 100) {
    try {
      const wallets = await fetchMadeOnSolAlphaLeaderboard({ limit: 100, offset });
      if (!wallets || wallets.length === 0) {
        console.log(`  - Offset ${offset}: no more alpha records.`);
        break;
      }
      await safeSaveWallets(wallets, dbPool);
      alphaCount += wallets.length;
      console.log(`  - Alpha Offset ${offset}-${offset + wallets.length}: fetched ${wallets.length} wallets`);
    } catch (err) {
      console.warn(`  - Alpha Offset ${offset} failed: ${err.message}`);
    }
    await sleep(1100);
  }

  const finalDoc = loadWallets();
  const finalCount = (finalDoc.wallets || []).length;
  console.log('\n===========================================================');
  console.log(`  HARVEST COMPLETE`);
  console.log(`  - Active Feed KOL Trades: ${feedKolsFound}`);
  console.log(`  - Deeper Alpha Snipers:   ${alphaCount}`);
  console.log(`  - Previous Wallet Count:  ${initialCount}`);
  console.log(`  - New Total Wallet Count: ${finalCount}`);
  console.log(`  - Net Unique Additions:   +${finalCount - initialCount}`);
  console.log('===========================================================');

  if (dbPool) await dbPool.end().catch(() => {});
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal harvest error:', err);
  process.exit(1);
});
