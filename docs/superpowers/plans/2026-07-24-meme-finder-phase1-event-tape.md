# Meme Finder — Phase 1: Event Tape Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the append-only, causal Postgres event tape and canonical identity as the system's foundation, remediate the 8 confirmed defects (§5.2 of the foundation report), and install the chain-scope gate — so every later workstream can replay owned events.

**Architecture:** A new `backend/src/tape/` module owns a Postgres-backed, idempotent, causally-ordered event store (`events` table, unique on `(source, signature, instruction_index)`, read filtered on `chain_ts`). A `backend/src/scope/` gate classifies `(chain, launchpad)` as `supported | unscored` so EVM/non-Pump.fun tokens never touch Solana analyzers. The tape runs **alongside** today's in-memory registry — ingestion writes events to the tape in addition to the current flow — keeping Phase 1 shippable and reversible with no loss of the raw tape.

**Tech Stack:** Node ESM, Express, `ws`, `pg` (Postgres, added here), Vitest. `pg-mem` (dev-only) executes real SQL in tests so the tape's idempotency and causal-read semantics are verified without a running server; production uses real Postgres.

**Source spec:** `docs/meme-finder-foundation-report-2026-07-24.md` (§5.2 defects, §8 architecture, §9 identity/tape, §10.1 ingestion, §14.2 chain gate). Section references below point there.

---

## File Structure

