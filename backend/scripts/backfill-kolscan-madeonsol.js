#!/usr/bin/env node
/**
 * Backfill Wallets from Kolscan and MadeOnSol (KOLs, Alpha Snipers, Bundlers, Deployers).
 *
 * Harvests:
 * 1. Kolscan SSR Leaderboards across 1d, 7d, 30d, all.
 * 2. MadeOnSol KOL Leaderboards across today, 7d, 30d, 90d, 180d.
 * 3. MadeOnSol Alpha Leaderboard (Early Buyer Snipers & Rank 1 Buyers).
 * 4. MadeOnSol Deployer Hunter Leaderboard (Top Pump.fun Deployers).
 *
 * Saves with sequential mutex locking into smart-wallets.json and Postgres.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import pg from 'pg';
import { fetchKolscanLeaderboard } from '../src/smartwallets/adapters/kolscan.js';
import {
  fetchMadeOnSolKolLeaderboard,
  fetchMadeOnSolAlphaLeaderboard,
  fetchMadeOnSolDeployerLeaderboard,
} from '../src/smartwallets/adapters/madeonsol.js';
import { loadWallets, saveWallets, upsertWallets } from '../src/smartwallets/tracker.js';
import { initSmartWalletsTable, upsertWalletsDb } from '../src/smartwallets/db.js';

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

async function runBackfill() {
  console.log('===========================================================');
  console.log('  STARTING KOLSCAN & MADEONSOL WALLET BACKFILL');
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

  const harvestedWallets = [];

  // 1. Kolscan Leaderboards (1d, 7d, 30d, all)
  console.log('>>> [1/4] Harvesting Kolscan Leaderboards...');
  const kolscanWindows = ['1d', '7d', '30d', 'all'];
  for (const window of kolscanWindows) {
    try {
      const wallets = await fetchKolscanLeaderboard({ timeframe: window, limit: 50 });
      console.log(`  - Kolscan (${window}): fetched ${wallets.length} caller wallets`);
      harvestedWallets.push(...wallets);
    } catch (err) {
      console.warn(`  - Kolscan (${window}) failed: ${err.message}`);
    }
  }

  // 2. MadeOnSol KOL Leaderboard (today, 7d, 30d, 90d, 180d)
  console.log('\n>>> [2/4] Harvesting MadeOnSol KOL Leaderboards...');
  const mosWindows = ['today', '7d', '30d', '90d', '180d'];
  for (const window of mosWindows) {
    try {
      const wallets = await fetchMadeOnSolKolLeaderboard({ window, limit: 50 });
      console.log(`  - MadeOnSol KOL (${window}): fetched ${wallets.length} smart KOL wallets`);
      harvestedWallets.push(...wallets);
    } catch (err) {
      console.warn(`  - MadeOnSol KOL (${window}) failed: ${err.message}`);
    }
  }

  // 3. MadeOnSol Alpha Leaderboard (Early Buyer Snipers) with offset pagination
  console.log('\n>>> [3/4] Harvesting MadeOnSol Alpha Snipers & Early Buyers...');
  const alphaOffsets = [0, 50, 100, 150];
  for (const offset of alphaOffsets) {
    try {
      const snipers = await fetchMadeOnSolAlphaLeaderboard({ limit: 50, offset });
      console.log(`  - MadeOnSol Alpha (offset ${offset}): fetched ${snipers.length} sniper wallets`);
      harvestedWallets.push(...snipers);
      if (snipers.length < 50) break; // reached end of available
    } catch (err) {
      console.warn(`  - MadeOnSol Alpha (offset ${offset}) failed: ${err.message}`);
    }
  }

  // 4. MadeOnSol Deployer Hunter Leaderboard
  console.log('\n>>> [4/4] Harvesting MadeOnSol Pump.fun Deployers...');
  const deployerOffsets = [0, 50, 100];
  for (const offset of deployerOffsets) {
    try {
      const deployers = await fetchMadeOnSolDeployerLeaderboard({ limit: 50, offset });
      console.log(`  - MadeOnSol Deployers (offset ${offset}): fetched ${deployers.length} deployer wallets`);
      harvestedWallets.push(...deployers);
      if (deployers.length < 50) break;
    } catch (err) {
      console.warn(`  - MadeOnSol Deployers (offset ${offset}) failed: ${err.message}`);
    }
  }

  console.log(`\nTotal unique wallets to upsert: ${harvestedWallets.length}`);

  // Save atomically
  const updatedList = await safeSaveWallets(harvestedWallets, dbPool);
  const finalDoc = loadWallets();
  const finalCount = (finalDoc.wallets || []).length;
  const netAdded = finalCount - initialCount;

  // Breakdown of wallet tags in the storage
  let sniperCount = 0;
  let kolCount = 0;
  let deployerCount = 0;
  let whaleCount = 0;
  let trackedCount = 0;
  let smartCount = 0;

  for (const w of finalDoc.wallets || []) {
    const tags = w.tags || [];
    if (w.category === 'whale') whaleCount++;
    else if (w.category === 'tracked') trackedCount++;
    else if (w.category === 'smart') smartCount++;

    if (tags.some(t => t.includes('sniper') || t.includes('bundler') || t === 'alpha_buyer')) sniperCount++;
    if (tags.some(t => t.includes('kol') || t === 'alpha_caller')) kolCount++;
    if (tags.some(t => t.includes('deployer'))) deployerCount++;
  }

  console.log('\n===========================================================');
  console.log('  BACKFILL COMPLETED SUCCESSFULLY');
  console.log('===========================================================');
  console.log(`Net New Wallets Added:  ${netAdded}`);
  console.log(`Total Wallets in Store: ${finalCount}`);
  console.log(`  - Smart Money:        ${smartCount}`);
  console.log(`  - Tracked Wallets:    ${trackedCount}`);
  console.log(`  - Whale Wallets:      ${whaleCount}`);
  console.log(`  - Snipers & Bundlers: ${sniperCount}`);
  console.log(`  - KOL / Callers:      ${kolCount}`);
  console.log(`  - Deployer Hunters:   ${deployerCount}`);
  console.log('===========================================================\n');
}

runBackfill().catch(err => {
  console.error('Backfill fatal error:', err);
  process.exit(1);
});
