-- Append-only event tape. Store events, never derived conclusions.
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  asset_key TEXT NOT NULL,
  type TEXT NOT NULL,
  chain_ts BIGINT,
  received_at BIGINT NOT NULL,
  slot BIGINT,
  signature TEXT,
  instruction_index INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  -- Identity is event_id. A NULL signature (scorer-emitted events) makes a
  -- (source, signature, instruction_index) constraint inapplicable in Postgres,
  -- because every NULL compares distinct.
  CONSTRAINT events_identity UNIQUE (event_id)
);
CREATE INDEX IF NOT EXISTS events_asset_chain_ts
  ON events (asset_key, chain_ts, slot, instruction_index);
-- Chain-event lookup by provider identity (non-unique: NULL signatures are permitted).
CREATE INDEX IF NOT EXISTS events_source_signature
  ON events (source, signature, instruction_index);

-- TimescaleDB-ready: create_hypertable('events', 'chain_ts', if_not_exists => TRUE)
