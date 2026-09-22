#!/usr/bin/env node
/**
 * Deep Backfill Wallets from MadeOnSol:
 * 1. Alpha Wallets (Early Buyer Snipers) -> 1,500 wallets (offsets 0..1400, limit 100)
 * 2. KOL Wallets Directory (Normal Leaderboard Wallets) -> ~1,000 wallets (offsets 0..900, limit 100)
 * 3. KOL Leaderboard Timeframe Windows (today, 7d, 30d, 90d, 180d) -> 250 top performers
 * 4. Deployer Hunter Leaderboard -> 500 deployers (offsets 0..400, limit 100)
 *
 * Paced at 1.1s per request to strictly respect 60 req/min burst limits.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import pg from 'pg';
import {
  fetchMadeOnSolAlphaLeaderboard,
  fetchMadeOnSolKolLeaderboard,
  fetchMadeOnSolKolWallets,
  fetchMadeOnSolDeployerLeaderboard,
} from '../src/smartwallets/adapters/madeonsol.js';
import { loadWallets, saveWallets, upsertWallets } from '../src/smartwallets/tracker.js';
import { initSmartWalletsTable, upsertWalletsDb } from '../src/smartwallets/db.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function runDeepBackfill() {
  console.log('===========================================================');
  console.log('  STARTING DEEP MADEONSOL WALLET BACKFILL (ALPHA + KOLS + DEPLOYERS)');
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

  let totalHarvested = 0;

  // 1. Alpha Wallets & Snipers (1,500 target: offsets 0 to 1400)
  console.log('>>> [1/4] Harvesting 1,500 Alpha / Early Buyer Snipers...');
  for (let offset = 0; offset <= 1400; offset += 100) {
    try {
      const wallets = await fetchMadeOnSolAlphaLeaderboard({ limit: 100, offset });
      if (!wallets || wallets.length === 0) {
        console.log(`  - Offset ${offset}: no more records, stopping early.`);
        break;
      }
      console.log(`  - Alpha Offset ${offset}-${offset + wallets.length}: fetched ${wallets.length} wallets`);
      await safeSaveWallets(wallets, dbPool);
      totalHarvested += wallets.length;
    } catch (err) {
      console.warn(`  - Alpha Offset ${offset} failed: ${err.message}`);
    }
    await sleep(1100);
  }

  // 2. KOL Wallets Directory (~1,000 target: offsets 0 to 900)
  console.log('\n>>> [2/4] Harvesting KOL Wallets Directory (~1,000 target)...');
  for (let offset = 0; offset <= 900; offset += 100) {
    try {
      const wallets = await fetchMadeOnSolKolWallets({ limit: 100, offset });
      if (!wallets || wallets.length === 0) {
        console.log(`  - Offset ${offset}: no more records, stopping early.`);
        break;
      }
      console.log(`  - KOL Wallets Offset ${offset}-${offset + wallets.length}: fetched ${wallets.length} wallets`);
      await safeSaveWallets(wallets, dbPool);
      totalHarvested += wallets.length;
    } catch (err) {
      console.warn(`  - KOL Wallets Offset ${offset} failed: ${err.message}`);
    }
    await sleep(1100);
  }

  // 3. KOL Leaderboards across windows (today, 7d, 30d, 90d, 180d)
  console.log('\n>>> [3/4] Harvesting KOL Leaderboard windows...');
  const windows = ['today', '7d', '30d', '90d', '180d'];
  for (const win of windows) {
    try {
      const wallets = await fetchMadeOnSolKolLeaderboard({ window: win });
      console.log(`  - KOL Leaderboard (${win}): fetched ${wallets.length} wallets`);
      await safeSaveWallets(wallets, dbPool);
      totalHarvested += wallets.length;
    } catch (err) {
      console.warn(`  - KOL Leaderboard (${win}) failed: ${err.message}`);
    }
    await sleep(1100);
  }

  // 4. Deployer Hunter Leaderboard (500 target: offsets 0 to 400)
  console.log('\n>>> [4/4] Harvesting Deployer Hunter Leaderboard (500 target)...');
  for (let offset = 0; offset <= 400; offset += 100) {
    try {
      const wallets = await fetchMadeOnSolDeployerLeaderboard({ limit: 100, offset });
      if (!wallets || wallets.length === 0) {
        console.log(`  - Offset ${offset}: no more records, stopping early.`);
        break;
      }
      console.log(`  - Deployer Offset ${offset}-${offset + wallets.length}: fetched ${wallets.length} wallets`);
      await safeSaveWallets(wallets, dbPool);
      totalHarvested += wallets.length;
    } catch (err) {
      console.warn(`  - Deployer Offset ${offset} failed: ${err.message}`);
    }
    await sleep(1100);
  }

  const finalDoc = loadWallets();
  const finalCount = (finalDoc.wallets || []).length;
  console.log('\n===========================================================');
  console.log(`  DEEP BACKFILL COMPLETE`);
  console.log(`  - Raw Records Processed: ${totalHarvested}`);
  console.log(`  - Previous Wallet Count: ${initialCount}`);
  console.log(`  - New Total Wallet Count: ${finalCount}`);
  console.log(`  - Net Unique Additions:  +${finalCount - initialCount}`);
  console.log('===========================================================');

  if (dbPool) await dbPool.end().catch(() => {});
  process.exit(0);
}

runDeepBackfill().catch(err => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
