import React, { Fragment, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, Star, Coins } from 'lucide-react';
import { ago, fmtUsd, fmtUsdPrecise } from '../../utils/format';
import { Pill, ScoreBadge } from '../ui/Primitives';

function tokenBuySellRatio(token) {
  const buys = token.txns?.m5?.buys || 0;
  const sells = token.txns?.m5?.sells || 0;
  if (sells === 0) return buys > 0 ? Infinity : 0;
  return buys / sells;
}

const CHAIN_COLORS = {
  solana: '#14f195',
  monad: '#836ef9',
  robinhood: '#00c805',
  ethereum: '#627eea',
  base: '#0052ff',
};

export function TokenAvatar({ token, size = 28 }) {
  const [imgError, setImgError] = useState(false);
  const symbol = token?.symbol || '?';
  const chain = token?.chain || 'solana';

  // Deterministic gradient from symbol name
  const hue = (symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) * 37) % 360;
  const bgGrad = `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${(hue + 45) % 360}, 80%, 45%))`;

  return (
    <div className="token-avatar-wrap" style={{ width: size, height: size }}>
      {token?.imageUrl && !imgError ? (
        <img
          src={token.imageUrl}
          alt=""
          className="token-avatar-img"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="token-avatar-fallback" style={{ background: bgGrad }}>
          {symbol.slice(0, 2).toUpperCase()}
        </div>
      )}
      <span 
        className="token-avatar-chain-dot" 
        style={{ backgroundColor: CHAIN_COLORS[chain] || '#5046e5' }}
        title={chain}
      />
    </div>
  );
}

function TokenRow({ token, selected, expanded, onSelect, onToggle, onTrack, onTrade, canSell }) {
  const ratio = tokenBuySellRatio(token);
  const rawChange = token.priceChange?.h1 ?? token.priceChange?.h24 ?? null;
  const change = rawChange != null ? Number(rawChange) : null;
  const isRevival = token.source === 'revival';
  const updatedAt = token.enrichedAt || token.analyzedAt || token.updatedAt;
  const stale = !updatedAt || Date.now() - updatedAt > 2 * 60_000;

  return (
    <Fragment>
      <tr className={`${selected ? 'selected' : ''} ${stale ? 'stale' : ''}`} onClick={() => onSelect(token)}>
        <td>
          <div className="scanner-token-cell">
            <button 
              className="scanner-expand" 
              type="button" 
              aria-label={expanded ? 'Collapse token details' : 'Expand token details'} 
              aria-expanded={expanded} 
              onClick={event => { event.stopPropagation(); onToggle(token); }}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <TokenAvatar token={token} size={30} />
            <div className="scanner-token-info">
              <div className="scanner-symbol-row">
                <strong className="scanner-symbol">{token.symbol || '?'}</strong>
                {isRevival && <Pill color="green">revival</Pill>}
                {token.rugged && <Pill color="red">risk</Pill>}
                {stale && <span className="stale-dot" title="Stale market data">stale</span>}
              </div>
              <small className="scanner-name">{token.name || token.mint.slice(0, 8)}</small>
            </div>
          </div>
        </td>
        <td className="mono">
          <div className="scanner-price-cell">
            <strong>{fmtUsdPrecise(token.priceUsd)}</strong>
            {change != null && Number.isFinite(change) && (
              <small className={change >= 0 ? 'text-green' : 'text-red'}>
                {change >= 0 ? '+' : ''}{change.toFixed(1)}%
              </small>
            )}
          </div>
        </td>
        <td className="text-muted">{ago(token.createdAt)}</td>
        <td className="mono">{fmtUsd(token.volume5mUsd)}</td>
        <td>
          <span className={ratio >= 1.2 ? 'flow-positive' : ratio > 0 ? 'flow-neutral' : 'text-dim'}>
            {token.txns?.m5 ? `${token.txns.m5.buys || 0}/${token.txns.m5.sells || 0}` : '—'}
          </span>
        </td>
        <td className="mono">{fmtUsd(token.liquidityUsd)}</td>
        <td className="mono">{fmtUsd(token.marketCapUsd)}</td>
        <td className="mono">
          {change == null || !Number.isFinite(change) ? '—' : (
            <span className={change >= 0 ? 'text-green' : 'text-red'}>
              {change >= 0 ? '+' : ''}{change.toFixed(1)}%
            </span>
          )}
        </td>
        <td>
          <div className="scanner-signals">
            {token.safety ? <ScoreBadge score={token.safety.score} /> : <span className="spinner" />}
            {token.traction && <span className={`traction-mini ${token.traction.tractionScore >= 45 ? 'good' : ''}`}>T {token.traction.tractionScore}</span>}
          </div>
        </td>
        <td>
          <div className="scanner-row-actions">
            <button type="button" title="Add to tracked watchlist" onClick={event => { event.stopPropagation(); onTrack(token); }}>
              <Star size={12} />
            </button>
            <button type="button" className="buy" title="Prepare Quick Buy" onClick={event => { event.stopPropagation(); onTrade(token, 'buy'); }}>
              <ArrowDownToLine size={12} />
            </button>
            <button type="button" className="sell" title={canSell ? 'Prepare Quick Sell' : 'No position'} disabled={!canSell} onClick={event => { event.stopPropagation(); onTrade(token, 'sell'); }}>
              <ArrowUpFromLine size={12} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="scanner-expanded-row">
          <td colSpan="10">
            <div className="scanner-expanded-grid">
              <div><span>Identity</span><strong className="mono">{token.chain || 'solana'}:{token.mint}</strong></div>
              <div><span>Source / migration</span><strong>{token.source || 'Unavailable'} · {token.migrated ? 'migrated' : token.migrationStatus || 'unknown'}</strong></div>
              <div><span>Volume 1h / 24h</span><strong>{fmtUsd(token.volume1hUsd)} / {fmtUsd(token.volume24hUsd)}</strong></div>
              <div><span>Price 5m / 24h</span><strong>{token.priceChange?.m5 == null ? '—' : `${Number(token.priceChange.m5).toFixed(1)}%`} / {token.priceChange?.h24 == null ? '—' : `${Number(token.priceChange.h24).toFixed(1)}%`}</strong></div>
              <div><span>Smart / whales / snipers / fresh</span><strong>{token.smartWallets ?? '—'} / {token.whales ?? '—'} / {token.snipers ?? '—'} / {token.freshWallets ?? '—'}</strong></div>
              <div><span>Bundlers / top 10</span><strong>{token.bundlerPct == null ? '—' : `${token.bundlerPct}%`} / {token.top10HolderPct == null ? '—' : `${token.top10HolderPct}%`}</strong></div>
              <div><span>Developer history</span><strong>{token.developer?.createdCount ?? token.creatorTokenCount ?? 'Unavailable'} tokens created</strong></div>
              <div><span>Freshness</span><strong className={stale ? 'text-red' : 'text-green'}>{updatedAt ? ago(updatedAt) : 'Unavailable'}</strong></div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default React.memo(TokenRow, (prev, next) =>
  prev.selected === next.selected
  && prev.expanded === next.expanded
  && prev.canSell === next.canSell
  && prev.onSelect === next.onSelect
  && prev.onToggle === next.onToggle
  && prev.onTrack === next.onTrack
  && prev.onTrade === next.onTrade
  && prev.token === next.token
  && prev.token.priceUsd === next.token.priceUsd
  && prev.token.enrichedAt === next.token.enrichedAt
  && prev.token.safety?.score === next.token.safety?.score
  && prev.token.traction?.tractionScore === next.token.traction?.tractionScore,
);
