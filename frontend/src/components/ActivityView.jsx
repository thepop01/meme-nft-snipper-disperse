import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ExternalLink, RefreshCw, Server, ShieldAlert } from 'lucide-react';
import { api, subscribeWs } from '../utils/sniperApi';
import { ago } from '../utils/format';
import { Pill } from './ui/Primitives';

const TYPES = ['', 'trade', 'disperse', 'mint', 'wallet', 'alert', 'system'];

function transactionUrl(event) {
  if (!event.txHash || String(event.txHash).startsWith('paper')) return null;
  if ((event.chainId || 'solana') === 'solana') return `https://solscan.io/tx/${event.txHash}`;
  return null;
}

export default function ActivityView() {
  const [events, setEvents] = useState([]);
  const [health, setHealth] = useState(null);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const [activityData, healthData] = await Promise.all([
        api.activity(), api.providerHealth({ ...(force ? { force: 'true' } : {}) }),
      ]);
      setEvents(activityData.activity || []);
      setHealth(healthData);
    } catch (refreshError) { setError(refreshError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    return subscribeWs(message => {
      if (['alert:new', 'fill:confirmed', 'trade:executed', 'disperse:job', 'nft:job'].includes(message.type)) refresh();
    });
  }, [refresh]);

  const filtered = useMemo(() => events.filter(event => !type || event.type === type), [events, type]);

  return <div className="activity-container">
    <div className="page-header page-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
      <h2 style={{ margin: 0 }}>Activity</h2>
      <button className="btn-outline btn-xs" type="button" onClick={() => refresh(true)} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem' }}><RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh health</button>
    </div>
    {error && <div className="conn-banner offline"><ShieldAlert size={15} /><span>{error}</span></div>}

    <section className="provider-health-grid" aria-label="Provider health">
      {(health?.providers || []).map(provider => <article key={provider.id} className={`provider-health-card ${provider.status}`}>
        <Server size={17} /><div><span>{provider.name}</span><strong>{provider.status}</strong><small>{provider.error || `${provider.latencyMs} ms · checked ${ago(provider.checkedAt)}`}</small></div>
      </article>)}
      {!health && <div className="provider-health-card"><Server size={17} /><div><span>Providers</span><strong>{loading ? 'Checking…' : 'Unavailable'}</strong></div></div>}
    </section>

    <section className="panel activity-panel">
      <div className="activity-toolbar"><div><span className="section-kicker">Unified timeline</span><h3><Activity size={16} /> Audit and activity history</h3></div><div className="selector-chip-list">{TYPES.map(value => <button type="button" key={value || 'all'} className={`selector-chip ${type === value ? 'active' : ''}`} onClick={() => setType(value)}>{value || 'all'}</button>)}</div></div>
      {loading && events.length === 0 ? <div className="activity-skeleton" aria-label="Loading activity">{[1, 2, 3, 4, 5].map(value => <span key={value} />)}</div>
        : filtered.length === 0 ? <div className="empty-state"><Activity size={24} /><strong>No activity in this filter</strong></div>
          : <div className="activity-table-wrap"><table className="data-table activity-table"><thead><tr><th>Time</th><th>Type</th><th>Event</th><th>Subsystem</th><th>Details</th><th /></tr></thead><tbody>{filtered.map(event => { const href = event.link || transactionUrl(event); return <tr key={event.id}><td className="text-dim">{ago(event.ts)}</td><td><Pill color={event.severity === 'critical' || event.severity === 'high' ? 'red' : event.type === 'trade' ? 'green' : event.type === 'disperse' ? 'violet' : 'blue'}>{event.type}</Pill></td><td><strong>{event.title}</strong></td><td className="text-muted">{event.subsystem}</td><td className="text-dim">{event.detail || '—'}</td><td>{href && <a className="tx-link" href={href} target="_blank" rel="noreferrer" aria-label="Open related record"><ExternalLink size={12} /></a>}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}
