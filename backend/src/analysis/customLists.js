// User-defined rule-based token lists. Evaluated on every analysis pass and
// refresh tick; matches are stamped with entry price and never silently
// dropped (exited flag instead).
import { load, save } from '../store.js';
import { emit } from '../bus.js';
import { pushAlert } from '../alerts.js';
import { matchesRules } from './listRules.js';

const STORE = 'custom-lists';
const COLORS = ['violet', 'green', 'blue', 'yellow', 'red'];

export function getLists() { return load(STORE, []); }
function persist(lists) { save(STORE, lists); }

export function createList({
  name, rules = {}, color, mode = 'rules', manualTokens = [], pinnedTokens = [],
  excludedTokens = [], sortOrder = 'matchedAt', refreshCadenceSec = 45, alerts,
}) {
  const lists = getLists();
  const list = {
    id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name, color: color || COLORS[lists.length % COLORS.length],
    enabled: true, rules, mode, manualTokens, pinnedTokens,
    excludedTokens, includedChains: [], excludedChains: [], includedSources: [], excludedSources: [],
    sortOrder, refreshCadenceSec,
    alerts: {
      newMatches: true, scoreChanges: false, priceMoves: false,
      priceMovePct: 10, riskChanges: true, ...alerts,
    },
    matched: [], createdAt: Date.now(), updatedAt: Date.now(), lastEvaluatedAt: null,
  };
  lists.push(list);
  persist(lists);
  return list;
}

export function updateList(id, patch) {
  const lists = getLists();
  const list = lists.find(l => l.id === id);
  if (!list) throw new Error('List not found');
  const { id: _ignore, matched: _keep, ...safe } = patch;
  Object.assign(list, safe);
  list.updatedAt = Date.now();
  persist(lists);
  return list;
}

export function deleteList(id) {
  persist(getLists().filter(l => l.id !== id));
}

export function removeMatch(listId, mint) {
  const lists = getLists();
  const list = lists.find(l => l.id === listId);
  if (!list) throw new Error('List not found');
  list.matched = list.matched.filter(m => m.mint !== mint);
  persist(lists);
  return list;
}

export function pinToken(listId, tokenRef, pinned = true) {
  const lists = getLists();
  const list = lists.find(item => item.id === listId);
  if (!list) throw new Error('List not found');
  const identity = String(tokenRef);
  list.pinnedTokens ||= [];
  list.pinnedTokens = pinned
    ? [...new Set([...list.pinnedTokens, identity])]
    : list.pinnedTokens.filter(value => value !== identity);
  if (pinned) list.excludedTokens = (list.excludedTokens || []).filter(value => value !== identity);
  persist(lists);
  return list;
}

export function excludeToken(listId, tokenRef, excluded = true) {
  const lists = getLists();
  const list = lists.find(item => item.id === listId);
  if (!list) throw new Error('List not found');
  const identity = String(tokenRef);
  list.excludedTokens ||= [];
  list.excludedTokens = excluded
    ? [...new Set([...list.excludedTokens, identity])]
    : list.excludedTokens.filter(value => value !== identity);
  if (excluded) {
    list.pinnedTokens = (list.pinnedTokens || []).filter(value => value !== identity);
    list.matched = list.matched.filter(entry => (entry.tokenKey || entry.mint) !== identity);
  }
  persist(lists);
  return list;
}

