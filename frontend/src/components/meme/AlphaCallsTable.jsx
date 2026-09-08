import React from 'react';
import { ago } from '../../utils/format';
import { TokenAvatar } from './TokenRow';

export function pickAlphaCalls(tokens, limit = 5) {
  return tokens
    .filter(t => t.state === 'curated')
    .sort((a, b) => (b.traction?.tractionScore ?? 0) - (a.traction?.tractionScore ?? 0))
    .slice(0, limit);
}

function strategyFor(token) {
  if ((token.smartWallets ?? 0) >= 10) return 'Smart Money';
  if (token.source === 'revival') return 'Narrative Shift';
  if (token.trenchType === 'near_completion') return 'Early Liquidity';
  if ((token.volume5mUsd ?? 0) > 0) return 'Social Momentum';
  return 'Curated';
}

export default function AlphaCallsTable({ tokens = [], onBuy, onSelect }) {
  const calls = pickAlphaCalls(tokens);
  return (
    <div className="panel">
      <div className="panel-title">
        <span>Alpha Meme Calls</span>
        <span className="text-dim" style={{ fontSize: '0.7rem' }}>AI + onchain + social · curated only</span>
      </div>
      {calls.length === 0 ? (
        <p className="text-dim" style={{ fontSize: '0.8rem' }}>No curated calls yet — launches appear here after passing the quality gates.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>Token</th><th>Strategy</th><th>Signals</th><th>Market Cap</th><th>Time</th><th></th></tr></thead>
            <tbody>
              {calls.map(token => (
                <tr key={token.key || `${token.chain || 'solana'}:${token.mint}`} onClick={() => onSelect?.(token)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <TokenAvatar token={token} size={24} />
                      <span><strong>${token.symbol || '?'}</strong><br /><small className="text-dim">{token.name || ''}</small></span>
                    </span>
                  </td>
                  <td><span className="selector-chip active">{strategyFor(token)}</span></td>
                  <td className="text-dim" style={{ fontSize: '0.75rem' }}>
                    T{token.traction?.tractionScore ?? '--'} · S{token.safety?.score ?? '--'}
                    {token.smartWallets != null ? ` · ${token.smartWallets} smart` : ''}
                    {token.bundlerPct != null ? ` · ${token.bundlerPct}% bund` : ''}
                  </td>
                  <td className="mono">{token.marketCapUsd ? `$${Math.round(token.marketCapUsd / 1000)}K` : '--'}</td>
                  <td className="text-dim">{token.createdAt ? `${ago(token.createdAt)}` : '--'}</td>
                  <td><button type="button" className="btn-primary btn-xs" onClick={e => { e.stopPropagation(); onBuy?.(token); }}>Buy</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
