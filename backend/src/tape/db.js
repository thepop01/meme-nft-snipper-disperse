import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createPool(connectionString = config.databaseUrl) {
  return new pg.Pool({ connectionString });
}

export async function migrate(db) {
  await db.query(readFileSync(join(here, 'schema.sql'), 'utf8'));

  // Pre-existing databases carry the old (source, signature, instruction_index) constraint,
  // which cannot dedupe NULL-signature scorer events. Swap it for the event_id identity.
  await db.query(`ALTER TABLE events DROP CONSTRAINT IF EXISTS events_identity`).catch(() => {});
  await db.query(`ALTER TABLE events ADD CONSTRAINT events_identity UNIQUE (event_id)`).catch(() => {});
}
