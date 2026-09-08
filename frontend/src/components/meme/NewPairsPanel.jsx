import React from 'react';
import { ago, fmtUsd } from '../../utils/format';
import { TokenAvatar } from './TokenRow';

export function selectNewPairs(tokens, limit = 5) {
  return tokens
    .filter(token => token?.createdAt != null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export default function NewPairsPanel({ tokens = [], onSelect }) {
  const pairs = selectNewPairs(tokens, 5);
  return (
    <div className="panel gainers-panel">
      <div className="panel-title"><span>New Pairs (Live)</span></div>
      {pairs.length === 0 ? (
        <p className="text-dim" style={{ fontSize: '0.78rem' }}>No launches in this feed yet.</p>
      ) : (
        <table className="data-table mini-table">
          <thead><tr><th>Token</th><th>Age</th><th>Liquidity</th><th>MC</th></tr></thead>
          <tbody>
            {pairs.map(token => (
              <tr key={token.key || `${token.chain || 'solana'}:${token.mint}`} onClick={() => onSelect?.(token)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <TokenAvatar token={token} size={20} />
                    <strong>${token.symbol || '?'}</strong>
                  </span>
                </td>
                <td className="text-dim">{ago(token.createdAt)}</td>
                <td className="mono">{fmtUsd(token.liquidityUsd)}</td>
                <td className="mono">{fmtUsd(token.marketCapUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
