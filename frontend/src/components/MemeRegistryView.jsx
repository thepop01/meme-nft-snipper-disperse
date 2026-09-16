import React, { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { getBackendUrl, authHeaders } from '../utils/sniperApi';

function fmtCurrency(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}k`;
  return `$${abs.toFixed(2)}`;
}

export default function MemeRegistryView({ initialMemes = null } = {}) {
  const [memes, setMemes] = useState(initialMemes ? { memes: initialMemes } : null);
  const [loading, setLoading] = useState(!initialMemes);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'backfilled' | 'pending_worker3'

  const fetchMemes = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/memes/registry`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Backend response ${res.status}`);
      const json = await res.json();
      setMemes(json);
    } catch (e) {
      // Silent catch as per spec
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialMemes) {
      fetchMemes();
    }
  }, [initialMemes]);

  const allMemes = useMemo(() => memes?.memes || [], [memes]);

  const filteredMemes = useMemo(() => {
    let list = allMemes;

    // Status filter
    if (filterStatus === 'backfilled') {
      list = list.filter(m => m.backfilled === true);
    } else if (filterStatus === 'pending_worker3') {
      list = list.filter(m => m.backfilled !== true);
    }

    // Search filter
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(m =>
      m.symbol?.toLowerCase().includes(q) ||
      m.contractAddress?.toLowerCase().includes(q)
    );
  }, [allMemes, filterStatus, search]);

  const backfilledCount = useMemo(() =>
    allMemes.filter(m => m.backfilled === true).length,
    [allMemes]
  );
  const pendingCount = useMemo(() =>
    allMemes.filter(m => m.backfilled !== true).length,
    [allMemes]
  );

  return (
    <div className="meme-terminal-container">
      {/* Page Header */}
      <div className="page-header page-header-row meme-page-header">
        <div>
          <span className="page-eyebrow">Distributed Meme Workers · Registry</span>
          <h2>Tracked Memes Registry</h2>
          <p>
            All-memes backfill tracking across workers. Worker 1 captures Current Mcap &gt; $2M,
            Worker 2 ATH Mcap &gt; $4M, and Worker 3 processes unbackfilled entries.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button
            type="button"
            className="icon-button-ghost"
            onClick={fetchMemes}
            title="Refresh memes"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem', marginBottom: '1.25rem' }}>
        <div
          className="card"
          style={{ padding: '0.8rem 1rem', background: 'var(--card-bg, #ffffff)', border: filterStatus === 'all' ? '2px solid #6366f1' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
          onClick={() => setFilterStatus('all')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
            <span>All Memes</span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#111827' }}>
            {allMemes.length}
          </div>
        </div>

        <div
          className="card"
          style={{ padding: '0.8rem 1rem', background: 'var(--card-bg, #ffffff)', border: filterStatus === 'backfilled' ? '2px solid #059669' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
          onClick={() => setFilterStatus('backfilled')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              ✅ Backfilled
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#059669' }}>
            {backfilledCount}
          </div>
        </div>

        <div
          className="card"
          style={{ padding: '0.8rem 1rem', background: 'var(--card-bg, #ffffff)', border: filterStatus === 'pending_worker3' ? '2px solid #f59e0b' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
          onClick={() => setFilterStatus('pending_worker3')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              ⏳ Pending Worker 3
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {pendingCount}
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className={`btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setFilterStatus('all')}
        >
          All ({allMemes.length})
        </button>
        <button
          type="button"
          className={`btn-sm ${filterStatus === 'backfilled' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setFilterStatus('backfilled')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
        >
          ✅ Backfilled ({backfilledCount})
        </button>
        <button
          type="button"
          className={`btn-sm ${filterStatus === 'pending_worker3' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setFilterStatus('pending_worker3')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
        >
          ⏳ Pending Worker 3 ({pendingCount})
        </button>

        <div className="search-field" style={{ flex: 1, minWidth: '240px', maxWidth: '380px', marginLeft: 'auto' }}>
          <Search size={15} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search token symbol or contract address..."
          />
        </div>

        <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>
          Showing {filteredMemes.length} of {allMemes.length}
        </span>
      </div>

      {/* Memes Table */}
      <div className="panel" style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        {filteredMemes.length === 0 ? (
          <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#6b7280' }}>
            <p style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>No memes found</p>
            {search && (
              <p style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Try adjusting your search terms</p>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Contract Address</th>
                  <th>Current Mcap</th>
                  <th>ATH Mcap</th>
                  <th>24h Volume</th>
                  <th>Sources</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredMemes.map(m => (
                  <tr key={`${m.chain}:${m.contractAddress}`}>
                    <td>
                      <strong style={{ color: '#111827', fontSize: '0.9rem' }}>
                        {m.symbol || 'N/A'}
                      </strong>
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{ fontSize: '0.78rem', color: '#6b7280' }}
                        title={m.contractAddress}
                      >
                        {m.contractAddress
                          ? `${m.contractAddress.slice(0, 6)}…${m.contractAddress.slice(-4)}`
                          : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <strong style={{ color: '#111827', fontSize: '0.88rem' }}>
                        {m.currentMcap ? fmtCurrency(m.currentMcap) : '—'}
                      </strong>
                    </td>
                    <td>
                      <strong style={{ color: '#111827', fontSize: '0.88rem' }}>
                        {m.athMcap ? fmtCurrency(m.athMcap) : '—'}
                      </strong>
                    </td>
                    <td>
                      <span style={{ color: '#111827', fontSize: '0.88rem' }}>
                        {m.volume24h ? fmtCurrency(m.volume24h) : '—'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {Array.isArray(m.sourceFlags) && m.sourceFlags.map((src, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '0.65rem',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              background: '#f3f4f6',
                              color: '#4b5563',
                            }}
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          background: m.backfilled ? '#dcfce7' : '#fef3c7',
                          color: m.backfilled ? '#166534' : '#92400e',
                        }}
                      >
                        {m.backfilled ? '✅ Backfilled' : '⏳ Pending Worker 3'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
