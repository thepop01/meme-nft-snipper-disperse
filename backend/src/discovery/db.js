// PostgreSQL persistence for meme tokens (Solana + EVM).
// Stores up to 100k+ / millions of meme tokens in Docker bot-postgres.
import { log } from '../bus.js';

export async function initMemeTokensTable(db) {
  if (!db) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS meme_tokens (
      chain VARCHAR(32) NOT NULL,
      mint VARCHAR(128) NOT NULL,
      symbol VARCHAR(64),
      name VARCHAR(128),
      decimals INT DEFAULT 9,
      price_usd DOUBLE PRECISION DEFAULT 0,
      liquidity_usd DOUBLE PRECISION DEFAULT 0,
      market_cap_usd DOUBLE PRECISION DEFAULT 0,
      volume_5m_usd DOUBLE PRECISION DEFAULT 0,
      volume_1h_usd DOUBLE PRECISION DEFAULT 0,
      volume_24h_usd DOUBLE PRECISION DEFAULT 0,
      txns_5m_buys INT DEFAULT 0,
      txns_5m_sells INT DEFAULT 0,
      traction_score INT DEFAULT 0,
      safety_score INT DEFAULT 0,
      state VARCHAR(32) DEFAULT 'watching',
      source VARCHAR(64) DEFAULT 'live',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB,
      PRIMARY KEY (chain, mint)
    );

    CREATE INDEX IF NOT EXISTS idx_meme_tokens_chain ON meme_tokens(chain);
    CREATE INDEX IF NOT EXISTS idx_meme_tokens_state ON meme_tokens(state);
    CREATE INDEX IF NOT EXISTS idx_meme_tokens_mcap ON meme_tokens(market_cap_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_meme_tokens_volume5m ON meme_tokens(volume_5m_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_meme_tokens_liquidity ON meme_tokens(liquidity_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_meme_tokens_created ON meme_tokens(created_at DESC);
  `;
  try {
    await db.query(sql);
    log('info', '[meme-tokens] PostgreSQL meme_tokens table ready (100k+ capacity)');
  } catch (err) {
    log('warn', `[meme-tokens] Failed to init meme_tokens table: ${err.message}`);
  }
}

export async function upsertMemeTokensDb(db, tokens = []) {
  if (!db || !tokens.length) return 0;
  let count = 0;
  for (const t of tokens) {
    const mint = t.mint || t.address;
    const chain = t.chain || 'solana';
    if (!mint) continue;

    const query = `
      INSERT INTO meme_tokens (
        chain, mint, symbol, name, decimals, price_usd, liquidity_usd,
        market_cap_usd, volume_5m_usd, volume_1h_usd, volume_24h_usd,
        txns_5m_buys, txns_5m_sells, traction_score, safety_score,
        state, source, created_at, updated_at, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17,
        to_timestamp($18 / 1000.0), NOW(), $19
      )
      ON CONFLICT (chain, mint) DO UPDATE SET
        symbol = COALESCE(EXCLUDED.symbol, meme_tokens.symbol),
        name = COALESCE(EXCLUDED.name, meme_tokens.name),
        price_usd = EXCLUDED.price_usd,
        liquidity_usd = EXCLUDED.liquidity_usd,
        market_cap_usd = EXCLUDED.market_cap_usd,
        volume_5m_usd = EXCLUDED.volume_5m_usd,
        volume_1h_usd = EXCLUDED.volume_1h_usd,
        volume_24h_usd = EXCLUDED.volume_24h_usd,
        txns_5m_buys = EXCLUDED.txns_5m_buys,
        txns_5m_sells = EXCLUDED.txns_5m_sells,
        traction_score = EXCLUDED.traction_score,
        safety_score = EXCLUDED.safety_score,
        state = EXCLUDED.state,
        source = COALESCE(EXCLUDED.source, meme_tokens.source),
        updated_at = NOW(),
        metadata = EXCLUDED.metadata;
    `;

    const values = [
      chain,
      mint,
      t.symbol || null,
      t.name || null,
      Number(t.decimals || 9),
      Number(t.priceUsd || t.price || 0),
      Number(t.liquidityUsd || t.liquidity || 0),
      Number(t.marketCapUsd || t.marketCap || 0),
      Number(t.volume5mUsd || t.volume?.m5 || 0),
      Number(t.volume1hUsd || t.volume?.h1 || 0),
      Number(t.volume24hUsd || t.volume?.h24 || 0),
      Number(t.txns?.m5?.buys || 0),
      Number(t.txns?.m5?.sells || 0),
      Number(t.traction?.tractionScore || 0),
      Number(t.safety?.score || 0),
      t.state || 'watching',
      t.source || 'live',
      Number(t.createdAt || Date.now()),
      JSON.stringify(t),
    ];

    try {
      await db.query(query, values);
      count++;
    } catch (err) {
      // ignore individual duplicate/parse error
    }
  }
  return count;
}

export async function countMemeTokensInDb(db, { chain = null, view = null } = {}) {
  if (!db) return 0;
  const conditions = [];
  const params = [];
  if (chain) {
    params.push(chain);
    conditions.push(`chain = $${params.length}`);
  }
  if (view === 'curated') {
    conditions.push(`state = 'curated'`);
  } else if (view && view !== 'all' && view !== 'discovered') {
    conditions.push(`state != 'discarded'`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await db.query(`SELECT COUNT(*) as count FROM meme_tokens ${where}`, params);
  return Number(res.rows[0]?.count || 0);
}
