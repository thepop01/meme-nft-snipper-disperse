// Strategy health analysis: evaluate every saved custom strategy (and the
// built-in curated gate) against the real persisted registry
// (backend/data/tokens.json + tracked.json + custom-lists.json), reporting
// match counts and field availability to identify dead strategies.
// Run: node scripts/analyze-strategies.mjs
import { readFileSync } from 'fs';
import { matchesRules, RULE_FIELDS } from '../backend/src/analysis/listRules.js';

const dataDir = new URL('../backend/data/', import.meta.url);
const readJson = (name, fallback) => {
  try { return JSON.parse(readFileSync(new URL(name, dataDir), 'utf8')); }
  catch { return fallback; }
};

const tokens = readJson('tokens.json', []);
const tracked = readJson('tracked.json', []);
const lists = readJson('custom-lists.json', []);

console.log(`tokens: ${tokens.length}, tracked: ${tracked.length}, strategies: ${lists.length}\n`);

// State / chain distribution
const by = (arr, fn) => arr.reduce((m, t) => { const k = fn(t); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log('states:', by(tokens, t => t.state));
console.log('chains:', by(tokens, t => t.chain || 'solana'));
console.log('sources:', by(tokens, t => t.source));

// Field availability — a strategy depending on a never-populated field is dead by construction
const fields = ['safety', 'traction', 'top10HolderPct', 'attentionBoost', 'liquidityUsd', 'volume5mUsd',
  'txns', 'history', 'priceUsd', 'marketCapUsd', 'onCurve', 'passes', 'rugged', 'holderCount',
  'smartWallets', 'freshWallets', 'bundlerPct', 'revivalHeat'];
console.log('\nfield availability (non-null / total):');
for (const f of fields) {
  const n = tokens.filter(t => t[f] != null && !(Array.isArray(t[f]) && t[f].length === 0)
    && !(typeof t[f] === 'object' && !Array.isArray(t[f]) && Object.keys(t[f]).length === 0)).length;
  console.log(`  ${f.padEnd(18)} ${String(n).padStart(4)} / ${tokens.length}`);
}

// Live-ish activity: how many tokens have ANY 5m volume / m5 txns right now
const active5m = tokens.filter(t => (t.volume5mUsd ?? 0) > 0).length;
const withM5 = tokens.filter(t => t.txns?.m5 && ((t.txns.m5.buys ?? 0) + (t.txns.m5.sells ?? 0)) > 0).length;
console.log(`\n5m volume > 0: ${active5m}; m5 txns > 0: ${withM5}`);

// Built-in curated gate, evaluated exactly like the registry does.
const CURATED_GATE = { minSafetyScore: 55, minLiquidityUsd: 5000 };
const alive = tokens.filter(t => t.state !== 'discarded');

// Strategy match counts — overall, and among non-discarded (what feeds the bots)
console.log(`\nstrategy match counts (all ${tokens.length} / alive ${alive.length}):`);
for (const s of lists) {
  let allCount = 0, aliveCount = 0;
  for (const t of tokens) {
    let m = false;
    try { m = s.mode === 'manual' ? false : matchesRules(t, s.rules).match
      || (s.pinnedTokens || []).includes(`${t.chain || 'solana'}:${t.mint}`)
      || (s.manualTokens || []).includes(`${t.chain || 'solana'}:${t.mint}`); } catch { /* no match */ }
    if (m) { allCount++; if (t.state !== 'discarded') aliveCount++; }
  }
  console.log(`  ${(s.name || s.id).padEnd(24)} ${String(allCount).padStart(4)} all  ${String(aliveCount).padStart(4)} alive   saved-matches: ${(s.matched || []).length}`);
}
let cAll = 0, cAlive = 0;
for (const t of tokens) {
  let m = false;
  try { m = matchesRules(t, CURATED_GATE).match; } catch { /* no match */ }
  if (m) { cAll++; if (t.state !== 'discarded') cAlive++; }
}
console.log(`  ${'[curated gate]'.padEnd(24)} ${String(cAll).padStart(4)} all  ${String(cAlive).padStart(4)} alive   state-curated: ${tokens.filter(t => t.state === 'curated').length}`);

// Per-rule-field coverage: which rules can never fire because data is missing
console.log('\nrule field usability (tokens with usable data / alive):');
const numericFields = RULE_FIELDS.filter(f => f.type === 'number').map(f => f.key);
for (const key of numericFields) {
  // min* rules probe at 0 (matches whenever data exists); max* rules probe at
  // MAX_SAFE_INTEGER so they match whenever data exists.
  const probe = { [key]: key.startsWith('max') ? Number.MAX_SAFE_INTEGER : 0 };
  const n = alive.filter(t => { try { return matchesRules(t, probe).match; } catch { return false; } }).length;
  console.log(`  ${key.padEnd(26)} ${String(n).padStart(4)} / ${alive.length}`);
}

// Tracked snapshot
console.log('\ntracked reasons:', by(tracked, t => t.reason));
console.log('tracked wakes > 0:', tracked.filter(t => (t.wakeCount ?? 0) > 0).length);
console.log('tracked climbers:', tracked.filter(t => t.climber).length);

// Duplicate detection: same address appearing on multiple chains
const addrChains = {};
for (const t of tokens) (addrChains[t.mint] ||= new Set()).add(t.chain || 'solana');
const crossChain = Object.entries(addrChains).filter(([, s]) => s.size > 1);
console.log('same address on multiple chains:', crossChain.length ? crossChain.map(([a, s]) => `${a}:${[...s]}`) : 'none');
