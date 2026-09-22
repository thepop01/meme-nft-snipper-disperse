import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, Coins, Filter, Flame, Plus, Radar,
  RefreshCw, Search, SlidersHorizontal, X,
  ExternalLink, Link2, Eye,
} from 'lucide-react';
import { api, getBackendUrl, setBackendUrl, authHeaders, getApiToken, setApiToken } from '../utils/sniperApi';
import { useBackend } from '../utils/useBackend';
import { useTradingPortfolio } from '../utils/useTradingPortfolio';
import { StatusDot } from './ui/Primitives';
import { Modal } from './ui/Modal';
import { useToast } from './ui/useToast';
import TokenRow from './meme/TokenRow';
import TradeTicket from './meme/TradeTicket';
import MemePortfolioDock from './meme/MemePortfolioDock';
import KpiStrip from './meme/KpiStrip';

// Chain scope for split terminals:
// - Solana terminal: forcedChain='solana'
// - EVM terminal: forcedChain='robinhood' (Robinhood-only for now, chain 4663)
// Legacy /memefinder route passes no forcedChain (both chains).
export const TERMINAL_META = {
  solana: { title: 'Solana Meme Terminal', subtitle: 'Pump.fun + GMGN Solana discovery, safety/traction scoring, and execution.' },
  robinhood: { title: 'EVM Meme Terminal', subtitle: 'Robinhood chain (4663) discovery via GeckoTerminal + GMGN, scoped to EVM playbook.' },
};

