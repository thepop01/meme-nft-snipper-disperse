// Store raw events. Causal features are recomputed from this tape.
export class Tape {
  constructor(db) { this.db = db; }

  async append(event) {
    const result = await this.db.query(
      `INSERT INTO events
       (event_id, asset_key, type, chain_ts, received_at, slot, signature,
        instruction_index, source, schema_version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [event.eventId, event.assetKey, event.type, event.chainTs, event.receivedAt,
        event.slot, event.signature, event.instructionIndex ?? 0, event.source,
        event.schemaVersion, JSON.stringify(event.payload ?? {})],
    );
    return result.rowCount === 1;
  }

  async eventsUntil(assetKey, asOfChainTs, types = null) {
    let query = `SELECT * FROM events
      WHERE asset_key = $1 AND chain_ts <= $2`;
    const params = [assetKey, asOfChainTs];
    if (types?.length) {
      query += ` AND type IN (${types.map((_, i) => `$${i + 3}`).join(', ')})`;
      params.push(...types);
    }
    query += ' ORDER BY chain_ts, slot NULLS LAST, instruction_index';
    const { rows } = await this.db.query(query, params);
    return rows;
  }

  // Creator-cluster history for the shrinkage-adjusted developer feature.  Derived
  // lifecycle aggregates are added later; until then missing outcome facts stay null.
  async launchesByCreatorCluster(creators) {
    if (!creators?.length) return [];
    const { rows } = await this.db.query(
      `SELECT asset_key, chain_ts, payload FROM events
       WHERE type = 'token_created' AND payload->>'creator' IN (${creators.map((_, index) => `$${index + 1}`).join(', ')})
       ORDER BY chain_ts`, creators);
    return rows.map(row => ({ creationTs: Number(row.chain_ts), creator: row.payload.creator,
      maxMcap: null, finalMcap: null, collapseTs: null, athTs: null, migrationTs: null, devFirstSellTs: null }));
  }
}
