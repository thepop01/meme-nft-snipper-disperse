import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { initSmartWalletsTable, upsertWalletsDb, countWalletsInDb } from '../src/smartwallets/db.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL || 'postgres://bot_user:bot_password@127.0.0.1:5434/bot_tape';
  console.log(`[sync] Connecting to PostgreSQL at ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);

  const pool = new pg.Pool({ connectionString: dbUrl });

  try {
    await initSmartWalletsTable(pool);
    console.log('[sync] Database schema initialized.');

    // 1. Read existing JSON file
    const jsonPath = path.resolve('backend/data/smart-wallets.json');
    if (fs.existsSync(jsonPath)) {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const wallets = doc.wallets || [];
      console.log(`[sync] Ingesting ${wallets.length} wallets from smart-wallets.json...`);
      const inserted = await upsertWalletsDb(pool, wallets);
      console.log(`[sync] Successfully synced ${inserted} wallets.`);
    }

    const total = await countWalletsInDb(pool);
    const solCount = await countWalletsInDb(pool, 'solana');
    const evmCount = await countWalletsInDb(pool, 'robinhood');
    console.log(`[sync] Total smart wallets in Docker Postgres: ${total} (Solana: ${solCount}, EVM: ${evmCount})`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[sync] Error syncing wallets:', err);
  process.exit(1);
});
