// Full-spectrum intelligence backfill runner:
// Discovers and ingests smart money from GMGN, FOMO.family, Kolscan, Nock Scout,
// derives execution metrics (avgBuyPrice, avgBuyMcap, avgSellPrice, avgHoldingTimeSec),
// and syncs all wallets into the persistent store and PostgreSQL database.
import 'dotenv/config';
import pg from 'pg';
import { scanSmartWallets, scanFomoSmartMoney, scanKolscanSmartMoney, scanNockSmartMoney } from '../src/smartwallets/finder.js';
import { backfillWalletMetrics } from '../src/smartwallets/backfill.js';
import { loadWallets, saveWallets } from '../src/smartwallets/tracker.js';
import { initSmartWalletsTable, upsertWalletsDb, countWalletsInDb } from '../src/smartwallets/db.js';

async function main() {
  console.log('====================================================');
  console.log('🚀 Starting Full Multi-Source Intelligence Backfill');
  console.log('====================================================');

  // 1. Setup DB connection if configured
  const dbUrl = process.env.DATABASE_URL;
  let pool = null;
  if (dbUrl) {
    try {
      pool = new pg.Pool({ connectionString: dbUrl });
      await initSmartWalletsTable(pool);
      const initialDbCount = await countWalletsInDb(pool);
      console.log(`[db] Connected to PostgreSQL. Existing DB records: ${initialDbCount}`);
    } catch (dbErr) {
      console.log(`[db] PostgreSQL not accessible (${dbErr.message}), operating in JSON store mode.`);
      pool = null;
    }
  }

  const initialDoc = loadWallets();
  console.log(`[store] Initial wallets in JSON store: ${initialDoc.wallets?.length || 0}`);

  // 2. Ingest from FOMO.family
  console.log('\n[1/5] Ingesting from FOMO.family (Solana & EVM)...');
  try {
    const fomoRes = await scanFomoSmartMoney({ chain: 'all', limit: 50, db: pool });
    console.log(`  -> FOMO.family: ${fomoRes.length} wallets ingested.`);
  } catch (err) {
    console.log(`  -> FOMO.family notice: ${err.message}`);
  }

  // 3. Ingest from Kolscan
  console.log('\n[2/5] Ingesting from Kolscan (Solana KOLs & Callers)...');
  try {
    const kolRes = await scanKolscanSmartMoney({ limit: 50, db: pool });
    console.log(`  -> Kolscan: ${kolRes.length} wallets ingested.`);
  } catch (err) {
    console.log(`  -> Kolscan notice: ${err.message}`);
  }

  // 4. Ingest from Nock Scout
  console.log('\n[3/5] Ingesting from Nock Scout (EVM & Solana snipers)...');
  try {
    const nockRes = await scanNockSmartMoney({ limit: 50, db: pool });
    console.log(`  -> Nock Scout: ${nockRes.length} wallets ingested.`);
  } catch (err) {
    console.log(`  -> Nock Scout notice: ${err.message}`);
  }

  // 5. Scan via GMGN Top Traders (Solana & Robinhood)
  console.log('\n[4/5] Ingesting from GMGN Top 30d Meme Traders...');
  try {
    const gmgnSol = await scanSmartWallets({ chain: 'solana', limit: 25, db: pool });
    console.log(`  -> GMGN Solana: ${gmgnSol.length} smart wallets analyzed.`);
  } catch (err) {
    console.log(`  -> GMGN Solana notice: ${err.message}`);
  }

  try {
    const gmgnRh = await scanSmartWallets({ chain: 'robinhood', limit: 25, db: pool });
    console.log(`  -> GMGN Robinhood: ${gmgnRh.length} smart wallets analyzed.`);
  } catch (err) {
    console.log(`  -> GMGN Robinhood notice: ${err.message}`);
  }

  // 6. Backfill execution metrics for all wallets
  console.log('\n[5/5] Backfilling execution metrics (Prices, Mcaps, Holding times)...');
  const metricResult = await backfillWalletMetrics({ maxLiveQueries: 10, db: pool });
  console.log('  -> Metrics backfilled:', metricResult);

  // 7. Summary
  const finalDoc = loadWallets();
  const wallets = finalDoc.wallets || [];
  const smartCount = wallets.filter(w => w.category === 'smart').length;
  const trackedCount = wallets.filter(w => w.category === 'tracked').length;
  const whaleCount = wallets.filter(w => w.category === 'whale' || (Number(w.balanceUsd || 0) >= 5000 || Number(w.memeHoldingsUsd || 0) >= 5000)).length;
  const lineageCount = wallets.filter(w => w.category === 'lineage' || Boolean(w.lineageParent)).length;

  console.log('\n====================================================');
  console.log('✅ Backfill Complete!');
  console.log(`Total Wallets: ${wallets.length}`);
  console.log(`  - Smart Wallets:   ${smartCount}`);
  console.log(`  - Tracked Wallets: ${trackedCount}`);
  console.log(`  - Whale Wallets:   ${whaleCount}`);
  console.log(`  - Lineage Wallets: ${lineageCount}`);
  console.log('====================================================\n');

  if (pool) {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[fatal] Backfill failed:', err);
  process.exit(1);
});
