import React from 'react';
import { ago } from '../../utils/format';
import { TokenAvatar } from './TokenRow';

export function isAlphaEligible(t) {
  if (!t) return false;
  const mcap = t.marketCapUsd;
  const peakMcap = Math.max(t.peakMarketCapUsd ?? 0, mcap ?? 0);
  if (mcap != null && Number.isFinite(mcap)) {
    if (mcap < 4000) return false;
    if (peakMcap >= 300000 && mcap < 10000) return false;
    if (peakMcap >= 50000 && mcap < 5000) return false;
  }
  return true;
}

export function pickAlphaCalls(tokens, limit = 5) {
  const eligible = tokens.filter(isAlphaEligible);
  const curated = eligible
    .filter(t => t.state === 'curated' || t.earlySignal?.isEarlySignal)
    .sort((a, b) => {
      const aEarly = a.earlySignal?.isEarlySignal ? 1 : 0;
      const bEarly = b.earlySignal?.isEarlySignal ? 1 : 0;
      if (bEarly !== aEarly) return bEarly - aEarly;
      return (b.traction?.tractionScore ?? 0) - (a.traction?.tractionScore ?? 0);
    });
  if (curated.length > 0) return curated.slice(0, limit);

  // Fallback: if no tokens have state === 'curated', pick top tokens by traction/safety
  return eligible
    .filter(t => (t.traction?.tractionScore ?? 0) > 0 || (t.safety?.score ?? 0) >= 40)
    .sort((a, b) => (b.traction?.tractionScore ?? 0) - (a.traction?.tractionScore ?? 0))
    .slice(0, limit);
}

export function strategyFor(token) {
  if (token.earlySignal?.isEarlySignal || token.strategy === 'Early Runner' || (token.tags || []).includes('early_runner')) {
    return '🚀 Early Runner';
  }
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
                    {token.earlySignal?.signals?.length > 0 ? (
                      <span style={{ color: '#10b981', fontWeight: 500 }}>
                        {token.earlySignal.signals.slice(0, 2).join(' · ')}
                      </span>
                    ) : (
                      <>
                        T{token.traction?.tractionScore ?? '--'} · S{token.safety?.score ?? '--'}
                        {token.smartWallets != null ? ` · ${token.smartWallets} smart` : ''}
                        {token.bundlerPct != null ? ` · ${token.bundlerPct}% bund` : ''}
                      </>
                    )}
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
