import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Flame, RefreshCw, Sparkles, X } from 'lucide-react';
import { api } from '../../utils/sniperApi';
import { ago, fmtUsd } from '../../utils/format';
import { Pill } from '../ui/Primitives';
import { useToast } from '../ui/useToast';
import Sparkline from './Sparkline';

const REASON_LABEL = { auto: 'auto', manual: 'pinned', curated: 'curated', revival: 'revival' };

// Long-horizon watchlist: sleepers, day-2 runners, slow climbers, and revivals.
// Surfaces the tracked-tier data the backend already computes but never showed.
export default function TrackedPanel({ forcedChain = '', selectedMint, onSelect, lastWake }) {
  const toast = useToast();
  const [tracked, setTracked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chainTab, setChainTab] = useState(forcedChain || 'all');

  const load = useCallback(async () => {
    try {
      const data = await api.tracked();
      let list = (data.tracked || []).filter(entry => {
        const mcap = entry.marketCapUsd;
        const peakMcap = Math.max(entry.peakMarketCapUsd ?? 0, mcap ?? 0);
        if (mcap != null && Number.isFinite(mcap)) {
          if (mcap < 4000) return false;
          if (peakMcap >= 300000 && mcap < 10000) return false;
          if (peakMcap >= 50000 && mcap < 5000) return false;
        }
        return true;
      });
      if (forcedChain) {
        list = list.filter(entry => {
          const entryChain = entry.chain || (entry.mint?.startsWith('0x') ? 'robinhood' : 'solana');
          return entryChain === forcedChain;
        });
      }
      setTracked(list);
    } catch { /* offline banner handles this */ }
    finally { setLoading(false); }
  }, [forcedChain]);

  useEffect(() => { load(); }, [load]);
  // A wake or climber event elsewhere means the list changed — refetch.
  useEffect(() => { if (lastWake) load(); }, [lastWake, load]);

  const untrack = async (mint, event) => {
    event.stopPropagation();
    try { await api.untrack(mint); toast.success('Removed from tracked'); load(); }
    catch (error) { toast.error(error.message); }
  };

  const solanaCount = useMemo(() =>
    tracked.filter(e => (e.chain || (e.mint?.startsWith('0x') ? 'robinhood' : 'solana')) === 'solana').length,
    [tracked]
  );
  const robinhoodCount = useMemo(() =>
    tracked.filter(e => (e.chain || (e.mint?.startsWith('0x') ? 'robinhood' : 'solana')) === 'robinhood').length,
    [tracked]
  );

  const displayList = useMemo(() => {
    if (forcedChain) return tracked;
    if (chainTab === 'solana') {
      return tracked.filter(e => (e.chain || (e.mint?.startsWith('0x') ? 'robinhood' : 'solana')) === 'solana');
    }
    if (chainTab === 'robinhood') {
      return tracked.filter(e => (e.chain || (e.mint?.startsWith('0x') ? 'robinhood' : 'solana')) === 'robinhood');
    }
    return tracked;
  }, [tracked, forcedChain, chainTab]);

  const sorted = useMemo(() => [...displayList].sort((a, b) => {
    const aw = a.lastWakeAt || 0, bw = b.lastWakeAt || 0;
    if (aw !== bw) return bw - aw; // most recently woken first
    return (b.promotedAt || 0) - (a.promotedAt || 0);
  }), [displayList]);

  return (
    <section className="tracked-panel">
      <div className="scanner-panel-head">
        <div><span className="section-kicker">Long-horizon watchlist</span><h3>Tracked &amp; Sleepers {forcedChain ? `(${forcedChain === 'solana' ? 'Solana' : 'Robinhood'})` : ''}</h3></div>
        <div className="tracked-head-actions">
          <span>{sorted.length} tracked</span>
          <button className="icon-button-ghost" onClick={load} title="Refresh tracked"><RefreshCw size={14} /></button>
        </div>
      </div>

      {!forcedChain && (
        <div className="strategy-tab-bar" style={{ padding: '0.4rem 0.8rem 0.2rem', display: 'flex', gap: '0.4rem', borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
          <button
            type="button"
            className={`strategy-tab ${chainTab === 'all' ? 'active' : ''}`}
            onClick={() => setChainTab('all')}
          >
            <span>All Chains</span>
            <span className="strategy-tab-badge">{tracked.length}</span>
          </button>
          <button
            type="button"
            className={`strategy-tab ${chainTab === 'solana' ? 'active' : ''}`}
            onClick={() => setChainTab('solana')}
          >
            <span>Solana</span>
            <span className="strategy-tab-badge">{solanaCount}</span>
          </button>
          <button
            type="button"
            className={`strategy-tab ${chainTab === 'robinhood' ? 'active' : ''}`}
            onClick={() => setChainTab('robinhood')}
          >
            <span>Robinhood / EVM</span>
            <span className="strategy-tab-badge">{robinhoodCount}</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="scanner-empty"><span className="spinner" /><strong>Loading tracked tokens…</strong></div>
      ) : sorted.length === 0 ? (
        <div className="scanner-empty">
          <Activity size={28} />
          <strong>No tracked {forcedChain ? (forcedChain === 'solana' ? 'Solana ' : 'Robinhood ') : ''}tokens yet</strong>
          <span>Tokens auto-promote here after surviving 6h with liquidity, hitting traction 60+, getting curated, or a revival. You can also pin any token with the Track button.</span>
        </div>
      ) : (
        <div className="scanner-table-wrap">
          <table className="data-table scanner-table tracked-table">
            <thead><tr><th>Token</th><th>Age</th><th>Promoted</th><th>Signals</th><th>Wakes</th><th>Trend</th><th /></tr></thead>
            <tbody>{sorted.filter(entry => entry && typeof entry.mint === 'string').map(entry => {
              const wokeRecently = entry.lastWakeAt && Date.now() - entry.lastWakeAt < 60 * 60_000;
              return (
                <tr key={entry.mint} className={selectedMint === entry.mint ? 'selected' : ''} onClick={() => onSelect?.(entry)}>
                  <td>
                    <div className="scanner-token-cell">
                      <span>{(entry.symbol || '?').slice(0, 2)}</span>
                      <div><strong>{entry.symbol || '?'}</strong><small>{entry.name || entry.mint.slice(0, 8)}</small></div>
                      {entry.climber && <Pill color="green">climber</Pill>}
                      {wokeRecently && <Pill color="yellow">awake</Pill>}
                    </div>
                  </td>
                  <td className="text-muted">{ago(entry.promotedAt)}</td>
                  <td><Pill color={entry.reason === 'revival' ? 'green' : entry.reason === 'manual' ? 'blue' : 'gray'}>{REASON_LABEL[entry.reason] || entry.reason}</Pill></td>
                  <td>
                    <div className="tracked-signals">
                      {entry.tractionScore != null && <span className="traction-mini">T {entry.tractionScore}</span>}
                      {entry.liquidityUsd != null && <span className="mono text-dim">{fmtUsd(entry.liquidityUsd)}</span>}
                      {entry.climber && <Sparkles size={12} className="text-green" title="Slow climber" />}
                    </div>
                  </td>
                  <td>
                    {entry.wakeCount > 0
                      ? <span className="tracked-wake"><Flame size={12} /> {entry.wakeCount}{entry.lastWakeAt && <small> · {ago(entry.lastWakeAt)}</small>}</span>
                      : <span className="text-dim">—</span>}
                  </td>
                  <td><Sparkline points={entry.priceHistory30m} /></td>
                  <td><button className="icon-btn-danger" onClick={e => untrack(entry.mint, e)} title="Untrack"><X size={13} /></button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
