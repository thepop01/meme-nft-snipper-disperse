import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { getBackendUrl, authHeaders } from '../utils/sniperApi';
import Pagination from './ui/Pagination.jsx';

function fmtCurrency(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}k`;
  return `$${abs.toFixed(2)}`;
}

function formatDaysAgo(ts) {
  if (!ts || !Number.isFinite(Number(ts)) || ts <= 0) return null;
  const t = Number(ts) < 100_000_000_000 ? Number(ts) * 1000 : Number(ts);
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'recent';
  const diffDays = Math.floor(diffMs / (86400 * 1000));
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (3600 * 1000));
    return diffHours <= 1 ? 'just now' : `${diffHours}h ago`;
  }
  if (diffDays === 1) return '1d ago';
  return `${diffDays}d ago`;
}

function getMemeChain(meme) {
  if (meme.chain) return String(meme.chain).toLowerCase();
  const ca = meme.contractAddress || meme.ca || '';
  if (ca.startsWith('0x') || ca.startsWith('0X')) return 'robinhood';
  return 'solana';
}

export default function MemeRegistryView({ initialMemes = null, initialChain = 'all' } = {}) {
  const isClientSide = Boolean(initialMemes);
  const [memes, setMemes] = useState(initialMemes ? { memes: initialMemes } : null);
  const [loading, setLoading] = useState(!initialMemes);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'backfilled' | 'pending_worker3'
  const [chainTab, setChainTab] = useState(initialChain); // 'all' | 'solana' | 'robinhood'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounce search by 200ms
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const fetchMemes = useCallback(async () => {
    if (isClientSide) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        chain: chainTab,
        status: filterStatus,
        search: debouncedSearch.trim(),
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`${getBackendUrl()}/api/memes/registry?${params.toString()}`, {
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
  }, [isClientSide, chainTab, filterStatus, debouncedSearch, page, pageSize]);

  useEffect(() => {
    if (!isClientSide) {
      fetchMemes();
    }
  }, [isClientSide, fetchMemes]);

  // Client-side calculations when initialMemes is provided (e.g. tests or SSR)
  const clientAllMemes = useMemo(() => initialMemes || [], [initialMemes]);

  const solanaCount = useMemo(() => {
    if (isClientSide) return clientAllMemes.filter(m => getMemeChain(m) === 'solana').length;
    return memes?.solanaCount ?? (memes?.memes || []).filter(m => getMemeChain(m) === 'solana').length;
  }, [isClientSide, clientAllMemes, memes]);

  const robinhoodCount = useMemo(() => {
    if (isClientSide) return clientAllMemes.filter(m => getMemeChain(m) === 'robinhood').length;
    return memes?.robinhoodCount ?? (memes?.memes || []).filter(m => getMemeChain(m) === 'robinhood').length;
  }, [isClientSide, clientAllMemes, memes]);

  const totalAllChains = useMemo(() => {
    if (isClientSide) return clientAllMemes.length;
    if (memes?.solanaCount != null && memes?.robinhoodCount != null) {
      return memes.solanaCount + memes.robinhoodCount;
    }
    return memes?.total ?? (memes?.memes || []).length;
  }, [isClientSide, clientAllMemes.length, memes]);

  const activePool = useMemo(() => {
    if (!isClientSide) return memes?.memes || [];
    if (chainTab === 'solana') {
      return clientAllMemes.filter(m => getMemeChain(m) === 'solana');
    }
    if (chainTab === 'robinhood') {
      return clientAllMemes.filter(m => getMemeChain(m) === 'robinhood');
    }
    return clientAllMemes;
  }, [isClientSide, clientAllMemes, chainTab, memes]);

  const activePoolTotal = useMemo(() => {
    if (isClientSide) return activePool.length;
    if (chainTab === 'solana') return solanaCount;
    if (chainTab === 'robinhood') return robinhoodCount;
    return totalAllChains;
  }, [isClientSide, activePool.length, chainTab, solanaCount, robinhoodCount, totalAllChains]);

  const filteredMemes = useMemo(() => {
    if (!isClientSide) return memes?.memes || [];
    let list = activePool;

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
      (m.contractAddress || m.ca)?.toLowerCase().includes(q)
    );
  }, [isClientSide, activePool, filterStatus, search, memes]);

  const backfilledCount = useMemo(() => {
    if (!isClientSide && memes?.backfilledCount != null) return memes.backfilledCount;
    return activePool.filter(m => m.backfilled === true).length;
  }, [isClientSide, memes, activePool]);

  const pendingCount = useMemo(() => {
    if (!isClientSide && memes?.pendingCount != null) return memes.pendingCount;
    return activePool.filter(m => m.backfilled !== true).length;
  }, [isClientSide, memes, activePool]);

  const totalFilteredCount = useMemo(() => {
    if (!isClientSide) return memes?.total ?? (memes?.memes || []).length;
    return filteredMemes.length;
  }, [isClientSide, memes, filteredMemes.length]);

  const totalPages = useMemo(() => {
    if (!isClientSide) return memes?.totalPages ?? 1;
    return Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  }, [isClientSide, memes, totalFilteredCount, pageSize]);

  const displayedMemes = useMemo(() => {
    if (!isClientSide) return memes?.memes || [];
    const start = (page - 1) * pageSize;
    return filteredMemes.slice(start, start + pageSize);
  }, [isClientSide, memes, filteredMemes, page, pageSize]);

  return (
    <div className="meme-terminal-container">
      {/* Header: Title & Refresh */}
      <div className="page-header page-header-row meme-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Tracked Memes Registry</h2>
          <span style={{ fontSize: '0.7rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '4px' }}>
            Distributed Meme Workers (Worker 1 · Worker 2 · Worker 3)
          </span>
        </div>
        <button
          type="button"
          className="icon-button-ghost"
          onClick={fetchMemes}
          title="Refresh memes"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Consolidated Filter Toolbar: Chains, Status Filters, and Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
        {/* Chain Tabs */}
        <div className="strategy-tab-bar" style={{ margin: 0, display: 'flex', gap: '0.3rem' }}>
          <button
            type="button"
            className={`strategy-tab ${chainTab === 'all' ? 'active' : ''}`}
            onClick={() => { setChainTab('all'); setPage(1); }}
            style={{ padding: '0.22rem 0.55rem', fontSize: '0.72rem' }}
          >
            <span>All Chains</span>
            <span className="strategy-tab-badge">{totalAllChains}</span>
          </button>
          <button
            type="button"
            className={`strategy-tab ${chainTab === 'solana' ? 'active' : ''}`}
            onClick={() => { setChainTab('solana'); setPage(1); }}
            style={{ padding: '0.22rem 0.55rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#9333ea' }} />
            <span>Solana</span>
            <span className="strategy-tab-badge">{solanaCount}</span>
          </button>
          <button
            type="button"
            className={`strategy-tab ${chainTab === 'robinhood' ? 'active' : ''}`}
            onClick={() => { setChainTab('robinhood'); setPage(1); }}
            style={{ padding: '0.22rem 0.55rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }} />
            <span>Robinhood / EVM</span>
            <span className="strategy-tab-badge">{robinhoodCount}</span>
          </button>
        </div>

        {/* Status Filter Buttons with Live Counts */}
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setFilterStatus('all'); setPage(1); }}
            style={{ padding: '0.22rem 0.55rem', fontSize: '0.72rem' }}
          >
            <span>All ({activePoolTotal})</span>
            <span style={{ display: 'none' }}>All Memes: {activePoolTotal}</span>
          </button>
          <button
            type="button"
            className={`btn-sm ${filterStatus === 'backfilled' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setFilterStatus('backfilled'); setPage(1); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.22rem 0.55rem', fontSize: '0.72rem' }}
          >
            ✅ Backfilled ({backfilledCount})
          </button>
          <button
            type="button"
            className={`btn-sm ${filterStatus === 'pending_worker3' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setFilterStatus('pending_worker3'); setPage(1); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.22rem 0.55rem', fontSize: '0.72rem' }}
          >
            ⏳ Pending Worker 3 ({pendingCount})
          </button>
        </div>

        {/* Search Field */}
        <div className="search-field" style={{ flex: 1, minWidth: '180px', maxWidth: '280px', marginLeft: 'auto', padding: '0.22rem 0.55rem' }}>
          <Search size={13} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search token symbol or contract address..."
            style={{ fontSize: '0.75rem' }}
          />
        </div>
      </div>

      {/* Memes Table */}
      <div className="panel" style={{ background: '#ffffff', borderRadius: '6px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        {displayedMemes.length === 0 ? (
          <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: '#6b7280' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>No memes found</p>
            {search && (
              <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Try adjusting your search terms</p>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
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
                {displayedMemes.map(m => {
                  const address = m.contractAddress || m.ca || '';
                  const volume = m.volume24h ?? m.volume24hUsd ?? null;
                  const chain = getMemeChain(m);
                  return (
                    <tr key={`${chain}:${address || m.symbol}`}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <strong style={{ color: '#111827', fontSize: '0.8125rem' }}>
                            {m.symbol || 'N/A'}
                          </strong>
                          <span
                            style={{
                              fontSize: '0.625rem',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 600,
                              background: chain === 'solana' ? '#f3e8ff' : '#ecfdf5',
                              color: chain === 'solana' ? '#7c3aed' : '#047857',
                            }}
                          >
                            {chain === 'solana' ? 'SOL' : 'EVM'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className="mono"
                          style={{ fontSize: '0.6875rem', color: '#737373' }}
                          title={address}
                        >
                          {address
                            ? `${address.slice(0, 6)}…${address.slice(-4)}`
                            : 'N/A'}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: '#111827', fontSize: '0.78rem' }}>
                          {m.currentMcap ? fmtCurrency(m.currentMcap) : '—'}
                        </strong>
                      </td>
                      <td>
                        <strong style={{ color: '#111827', fontSize: '0.78rem' }}>
                          {m.athMcap ? fmtCurrency(m.athMcap) : '—'}
                        </strong>
                        {m.athTimestamp > 0 && (
                          <div style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>
                            {formatDaysAgo(m.athTimestamp)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ color: '#111827', fontSize: '0.78rem' }}>
                          {volume ? fmtCurrency(volume) : '—'}
                        </span>
                      </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {Array.isArray(m.sourceFlags) && m.sourceFlags.map((src, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '0.625rem',
                              padding: '1px 4px',
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
                          gap: '0.3rem',
                          fontSize: '0.6875rem',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                          background: m.backfilled ? '#dcfce7' : '#fef3c7',
                          color: m.backfilled ? '#166534' : '#92400e',
                        }}
                      >
                        {m.backfilled ? '✅ Backfilled' : '⏳ Pending Worker 3'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalFilteredCount}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={sz => {
            setPageSize(sz);
            setPage(1);
          }}
          pageSizeOptions={[25, 50, 100]}
        />
      </div>
    </div>
  );
}
