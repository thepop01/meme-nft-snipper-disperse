// PostgreSQL database access for smart wallets.
// Allows storing tens of thousands / millions of wallets in Docker bot-postgres.
import { log } from '../bus.js';

export async function initSmartWalletsTable(db) {
  if (!db) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS smart_wallets (
      chain VARCHAR(32) NOT NULL,
      address VARCHAR(128) NOT NULL,
      category VARCHAR(32) DEFAULT 'smart',
      source VARCHAR(64) DEFAULT 'manual',
      score DOUBLE PRECISION,
      hits INT DEFAULT 1,
      realized_profit_usd DOUBLE PRECISION DEFAULT 0,
      win_rate_pct DOUBLE PRECISION DEFAULT 0,
      profitable_trades INT DEFAULT 0,
      total_trades INT DEFAULT 0,
      token_num INT DEFAULT 0,
      buys_0_to_1m INT DEFAULT 0,
      buys_0_to_1m_won INT DEFAULT 0,
      buys_1_to_2m INT DEFAULT 0,
      buys_1_to_2m_won INT DEFAULT 0,
      buys_2_to_5m INT DEFAULT 0,
      buys_2_to_5m_won INT DEFAULT 0,
      buys_5_to_10m INT DEFAULT 0,
      buys_5_to_10m_won INT DEFAULT 0,
      buys_under_1m INT DEFAULT 0,
      buys_under_1m_profitable INT DEFAULT 0,
      buys_under_2m INT DEFAULT 0,
      buys_under_5m INT DEFAULT 0,
      buys_under_10m INT DEFAULT 0,
      tags TEXT[] DEFAULT ARRAY['smart_degen']::TEXT[],
      twitter_username VARCHAR(128),
      avatar TEXT,
      evidence JSONB,
      lineage_parent VARCHAR(128),
      lineage_tx VARCHAR(128),
      lineage_amount DOUBLE PRECISION,
      early_buyer_info JSONB,
      status VARCHAR(32) DEFAULT 'active',
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chain, address)
    );

    CREATE INDEX IF NOT EXISTS idx_smart_wallets_chain ON smart_wallets(chain);
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_category ON smart_wallets(category);
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_lineage ON smart_wallets(lineage_parent);
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_profit ON smart_wallets(realized_profit_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_winrate ON smart_wallets(win_rate_pct DESC);
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_hits ON smart_wallets(hits DESC);

    -- Migrations for existing tables
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS category VARCHAR(32) DEFAULT 'smart';
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS lineage_parent VARCHAR(128);
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS lineage_tx VARCHAR(128);
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS lineage_amount DOUBLE PRECISION;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS early_buyer_info JSONB;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'active';
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS open_trades INT DEFAULT 0;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS wallet_type VARCHAR(32) DEFAULT 'normal';
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS retard_points INT DEFAULT 0;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS sus_wallet_points INT DEFAULT 0;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS scam_memes_involved TEXT[] DEFAULT '{}';
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS balance_usd DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS meme_holdings_usd DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_buy_price DOUBLE PRECISION;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_buy_mcap DOUBLE PRECISION;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_sell_price DOUBLE PRECISION;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_sell_mcap DOUBLE PRECISION;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_holding_time_sec DOUBLE PRECISION;
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS qualification_method VARCHAR(64);
    ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS methods TEXT[] DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS scam_memes (
      mint VARCHAR(128) PRIMARY KEY,
      chain VARCHAR(32) NOT NULL DEFAULT 'solana',
      symbol VARCHAR(64),
      name VARCHAR(128),
      dev_wallet VARCHAR(128),
      sell_tx VARCHAR(128),
      sell_amount DOUBLE PRECISION,
      sell_price_usd DOUBLE PRECISION,
      ath_mcap DOUBLE PRECISION,
      early_wallets_penalized INT DEFAULT 0,
      early_wallets_sus INT DEFAULT 0,
      detected_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB
    );

    CREATE INDEX IF NOT EXISTS idx_scam_memes_dev ON scam_memes(dev_wallet);
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_wallet_type ON smart_wallets(wallet_type);
  `;
  await db.query(sql);
}

export async function upsertWalletsDb(db, wallets = []) {
  if (!db || !wallets.length) return 0;
  let count = 0;
  for (const w of wallets) {
    if (!w.address || !w.chain) continue;
    const query = `
      INSERT INTO smart_wallets (
        chain, address, category, source, score, hits, realized_profit_usd, win_rate_pct,
        profitable_trades, total_trades, token_num, open_trades,
        wallet_type, retard_points, sus_wallet_points, scam_memes_involved,
        balance_usd, meme_holdings_usd,
        buys_0_to_1m, buys_0_to_1m_won, buys_1_to_2m, buys_1_to_2m_won,
        buys_2_to_5m, buys_2_to_5m_won, buys_5_to_10m, buys_5_to_10m_won,
        buys_under_1m, buys_under_1m_profitable, buys_under_2m, buys_under_5m, buys_under_10m,
        tags, twitter_username, avatar, evidence,
        lineage_parent, lineage_tx, lineage_amount, early_buyer_info, status,
        avg_buy_price, avg_buy_mcap, avg_sell_price, avg_holding_time_sec, qualification_method, methods,
        last_seen_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18,
        $19, $20, $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29, $30, $31,
        $32, $33, $34, $35,
        $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46,
        NOW(), NOW()
      )
      ON CONFLICT (chain, address) DO UPDATE SET
        category = COALESCE(EXCLUDED.category, smart_wallets.category),
        source = COALESCE(EXCLUDED.source, smart_wallets.source),
        score = COALESCE(EXCLUDED.score, smart_wallets.score),
        hits = smart_wallets.hits + COALESCE(EXCLUDED.hits, 1),
        realized_profit_usd = GREATEST(smart_wallets.realized_profit_usd, EXCLUDED.realized_profit_usd),
        win_rate_pct = CASE WHEN EXCLUDED.win_rate_pct > 0 THEN EXCLUDED.win_rate_pct ELSE smart_wallets.win_rate_pct END,
        profitable_trades = GREATEST(smart_wallets.profitable_trades, EXCLUDED.profitable_trades),
        total_trades = GREATEST(smart_wallets.total_trades, EXCLUDED.total_trades),
        token_num = GREATEST(smart_wallets.token_num, EXCLUDED.token_num),
        open_trades = GREATEST(smart_wallets.open_trades, EXCLUDED.open_trades),
        wallet_type = CASE WHEN EXCLUDED.wallet_type != 'normal' THEN EXCLUDED.wallet_type ELSE smart_wallets.wallet_type END,
        retard_points = smart_wallets.retard_points + COALESCE(EXCLUDED.retard_points, 0),
        sus_wallet_points = smart_wallets.sus_wallet_points + COALESCE(EXCLUDED.sus_wallet_points, 0),
        balance_usd = GREATEST(smart_wallets.balance_usd, EXCLUDED.balance_usd),
        meme_holdings_usd = GREATEST(smart_wallets.meme_holdings_usd, EXCLUDED.meme_holdings_usd),
        scam_memes_involved = (
          SELECT array_agg(DISTINCT elem)
          FROM unnest(array_cat(smart_wallets.scam_memes_involved, EXCLUDED.scam_memes_involved)) elem
        ),
        buys_0_to_1m = GREATEST(smart_wallets.buys_0_to_1m, EXCLUDED.buys_0_to_1m),
        buys_0_to_1m_won = GREATEST(smart_wallets.buys_0_to_1m_won, EXCLUDED.buys_0_to_1m_won),
        buys_1_to_2m = GREATEST(smart_wallets.buys_1_to_2m, EXCLUDED.buys_1_to_2m),
        buys_1_to_2m_won = GREATEST(smart_wallets.buys_1_to_2m_won, EXCLUDED.buys_1_to_2m_won),
        buys_2_to_5m = GREATEST(smart_wallets.buys_2_to_5m, EXCLUDED.buys_2_to_5m),
        buys_2_to_5m_won = GREATEST(smart_wallets.buys_2_to_5m_won, EXCLUDED.buys_2_to_5m_won),
        buys_5_to_10m = GREATEST(smart_wallets.buys_5_to_10m, EXCLUDED.buys_5_to_10m),
        buys_5_to_10m_won = GREATEST(smart_wallets.buys_5_to_10m_won, EXCLUDED.buys_5_to_10m_won),
        buys_under_1m = GREATEST(smart_wallets.buys_under_1m, EXCLUDED.buys_under_1m),
        buys_under_1m_profitable = GREATEST(smart_wallets.buys_under_1m_profitable, EXCLUDED.buys_under_1m_profitable),
        buys_under_2m = GREATEST(smart_wallets.buys_under_2m, EXCLUDED.buys_under_2m),
        buys_under_5m = GREATEST(smart_wallets.buys_under_5m, EXCLUDED.buys_under_5m),
        buys_under_10m = GREATEST(smart_wallets.buys_under_10m, EXCLUDED.buys_under_10m),
        tags = CASE WHEN array_length(EXCLUDED.tags, 1) > 0 THEN EXCLUDED.tags ELSE smart_wallets.tags END,
        twitter_username = COALESCE(EXCLUDED.twitter_username, smart_wallets.twitter_username),
        avatar = COALESCE(EXCLUDED.avatar, smart_wallets.avatar),
        evidence = COALESCE(EXCLUDED.evidence, smart_wallets.evidence),
        lineage_parent = COALESCE(EXCLUDED.lineage_parent, smart_wallets.lineage_parent),
        lineage_tx = COALESCE(EXCLUDED.lineage_tx, smart_wallets.lineage_tx),
        lineage_amount = COALESCE(EXCLUDED.lineage_amount, smart_wallets.lineage_amount),
        early_buyer_info = COALESCE(EXCLUDED.early_buyer_info, smart_wallets.early_buyer_info),
        status = COALESCE(EXCLUDED.status, smart_wallets.status),
        avg_buy_price = COALESCE(EXCLUDED.avg_buy_price, smart_wallets.avg_buy_price),
        avg_buy_mcap = COALESCE(EXCLUDED.avg_buy_mcap, smart_wallets.avg_buy_mcap),
        avg_sell_price = COALESCE(EXCLUDED.avg_sell_price, smart_wallets.avg_sell_price),
        avg_holding_time_sec = COALESCE(EXCLUDED.avg_holding_time_sec, smart_wallets.avg_holding_time_sec),
        qualification_method = COALESCE(EXCLUDED.qualification_method, smart_wallets.qualification_method),
        methods = CASE WHEN array_length(EXCLUDED.methods, 1) > 0 THEN EXCLUDED.methods ELSE smart_wallets.methods END,
        last_seen_at = NOW(),
        updated_at = NOW();
    `;
    await db.query(query, [
      w.chain,
      w.chain === 'robinhood' ? w.address.toLowerCase() : w.address,
      w.category || 'smart',
      w.source || 'manual',
      w.score ?? null,
      w.hits || 1,
      w.realizedProfitUsd || 0,
      w.winRatePct || 0,
      w.profitableTrades || 0,
      w.totalTrades || 0,
      w.tokenNum || 0,
      w.openTrades || 0,
      w.walletType || 'normal',
      w.retardPoints || 0,
      w.susWalletPoints || 0,
      Array.isArray(w.scamMemesInvolved) ? w.scamMemesInvolved : [],
      w.balanceUsd || 0,
      w.memeHoldingsUsd || 0,
      w.buys0to1M || 0,
      w.buys0to1MWon || 0,
      w.buys1to2M || 0,
      w.buys1to2MWon || 0,
      w.buys2to5M || 0,
      w.buys2to5MWon || 0,
      w.buys5to10M || 0,
      w.buys5to10MWon || 0,
      w.buysUnder1M || 0,
      w.buysUnder1MProfitable || 0,
      w.buysUnder2M || 0,
      w.buysUnder5M || 0,
      w.buysUnder10M || 0,
      Array.isArray(w.tags) ? w.tags : ['smart_degen'],
      w.twitterUsername || null,
      w.avatar || null,
      w.evidence ? JSON.stringify(w.evidence) : null,
      w.lineageParent || null,
      w.lineageTx || null,
      w.lineageAmount ?? null,
      w.earlyBuyerInfo ? JSON.stringify(w.earlyBuyerInfo) : null,
      w.status || 'active',
      w.avgBuyPrice ?? null,
      w.avgBuyMcap ?? null,
      w.avgSellPrice ?? null,
      w.avgHoldingTimeSec ?? null,
      w.qualificationMethod || null,
      Array.isArray(w.methods) ? w.methods : (w.qualificationMethod ? [w.qualificationMethod] : []),
    ]);
    count++;
  }
  return count;
}

export async function fetchWalletsFromDb(db, { chain, category, walletType, limit, offset = 0 } = {}) {
  if (!db) return [];
  const params = [];
  const conditions = [];
  const resolvedLimit = limit === undefined ? 500 : limit;

  if (chain) {
    params.push(chain);
    conditions.push(`chain = $${params.length}`);
  }
  if (category && category !== 'all') {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (walletType) {
    params.push(walletType);
    conditions.push(`wallet_type = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let limitSql = '';
  if (resolvedLimit != null) {
    params.push(resolvedLimit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;
    limitSql = `LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  }

  const sql = `
    SELECT 
      chain, address, category, source, score, hits,
      realized_profit_usd AS "realizedProfitUsd",
      win_rate_pct AS "winRatePct",
      profitable_trades AS "profitableTrades",
      total_trades AS "totalTrades",
      token_num AS "tokenNum",
      open_trades AS "openTrades",
      balance_usd AS "balanceUsd",
      meme_holdings_usd AS "memeHoldingsUsd",
      wallet_type AS "walletType",
      retard_points AS "retardPoints",
      sus_wallet_points AS "susWalletPoints",
      scam_memes_involved AS "scamMemesInvolved",
      buys_0_to_1m AS "buys0to1M",
      buys_0_to_1m_won AS "buys0to1MWon",
      buys_1_to_2m AS "buys1to2M",
      buys_1_to_2m_won AS "buys1to2MWon",
      buys_2_to_5m AS "buys2to5M",
      buys_2_to_5m_won AS "buys2to5MWon",
      buys_5_to_10m AS "buys5to10M",
      buys_5_to_10m_won AS "buys5to10MWon",
      buys_under_1m AS "buysUnder1M",
      buys_under_1m_profitable AS "buysUnder1MProfitable",
      buys_under_2m AS "buysUnder2M",
      buys_under_5m AS "buysUnder5M",
      buys_under_10m AS "buysUnder10M",
      tags,
      twitter_username AS "twitterUsername",
      avatar,
      evidence,
      lineage_parent AS "lineageParent",
      lineage_tx AS "lineageTx",
      lineage_amount AS "lineageAmount",
      early_buyer_info AS "earlyBuyerInfo",
      status,
      avg_buy_price AS "avgBuyPrice",
      avg_buy_mcap AS "avgBuyMcap",
      avg_sell_price AS "avgSellPrice",
      avg_holding_time_sec AS "avgHoldingTimeSec",
      qualification_method AS "qualificationMethod",
      methods,
      first_seen_at AS "firstSeenAt",
      last_seen_at AS "lastSeenAt",
      updated_at AS "updatedAt"
    FROM smart_wallets
    ${where}
    ORDER BY realized_profit_usd DESC, hits DESC
    ${limitSql}
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function countWalletsInDb(db, chain, category) {
  if (!db) return 0;
  const conditions = [];
  const params = [];

  if (chain) {
    params.push(chain);
    conditions.push(`chain = $${params.length}`);
  }
  if (category && category !== 'all') {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT count(*)::int as count FROM smart_wallets ${where}`, params);
  return rows[0]?.count || 0;
}

export async function upsertScamMemeDb(db, meme) {
  if (!db || !meme?.mint) return;
  const sql = `
    INSERT INTO scam_memes (
      mint, chain, symbol, name, dev_wallet, sell_tx, sell_amount,
      sell_price_usd, ath_mcap, early_wallets_penalized, early_wallets_sus,
      detected_at, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
    ON CONFLICT (mint) DO UPDATE SET
      dev_wallet = COALESCE(EXCLUDED.dev_wallet, scam_memes.dev_wallet),
      sell_tx = COALESCE(EXCLUDED.sell_tx, scam_memes.sell_tx),
      sell_amount = COALESCE(EXCLUDED.sell_amount, scam_memes.sell_amount),
      sell_price_usd = COALESCE(EXCLUDED.sell_price_usd, scam_memes.sell_price_usd),
      ath_mcap = COALESCE(EXCLUDED.ath_mcap, scam_memes.ath_mcap),
      early_wallets_penalized = GREATEST(scam_memes.early_wallets_penalized, EXCLUDED.early_wallets_penalized),
      early_wallets_sus = GREATEST(scam_memes.early_wallets_sus, EXCLUDED.early_wallets_sus),
      metadata = COALESCE(EXCLUDED.metadata, scam_memes.metadata);
  `;
  await db.query(sql, [
    meme.mint,
    meme.chain || 'solana',
    meme.symbol || null,
    meme.name || null,
    meme.devWallet || null,
    meme.sellTx || null,
    meme.sellAmount ?? null,
    meme.sellPriceUsd ?? null,
    meme.athMcap ?? null,
    meme.earlyWalletsPenalized || 0,
    meme.earlyWalletsSus || 0,
    meme.metadata ? JSON.stringify(meme.metadata) : null,
  ]);
}

export async function fetchScamMemesDb(db, { limit = 100, offset = 0 } = {}) {
  if (!db) return [];
  const sql = `
    SELECT 
      mint, chain, symbol, name, dev_wallet AS "devWallet",
      sell_tx AS "sellTx", sell_amount AS "sellAmount",
      sell_price_usd AS "sellPriceUsd", ath_mcap AS "athMcap",
      early_wallets_penalized AS "earlyWalletsPenalized",
      early_wallets_sus AS "earlyWalletsSus",
      detected_at AS "detectedAt", metadata
    FROM scam_memes
    ORDER BY detected_at DESC
    LIMIT $1 OFFSET $2
  `;
  const { rows } = await db.query(sql, [limit, offset]);
  return rows;
}

export async function markWalletScamDb(db, { chain = 'solana', address, walletType = 'scam_wallet' }) {
  if (!db || !address) return;
  const norm = chain === 'robinhood' ? String(address).toLowerCase() : String(address);
  const sql = `
    INSERT INTO smart_wallets (chain, address, category, wallet_type, source, status, last_seen_at, updated_at)
    VALUES ($1, $2, 'tracked', $3, 'scam-detection', 'flagged', NOW(), NOW())
    ON CONFLICT (chain, address) DO UPDATE SET
      wallet_type = EXCLUDED.wallet_type,
      status = 'flagged',
      tags = array_append(smart_wallets.tags, EXCLUDED.wallet_type),
      updated_at = NOW();
  `;
  await db.query(sql, [chain, norm, walletType]);
}

export async function penalizeEarlyWalletDb(db, { chain = 'solana', address, isProfitable = false, scamMint }) {
  if (!db || !address) return;
  const norm = chain === 'robinhood' ? String(address).toLowerCase() : String(address);
  const retardInc = isProfitable ? 0 : 1;
  const susInc = isProfitable ? 1 : 0;
  const sql = `
    INSERT INTO smart_wallets (
      chain, address, category, source, retard_points, sus_wallet_points,
      scam_memes_involved, last_seen_at, updated_at
    ) VALUES (
      $1, $2, 'tracked', 'scam-analysis', $3, $4,
      ARRAY[$5]::TEXT[], NOW(), NOW()
    )
    ON CONFLICT (chain, address) DO UPDATE SET
      retard_points = smart_wallets.retard_points + $3,
      sus_wallet_points = smart_wallets.sus_wallet_points + $4,
      scam_memes_involved = array_append(smart_wallets.scam_memes_involved, $5),
      updated_at = NOW();
  `;
  await db.query(sql, [chain, norm, retardInc, susInc, scamMint]);
}
