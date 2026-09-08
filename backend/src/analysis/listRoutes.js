// REST for custom lists + performance stats. Mounted at /api/lists.
import { Router } from 'express';
import {
  getLists, createList, updateList, deleteList, removeMatch, pinToken, excludeToken,
} from './customLists.js';
import { computeStats, pctChange } from './listStats.js';
import { getTokenByMint, getTokenByKey, getCuratedTokens } from '../discovery/registry.js';
import { RULE_FIELDS } from './listRules.js';

const WINDOWS = { '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 };

export function createListRouter() {
  const router = Router();
  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ error: err.message }));

  router.get('/', (req, res) => res.json({ lists: getLists(), ruleFields: RULE_FIELDS }));
  router.post('/', wrap((req, res) => res.json({ list: createList(req.body || {}) })));
  router.patch('/:id', wrap((req, res) => res.json({ list: updateList(req.params.id, req.body || {}) })));
  router.delete('/:id', wrap((req, res) => { deleteList(req.params.id); res.json({ ok: true }); }));
  router.delete('/:id/matches/:mint', wrap((req, res) =>
    res.json({ list: removeMatch(req.params.id, req.params.mint) })));
  router.post('/:id/pins', wrap((req, res) => res.json({
    list: pinToken(req.params.id, req.body?.tokenKey, req.body?.pinned !== false),
  })));
  router.post('/:id/exclusions', wrap((req, res) => res.json({
    list: excludeToken(req.params.id, req.body?.tokenKey, req.body?.excluded !== false),
  })));

  // Tokens of one list, enriched with live data + % since listed.
  router.get('/:id/tokens', wrap((req, res) => {
    const list = getLists().find(l => l.id === req.params.id);
    if (!list) throw new Error('List not found');
    const tokens = list.matched.map(m => {
      const t = m.tokenKey ? getTokenByKey(m.tokenKey) : getTokenByMint(m.mint);
      return t ? {
        ...t,
        listedAt: m.listedAt, listedPriceUsd: m.listedPriceUsd, exited: m.exited,
        matchReasons: m.reasons || [],
        missingEvidence: m.missingEvidence || [], pinned: (list.pinnedTokens || []).includes(m.tokenKey || m.mint),
        sinceListedPct: pctChange(m.listedPriceUsd, t.priceUsd),
      } : null;
    }).filter(Boolean);
    const sorters = {
      score: (a, b) => (b.safety?.score ?? 0) - (a.safety?.score ?? 0),
      volume5m: (a, b) => (b.volume5mUsd ?? 0) - (a.volume5mUsd ?? 0),
      liquidity: (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
      matchedAt: (a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0),
    };
    tokens.sort(sorters[list.sortOrder] || sorters.matchedAt);
    res.json({ tokens });
  }));

  router.get('/:id/stats', wrap((req, res) => {
    const list = getLists().find(l => l.id === req.params.id);
    if (!list) throw new Error('List not found');
    const entries = list.matched.map(m => {
      const t = m.tokenKey ? getTokenByKey(m.tokenKey) : getTokenByMint(m.mint);
      return { entryPrice: m.listedPriceUsd, currentPrice: t?.priceUsd ?? null, ts: m.listedAt };
    });
    res.json({
      stats24h: computeStats(entries, { windowMs: WINDOWS['24h'] }),
      stats7d: computeStats(entries, { windowMs: WINDOWS['7d'] }),
    });
  }));

  return router;
}

// Curated-feed stats: % since curated across curated tokens.
export function curatedStats() {
  const entries = getCuratedTokens().map(t => ({
    entryPrice: t.curatedPriceUsd ?? null, currentPrice: t.priceUsd ?? null, ts: t.curatedAt ?? 0,
  }));
  return {
    stats24h: computeStats(entries, { windowMs: WINDOWS['24h'] }),
    stats7d: computeStats(entries, { windowMs: WINDOWS['7d'] }),
  };
}