function CustomListsModal({ open, onClose, lists, ruleFields, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    try {
      const body = JSON.stringify({
        name: editing.name, rules: editing.rules, mode: editing.mode || 'rules',
        manualTokens: editing.manualTokens || [], pinnedTokens: editing.pinnedTokens || [],
        excludedTokens: editing.excludedTokens || [], sortOrder: editing.sortOrder || 'matchedAt',
        refreshCadenceSec: Number(editing.refreshCadenceSec) || 45, alerts: editing.alerts,
      });
      const response = editing.id
        ? await fetch(`${getBackendUrl()}/api/lists/${editing.id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body })
        : await fetch(`${getBackendUrl()}/api/lists`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save list');
      setEditing(null);
      onChanged();
    } catch (saveError) { setError(saveError.message); }
  };

  const toggle = async list => {
    await fetch(`${getBackendUrl()}/api/lists/${list.id}`, {
      method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !list.enabled }),
    });
    onChanged();
  };

  const remove = async list => {
    if (!window.confirm(`Delete custom strategy "${list.name}"?`)) return;
    await fetch(`${getBackendUrl()}/api/lists/${list.id}`, { method: 'DELETE', headers: authHeaders() });
    onChanged();
  };

  const setRule = (key, value) => setEditing(current => ({ ...current, rules: { ...current.rules, [key]: value === '' ? undefined : value } }));

  return (
    <Modal open={open} onClose={onClose} title="Custom strategies" actions={<button className="btn-outline" onClick={onClose}>Close</button>}>
      {!editing ? (
        <div className="custom-list-manager">
          <p className="text-muted custom-list-intro">Create a rule-based strategy, or duplicate a built-in strategy and tune its thresholds.</p>
          {lists.map(list => (
            <div key={list.id} className="custom-list-row">
              <div><strong>{list.name}</strong><span>{list.matched?.length || 0} matches · {list.enabled ? 'enabled' : 'disabled'}</span></div>
              <div className="custom-list-actions">
                <button className="btn-outline btn-xs" onClick={() => toggle(list)}>{list.enabled ? 'Disable' : 'Enable'}</button>
                <button className="btn-outline btn-xs" onClick={() => setEditing({ ...list, rules: { ...list.rules }, alerts: { ...list.alerts } })}>Edit</button>
                <button className="icon-btn-danger" onClick={() => remove(list)} title="Delete list"><X size={13} /></button>
              </div>
            </div>
          ))}
          <button className="btn-primary btn-sm custom-list-create" onClick={() => setEditing({ name: '', mode: 'rules', rules: {}, manualTokens: [], pinnedTokens: [], excludedTokens: [], sortOrder: 'matchedAt', refreshCadenceSec: 45, alerts: { newMatches: true, scoreChanges: false, priceMoves: false, riskChanges: true } })}><Plus size={14} /> New custom strategy</button>
        </div>
      ) : (
        <div className="custom-list-form">
          <div className="form-group"><label className="form-label">Strategy name</label><input className="input-field" value={editing.name} onChange={event => setEditing(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Morning momentum scan" /></div>
          <div className="custom-rule-grid">
            <div className="form-group"><label className="form-label">List mode</label><select className="select-field" value={editing.mode || 'rules'} onChange={event => setEditing(current => ({ ...current, mode: event.target.value }))}><option value="rules">Rule based</option><option value="manual">Manual tokens</option><option value="hybrid">Rules + manual</option></select></div>
            <div className="form-group"><label className="form-label">Sort order</label><select className="select-field" value={editing.sortOrder || 'matchedAt'} onChange={event => setEditing(current => ({ ...current, sortOrder: event.target.value }))}><option value="matchedAt">Newest match</option><option value="score">Strategy score</option><option value="volume5m">5m volume</option><option value="liquidity">Liquidity</option></select></div>
            <div className="form-group"><label className="form-label">Refresh cadence (seconds)</label><input type="number" min="15" className="input-field" value={editing.refreshCadenceSec || 45} onChange={event => setEditing(current => ({ ...current, refreshCadenceSec: Number(event.target.value) }))} /></div>
            <div className="form-group"><label className="form-label">Manual token identities</label><textarea className="textarea-field" placeholder="solana:mint or monad:0x…" value={(editing.manualTokens || []).join('\n')} onChange={event => setEditing(current => ({ ...current, manualTokens: event.target.value.split(/\s+/).filter(Boolean) }))} /></div>
            <div className="form-group"><label className="form-label">Pinned token identities</label><textarea className="textarea-field" value={(editing.pinnedTokens || []).join('\n')} onChange={event => setEditing(current => ({ ...current, pinnedTokens: event.target.value.split(/\s+/).filter(Boolean) }))} /></div>
            <div className="form-group"><label className="form-label">Permanent exclusions</label><textarea className="textarea-field" value={(editing.excludedTokens || []).join('\n')} onChange={event => setEditing(current => ({ ...current, excludedTokens: event.target.value.split(/\s+/).filter(Boolean) }))} /></div>
          </div>
          <div className="custom-alert-grid"><label><input type="checkbox" checked={editing.alerts?.newMatches !== false} onChange={event => setEditing(current => ({ ...current, alerts: { ...current.alerts, newMatches: event.target.checked } }))} /> New matches</label><label><input type="checkbox" checked={Boolean(editing.alerts?.scoreChanges)} onChange={event => setEditing(current => ({ ...current, alerts: { ...current.alerts, scoreChanges: event.target.checked } }))} /> Score changes</label><label><input type="checkbox" checked={Boolean(editing.alerts?.priceMoves)} onChange={event => setEditing(current => ({ ...current, alerts: { ...current.alerts, priceMoves: event.target.checked } }))} /> Price moves</label><label><input type="checkbox" checked={editing.alerts?.riskChanges !== false} onChange={event => setEditing(current => ({ ...current, alerts: { ...current.alerts, riskChanges: event.target.checked } }))} /> Risk changes</label>{editing.alerts?.priceMoves && <label>Alert move % <input className="input-field compact" type="number" min="0.1" step="0.1" value={editing.alerts?.priceMovePct || 10} onChange={event => setEditing(current => ({ ...current, alerts: { ...current.alerts, priceMovePct: Number(event.target.value) || 10 } }))} /></label>}</div>
          <div className="custom-rule-grid">
            {ruleFields.map(field => (
              <div className="form-group" key={field.key}>
                <label className="form-label">{field.label}</label>
                {field.type === 'number' && <input type="number" className="input-field" value={editing.rules[field.key] ?? ''} onChange={event => setRule(field.key, event.target.value === '' ? '' : Number(event.target.value))} />}
                {field.type === 'select' && <select className="select-field" value={editing.rules[field.key] ?? ''} onChange={event => setRule(field.key, event.target.value)}><option value="">Any</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>}
                {field.type === 'multi' && <div className="selector-chip-list">{field.options.map(option => { const values = editing.rules[field.key] || []; return <button type="button" key={option} className={`selector-chip ${values.includes(option) ? 'active' : ''}`} onClick={() => setRule(field.key, values.includes(option) ? values.filter(value => value !== option) : [...values, option])}>{option}</button>; })}</div>}
                {field.type === 'keywords' && <input className="input-field" placeholder="comma, separated" value={(editing.rules[field.key] || []).join(',')} onChange={event => setRule(field.key, event.target.value ? event.target.value.split(',').map(value => value.trim()).filter(Boolean) : '')} />}
                {field.type === 'boolean' && <label className="checkbox-control"><input type="checkbox" checked={Boolean(editing.rules[field.key])} onChange={event => setRule(field.key, event.target.checked || '')} /><span>Required</span></label>}
              </div>
            ))}
          </div>
          {error && <p className="text-red" style={{ fontSize: '0.78rem' }}>{error}</p>}
          <div className="custom-list-form-actions"><button className="btn-outline" onClick={() => setEditing(null)}>Back</button><button className="btn-primary" disabled={!editing.name.trim()} onClick={save}>Save custom strategy</button></div>
        </div>
      )}
    </Modal>
  );
}

function TokenScanner({
  tokens, selected, onSelect, expandedKeys, onToggle, onTrack, onTrade,
  positions, sortBy, sortDirection, onSort, trackedMints, activeFeed,
  emptyAction, customList, onPin, onExclude,
}) {
  const sortableHeader = (label, key) => <button className={`scanner-sort ${sortBy === key ? 'active' : ''}`} type="button" onClick={() => onSort(key)}>{label}{sortBy === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button>;
  return (
    <div className="scanner-table-wrap">
      <table className="data-table scanner-table">
        <thead><tr><th>Token</th><th>{sortableHeader('Price', 'price')}</th><th>{sortableHeader('Age', 'newest')}</th><th>{sortableHeader('5m volume', 'volume5m')}</th><th>Flow 5m</th><th>{sortableHeader('Liquidity', 'liquidity')}</th><th>{sortableHeader('Market cap', 'marketCap')}</th><th>{sortableHeader('1h change', 'change1h')}</th><th>{sortableHeader('Signals', 'traction')}</th><th>Actions</th></tr></thead>
        <tbody>{tokens.filter(token => token && typeof token.mint === 'string').map(token => (
          <TokenRow
            key={token.key || `${token.chain || 'solana'}:${token.mint}`}
            token={token}
            selected={selected?.mint === token.mint}
            expanded={expandedKeys ? expandedKeys.has(token.key || `${token.chain || 'solana'}:${token.mint}`) : false}
            onSelect={onSelect}
            onToggle={onToggle}
            onTrack={onTrack}
            onTrade={onTrade}
            canSell={positions.some(position => position.status === 'open' && position.mint === token.mint)}
            isTracked={token.state === 'tracked' || trackedMints?.has(token.mint)}
            activeFeed={activeFeed}
            customList={customList}
            onPin={onPin}
            onExclude={onExclude}
          />
        ))}</tbody>
      </table>
      {tokens.length === 0 && (
        <div className="scanner-empty">
          <Radar size={28} />
          <strong>No tokens match the current filters</strong>
          <span>{emptyAction
            ? 'The feed is live — relax your filters or wait for fresh launches to arrive.'
            : 'This feed has no tokens yet. New launches appear here automatically.'}</span>
          {emptyAction}
        </div>
      )}
    </div>
  );
}

export default function MemeFinderView({ walletDirectory = { wallets: [], tags: [] }, forcedChain = '', basePath = '/memefinder' }) {
  const toast = useToast();
  const { feedId } = useParams();
  const navigate = useNavigate();
  const [tokens, setTokens] = useState([]);
  // URL is the source of truth for the feed (base path comes from the `basePath`
  // prop: /memefinder, /sol-meme, or /evm-meme); falls back
  // to the last-used feed so a bare base path restores the previous session.
  const activeFeed = feedId ? decodeURIComponent(feedId) : (localStorage.getItem('memeActiveFeed') || 'curated');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  // Split terminals lock the chain: Solana terminal forces 'solana',
  // EVM terminal forces 'robinhood'. Legacy view leaves it free.
  const [chain, setChain] = useState(forcedChain || '');
  useEffect(() => { if (forcedChain) setChain(forcedChain); }, [forcedChain]);
  const terminalMeta = forcedChain ? TERMINAL_META[forcedChain] : null;
  const [source, setSource] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [minVolume5m, setMinVolume5m] = useState(0);
  const [maxAgeMin, setMaxAgeMin] = useState(0);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('memeScannerSort') || 'traction');
  const [sortDirection, setSortDirection] = useState(() => localStorage.getItem('memeScannerSortDirection') || 'desc');
  const [tradeRequest, setTradeRequest] = useState(null);
  const [portfolioTagIds, setPortfolioTagIds] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [lists, setLists] = useState([]);
  const [ruleFields, setRuleFields] = useState([]);
  const [showListManager, setShowListManager] = useState(false);
  const [urlDraft, setUrlDraft] = useState(getBackendUrl());
  const [tokenDraft, setTokenDraft] = useState(getApiToken());
  const [scannerPaused, setScannerPaused] = useState(() => localStorage.getItem('memeScannerPaused') !== 'false');
  const [wakeEvents, setWakeEvents] = useState([]); // live sleeper-wake / revival banners
  const [feedCounts, setFeedCounts] = useState({ curated: 0, tracked: 0, all: 0 });
  const [trackedMints, setTrackedMints] = useState(() => new Set());
  const activeFeedRef = useRef(activeFeed);
  activeFeedRef.current = activeFeed;
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const toggleExpanded = useCallback(token => {
    const key = token.key || `${token.chain || 'solana'}:${token.mint}`;
    setExpandedKeys(current => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.clear();
        next.add(key);
      }
      return next;
    });
  }, []);


  const [selectedPortfolioWallet, setSelectedPortfolioWallet] = useState('');
  const portfolio = useTradingPortfolio({ walletAddress: selectedPortfolioWallet });

  const fetchLists = useCallback(async () => {
    try {
      const response = await fetch(`${getBackendUrl()}/api/lists`, { headers: authHeaders() });
      const data = await response.json();
      setLists(data.lists || []);
      setRuleFields(data.ruleFields || []);
      // A saved feed pointing at a deleted custom list would render nothing forever.
      if (activeFeedRef.current.startsWith('list:') && data.lists
        && !data.lists.some(list => `list:${list.id}` === activeFeedRef.current)) {
        activeFeedRef.current = 'curated';
        localStorage.setItem('memeActiveFeed', 'curated');
        navigate(basePath, { replace: true });
      }
    } catch { /* offline banner handles this */ }
  }, [navigate, basePath]);

  const fetchCounts = useCallback(async () => {
    try {
      const scopedChain = forcedChain || chain;
      const [cRes, tRes, aRes] = await Promise.allSettled([
        api.tokens({ view: 'curated', limit: 300, ...(scopedChain ? { chain: scopedChain } : {}) }),
        api.tracked(),
        api.tokens({ view: 'all', limit: 1, ...(scopedChain ? { chain: scopedChain } : {}) }),
      ]);
      let trackedList = [];
      if (tRes.status === 'fulfilled' && Array.isArray(tRes.value?.tracked)) {
        trackedList = tRes.value.tracked;
        if (forcedChain) {
          trackedList = trackedList.filter(t => (t.chain || (t.mint?.startsWith('0x') ? 'robinhood' : 'solana')) === forcedChain);
        }
        setTrackedMints(new Set(trackedList.map(t => t.mint)));
      }
      const curatedTokens = cRes.status === 'fulfilled' ? (cRes.value?.tokens || []) : [];
      setFeedCounts({
        curated: curatedTokens.length,
        tracked: trackedList.length,
        all: aRes.status === 'fulfilled' ? (aRes.value?.total || 0) : 0,
      });
    } catch { /* offline banner handles this */ }
  }, [chain, forcedChain]);

  const fetchTokens = useCallback(async () => {
    try {
      let nextTokens;
      if (activeFeedRef.current.startsWith('list:')) {
        const response = await fetch(`${getBackendUrl()}/api/lists/${activeFeedRef.current.slice(5)}/tokens`, { headers: authHeaders() });
        nextTokens = (await response.json()).tokens || [];
      } else if (activeFeedRef.current === 'view:tracked') {
        const res = await api.tracked();
        const rawTracked = (res.tracked || []).map(t => ({
          ...t,
          state: 'tracked',
          traction: { tractionScore: t.tractionScore ?? 0 },
          priceUsd: t.priceUsd ?? (t.priceHistory30m?.slice(-1)[0]?.p || null),
        }));
        nextTokens = rawTracked;
      } else {
        const view = activeFeedRef.current === 'curated' || activeFeedRef.current === 'alpha' ? 'curated' : 'all';
        const scopedChain = forcedChain || chain;
        nextTokens = (await api.tokens({ view, limit: 300, ...(scopedChain ? { chain: scopedChain } : {}) })).tokens || [];
      }
      // Enforce terminal scope client-side too (custom lists can mix chains).
      if (forcedChain) {
        nextTokens = nextTokens.filter(token => (token.chain || (token.mint?.startsWith('0x') ? 'robinhood' : 'solana')) === forcedChain);
      }
      setTokens(nextTokens);
      setSelected(current => nextTokens.find(token => token.mint === current?.mint) || nextTokens[0] || null);
    } catch { /* offline banner handles this */ }
  }, [chain, forcedChain]);

  const handleMessage = useCallback(message => {
    if (scannerPaused) return;
    // Dedupe/select by chain-aware key: an EVM address can collide across chains,
    // so matching on mint alone clobbers distinct tokens into one row.
    const keyOf = token => token?.key || `${token?.chain || 'solana'}:${token?.mint}`;
    if (forcedChain && message.chain && message.chain !== forcedChain) return;
    if (['token:new', 'token:curated'].includes(message.type) && message.token && !activeFeedRef.current.startsWith('list:')) {
      const tokenChain = message.token.chain || 'solana';
      if (forcedChain && tokenChain !== forcedChain) return;
      const k = keyOf(message.token);
      setTokens(current => [message.token, ...current.filter(token => keyOf(token) !== k)].slice(0, 100));
    }
    if (message.type === 'token:curated' && message.token) {
      const tokenChain = message.token.chain || 'solana';
      if (forcedChain && tokenChain !== forcedChain) return;
      const k = keyOf(message.token);
      setTokens(current => [message.token, ...current.filter(token => keyOf(token) !== k)].slice(0, 300));
      setSelected(current => current && keyOf(current) === k ? message.token : current);
    }
    if (message.type === 'token:update' && message.token) {
      const tokenChain = message.token.chain || 'solana';
      if (forcedChain && tokenChain !== forcedChain) return;
      const k = keyOf(message.token);
      setTokens(current => current.map(token => keyOf(token) === k ? message.token : token));
      setSelected(current => current && keyOf(current) === k ? message.token : current);
    }
    if (message.type === 'token:discarded' && message.token && activeFeedRef.current === 'all') {
      const tokenChain = message.token.chain || 'solana';
      if (forcedChain && tokenChain !== forcedChain) return;
      const k = keyOf(message.token);
      setTokens(current => [message.token, ...current.filter(token => keyOf(token) !== k)].slice(0, 300));
      setSelected(current => current && keyOf(current) === k ? message.token : current);
    }
    if (message.type === 'token:listed') { fetchLists(); fetchTokens(); fetchCounts(); }
    // Live sleeper-wake / climber / revival / early runner events → transient banner queue.
    if (message.type === 'token:tracked:wake' && message.mint) {
      if (forcedChain && message.chain && message.chain !== forcedChain) return;
      if (forcedChain === 'solana' && message.mint.startsWith('0x')) return;
      setWakeEvents(current => [{
        id: `${message.mint}-${Date.now()}`,
        mint: message.mint,
        symbol: message.symbol,
        name: message.name || message.token?.name,
        chain: message.chain || (message.mint.startsWith('0x') ? 'robinhood' : 'solana'),
        kind: 'wake',
        text: `woke — ${(message.reasons || []).join('; ') || 'momentum spike'}`,
        priceUsd: message.priceUsd ?? message.token?.priceUsd,
        volume5mUsd: message.volume5mUsd ?? message.token?.volume5mUsd,
        marketCapUsd: message.marketCapUsd ?? message.token?.marketCapUsd,
        token: message.token || null,
      }, ...current].slice(0, 5));
    }
    if (message.type === 'token:revival' && message.token) {
      const t = message.token;
      if (forcedChain && (t.chain || (t.mint?.startsWith('0x') ? 'robinhood' : 'solana')) !== forcedChain) return;
      setWakeEvents(current => [{
        id: `${t.mint}-${Date.now()}`,
        mint: t.mint,
        symbol: t.symbol,
        name: t.name,
        chain: t.chain || (t.mint?.startsWith('0x') ? 'robinhood' : 'solana'),
        kind: 'revival',
        text: `revival — ${t.revivedAgeDays ?? '?'}d old${t.revivalHeat ? `, vol x${t.revivalHeat}` : ''}`,
        priceUsd: t.priceUsd,
        volume5mUsd: t.volume5mUsd,
        marketCapUsd: t.marketCapUsd,
        token: t,
      }, ...current].slice(0, 5));
    }
    if (message.type === 'token:early-call' && message.token) {
      const t = message.token;
      if (forcedChain && (t.chain || 'solana') !== forcedChain) return;
      setWakeEvents(current => [{
        id: `${t.mint}-${Date.now()}`,
        mint: t.mint,
        symbol: t.symbol,
        name: t.name,
        chain: t.chain || 'solana',
        kind: 'early',
        text: `🚀 Early Runner — MCap $${Math.round(t.marketCapUsd || 0).toLocaleString()}, 5m Vol $${Math.round(t.volume5mUsd || 0).toLocaleString()}`,
        priceUsd: t.priceUsd,
        volume5mUsd: t.volume5mUsd,
        marketCapUsd: t.marketCapUsd,
        token: t,
      }, ...current].slice(0, 5));
    }
    if (message.type === 'token:climber' && message.mint) {
      if (forcedChain && message.chain && message.chain !== forcedChain) return;
      if (forcedChain === 'solana' && message.mint.startsWith('0x')) return;
      setWakeEvents(current => [{
        id: `${message.mint}-${Date.now()}`,
        mint: message.mint,
        symbol: message.symbol,
        name: message.name || message.token?.name,
        chain: message.chain || (message.mint.startsWith('0x') ? 'robinhood' : 'solana'),
        kind: 'climber',
        text: 'slow climber confirmed',
        priceUsd: message.priceUsd ?? message.token?.priceUsd,
        volume5mUsd: message.volume5mUsd ?? message.token?.volume5mUsd,
        marketCapUsd: message.marketCapUsd ?? message.token?.marketCapUsd,
        token: message.token || null,
      }, ...current].slice(0, 5));
    }
  }, [fetchLists, fetchTokens, fetchCounts, forcedChain, scannerPaused]);

  const { backend, wsOn, refresh } = useBackend({ onMessage: handleMessage });

  useEffect(() => {
    if (backend) {
      fetchLists();
      fetchCounts();
      fetchTokens();
    }
  }, [backend, activeFeed, chain, forcedChain, fetchLists, fetchTokens, fetchCounts]);

  const activeCustom = activeFeed.startsWith('list:') ? lists.find(list => list.id === activeFeed.slice(5)) : null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scopedChain = forcedChain || chain;
    const result = tokens.filter(token => {
      if (needle && !`${token.name || ''} ${token.symbol || ''} ${token.mint}`.toLowerCase().includes(needle)) return false;
      if (scopedChain && (token.chain || 'solana') !== scopedChain) return false;
      if (source && token.source !== source) return false;
      if (minScore && (token.safety?.score ?? 0) < minScore) return false;
      if (minLiquidity && (token.liquidityUsd ?? 0) < minLiquidity) return false;
      if (minVolume5m && (token.volume5mUsd ?? 0) < minVolume5m) return false;
      if (maxAgeMin && (!token.createdAt || Date.now() - token.createdAt > maxAgeMin * 60_000)) return false;
      return true;
    });
    const sorters = {
      traction: (a, b) => (b.traction?.tractionScore ?? 0) - (a.traction?.tractionScore ?? 0),
      newest: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      volume5m: (a, b) => (b.volume5mUsd ?? 0) - (a.volume5mUsd ?? 0),
      liquidity: (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
      marketCap: (a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0),
      safety: (a, b) => (b.safety?.score ?? 0) - (a.safety?.score ?? 0),
      price: (a, b) => (b.priceUsd ?? 0) - (a.priceUsd ?? 0),
      change1h: (a, b) => (b.priceChange?.h1 ?? -Infinity) - (a.priceChange?.h1 ?? -Infinity),
    };
    const sorted = result.sort(sorters[sortBy] || sorters.traction);
    return sortDirection === 'asc' ? sorted.reverse() : sorted;
  }, [tokens, query, chain, forcedChain, source, minScore, minLiquidity, minVolume5m, maxAgeMin, sortBy, sortDirection]);

  useEffect(() => {
    localStorage.setItem('memeScannerSort', sortBy);
    localStorage.setItem('memeScannerSortDirection', sortDirection);
  }, [sortBy, sortDirection]);

  const handleSort = key => {
    if (sortBy === key) setSortDirection(current => current === 'desc' ? 'asc' : 'desc');
    else { setSortBy(key); setSortDirection('desc'); }
  };

  const prepareTrade = useCallback((token, side) => {
    setSelected(token);
    setTradeRequest({ tokenKey: token.key || `${token.chain || 'solana'}:${token.mint}`, side, nonce: Date.now() });
    setTimeout(() => document.querySelector('.trade-ticket')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, []);

  useEffect(() => {
    if (filtered.length && !filtered.some(token => token.mint === selected?.mint)) setSelected(filtered[0]);
  }, [filtered, selected?.mint]);

  const selectFeed = value => {
    activeFeedRef.current = value;
    localStorage.setItem('memeActiveFeed', value);
    navigate(`${basePath}/${encodeURIComponent(value)}`);
    if (value === 'curated') setSortBy('newest');
  };

  const trackToken = async token => {
    if (!token?.mint) return;
    try { await api.trackToken(token.mint); toast.success(`Tracking ${token.symbol || 'token'}`); }
    catch (error) { toast.error(error.message); }
  };

  // Jump to a token from a wake banner: pull it into the feed, select it, and expand its row in scanner
  const focusMint = async (mint, directToken = null) => {
    let target = directToken || tokens.find(token => token.mint === mint);
    if (!target) {
      try {
        const data = await api.token(mint);
        if (data?.token) {
          target = data.token;
          setTokens(current => [data.token, ...current.filter(t => t.mint !== mint)]);
        }
      } catch { /* ignore */ }
    }
    if (!target) {
      try {
        const data = await api.tokens({ view: 'all', limit: 500 });
        target = (data.tokens || []).find(token => token.mint === mint);
        if (target) {
          setTokens(current => [target, ...current.filter(t => t.mint !== mint)]);
        }
      } catch { /* offline banner handles this */ }
    }
    if (target) {
      setSelected(target);
      const key = target.key || `${target.chain || 'solana'}:${target.mint}`;
      setExpandedKeys(new Set([key]));
      setTimeout(() => {
        document.getElementById(`token-row-${target.mint}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    }
  };

  const dismissWake = id => setWakeEvents(current => current.filter(event => event.id !== id));

  const duplicateStrategy = async id => {
    toast.error('Legacy strategies can no longer be duplicated.');
  };

  const updateCustomToken = async (action, token) => {
    if (!activeCustom || !token) return;
    const tokenKey = `${token.chain || 'solana'}:${token.mint}`;
    try {
      const response = await fetch(`${getBackendUrl()}/api/lists/${activeCustom.id}/${action}`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'pins' ? { tokenKey, pinned: true } : { tokenKey, excluded: true }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not update the custom strategy');
      await fetchLists();
      await fetchTokens();
      toast.success(action === 'pins' ? 'Token pinned to this strategy' : 'Token permanently excluded');
    } catch (error) { toast.error(error.message); }
  };

  const reconnect = () => {
    setBackendUrl(urlDraft);
    setApiToken(tokenDraft.trim());
    window.location.reload();
  };

  const openPositions = portfolio.positions.filter(position => position.status === 'open');
  const openOrders = portfolio.orders.filter(order => order.status === 'open');

  const clearFilters = () => { setQuery(''); if (!forcedChain) setChain(''); setSource(''); setMinScore(0); setMinLiquidity(0); setMinVolume5m(0); setMaxAgeMin(0); };
  const filtersActive = query || (!forcedChain && chain) || source || minScore || minLiquidity || minVolume5m || maxAgeMin;

  return (
    <div className="meme-terminal-container">
      <div className="page-header page-header-row meme-page-header" style={{ marginBottom: '0.65rem' }}>
        <div><h2 style={{ margin: 0 }}>{terminalMeta?.title || 'Meme Finder Terminal'}</h2></div>
        <div className="terminal-header-stats">
          <button
            type="button"
            className={`btn-xs ${scannerPaused ? 'btn-outline' : 'btn-primary'}`}
            style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 8px', borderRadius: '4px' }}
            onClick={() => {
              const next = !scannerPaused;
              setScannerPaused(next);
              localStorage.setItem('memeScannerPaused', String(next));
            }}
            title={scannerPaused ? 'Resume live discovery scanner' : 'Pause live discovery scanner'}
          >
            {scannerPaused ? '⏸️ Scanner: Paused' : '▶️ Scanner: Active'}
          </button>
          <span><StatusDot on={wsOn && !scannerPaused} pulse={!scannerPaused} /> {scannerPaused ? 'Scanner paused' : (wsOn ? 'Live feed' : 'Reconnecting')}</span>
          <span><strong>{openPositions.length}</strong> positions</span>
          <span><strong>{openOrders.length}</strong> orders</span>
        </div>
      </div>

      {scannerPaused && (
        <div className="conn-banner" style={{
          backgroundColor: 'rgba(99, 102, 241, 0.06)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          borderRadius: '5px',
          padding: '6px 12px',
          marginBottom: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '0.75rem',
        }}>
          <span style={{ color: '#4b5563' }}>
            ⏸️ Scanner paused · Active workspace focus is on <strong>Tracked Wallets</strong> &amp; <strong>Tracked Memes</strong>
          </span>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              className="btn-outline btn-xs"
              onClick={() => navigate('/smart-wallets')}
              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
            >
              Tracked Wallets →
            </button>
            <button
              type="button"
              className="btn-outline btn-xs"
              onClick={() => navigate('/tracked-memes')}
              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
            >
              Tracked Memes →
            </button>
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={() => {
                setScannerPaused(false);
                localStorage.setItem('memeScannerPaused', 'false');
              }}
              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
            >
              Resume Scanner
            </button>
          </div>
        </div>
      )}

      {backend === null && <div className="conn-banner offline"><StatusDot on={false} /><div className="backend-offline-copy"><strong>Trading backend offline</strong><span>Start the backend or update its URL.</span></div><input className="input-field" value={urlDraft} onChange={event => setUrlDraft(event.target.value)} /><input className="input-field" type="password" placeholder="API token (if set)" value={tokenDraft} onChange={event => setTokenDraft(event.target.value)} /><button className="btn-outline" onClick={reconnect}>Connect</button></div>}
      {backend?.dryRun && <div className="conn-banner dryrun"><AlertTriangle size={15} /><span><strong>Paper trading is active.</strong> Orders use live observations but simulated execution.</span></div>}

      <KpiStrip tokens={tokens} positions={portfolio.positions} trades={portfolio.trades} />

      <div className="meme-terminal-grid">
        <main className="meme-center-column">
          <div className="strategy-tab-bar">
            <button
              type="button"
              className={`strategy-tab ${activeFeed === 'curated' || activeFeed === 'alpha' ? 'active' : ''}`}
              onClick={() => selectFeed('curated')}
            >
              <Flame size={13} />
              <span>Alpha Calls</span>
              <span className="strategy-tab-badge">
                {feedCounts.curated || (activeFeed === 'curated' ? tokens.length : 0)}
              </span>
            </button>

            <button
              type="button"
              className={`strategy-tab ${activeFeed === 'view:tracked' ? 'active' : ''}`}
              onClick={() => selectFeed('view:tracked')}
            >
              <Radar size={13} />
              <span>Tracked &amp; Sleepers</span>
              <span className="strategy-tab-badge">
                {feedCounts.tracked}
              </span>
            </button>

            <button
              type="button"
              className={`strategy-tab ${activeFeed === 'all' ? 'active' : ''}`}
              onClick={() => selectFeed('all')}
            >
              <Coins size={13} />
              <span>All Markets</span>
              <span className="strategy-tab-badge">
                {feedCounts.all || (activeFeed === 'all' ? tokens.length : 0)}
              </span>
            </button>

            {lists.map(list => (
              <button
                key={list.id}
                type="button"
                className={`strategy-tab ${activeFeed === `list:${list.id}` ? 'active' : ''}`}
                onClick={() => selectFeed(`list:${list.id}`)}
              >
                <span>{list.name}</span>
                {list.matched?.length > 0 && <span className="strategy-tab-badge">{list.matched.length}</span>}
              </button>
            ))}

            <button
              type="button"
              className="strategy-tab-add"
              onClick={() => setShowListManager(true)}
              title="Manage custom strategy lists"
            >
              <Plus size={13} /> Custom Strategy
            </button>
          </div>

          {wakeEvents.length > 0 && (
            <div className="wake-strip">
              {wakeEvents.map(event => {
                const tokenChain = event.chain || (event.mint?.startsWith('0x') ? 'robinhood' : 'solana');
                const matchedToken = event.token || tokens.find(t => t.mint === event.mint);
                const price = event.priceUsd ?? matchedToken?.priceUsd;
                const vol5m = event.volume5mUsd ?? matchedToken?.volume5mUsd;
                const mcap = event.marketCapUsd ?? matchedToken?.marketCapUsd;
                const dexscreenerUrl = `https://dexscreener.com/${tokenChain}/${encodeURIComponent(event.mint)}`;
                const gmgnUrl = `https://gmgn.ai/${tokenChain === 'solana' ? 'sol' : 'robinhood'}/token/${encodeURIComponent(event.mint)}`;
                const explorerUrl = tokenChain === 'solana'
                  ? `https://solscan.io/token/${encodeURIComponent(event.mint)}`
                  : `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(event.mint)}`;

                return (
                  <div key={event.id} className={`wake-banner ${event.kind}`}>
                    <button
                      type="button"
                      className="wake-banner-body"
                      onClick={() => focusMint(event.mint, matchedToken)}
                      title="Click to view charts, metrics & trade ticket"
                    >
                      <Flame size={15} className="wake-flame-icon" />
                      <div className="wake-token-identity">
                        <strong>${event.symbol || event.mint.slice(0, 6)}</strong>
                        <span className="wake-badge-chain">{tokenChain}</span>
                      </div>
                      <span className="wake-alert-text">{event.text}</span>

                      <div className="wake-metrics-row">
                        {price != null && Number(price) > 0 && (
                          <span className="wake-metric-pill">
                            ${Number(price) < 0.0001 ? Number(price).toExponential(2) : Number(price).toFixed(4)}
                          </span>
                        )}
                        {vol5m != null && Number(vol5m) > 0 && (
                          <span className="wake-metric-pill">
                            5m Vol: ${(Number(vol5m) >= 1000 ? `${(vol5m / 1000).toFixed(1)}k` : Number(vol5m).toFixed(0))}
                          </span>
                        )}
                        {mcap != null && Number(mcap) > 0 && (
                          <span className="wake-metric-pill">
                            MCap: ${(Number(mcap) >= 1000 ? `${(mcap / 1000).toFixed(0)}k` : Number(mcap).toFixed(0))}
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="wake-actions-row">
                      <a
                        href={dexscreenerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="wake-ext-link"
                        title="Open DexScreener Chart"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={12} /> DexScreener
                      </a>
                      <a
                        href={gmgnUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="wake-ext-link"
                        title="Open GMGN"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={12} /> GMGN
                      </a>
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="wake-ext-link"
                        title="View on Explorer"
                        onClick={e => e.stopPropagation()}
                      >
                        <Link2 size={12} /> Explorer
                      </a>
                      <button
                        type="button"
                        className="btn-primary btn-xs wake-inspect-btn"
                        onClick={() => focusMint(event.mint, matchedToken)}
                      >
                        <Eye size={12} /> Inspect
                      </button>
                      <button
                        type="button"
                        className="wake-banner-dismiss"
                        onClick={() => dismissWake(event.id)}
                        title="Dismiss"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="terminal-toolbar">
            <div className="search-field terminal-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search token, ticker, or contract" /></div>
            {forcedChain ? (
              <span className="terminal-chain-lock" title={forcedChain === 'solana' ? 'Solana terminal — chain locked' : 'EVM terminal — Robinhood (4663) locked'}>{forcedChain === 'solana' ? 'Solana' : 'Robinhood'}</span>
            ) : (
              <select className="select-field terminal-chain-select" value={chain} onChange={event => setChain(event.target.value)}><option value="">Solana + Robinhood</option><option value="solana">Solana</option><option value="robinhood">Robinhood</option></select>
            )}
            <button className={`btn-outline terminal-filter-button ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(current => !current)}><Filter size={14} /> Filters</button>
            <button className="icon-button-ghost" onClick={() => { refresh(); fetchTokens(); fetchCounts(); portfolio.refresh(); }} title="Refresh terminal"><RefreshCw size={14} /></button>
          </div>
          {showFilters && <div className="terminal-filter-drawer"><div className="form-group"><label className="form-label">Source</label><select className="select-field" value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{[...new Set(tokens.map(token => token.source).filter(Boolean))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></div><div className="form-group"><label className="form-label">Minimum safety</label><select className="select-field" value={minScore} onChange={event => setMinScore(Number(event.target.value))}><option value="0">Any</option><option value="40">40+</option><option value="60">60+</option><option value="75">75+</option></select></div><div className="form-group"><label className="form-label">Minimum liquidity</label><select className="select-field" value={minLiquidity} onChange={event => setMinLiquidity(Number(event.target.value))}><option value="0">Any</option><option value="5000">$5k+</option><option value="10000">$10k+</option><option value="50000">$50k+</option></select></div><div className="form-group"><label className="form-label">Minimum 5m volume</label><select className="select-field" value={minVolume5m} onChange={event => setMinVolume5m(Number(event.target.value))}><option value="0">Any</option><option value="1000">$1k+</option><option value="10000">$10k+</option><option value="50000">$50k+</option></select></div><div className="form-group"><label className="form-label">Maximum age</label><select className="select-field" value={maxAgeMin} onChange={event => setMaxAgeMin(Number(event.target.value))}><option value="0">Any</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">24 hours</option></select></div><div className="form-group"><label className="form-label">Sort by</label><select className="select-field" value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="traction">Traction</option><option value="newest">Newest</option><option value="volume5m">5m volume</option><option value="liquidity">Liquidity</option><option value="marketCap">Market cap</option><option value="safety">Safety</option><option value="change1h">1h change</option><option value="price">Price</option></select></div></div>}

          <div className="active-strategy-band">
            <div>
              <span className={`strategy-icon ${activeCustom?.color || 'violet'}`}>
                {(activeFeed === 'curated' || activeFeed === 'alpha') ? <Flame size={14} /> : activeFeed === 'view:tracked' ? <Radar size={14} /> : activeFeed === 'all' ? <Coins size={14} /> : <SlidersHorizontal size={14} />}
              </span>
              <div>
                <strong>
                  {(activeFeed === 'curated' || activeFeed === 'alpha')
                    ? '🔥 Alpha Calls (Curated + Traction)'
                    : activeFeed === 'view:tracked'
                    ? '📡 Tracked Sleepers & Climbers'
                    : activeFeed === 'all'
                    ? '🪙 All Live Markets'
                    : activeCustom?.name || 'Custom Strategy Scanner'}
                </strong>
                <small>
                  {(activeFeed === 'curated' || activeFeed === 'alpha')
                    ? 'High-conviction tokens passing 2-layer safety, traction, and smart money filters'
                    : activeFeed === 'view:tracked'
                    ? 'Watchlist tokens monitored for volume/liquidity breakouts and dormancy wakeups'
                    : activeFeed === 'all'
                    ? 'Real-time multi-source market stream from Pump.fun and Raydium'
                    : `${activeCustom?.matched?.length || 0} saved matches`}
                </small>
              </div>
            </div>
            <span className="strategy-match-count">{filtered.length} matches</span>
          </div>

          <section className="scanner-panel">
            <div className="scanner-panel-head">
              <div>
                <span className="section-kicker">Live matches</span>
                <h3>Token scanner</h3>
              </div>
              <span>{filtered.length} of {tokens.length} markets</span>
            </div>
            <TokenScanner
              tokens={filtered}
              selected={selected}
              onSelect={setSelected}
              expandedKeys={expandedKeys}
              onToggle={toggleExpanded}
              onTrack={trackToken}
              onTrade={prepareTrade}
              positions={portfolio.positions}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSort={handleSort}
              trackedMints={trackedMints}
              activeFeed={activeFeed}
              customList={activeCustom}
              onPin={token => updateCustomToken('pins', token)}
              onExclude={token => updateCustomToken('exclusions', token)}
              emptyAction={filtersActive ? <button className="btn-outline btn-sm" onClick={clearFilters}><X size={13} /> Clear all filters</button> : null}
            />
          </section>

          <MemePortfolioDock 
            positions={portfolio.positions} 
            orders={portfolio.orders} 
            trades={portfolio.trades} 
            fills={portfolio.fills} 
            pnl={portfolio.pnl} 
            loading={portfolio.loading} 
            onRefresh={portfolio.refresh} 
            wallets={walletDirectory?.wallets || []}
            selectedWalletAddress={selectedPortfolioWallet}
            onWalletChange={setSelectedPortfolioWallet}
          />
        </main>

        <aside className="meme-right-rail">
          <TradeTicket
            token={selected}
            positions={portfolio.positions}
            requestedSide={tradeRequest}
            onChanged={portfolio.refresh}
            dryRun={backend?.dryRun}
            backend={backend}
            wallets={walletDirectory?.wallets || []}
          />
        </aside>
      </div>

      <CustomListsModal open={showListManager} onClose={() => setShowListManager(false)} lists={lists} ruleFields={ruleFields} onChanged={fetchLists} />
    </div>
  );
}
