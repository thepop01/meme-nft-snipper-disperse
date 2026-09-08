import React from 'react';
import { ExternalLink } from 'lucide-react';
import { ago, fmtSol, fmtUsd, fmtUsdPrecise } from '../../utils/format';
import TokenChart from './TokenChart';
import { TokenAvatar } from './TokenRow';

export default function TradingTerminal({ token, positions = [], onTrade }) {
  if (!token) {
    return (
      <div className="panel">
        <div className="panel-title"><span>Trading Terminal</span></div>
        <p className="text-dim" style={{ fontSize: '0.8rem' }}>Select a token from the scanner to trade it here.</p>
      </div>
    );
  }
  const position = positions.find(p => p.status === 'open' && p.mint === token.mint) || null;
  const chain = token.chain || 'solana';
  const mint = encodeURIComponent(token.mint || '');
  const links = [
    chain === 'solana' && { label: 'pump.fun', href: `https://pump.fun/coin/${mint}` },
    { label: 'GMGN', href: `https://gmgn.ai/${chain === 'robinhood' ? 'robinhood' : 'sol'}/token/${token.mint}` },
    { label: 'DexScreener', href: `https://dexscreener.com/${chain}/${mint}` },
  ].filter(Boolean);

  return (
    <div className="panel">
      <div className="panel-title">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <TokenAvatar token={token} size={24} />
          ${token.symbol || '?'} <small className="text-dim">{token.name || ''}</small>
        </span>
        <span className="market-updated">Updated {ago(token.enrichedAt || token.analyzedAt)}</span>
      </div>
      <div className="market-metrics">
        <div className="market-metric"><span>Price</span><strong>{fmtUsdPrecise(token.priceUsd)}</strong></div>
        <div className="market-metric"><span>Market cap</span><strong>{fmtUsd(token.marketCapUsd)}</strong></div>
        <div className="market-metric"><span>Liquidity</span><strong>{fmtUsd(token.liquidityUsd)}</strong></div>
        <div className="market-metric"><span>Volume (24h)</span><strong>{fmtUsd(token.volume24hUsd)}</strong></div>
        <div className="market-metric"><span>Holders</span><strong>{token.holderCount ?? token.holders ?? '—'}</strong></div>
        <div className="market-metric"><span>Smart</span><strong className="text-green">{token.smartWallets ?? '—'}</strong></div>
      </div>
      <TokenChart token={token} />
      <div className="terminal-trade-row">
        <div className="terminal-links">
          {links.map(link => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
              {link.label} <ExternalLink size={11} />
            </a>
          ))}
        </div>
        <div className="terminal-actions">
          <button type="button" className="btn-primary btn-sm" onClick={() => onTrade?.(token, 'buy')}>Buy</button>
          <button type="button" className="btn-outline btn-sm" disabled={!position} title={position ? 'Prepare quick sell' : 'No open position'} onClick={() => onTrade?.(token, 'sell')}>Sell</button>
        </div>
      </div>
      {position && (
        <div className="terminal-position">
          <span>Position <strong className="mono">{fmtSol(position.solSpent)} ◎</strong></span>
          <span>Entry <strong className="mono">{fmtUsdPrecise(position.entryPriceUsd)}</strong></span>
          <span>P&amp;L <strong className={`mono ${Number(position.pnlSol || 0) >= 0 ? 'text-green' : 'text-red'}`}>
            {Number(position.pnlSol || 0) >= 0 ? '+' : ''}{fmtSol(position.pnlSol || 0)} ◎
            {position.pnlPct != null ? ` (${Number(position.pnlPct) >= 0 ? '+' : ''}${Number(position.pnlPct).toFixed(1)}%)` : ''}
          </strong></span>
        </div>
      )}
    </div>
  );
}
