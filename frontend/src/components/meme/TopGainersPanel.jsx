import React, { useState } from 'react';
import { fmtUsd, fmtUsdPrecise } from '../../utils/format';
import { TokenAvatar } from './TokenRow';

export const GAINER_TABS = ['5m', '1h', '6h', '24h'];

// GMGN tokens carry m1/m5/h1/h24; DexScreener pairs may only have h1/h24.
// Fall back down the chain so a tab never blanks on partial evidence.
export function gainFor(token, tab) {
  const changes = token?.priceChange || {};
  const order = tab === '5m'
    ? ['m5', 'h1', 'h24']
    : tab === '24h' ? ['h24', 'h1', 'm5'] : ['h1', 'm5', 'h24'];
  for (const key of order) {
    const value = changes[key] != null ? Number(changes[key]) : null;
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

export function selectTopGainers(tokens, tab, limit = 5) {
  return tokens
    .map(token => ({ token, gain: gainFor(token, tab) }))
    .filter(entry => entry.gain != null)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit)
    .map(entry => entry.token);
}

export default function TopGainersPanel({ tokens = [], onSelect }) {
  const [tab, setTab] = useState('5m');
  const gainers = selectTopGainers(tokens, tab, 5);
  return (
    <div className="panel gainers-panel">
      <div className="panel-title">
        <span>Top Gainers (Live)</span>
        <span className="mini-tabs">
          {GAINER_TABS.map(value => (
            <button
              key={value}
              type="button"
              className={`mini-tab ${tab === value ? 'active' : ''}`}
              onClick={() => setTab(value)}
            >
              {value}
            </button>
          ))}
        </span>
      </div>
      {gainers.length === 0 ? (
        <p className="text-dim" style={{ fontSize: '0.78rem' }}>No gainers with {tab} data yet.</p>
      ) : (
        <table className="data-table mini-table">
          <thead><tr><th>#</th><th>Token</th><th>Price</th><th>MC</th><th>{tab}</th></tr></thead>
          <tbody>
            {gainers.map((token, index) => {
              const gain = gainFor(token, tab);
              return (
                <tr key={token.key || `${token.chain || 'solana'}:${token.mint}`} onClick={() => onSelect?.(token)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                  <td className="text-dim">{index + 1}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <TokenAvatar token={token} size={20} />
                      <strong>${token.symbol || '?'}</strong>
                    </span>
                  </td>
                  <td className="mono">{fmtUsdPrecise(token.priceUsd)}</td>
                  <td className="mono">{fmtUsd(token.marketCapUsd)}</td>
                  <td className={`mono ${gain >= 0 ? 'text-green' : 'text-red'}`}>
                    {gain >= 0 ? '+' : ''}{gain.toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
