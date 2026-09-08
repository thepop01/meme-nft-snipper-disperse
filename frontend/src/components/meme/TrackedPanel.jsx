import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Flame, RefreshCw, Sparkles, X } from 'lucide-react';
import { api } from '../../utils/sniperApi';
import { ago, fmtUsd } from '../../utils/format';
import { Pill } from '../ui/Primitives';
import { useToast } from '../ui/useToast';
import Sparkline from './Sparkline';

const REASON_LABEL = { auto: 'auto', manual: 'pinned', curated: 'curated', revival: 'revival' };

// Long-horizon watchlist: sleepers, day-2 runners, slow climbers, and revivals.
// Surfaces the tracked-tier data the backend already computes but never showed.
export default function TrackedPanel({ selectedMint, onSelect, lastWake }) {
  const toast = useToast();
  const [tracked, setTracked] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.tracked();
      setTracked(data.tracked || []);
    } catch { /* offline banner handles this */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // A wake or climber event elsewhere means the list changed — refetch.
  useEffect(() => { if (lastWake) load(); }, [lastWake, load]);

  const untrack = async (mint, event) => {
    event.stopPropagation();
    try { await api.untrack(mint); toast.success('Removed from tracked'); load(); }
    catch (error) { toast.error(error.message); }
  };

  const sorted = [...tracked].sort((a, b) => {
    const aw = a.lastWakeAt || 0, bw = b.lastWakeAt || 0;
    if (aw !== bw) return bw - aw; // most recently woken first
    return (b.promotedAt || 0) - (a.promotedAt || 0);
  });

  return (
    <section className="tracked-panel">
      <div className="scanner-panel-head">
        <div><span className="section-kicker">Long-horizon watchlist</span><h3>Tracked &amp; Sleepers</h3></div>
        <div className="tracked-head-actions">
          <span>{tracked.length} tracked</span>
          <button className="icon-button-ghost" onClick={load} title="Refresh tracked"><RefreshCw size={14} /></button>
        </div>
      </div>

      {loading ? (
        <div className="scanner-empty"><span className="spinner" /><strong>Loading tracked tokens…</strong></div>
      ) : sorted.length === 0 ? (
        <div className="scanner-empty">
          <Activity size={28} />
          <strong>No tracked tokens yet</strong>
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
