// Full-Spectrum FOMO (fomo.family) High-Performance Parallel Backfill
// 1. Backfills all 4 leaderboards: 24h, 7d, 30d, all-time
// 2. Extracts and prioritizes followed social traders by trading activity & volume
// 3. Resolves on-chain wallets (Solana & EVM) using concurrent workers with mutex-locked storage
// 4. Enriches real-time balances, calculates execution metrics & whale qualification (>= $5k)
// 5. Progressively saves to JSON store & PostgreSQL so results are immediately available in UI

import 'dotenv/config';
import pg from 'pg';
import {
  fetchFomoLeaderboard,
  fetchFomoUserFollowing,
  fetchFomoUserProfile,
  fetchFomoUserBalances,
  calculateHoldingsUsd,
  normalizeFomoPayload,
} from '../src/smartwallets/adapters/fomo.js';
import { loadWallets, saveWallets, upsertWallets } from '../src/smartwallets/tracker.js';
import { initSmartWalletsTable, upsertWalletsDb, countWalletsInDb } from '../src/smartwallets/db.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Parallel execution worker pool
async function mapConcurrent(items, concurrency, fn) {
  const results = [];
  let index = 0;
  const workers = Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (index < items.length) {
      const i = index++;
      try {
        const res = await fn(items[i], i);
        if (res != null) results.push(res);
      } catch (err) {
        // Continue gracefully
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('====================================================');
  console.log('🚀 FOMO.family Deep Intelligence High-Speed Backfill');
  console.log('====================================================');

  const dbUrl = process.env.DATABASE_URL;
  let pool = null;
  if (dbUrl) {
    try {
      pool = new pg.Pool({ connectionString: dbUrl });
      await initSmartWalletsTable(pool);
      console.log(`[db] Connected to PostgreSQL.`);
    } catch (e) {
      console.log(`[db] Operating in file-store mode (${e.message})`);
      pool = null;
    }
  }

  // Mutex-serialized progressive auto-saver to guarantee 0 race conditions
  let saveLock = Promise.resolve();
  const autoSave = (walletsToSave) => {
    if (!walletsToSave.length) return Promise.resolve();
    saveLock = saveLock.then(async () => {
      try {
        const doc = loadWallets();
        const merged = upsertWallets(doc.wallets || [], walletsToSave);
        saveWallets({ ...doc, wallets: merged });
        if (pool) {
          await upsertWalletsDb(pool, walletsToSave).catch(() => {});
        }
      } catch (err) {
        console.error(`[save] Notice during save: ${err.message}`);
      }
    });
    return saveLock;
  };

  // --- PHASE 1: All 4 Leaderboard Windows ---
  console.log('\n[Phase 1/4] Fetching all leaderboards (24h, 7d, 30d, all-time)...');
  const windows = ['24h', '7d', '30d', 'all'];
  const leaderWalletsMap = new Map();
  const leaderHandles = new Set();

  for (const win of windows) {
    const wallets = await fetchFomoLeaderboard({ window: win, limit: 150 });
    console.log(`  -> Leaderboard [${win}]: Retrieved ${wallets.length} wallets`);
    for (const w of wallets) {
      const key = `${w.chain}:${w.address.toLowerCase()}`;
      if (!leaderWalletsMap.has(key)) {
        leaderWalletsMap.set(key, w);
      } else {
        const existing = leaderWalletsMap.get(key);
        existing.hits = (existing.hits || 1) + 1;
        if ((w.realizedProfitUsd || 0) > (existing.realizedProfitUsd || 0)) {
          existing.realizedProfitUsd = w.realizedProfitUsd;
          existing.score = w.score;
        }
      }
      if (w.twitterUsername) {
        leaderHandles.add(w.twitterUsername);
      }
    }
    await sleep(150);
  }

  const initialLeaders = Array.from(leaderWalletsMap.values());
  await autoSave(initialLeaders);
  console.log(`✅ Phase 1 complete: Saved ${initialLeaders.length} wallets from ${leaderHandles.size} top leaders.`);

  // --- PHASE 2: Extract Followed Traders with Concurrency ---
  console.log(`\n[Phase 2/4] Extracting social network followed by ${leaderHandles.size} leaders...`);
  const followedMap = new Map(); // handle -> { handle, trades, volumeUsd, followers }
  const leadersArray = Array.from(leaderHandles);
  let scanProgress = 0;

  await mapConcurrent(leadersArray, 6, async (handle) => {
    const follows = await fetchFomoUserFollowing(handle);
    scanProgress++;
    if (scanProgress % 25 === 0 || scanProgress === leadersArray.length) {
      process.stdout.write(`  -> Leaders scanned: ${scanProgress}/${leadersArray.length} (Discovered ${followedMap.size} unique followed traders)...\r`);
    }
    for (const f of follows) {
      if (f?.handle && !leaderHandles.has(f.handle)) {
        if (!followedMap.has(f.handle)) {
          followedMap.set(f.handle, {
            handle: f.handle,
            trades: Number(f.trades || f.swapCount || 0) || 0,
            volumeUsd: Number(f.volumeUsd || 0) || 0,
            followers: Number(f.followers || 0) || 0,
          });
        }
      }
    }
    await sleep(40);
  });

  console.log(`\n✅ Phase 2 complete: Discovered ${followedMap.size} unique followed social traders.`);

  // Load existing store to skip already-resolved handles
  const existingDoc = loadWallets();
  const existingHandles = new Set((existingDoc.wallets || []).map(w => w.twitterUsername).filter(Boolean));
  console.log(`[store] Current database already has ${existingHandles.size} resolved trader handles.`);

  // Separate active traders (volume > 0 or trades > 0) from lurkers, skipping already resolved
  const unvisitedTraders = Array.from(followedMap.values()).filter(t => !existingHandles.has(t.handle));
  const activeTraders = unvisitedTraders
    .filter(t => t.volumeUsd > 0 || t.trades > 0)
    .sort((a, b) => (b.volumeUsd + b.trades * 100) - (a.volumeUsd + a.trades * 100));
  const remainingLurkers = unvisitedTraders.filter(t => t.volumeUsd === 0 && t.trades === 0);
  const prioritizedFollowed = [...activeTraders, ...remainingLurkers];

  console.log(`[plan] ${activeTraders.length} active volume traders to resolve first, followed by ${remainingLurkers.length} social connections.`);

  // --- PHASE 3: Concurrent Wallet Resolution ---
  console.log(`\n[Phase 3/4] Resolving on-chain addresses & balances for followed traders (6 workers)...`);
  const resolvedWallets = [];
  let resolveProgress = 0;
  let batchToSave = [];

  await mapConcurrent(prioritizedFollowed, 6, async (trader) => {
    const profile = await fetchFomoUserProfile(trader.handle);
    resolveProgress++;
    if (resolveProgress % 25 === 0 || resolveProgress === prioritizedFollowed.length) {
      process.stdout.write(`  -> Progress: ${resolveProgress}/${prioritizedFollowed.length} | Wallets found: ${resolvedWallets.length}...\r`);
    }

    if (profile?.wallets && (profile.wallets.solana || profile.wallets.evm)) {
      const normalized = normalizeFomoPayload(profile);
      for (const w of normalized) {
        if (!w.tags.includes('fomo_network_followed')) {
          w.tags.push('fomo_network_followed');
        }
        resolvedWallets.push(w);
        batchToSave.push(w);
      }
    }

    // Auto-save batch every 30 wallets found
    if (batchToSave.length >= 30) {
      const toWrite = [...batchToSave];
      batchToSave = [];
      await autoSave(toWrite);
    }

    await sleep(50);
  });

  if (batchToSave.length > 0) {
    await autoSave(batchToSave);
  }
  console.log(`\n✅ Phase 3 complete: Resolved ${resolvedWallets.length} additional on-chain wallets from followed network.`);

  // --- PHASE 4: Enrich Balances & Whale Qualifications ---
  console.log(`\n[Phase 4/4] Enriching live portfolio balances for top unmeasured traders...`);
  const currentDoc = loadWallets();
  const allWallets = currentDoc.wallets || [];
  const needBalance = allWallets.filter(w => (!w.balanceUsd || w.balanceUsd === 0) && w.twitterUsername).slice(0, 150);

  let enrichedCount = 0;
  await mapConcurrent(needBalance, 5, async (w) => {
    const balances = await fetchFomoUserBalances(w.twitterUsername);
    if (balances && balances.length) {
      const { balanceUsd, memeHoldingsUsd } = calculateHoldingsUsd(balances);
      w.balanceUsd = balanceUsd;
      w.memeHoldingsUsd = memeHoldingsUsd;
      if (balanceUsd >= 5000 || memeHoldingsUsd >= 5000) {
        if (!w.tags.includes('whale')) w.tags.push('whale', 'top_holder');
        w.category = 'whale';
      }
      enrichedCount++;
    }
    await sleep(50);
  });

  await autoSave(allWallets);
  if (pool) {
    await upsertWalletsDb(pool, allWallets).catch(() => {});
    await pool.end();
  }
  console.log(`✅ Phase 4 complete: Enriched live balances for ${enrichedCount} wallets.`);

  // Final Stats
  const finalDoc = loadWallets();
  const finalWallets = finalDoc.wallets || [];
  const solWallets = finalWallets.filter(w => w.chain === 'solana');
  const evmWallets = finalWallets.filter(w => w.chain === 'robinhood');
  const whales = finalWallets.filter(w => w.category === 'whale' || (w.balanceUsd || 0) >= 5000);
  const smartWallets = finalWallets.filter(w => w.category === 'smart');
  const trackedWallets = finalWallets.filter(w => w.category === 'tracked');

  console.log('\n====================================================');
  console.log('🎉 Deep FOMO Backfill Completed!');
  console.log(`Total Database Wallets:     ${finalWallets.length}`);
  console.log(`  - Solana Wallets:          ${solWallets.length}`);
  console.log(`  - Robinhood (EVM) Wallets: ${evmWallets.length}`);
  console.log(`  - Whale Wallets (>= $5k):  ${whales.length}`);
  console.log(`  - Smart Money Wallets:     ${smartWallets.length}`);
  console.log(`  - Tracked Wallets:         ${trackedWallets.length}`);
  console.log('====================================================\n');

  const topWhales = [...whales].sort((a, b) => (b.balanceUsd || 0) - (a.balanceUsd || 0)).slice(0, 5);
  if (topWhales.length) {
    console.log('👑 Top Identified Whales:');
    topWhales.forEach((w, i) => {
      console.log(`  ${i + 1}. [${w.chain}] ${w.address} (@${w.twitterUsername || 'anon'}) - Balance: $${(w.balanceUsd || 0).toLocaleString()} (PnL: $${(w.realizedProfitUsd || 0).toLocaleString()})`);
    });
    console.log('');
  }
}

main().catch(err => {
  console.error('[fatal] FOMO Backfill failed:', err);
  process.exit(1);
});