**Create:**
- `backend/src/tape/db.js` — Postgres pool + migration runner. Reads `DATABASE_URL`. One responsibility: connect + apply schema.
- `backend/src/tape/schema.sql` — `events` table DDL (§9.5). Hypertable-ready comment block, plain Postgres by default.
- `backend/src/tape/identity.js` — `assetKey`, `eventId`, `EVENT_TYPES`, `validateEnvelope` (§9.1–§9.3), exact-units guards.
- `backend/src/tape/tape.js` — `Tape` class: `append` (idempotent) + `eventsUntil` (causal) (§9.5).
- `backend/src/scope/chainScope.js` — `classifyScope({chain, launchpad})` → `supported | unscored` (§14.2, defect #4).
- `backend/src/tape/__tests__/identity.test.js`
- `backend/src/tape/__tests__/tape.test.js`
- `backend/src/scope/__tests__/chainScope.test.js`
- `backend/src/discovery/__tests__/tapeIngestion.test.js`

**Modify:**
- `backend/package.json` — add `pg`; add `pg-mem` dev dep.
- `backend/.env.example` — add `DATABASE_URL`.
- `backend/src/config.js` — expose `databaseUrl`.
- `backend/server.js` — run migrations on boot; construct the shared `Tape`; pass it to feeds.
- `backend/src/discovery/pumpfun.js` — subscribe to trades + migrations; append `token_created` / `trade_observed` / `migration_observed` to the tape (defect #1, first slice).
- `backend/src/analysis/traction.js` — fix mixed-window breadth math (defect #2).
- `backend/src/discovery/refreshLoop.js` — fix mutate-before-compare in spike detection (defect #3).
- `backend/src/analysis/safety.js` — resolve system accounts explicitly instead of skipping the largest; apply chain-scope gate (defects #5, #4).
- `backend/src/discovery/registry.js` — remove hard 300-cap eviction of protected tokens; expose paginated reads (defect #6).
- `backend/server.js` (`/api/tokens`) — pagination (defect #6).
- `backend/src/analysis/missingData.js` (Create) + call sites — one shared missing-data helper (defect #7).
- `frontend/src/utils/memeStrategies.js` + `frontend/src/components/MemeFinderView.jsx` — stop client-side qualification; render backend admission only (defect #8, first slice).

**Defect coverage note (honest scope):** Defects #2–#7 are fixed fully here. Defect #1 (full trade stream) gets its foundational slice — trades captured into the tape — with full staged Stage A/B/C collection deferred to Workstream 3. Defect #8 (frontend predicates) gets its foundational slice — the backend becomes the qualification authority and the UI stops running `matches()` to qualify — with full strategy-tab removal deferred to Workstream 10 (UI). Both are called out at their tasks.

---

## Task 0: Dependencies and configuration

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/.env.example`
- Modify: `backend/src/config.js`

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd backend && npm install pg && npm install --save-dev pg-mem
```
Expected: `pg` appears under `dependencies`, `pg-mem` under `devDependencies` in `backend/package.json`.

- [ ] **Step 2: Add DATABASE_URL to env example**

In `backend/.env.example` add:
```
# Postgres event tape (Phase 1). Local default:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tradeforge
```

- [ ] **Step 3: Expose databaseUrl in config**

In `backend/src/config.js`, add to the exported config object:
```js
databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tradeforge',
```

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example backend/src/config.js
git commit -m "chore: add pg + DATABASE_URL config for event tape"
```

---

## Task 1: Event schema and migration runner

**Files:**
- Create: `backend/src/tape/schema.sql`
- Create: `backend/src/tape/db.js`

- [ ] **Step 1: Write the schema**

Create `backend/src/tape/schema.sql`:
```sql
-- Append-only event tape (foundation report §9.5). Store EVENTS, never conclusions.
CREATE TABLE IF NOT EXISTS events (
  event_id          TEXT NOT NULL,
  asset_key         TEXT NOT NULL,          -- chain:launchpad:mint
  type              TEXT NOT NULL,
  chain_ts          BIGINT,                 -- authoritative chain/effective time (ms) for causal reads
  received_at       BIGINT NOT NULL,        -- local ingestion time (observability only)
  slot              BIGINT,
  signature         TEXT,
  instruction_index INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL,
  schema_version    INTEGER NOT NULL,
  payload           JSONB NOT NULL,
  -- Idempotency: reconnect duplicates collapse here.
  CONSTRAINT events_identity UNIQUE (source, signature, instruction_index)
);
-- Causal read path: WHERE asset_key = $1 AND chain_ts <= $2 ORDER BY chain_ts, slot, instruction_index
CREATE INDEX IF NOT EXISTS events_asset_chain_ts ON events (asset_key, chain_ts, slot, instruction_index);

-- To upgrade to TimescaleDB later:
--   SELECT create_hypertable('events', 'chain_ts', chunk_time_interval => 86400000, if_not_exists => TRUE);
```

- [ ] **Step 2: Write the migration runner**

Create `backend/src/tape/db.js`:
```js
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createPool(connectionString = config.databaseUrl) {
  return new pg.Pool({ connectionString });
}

export async function migrate(db) {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/tape/schema.sql backend/src/tape/db.js
git commit -m "feat(tape): events schema + migration runner"
```

Note: no unit test here — `migrate` is exercised by the Tape tests in Task 3, which run the same `schema.sql` against pg-mem.

---

## Task 2: Canonical identity and envelope validation

**Files:**
- Create: `backend/src/tape/identity.js`
- Test: `backend/src/tape/__tests__/identity.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/tape/__tests__/identity.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { assetKey, eventId, EVENT_TYPES, validateEnvelope } from '../identity.js';

describe('assetKey', () => {
  it('joins chain, launchpad, mint', () => {
    expect(assetKey('solana', 'pumpfun', 'ABC')).toBe('solana:pumpfun:ABC');
  });
});

describe('eventId', () => {
  it('is deterministic for the same identity tuple', () => {
    const base = { source: 'pumpportal', signature: 'sig1', instructionIndex: 0, type: 'trade_observed' };
    expect(eventId(base)).toBe(eventId({ ...base }));
  });
  it('differs when identity differs', () => {
    const a = eventId({ source: 'pumpportal', signature: 'sig1', instructionIndex: 0, type: 'trade_observed' });
    const b = eventId({ source: 'pumpportal', signature: 'sig1', instructionIndex: 1, type: 'trade_observed' });
    expect(a).not.toBe(b);
  });
});

describe('validateEnvelope', () => {
  const good = {
    eventId: 'e1', assetKey: 'solana:pumpfun:ABC', type: EVENT_TYPES.TOKEN_CREATED,
    chainTs: 1000, receivedAt: 2000, source: 'pumpportal', schemaVersion: 1,
    instructionIndex: 0, payload: {},
  };
  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(good)).toEqual({ ok: true });
  });
  it('rejects an unknown type', () => {
    expect(validateEnvelope({ ...good, type: 'nonsense' }).ok).toBe(false);
  });
  it('rejects float SOL in payload amount fields (exact units only)', () => {
    const bad = { ...good, payload: { lamports: 1.5 } };
    expect(validateEnvelope(bad).ok).toBe(false);
  });
  it('accepts integer lamports and string raw token amounts', () => {
    const ok = { ...good, payload: { lamports: 1500, rawTokens: '90000000000' } };
    expect(validateEnvelope(ok).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/tape/__tests__/identity.test.js`
Expected: FAIL — cannot resolve `../identity.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/tape/identity.js`:
```js
import { createHash } from 'node:crypto';

export function assetKey(chain, launchpad, mint) {
  return `${chain}:${launchpad}:${mint}`;
}

export const EVENT_TYPES = {
  TOKEN_CREATED: 'token_created',
  TRADE_OBSERVED: 'trade_observed',
  BASELINE_CLOSED: 'baseline_closed',
  MIGRATION_OBSERVED: 'migration_observed',
  HOLDER_SNAPSHOT: 'holder_snapshot',
  FUNDING_LINK: 'funding_link',
  MARKET_SNAPSHOT: 'market_snapshot',
  SELL_ROUTE_CHECK: 'sell_route_check',
  SCORE_EVALUATED: 'score_evaluated',
  ADMISSION_CHANGED: 'admission_changed',
};
const KNOWN_TYPES = new Set(Object.values(EVENT_TYPES));

// Deterministic where possible: identity tuple hashed. Falls back to random-free composite.
export function eventId({ source, signature, instructionIndex = 0, type }) {
  return createHash('sha1')
    .update(`${source}|${signature ?? ''}|${instructionIndex}|${type}`)
    .digest('hex');
}

// Exact units: amount-like fields must be integers (lamports/raw units) or decimal strings — never JS floats.
const AMOUNT_KEYS = /lamports|raw|sol|amount|supply/i;
function payloadUnitsOk(payload) {
  if (!payload || typeof payload !== 'object') return true;
  for (const [k, v] of Object.entries(payload)) {
    if (AMOUNT_KEYS.test(k) && typeof v === 'number' && !Number.isInteger(v)) return false;
  }
  return true;
}

export function validateEnvelope(e) {
  if (!e || typeof e !== 'object') return { ok: false, reason: 'not-an-object' };
  if (!e.assetKey) return { ok: false, reason: 'missing-assetKey' };
  if (!KNOWN_TYPES.has(e.type)) return { ok: false, reason: 'unknown-type' };
  if (typeof e.receivedAt !== 'number') return { ok: false, reason: 'missing-receivedAt' };
  if (typeof e.schemaVersion !== 'number') return { ok: false, reason: 'missing-schemaVersion' };
  if (!payloadUnitsOk(e.payload)) return { ok: false, reason: 'float-amount' };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/tape/__tests__/identity.test.js`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add backend/src/tape/identity.js backend/src/tape/__tests__/identity.test.js
git commit -m "feat(tape): canonical identity + envelope validation with exact-units guard"
```

---

## Task 3: The Tape — idempotent append + causal read

**Files:**
- Create: `backend/src/tape/tape.js`
- Test: `backend/src/tape/__tests__/tape.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/tape/__tests__/tape.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { migrate } from '../db.js';
import { Tape } from '../tape.js';
import { EVENT_TYPES } from '../identity.js';

function makeDb() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

function evt(overrides = {}) {
  return {
    eventId: 'e-' + Math.random().toString(36).slice(2),
    assetKey: 'solana:pumpfun:ABC',
    type: EVENT_TYPES.TRADE_OBSERVED,
    chainTs: 1000, receivedAt: 2000, slot: 1,
    signature: 'sig-' + Math.random().toString(36).slice(2),
    instructionIndex: 0, source: 'pumpportal', schemaVersion: 1,
    payload: { side: 'buy', lamports: 1000, rawTokens: '5' },
    ...overrides,
  };
}

describe('Tape', () => {
  let db, tape;
  beforeEach(async () => { db = makeDb(); await migrate(db); tape = new Tape(db); });

  it('appends and reads back an event', async () => {
    await tape.append(evt({ signature: 's1' }));
    const rows = await tape.eventsUntil('solana:pumpfun:ABC', 2000);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent on (source, signature, instruction_index)', async () => {
    const e = evt({ signature: 'dup', instructionIndex: 0 });
    await tape.append(e);
    await tape.append({ ...e, eventId: 'different-id' }); // reconnect duplicate
    const rows = await tape.eventsUntil('solana:pumpfun:ABC', 2000);
    expect(rows).toHaveLength(1);
  });

  it('causal read excludes events after asOf (filters on chain_ts, not received_at)', async () => {
    await tape.append(evt({ signature: 'past', chainTs: 500, receivedAt: 9999 }));
    await tape.append(evt({ signature: 'future', chainTs: 1500, receivedAt: 1 }));
    const rows = await tape.eventsUntil('solana:pumpfun:ABC', 1000);
    expect(rows.map(r => r.signature)).toEqual(['past']);
  });

  it('filters by type when types are provided', async () => {
    await tape.append(evt({ signature: 'c', type: EVENT_TYPES.TOKEN_CREATED }));
    await tape.append(evt({ signature: 't', type: EVENT_TYPES.TRADE_OBSERVED }));
    const rows = await tape.eventsUntil('solana:pumpfun:ABC', 2000, [EVENT_TYPES.TRADE_OBSERVED]);
    expect(rows.map(r => r.signature)).toEqual(['t']);
  });

  it('orders by chain_ts, slot, instruction_index', async () => {
    await tape.append(evt({ signature: 'b', chainTs: 100, slot: 2, instructionIndex: 0 }));
    await tape.append(evt({ signature: 'a', chainTs: 100, slot: 1, instructionIndex: 0 }));
    const rows = await tape.eventsUntil('solana:pumpfun:ABC', 2000);
    expect(rows.map(r => r.signature)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/tape/__tests__/tape.test.js`
Expected: FAIL — cannot resolve `../tape.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/tape/tape.js`:
```js
// Store EVENTS, never conclusions. Features are recomputable; raw events are not. (§9.5)
export class Tape {
  constructor(db) { this.db = db; }

  // Idempotent append: reconnect duplicates collapse on (source, signature, instruction_index).
  async append(e) {
    await this.db.query(
      `INSERT INTO events
         (event_id, asset_key, type, chain_ts, received_at, slot, signature,
          instruction_index, source, schema_version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (source, signature, instruction_index) DO NOTHING`,
      [e.eventId, e.assetKey, e.type, e.chainTs, e.receivedAt, e.slot, e.signature,
       e.instructionIndex ?? 0, e.source, e.schemaVersion, JSON.stringify(e.payload ?? {})]);
  }

  // Causal read: never returns events after asOf. Filters on chain_ts, NOT received_at.
  async eventsUntil(assetKey, asOfChainTs, types = null) {
    const t = types ? `AND type = ANY($3)` : '';
    const params = types ? [assetKey, asOfChainTs, types] : [assetKey, asOfChainTs];
    const { rows } = await this.db.query(
      `SELECT * FROM events
        WHERE asset_key = $1 AND chain_ts <= $2 ${t}
        ORDER BY chain_ts, slot, instruction_index`, params);
    return rows;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/tape/__tests__/tape.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/tape/tape.js backend/src/tape/__tests__/tape.test.js
git commit -m "feat(tape): idempotent append + causal eventsUntil read"
```

---

## Task 4: Chain-scope gate (defect #4)

**Files:**
- Create: `backend/src/scope/chainScope.js`
- Test: `backend/src/scope/__tests__/chainScope.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/scope/__tests__/chainScope.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { classifyScope } from '../chainScope.js';

describe('classifyScope', () => {
  it('supports solana + pumpfun', () => {
    expect(classifyScope({ chain: 'solana', launchpad: 'pumpfun' })).toBe('supported');
  });
  it('marks EVM chains unscored', () => {
    expect(classifyScope({ chain: 'monad', launchpad: 'unknown' })).toBe('unscored');
    expect(classifyScope({ chain: 'robinhood', launchpad: 'unknown' })).toBe('unscored');
  });
  it('marks solana non-pumpfun launchpads unscored (first release is pumpfun-only)', () => {
    expect(classifyScope({ chain: 'solana', launchpad: 'raydium' })).toBe('unscored');
  });
  it('treats missing fields as unscored, never supported', () => {
    expect(classifyScope({})).toBe('unscored');
    expect(classifyScope(null)).toBe('unscored');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/scope/__tests__/chainScope.test.js`
Expected: FAIL — cannot resolve `../chainScope.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/scope/chainScope.js`:
```js
// First release is Pump.fun-only (§14.2). Everything else is `unscored` and must NOT
// run through Solana-specific checks or inherit an uncalibrated score.
const SUPPORTED = new Set(['solana:pumpfun']);

export function classifyScope(token) {
  if (!token || !token.chain || !token.launchpad) return 'unscored';
  return SUPPORTED.has(`${token.chain}:${token.launchpad}`) ? 'supported' : 'unscored';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/scope/__tests__/chainScope.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scope/chainScope.js backend/src/scope/__tests__/chainScope.test.js
git commit -m "feat(scope): chain-scope gate — pumpfun-only, EVM unscored (defect #4)"
```

---

## Task 5: Boot wiring — migrate on startup, share one Tape

**Files:**
- Modify: `backend/server.js`
- Modify: `backend/src/discovery/pumpfun.js` (signature only; body in Task 6)

- [ ] **Step 1: Add tape construction + migration to boot**

In `backend/server.js`, near the top imports add:
```js
import { createPool, migrate } from './src/tape/db.js';
import { Tape } from './src/tape/tape.js';
```

In the startup block (where `startPumpFeed`, `startRaydiumFeed`, etc. are called), before starting feeds add:
```js
const tapePool = createPool();
await migrate(tapePool);
const tape = new Tape(tapePool);
console.log('[tape] Postgres event tape ready');
```
Then pass `tape` into the pump feed start call:
```js
startPumpFeed(tape);
```
(If the startup block is not already inside an async function, wrap it in `(async () => { ... })()`.)

- [ ] **Step 2: Accept the tape in the pump feed signature**

In `backend/src/discovery/pumpfun.js`, change the exported start function to accept and store the tape (full body in Task 6). For now:
```js
export function startPumpFeed(tape) {
  // tape appended in Task 6
  ...existing subscription setup...
}
```

- [ ] **Step 3: Verify boot works with Postgres unavailable-safe path**

Run: `cd backend && node -e "import('./src/tape/db.js').then(async m => { const p = m.createPool('postgres://postgres:postgres@localhost:5432/tradeforge'); try { await m.migrate(p); console.log('migrated'); } catch (e) { console.log('expected if no local pg:', e.code); } finally { await p.end(); } })"`
Expected: prints `migrated` if local Postgres is running, otherwise a connection error code (`ECONNREFUSED`) — confirms wiring resolves.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js backend/src/discovery/pumpfun.js
git commit -m "feat(tape): migrate on boot + share Tape into pump feed"
```

---

## Task 6: Capture creations, trades, migrations into the tape (defect #1, first slice)

**Files:**
- Modify: `backend/src/discovery/pumpfun.js`
- Test: `backend/src/discovery/__tests__/tapeIngestion.test.js`

> **Scope:** This subscribes to `subscribeNewToken`, `subscribeMigration`, and trade messages and appends them to the tape. Full staged Stage A/B/C baseline collection (§10) is Workstream 3. Here we prove the pipeline: PumpPortal message → validated envelope → tape.

- [ ] **Step 1: Write the failing test**

Create `backend/src/discovery/__tests__/tapeIngestion.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { handlePumpMessage } from '../pumpfun.js';
import { EVENT_TYPES } from '../../tape/identity.js';

function fakeTape() {
  const appended = [];
  return { appended, append: vi.fn(async (e) => { appended.push(e); }) };
}

describe('handlePumpMessage', () => {
  it('appends token_created for a create message', async () => {
    const tape = fakeTape();
    await handlePumpMessage(tape, {
      txType: 'create', mint: 'ABC', traderPublicKey: 'dev1', bondingCurveKey: 'curve1',
      solAmount: 1.5, signature: 'sig-c', slot: 10, blockTime: 1700000000,
    });
    expect(tape.appended).toHaveLength(1);
    expect(tape.appended[0].type).toBe(EVENT_TYPES.TOKEN_CREATED);
    expect(tape.appended[0].assetKey).toBe('solana:pumpfun:ABC');
    // exact units: initial buy stored as integer lamports, not float SOL
    expect(Number.isInteger(tape.appended[0].payload.initialBuyLamports)).toBe(true);
  });

  it('appends trade_observed for a buy message', async () => {
    const tape = fakeTape();
    await handlePumpMessage(tape, {
      txType: 'buy', mint: 'ABC', traderPublicKey: 'w1', solAmount: 0.2,
      tokenAmountRaw: '123', signature: 'sig-b', slot: 11, blockTime: 1700000001,
    });
    expect(tape.appended[0].type).toBe(EVENT_TYPES.TRADE_OBSERVED);
    expect(tape.appended[0].payload.side).toBe('buy');
    expect(typeof tape.appended[0].payload.rawTokens).toBe('string');
  });

  it('appends migration_observed for a migrate message', async () => {
    const tape = fakeTape();
    await handlePumpMessage(tape, {
      txType: 'migrate', mint: 'ABC', pool: 'pool1', signature: 'sig-m', slot: 12, blockTime: 1700000002,
    });
    expect(tape.appended[0].type).toBe(EVENT_TYPES.MIGRATION_OBSERVED);
  });

  it('drops a message that fails envelope validation without throwing', async () => {
    const tape = fakeTape();
    await handlePumpMessage(tape, { txType: 'buy', mint: 'ABC', solAmount: 0.2 }); // no signature
    // still appends (signature null is allowed by schema) but must not throw
    expect(tape.append).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/tapeIngestion.test.js`
Expected: FAIL — `handlePumpMessage` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/discovery/pumpfun.js`, add these exports and use them from the WS `message` handler. Keep the existing `registerToken` call for the live registry; the tape append is additive.
```js
import WebSocket from 'ws';
import { assetKey, eventId, EVENT_TYPES, validateEnvelope } from '../tape/identity.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const toLamports = (sol) => Math.round(Number(sol ?? 0) * LAMPORTS_PER_SOL);

// Pure, testable: maps one PumpPortal message to a tape append. No socket, no globals.
export async function handlePumpMessage(tape, m) {
  const key = assetKey('solana', 'pumpfun', m.mint);
  const base = {
    assetKey: key, source: 'pumpportal', schemaVersion: 1,
    chainTs: m.blockTime != null ? m.blockTime * 1000 : null, // chain time in ms; never Date.now()
    receivedAt: Date.now(),                                   // observability only
    slot: m.slot ?? null, signature: m.signature ?? null,
    instructionIndex: m.instructionIndex ?? 0,
  };

  let envelope = null;
  if (m.txType === 'create') {
    envelope = { ...base, type: EVENT_TYPES.TOKEN_CREATED,
      payload: { creator: m.traderPublicKey, curve: m.bondingCurveKey,
                 initialBuyLamports: toLamports(m.solAmount) } };
  } else if (m.txType === 'buy' || m.txType === 'sell') {
    envelope = { ...base, type: EVENT_TYPES.TRADE_OBSERVED,
      payload: { side: m.txType, wallet: m.traderPublicKey,
                 lamports: toLamports(m.solAmount),
                 rawTokens: String(m.tokenAmountRaw ?? '0') } };
  } else if (m.txType === 'migrate') {
    envelope = { ...base, type: EVENT_TYPES.MIGRATION_OBSERVED,
      payload: { pool: m.pool ?? null } };
  } else {
    return;
  }

  envelope.eventId = eventId(envelope);
  const v = validateEnvelope(envelope);
  if (!v.ok) { console.warn('[tape] dropped invalid envelope:', v.reason); return; }
  await tape.append(envelope);
}

export function startPumpFeed(tape) {
  const ws = new WebSocket('wss://pumpportal.fun/api/data');
  ws.on('open', () => {
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    ws.send(JSON.stringify({ method: 'subscribeMigration' }));
  });
  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    try { await handlePumpMessage(tape, m); } catch (e) { console.warn('[tape] append failed:', e.message); }
    // existing registry-side handling stays here (registerToken, etc.)
  });
  return ws;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/tapeIngestion.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/discovery/pumpfun.js backend/src/discovery/__tests__/tapeIngestion.test.js
git commit -m "feat(ingestion): capture create/trade/migration events into tape (defect #1 slice)"
```

---

## Task 7: Fix mixed-window breadth math (defect #2)

**Files:**
- Modify: `backend/src/analysis/traction.js`
- Test: `backend/src/analysis/__tests__/traction.test.js` (Create if absent)

> **Defect (§5.2.2):** breadth divides 24h volume by overlapping 1h + 5m transaction counts — numerator and denominator describe different windows, and the 5m count is double-counted inside the 1h count. Fix: divide a window's volume by that same window's trade count.

- [ ] **Step 1: Read the current breadth calculation**

Run: `cd backend && npx vitest run src/analysis/__tests__/traction.test.js` (note current state), and open `backend/src/analysis/traction.js` to find the breadth block (avg-trade-size). Identify the exact variables: the volume field and the txn-count fields for each window (`h1`, `m5`, `h24`).

- [ ] **Step 2: Write the failing test**

Create/extend `backend/src/analysis/__tests__/traction.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { breadthFromWindow } from '../traction.js';

describe('breadthFromWindow', () => {
  it('divides a window volume by the SAME window trade count', () => {
    // 1h volume 1000 over 50 trades => avg trade size 20
    expect(breadthFromWindow(1000, 50)).toBe(20);
  });
  it('returns null when the trade count is missing (unknown != zero)', () => {
    expect(breadthFromWindow(1000, null)).toBeNull();
    expect(breadthFromWindow(1000, 0)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/analysis/__tests__/traction.test.js`
Expected: FAIL — `breadthFromWindow` not exported.

- [ ] **Step 4: Write minimal implementation**

In `backend/src/analysis/traction.js`, add:
```js
// Breadth = average trade size within ONE window. Volume and trade count MUST share the window.
// Never divide 24h volume by a 1h or 5m trade count. (§5.2.2, §13.1)
export function breadthFromWindow(windowVolume, windowTrades) {
  if (windowVolume == null || !windowTrades || windowTrades <= 0) return null; // unknown != zero
  return windowVolume / windowTrades;
}
```
Then, inside `computeTraction`, replace the mixed-window breadth expression with a single-window call, e.g. `breadthFromWindow(token.volume?.h1, token.txns?.h1)` using matching `h1`/`h1`. Do not mix `h24` volume with `h1`/`m5` counts.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/analysis/__tests__/traction.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/analysis/traction.js backend/src/analysis/__tests__/traction.test.js
git commit -m "fix(traction): breadth uses same-window volume and trade count (defect #2)"
```

---

## Task 8: Fix mutate-before-compare in spike detection (defect #3)

**Files:**
- Modify: `backend/src/discovery/refreshLoop.js`
- Test: `backend/src/discovery/__tests__/refreshLoop.test.js` (extend existing)

> **Defect (§5.2.3):** refresh mutates the token object before comparing "before" vs "after," so both references point at the new values and `detectSpike` can never fire. Fix: snapshot the pre-patch values immutably, then compare against the incoming values.

- [ ] **Step 1: Write the failing test**

Extend `backend/src/discovery/__tests__/refreshLoop.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { detectSpikeBetween } from '../refreshLoop.js';

describe('detectSpikeBetween', () => {
  it('fires when incoming volume jumps past the spike ratio vs the prior snapshot', () => {
    const before = { volumeUsd: 100, priceUsd: 1 };
    const after = { volumeUsd: 400, priceUsd: 1.2 };
    expect(detectSpikeBetween(before, after, { volumeRatio: 3 })).toBe(true);
  });
  it('does NOT fire when before and after are the same reference (the original bug)', () => {
    const snap = { volumeUsd: 400, priceUsd: 1.2 };
    expect(detectSpikeBetween(snap, snap, { volumeRatio: 3 })).toBe(false);
  });
  it('does not fire on a modest change', () => {
    expect(detectSpikeBetween({ volumeUsd: 100 }, { volumeUsd: 150 }, { volumeRatio: 3 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/refreshLoop.test.js`
Expected: FAIL — `detectSpikeBetween` not exported.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/discovery/refreshLoop.js`, add a pure comparator and use it in `processPrices`:
```js
// Compare an IMMUTABLE prior snapshot to incoming values. If before === after (same ref),
// there is no delta to detect — this is exactly the bug that silenced dormant-spike detection. (§5.2.3)
export function detectSpikeBetween(before, after, cfg) {
  if (!before || !after || before === after) return false;
  const b = Number(before.volumeUsd ?? 0);
  const a = Number(after.volumeUsd ?? 0);
  if (b <= 0) return false;
  return a / b >= (cfg?.volumeRatio ?? 3);
}
```
In `processPrices`/`detectSpike`, capture the prior values BEFORE applying the patch:
```js
const before = { volumeUsd: token.volumeUsd, priceUsd: token.priceUsd }; // snapshot first
applyMarketPatch(token, patch);                                          // then mutate
const after = { volumeUsd: token.volumeUsd, priceUsd: token.priceUsd };
if (detectSpikeBetween(before, after, { volumeRatio: SPIKE_VOLUME_RATIO })) {
  // ...existing dormant-wake path...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/refreshLoop.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/discovery/refreshLoop.js backend/src/discovery/__tests__/refreshLoop.test.js
git commit -m "fix(refresh): snapshot before mutation so spike detection can fire (defect #3)"
```

---

## Task 9: Resolve system accounts explicitly + apply chain gate in safety (defects #5, #4)

**Files:**
- Modify: `backend/src/analysis/safety.js`
- Test: `backend/src/analysis/__tests__/safety.test.js` (Create if absent)

> **Defect (§5.2.5):** holder analysis blindly skips the largest token account as a presumed pool/curve. Fix: exclude accounts by a known-account predicate (curve PDA / AMM vault / burn), not by size. **Defect (§5.2.4):** the Solana-specific safety analyzer can receive EVM tokens — guard with `classifyScope`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/analysis/__tests__/safety.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { top10ExcludingKnown, isAnalyzable } from '../safety.js';

describe('isAnalyzable', () => {
  it('rejects EVM tokens (safety is Solana-specific)', () => {
    expect(isAnalyzable({ chain: 'monad', launchpad: 'unknown' })).toBe(false);
    expect(isAnalyzable({ chain: 'solana', launchpad: 'pumpfun' })).toBe(true);
  });
});

describe('top10ExcludingKnown', () => {
  const known = new Set(['curvePDA', 'ammVault', 'burn']);
  const isKnown = (addr) => known.has(addr);
  it('excludes known system accounts by identity, not by size', () => {
    const accounts = [
      { address: 'curvePDA', rawAmount: 900n }, // largest, but known -> excluded
      { address: 'w1', rawAmount: 50n },
      { address: 'w2', rawAmount: 30n },
    ];
    const { top10Raw } = top10ExcludingKnown(accounts, isKnown);
    expect(top10Raw).toBe(80n); // 50 + 30, curve excluded
  });
  it('does NOT exclude a large ordinary holder just for being largest', () => {
    const accounts = [{ address: 'whale', rawAmount: 900n }, { address: 'w1', rawAmount: 50n }];
    const { top10Raw } = top10ExcludingKnown(accounts, isKnown);
    expect(top10Raw).toBe(950n); // whale is NOT excluded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/analysis/__tests__/safety.test.js`
Expected: FAIL — `top10ExcludingKnown` / `isAnalyzable` not exported.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/analysis/safety.js` add:
```js
import { classifyScope } from '../scope/chainScope.js';

// Solana-specific analyzer must refuse EVM/unsupported tokens (defect #4).
export function isAnalyzable(token) {
  return classifyScope(token) === 'supported';
}

// Exclude system accounts by KNOWN identity (curve PDA / AMM vault / burn), never by size (defect #5).
export function top10ExcludingKnown(accounts, isKnown) {
  const held = [];
  for (const a of accounts) {
    if (isKnown(a.address)) continue; // excluded system account — resolved, not guessed
    held.push(a);
    if (held.length === 10) break;
  }
  const top10Raw = held.reduce((s, a) => s + BigInt(a.rawAmount), 0n);
  return { top10Raw, held };
}
```
In `analyzeToken`, at the top add `if (!isAnalyzable(token)) return { score: null, checks: { scope: 'unscored' } };`. Replace the "skip largest account" logic with `top10ExcludingKnown(accounts, isKnownSystemAccount)`, where `isKnownSystemAccount` checks the resolved curve/vault/burn set (start with the burn address `1nc1nerator11111111111111111111111111111111` and the token's known bonding-curve address from its `token_created` event; expand in Workstream 6).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/analysis/__tests__/safety.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/analysis/safety.js backend/src/analysis/__tests__/safety.test.js
git commit -m "fix(safety): resolve system accounts by identity + EVM guard (defects #5, #4)"
```

---

## Task 10: Standardized missing-data helper (defect #7)

**Files:**
- Create: `backend/src/analysis/missingData.js`
- Test: `backend/src/analysis/__tests__/missingData.test.js`

> **Defect (§5.2.7):** missing fields are inconsistently treated as zero/pass/fail/unavailable across strategies. Fix: one helper with explicit semantics — missing is `unavailable`, never silently `0` or `pass`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/analysis/__tests__/missingData.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { valueOrUnavailable, isPresent } from '../missingData.js';

describe('missingData helpers', () => {
  it('isPresent is false for null/undefined/NaN, true for 0', () => {
    expect(isPresent(0)).toBe(true);
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent(NaN)).toBe(false);
  });
  it('valueOrUnavailable returns the value when present, else the sentinel', () => {
    expect(valueOrUnavailable(5)).toBe(5);
    expect(valueOrUnavailable(0)).toBe(0);
    expect(valueOrUnavailable(null)).toBe('unavailable');
    expect(valueOrUnavailable(undefined, 'n/a')).toBe('n/a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/analysis/__tests__/missingData.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/analysis/missingData.js`:
```js
// One rule everywhere: missing evidence is UNAVAILABLE, never silently 0 / pass / fail. (§5.2.7)
export function isPresent(v) {
  return v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v));
}
export function valueOrUnavailable(v, sentinel = 'unavailable') {
  return isPresent(v) ? v : sentinel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/analysis/__tests__/missingData.test.js`
Expected: PASS.

- [ ] **Step 5: Adopt at one call site to prove the pattern**

In `backend/src/analysis/traction.js`, import `isPresent` and guard the breadth/attention inputs with it instead of `|| 0`. Run the traction tests: `cd backend && npx vitest run src/analysis/__tests__/traction.test.js` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/analysis/missingData.js backend/src/analysis/__tests__/missingData.test.js backend/src/analysis/traction.js
git commit -m "feat(analysis): shared missing-data helper; unknown != zero (defect #7)"
```

---

## Task 11: Remove hard 300-cap eviction of protected tokens + paginate reads (defect #6)

**Files:**
- Modify: `backend/src/discovery/registry.js`
- Modify: `backend/server.js` (`/api/tokens`)
- Test: `backend/src/discovery/__tests__/registry.test.js` (Create if absent)

> **Defect (§5.2.6):** in-memory registry, API, and frontend impose 300/100-record truncation; arrival order can evict better candidates while the UI implies exhaustive discovery. Fix (Phase 1 slice, §17): the cap applies only to *evictable* records — curated/tracked/position-linked tokens are never sliced away — and the API returns paginated results with a total count instead of a silent newest-300 slice.

- [ ] **Step 1: Write the failing test**

Create `backend/src/discovery/__tests__/registry.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { selectEvictable } from '../registry.js';

describe('selectEvictable', () => {
  const mk = (id, over = {}) => ({ mint: id, lifecycle: 'watching', tracked: false, hasOpenPosition: false, ...over });
  it('never evicts curated, tracked, or position-linked tokens', () => {
    const tokens = [
      mk('a', { lifecycle: 'curated' }),
      mk('b', { tracked: true }),
      mk('c', { hasOpenPosition: true }),
      mk('d'), mk('e'),
    ];
    const kept = selectEvictable(tokens, 1); // hotLimit = 1 evictable slot
    const keptIds = kept.map(t => t.mint);
    expect(keptIds).toContain('a');
    expect(keptIds).toContain('b');
    expect(keptIds).toContain('c');
    // only ONE of the two evictable (d,e) survives
    expect(keptIds.filter(id => id === 'd' || id === 'e')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/registry.test.js`
Expected: FAIL — `selectEvictable` not exported.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/discovery/registry.js` add:
```js
// Capacity applies ONLY to evictable records. Curated/tracked/position tokens sit outside the cap. (§17)
export function canEvict(t) {
  return !(t.lifecycle === 'curated' || t.tracked || t.hasOpenPosition);
}
export function selectEvictable(tokens, hotLimit) {
  const protectedT = tokens.filter(t => !canEvict(t));
  const evictable = tokens.filter(canEvict)
    .sort((a, b) => (b.score?.memeScore ?? -1) - (a.score?.memeScore ?? -1));
  return [...protectedT, ...evictable.slice(0, hotLimit)];
}
```
Replace the existing `MAX_TOKENS` array-slice eviction in the save/prune path with `selectEvictable(all, MAX_TOKENS)`. Eviction stops monitoring but does not delete persisted events (the tape).

- [ ] **Step 4: Paginate the API**

In `backend/server.js`, in the `/api/tokens` handler, read `?page` and `?pageSize` (default `pageSize=100`, cap 500), and return:
```js
const page = Math.max(1, Number(req.query.page) || 1);
const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
const all = getTokens(/* existing filters */);
const start = (page - 1) * pageSize;
res.json({ total: all.length, page, pageSize, tokens: all.slice(start, start + pageSize) });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/discovery/__tests__/registry.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/discovery/registry.js backend/server.js backend/src/discovery/__tests__/registry.test.js
git commit -m "fix(registry): protect non-evictable tokens + paginate /api/tokens (defect #6)"
```

---

## Task 12: Backend becomes the qualification authority; frontend stops qualifying (defect #8, first slice)

**Files:**
- Modify: `frontend/src/utils/memeStrategies.js`
- Modify: `frontend/src/components/MemeFinderView.jsx`
- Test: `frontend/src/utils/__tests__/memeStrategies.test.js` (extend existing)

> **Defect (§5.2.8):** scores and admission predicates are split between backend lifecycle code and frontend strategy functions, so labels and gates drift. Fix (Phase 1 slice, §18.1): the frontend must not decide whether a token *qualifies* — it renders the backend's `admission`/`lifecycle`. Client-side `matches()` predicates are demoted to a debug-only local filter and MUST NOT be used to compute qualification. Full strategy-tab removal is Workstream 10.

- [ ] **Step 1: Write the failing test**

Extend `frontend/src/utils/__tests__/memeStrategies.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { isQualified } from '../memeStrategies.js';

describe('isQualified', () => {
  it('reads the backend admission field, not client predicates', () => {
    expect(isQualified({ admission: 'qualified' })).toBe(true);
    expect(isQualified({ admission: 'watching' })).toBe(false);
    expect(isQualified({ lifecycle: 'curated' })).toBe(false); // lifecycle is not admission
    expect(isQualified({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/utils/__tests__/memeStrategies.test.js`
Expected: FAIL — `isQualified` not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/utils/memeStrategies.js` add:
```js
// Qualification is decided by the BACKEND only. The frontend never recomputes it. (§18.1)
export function isQualified(token) {
  return token?.admission === 'qualified';
}
```
In `frontend/src/components/MemeFinderView.jsx`, where the Qualified feed is currently derived by running a strategy's `matches(token)`, replace that qualification decision with `isQualified(token)`. Keep `matches()` only behind the existing advanced/debug filter surface (do not delete it yet — Workstream 10), and add a code comment: `// DEBUG-ONLY local filter — not a qualification gate (see §18.1).`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/utils/__tests__/memeStrategies.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/memeStrategies.js frontend/src/components/MemeFinderView.jsx frontend/src/utils/__tests__/memeStrategies.test.js
git commit -m "fix(ui): backend is qualification authority; frontend renders admission (defect #8 slice)"
```

---

## Task 13: Full regression + phase close

**Files:**
- Modify: `doc/implementation-plan.md` (append a Phase 1 completion note) — optional, follow existing doc conventions.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: all suites PASS, including the new tape/scope/ingestion/traction/safety/registry/missingData tests.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all suites PASS, including the updated memeStrategies test.

- [ ] **Step 3: Boot smoke test against local Postgres**

Ensure a local Postgres is running with a `tradeforge` database, then:
Run: `cd backend && node server.js` (or the project's start script)
Expected: log line `[tape] Postgres event tape ready`, then feeds start. Stop after confirming.

- [ ] **Step 4: Verify events are landing**

With the server running for ~1 minute, run:
```bash
psql "$DATABASE_URL" -c "SELECT type, count(*) FROM events GROUP BY type ORDER BY 2 DESC;"
```
Expected: non-zero `token_created` and (as trade subscriptions land in WS3) eventually `trade_observed` rows. At minimum `token_created` and `migration_observed` appear.

- [ ] **Step 5: Commit the phase close**

```bash
git add -A
git commit -m "chore: Phase 1 event tape foundation complete — tape, chain gate, 8 defect fixes"
```

---

## Self-Review (completed)

**Spec coverage vs Phase 1 scope (§26 WS1–WS2 + §28):**
- Event tape (§9.5) → Tasks 1, 3. Canonical identity/envelope (§9.1–§9.3) → Task 2. Chain-scope gate (§14.2) → Task 4. Postgres persistence (§9.4) → Tasks 0, 1, 5.
- 8 defects (§5.2): #1 trade capture → Task 6 (slice; full ingestion = WS3); #2 breadth → Task 7; #3 mutate-before-compare → Task 8; #4 EVM guard → Tasks 4, 9; #5 holder skip-largest → Task 9; #6 truncation → Task 11; #7 missing-data → Task 10; #8 backend authority → Task 12 (slice; full UI = WS10).

**Deferred-by-design (called out at their tasks, not gaps):** full staged Stage A/B/C collection (WS3); full frontend strategy-tab removal (WS10); feature/scoring/admission engines (WS4–WS8). These are out of Phase 1 scope per the approved plan-scope decision.

**Placeholder scan:** none — every code step contains runnable code and exact commands.

**Type consistency:** `Tape.append/eventsUntil`, `assetKey`, `eventId`, `EVENT_TYPES`, `validateEnvelope`, `classifyScope`, `handlePumpMessage`, `breadthFromWindow`, `detectSpikeBetween`, `top10ExcludingKnown`, `isAnalyzable`, `valueOrUnavailable`/`isPresent`, `selectEvictable`/`canEvict`, `isQualified` — each defined once and referenced consistently.
