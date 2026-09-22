#!/usr/bin/env node
/**
 * Harvests 120 days of historical KOL buy trades from /kol/feed.
 * Samples across 30 time checkpoints (every ~4 days across the 120-day window)
 * with limit=100 per call, extracting active KOL wallets, win rates, tokens, and PnL.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import pg from 'pg';
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
  console.log('  HARVESTING 120 DAYS OF /kol/feed BUY TRADES');
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
  console.log(`Initial total wallets in storage: ${initialCount}\n`);

  const key = process.env.MADEONSOL_API_KEY;
  const headers = { 'Authorization': 'Bearer ' + key, 'x-api-key': key };

  // Generate 30 checkpoints across 120 days (every 4 days)
  const nowMs = Date.now();
  const checkpoints = [];
  for (let day = 0; day <= 116; day += 4) {
    checkpoints.push(new Date(nowMs - day * 86400000).toISOString());
  }

  console.log(`Sampling ${checkpoints.length} intervals across 120 days (from today back to 120d ago)...`);
  let totalTradesProcessed = 0;
  let checkpointsProcessed = 0;

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const daysAgo = i * 4;
    try {
      const url = `https://madeonsol.com/api/v1/kol/feed?limit=100&action=buy&before=${encodeURIComponent(cp)}`;
      const res = await fetch(url, { headers });

      if (res.status === 429) {
        console.warn('  - Rate limit reached (429), stopping gracefully.');
        break;
      }
      if (!res.ok) {
        console.warn(`  - Checkpoint ${daysAgo}d ago (${cp.slice(0, 10)}) returned status: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const trades = data.trades || [];
      if (trades.length === 0) {
        console.log(`  - Checkpoint ${daysAgo}d ago: 0 trades returned.`);
        continue;
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
          source: 'madeonsol-120d-feed',
          score: winrate30d || winrate7d,
          hits: 1,
          winRatePct: winrate30d || winrate7d,
          twitterUsername: t.kol_twitter 
            ? t.kol_twitter.replace(/https?:\/\/(www\.)?(x|twitter)\.com\//, '').replace(/\/$/, '') 
            : (t.kol_name || null),
          tags: [
            'kol',
            'feed_120d_kol',
            t.kol_strategy_tag || 'trader',
            earlyPct >= 50 ? 'early_entry_kol' : null,
          ].filter(Boolean),
          evidence: {
            platform: 'madeonsol.com',
            type: '120d_feed_trade',
            kolName: t.kol_name,
            tradedAt: t.traded_at,
            token: t.token_symbol,
            entryMcapUsd: t.market_cap_usd_at_trade,
            daysAgoSampled: daysAgo,
            importedAt: new Date().toISOString(),
          },
        });
      }

      if (kolWallets.length > 0) {
        await safeSaveWallets(kolWallets, dbPool);
        totalTradesProcessed += kolWallets.length;
        console.log(`  - [${i + 1}/${checkpoints.length}] Day ${daysAgo}d ago (${cp.slice(0, 10)}): processed ${kolWallets.length} buy trades (Sample token: ${trades[0].token_symbol || 'TOKEN'}, KOL: ${trades[0].kol_name || 'Anonymous'})`);
      }
      checkpointsProcessed++;
    } catch (err) {
      console.warn(`  - Checkpoint ${daysAgo}d ago failed: ${err.message}`);
    }
    await sleep(1100);
  }

  const finalDoc = loadWallets();
  const finalCount = (finalDoc.wallets || []).length;
  console.log('\n===========================================================');
  console.log('  120-DAY FEED HARVEST COMPLETE');
  console.log(`  - Checkpoints Sampled:   ${checkpointsProcessed} of ${checkpoints.length}`);
  console.log(`  - Total Trades Ingested: ${totalTradesProcessed}`);
  console.log(`  - Previous Wallet Count: ${initialCount}`);
  console.log(`  - New Total Wallet Count: ${finalCount}`);
  console.log(`  - Net Unique Additions:  +${finalCount - initialCount}`);
  console.log('===========================================================');

  if (dbPool) await dbPool.end().catch(() => {});
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal harvest error:', err);
  process.exit(1);
});