function evaluateForList(list, token, now) {
  let changed = false;
  const identity = `${token.chain || 'solana'}:${token.mint}`;
  if ((list.excludedTokens || []).includes(identity)) return false;
  const pinned = (list.pinnedTokens || []).includes(identity);
  const manual = (list.manualTokens || []).includes(identity);
  const result = matchesRules(token, list.rules);
  const match = pinned || manual || (list.mode !== 'manual' && result.match);
  const reasons = pinned ? ['pinned'] : manual ? ['manual'] : result.reasons;
  const entry = list.matched.find(m => (m.tokenKey || m.mint) === identity);
  if (match && !entry) {
    list.matched.push({
      tokenKey: identity, mint: token.mint, chain: token.chain || 'solana', listedAt: now,
      listedPriceUsd: token.priceUsd ?? null, exited: false, reasons,
      missingEvidence: result.missing || [], lastScore: token.safety?.score ?? null,
      lastRiskState: token.rugged ? 'critical' : token.safety?.score < 40 ? 'warning' : 'normal',
      lastPriceUsd: token.priceUsd ?? null, lastPriceAlertUsd: token.priceUsd ?? null,
    });
    changed = true;
    if (list.alerts?.newMatches !== false) pushAlert({
      type: 'meme', severity: 'info',
      title: `${token.symbol || token.mint.slice(0, 6)} matched list "${list.name}"`,
      body: reasons.join(', '),
    });
    emit('token:listed', { listId: list.id, listName: list.name, mint: token.mint });
  } else if (entry && entry.exited !== !match) {
    entry.exited = !match;
    entry.reasons = reasons;
    entry.missingEvidence = result.missing || [];
    changed = true;
  } else if (entry) {
    const score = token.safety?.score ?? null;
    const risk = token.rugged ? 'critical' : score != null && score < 40 ? 'warning' : 'normal';
    if (list.alerts?.scoreChanges && score != null && entry.lastScore != null && Math.abs(score - entry.lastScore) >= 10) {
      pushAlert({ type: 'meme', severity: 'info', title: `${token.symbol || token.mint.slice(0, 6)} score changed`, body: `${entry.lastScore} → ${score} in ${list.name}` });
    }
    if (list.alerts?.riskChanges && entry.lastRiskState && risk !== entry.lastRiskState) {
      pushAlert({ type: 'meme', severity: risk === 'critical' ? 'critical' : 'info', title: `${token.symbol || token.mint.slice(0, 6)} risk changed`, body: `${entry.lastRiskState} → ${risk} in ${list.name}` });
    }
    const price = Number(token.priceUsd);
    const baseline = Number(entry.lastPriceAlertUsd ?? entry.listedPriceUsd ?? entry.lastPriceUsd);
    const threshold = Math.max(0.1, Number(list.alerts?.priceMovePct) || 10);
    if (list.alerts?.priceMoves && price > 0 && baseline > 0) {
      const movePct = (price - baseline) / baseline * 100;
      if (Math.abs(movePct) >= threshold) {
        pushAlert({
          type: 'meme', severity: movePct < 0 ? 'high' : 'info',
          title: `${token.symbol || token.mint.slice(0, 6)} moved ${movePct >= 0 ? '+' : ''}${movePct.toFixed(1)}%`,
          body: `${list.name} · since the last price alert`,
        });
        entry.lastPriceAlertUsd = price;
        entry.lastPriceAlertAt = now;
        changed = true;
      }
    }
    if (entry.lastScore !== score || entry.lastRiskState !== risk || entry.lastPriceUsd !== (token.priceUsd ?? null)) changed = true;
    entry.lastScore = score;
    entry.lastRiskState = risk;
    entry.lastPriceUsd = token.priceUsd ?? null;
  }
  return changed;
}

// Batch refresh evaluation honours each list's cadence and persists once.
// Registry ingestion uses evaluateToken below so a brand-new token is still
// considered immediately rather than waiting for the next market refresh.
export function evaluateTokens(tokens, { respectCadence = true, now = Date.now() } = {}) {
  const lists = getLists();
  let changed = false;
  for (const list of lists) {
    if (!list.enabled) continue;
    const cadenceMs = Math.max(15, Number(list.refreshCadenceSec) || 45) * 1000;
    if (respectCadence && list.lastEvaluatedAt && now - list.lastEvaluatedAt < cadenceMs) continue;
    for (const token of tokens) {
      if (token?.mint && evaluateForList(list, token, now)) changed = true;
    }
    list.lastEvaluatedAt = now;
    changed = true;
  }
  if (changed) persist(lists);
  return lists;
}

export function evaluateToken(token) {
  return evaluateTokens([token], { respectCadence: false });
}

// All mints matched by enabled lists (for the refresh loop).
export function trackedMints() {
  const out = new Set();
  for (const list of getLists()) {
    if (!list.enabled) continue;
    for (const m of list.matched) out.add(m.mint);
  }
  return [...out];
}
