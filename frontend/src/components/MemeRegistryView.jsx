import React, { useEffect, useState } from 'react';
import { getBackendUrl } from '../utils/sniperApi';

function fmtCurrency(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}k`;
  return `$${abs.toFixed(2)}`;
}

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function MemeRegistryView({ initialMemes = null } = {}) {
  const [memes, setMemes] = useState(initialMemes || []);
  const [loading, setLoading] = useState(!initialMemes);
  const [filter, setFilter] = useState('all'); // 'all' | 'backfilled' | 'pending'

  useEffect(() => {
    if (initialMemes) return;
    const fetchMemes = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/memes/registry`);
        if (res.ok) {
          const data = await res.json();
          setMemes(Array.isArray(data.memes) ? data.memes : []);
        }
      } catch {
        // swallow errors
      } finally {
        setLoading(false);
      }
    };
    fetchMemes();
  }, [initialMemes]);

  const backfilledCount = memes.filter(m => m.backfilled === true).length;
  const pendingCount = memes.filter(m => m.backfilled !== true).length;

  const filteredMemes = memes.filter(m => {
    if (filter === 'backfilled') return m.backfilled === true;
    if (filter === 'pending') return m.backfilled !== true;
    return true;
  });

  return (
    <div className="view-container">
      <div className="view-header">
        <h1>Tracked Memes Registry</h1>
        <p className="view-subtitle">Discovered tokens from distributed worker pipeline</p>
      </div>

      {/* Filter Buttons with Counts */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          All ({memes.length})
        </button>
        <button
          onClick={() => setFilter('backfilled')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filter === 'backfilled'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          Backfilled ({backfilledCount})
        </button>
        <button
          onClick={() => setFilter('pending')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filter === 'pending'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          Pending Worker 3 ({pendingCount})
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900">
                <th className="px-4 py-3 text-left font-semibold text-slate-200">Token</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200">Contract Address</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200">Current Mcap</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200">ATH Mcap</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200">24h Volume</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200">Sources</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-400">
                    Loading memes…
                  </td>
                </tr>
              ) : filteredMemes.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-400">
                    No memes found
                  </td>
                </tr>
              ) : (
                filteredMemes.map((meme) => (
                  <tr key={meme.ca} className="border-b border-slate-800 hover:bg-slate-900/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">
                      {meme.symbol}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                      {shortAddr(meme.ca)}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {fmtCurrency(meme.currentMcap)}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {fmtCurrency(meme.athMcap)}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {fmtCurrency(meme.volume24hUsd)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {Array.isArray(meme.sourceFlags) && meme.sourceFlags.length > 0 ? (
                          meme.sourceFlags.map((source) => (
                            <span
                              key={source}
                              className="inline-block px-2 py-1 rounded bg-slate-800 text-xs text-slate-300"
                            >
                              {source}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {meme.backfilled ? (
                        <span className="text-emerald-500 font-medium">
                          ✅ Backfilled
                        </span>
                      ) : (
                        <span className="text-amber-500 font-medium">
                          ⏳ Pending Worker 3
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Count Summary */}
      <div className="mt-4 text-sm text-slate-400">
        Showing {filteredMemes.length} of {memes.length} memes
      </div>
    </div>
  );
}

export default MemeRegistryView;
