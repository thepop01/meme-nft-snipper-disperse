import React, { Fragment, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowUpRight,
  AtSign, Check, CheckCircle, ChevronDown, ChevronRight, Copy, ExternalLink,
  Flame, Globe, Info, Link2, Send, ShieldCheck, Star, TrendingDown, TrendingUp,
  User, Users, Zap,
} from 'lucide-react';
import { ago, fmtUsd, fmtUsdPrecise } from '../../utils/format';
import { Pill, ScoreBadge } from '../ui/Primitives';
import { strategyFor } from './AlphaCallsTable';
import TokenChart from './TokenChart';
import { ecosystemLinks, explorerUrl } from './tokenLinks';

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
  const isMetadataJson = typeof token?.imageUrl === 'string' && /\.json($|\?)/i.test(token.imageUrl);
  const validImageUrl = token?.imageUrl && !isMetadataJson ? token.imageUrl : null;

  return (
    <div className="token-avatar-wrap" style={{ width: size, height: size }}>
      {validImageUrl && !imgError ? (
        <img
          src={validImageUrl}
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

function TokenRow({
  token, selected, expanded, onSelect, onToggle, onTrack, onTrade,
  canSell, isTracked, activeFeed, customList, onPin, onExclude,
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e, text) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const ratio = tokenBuySellRatio(token);
  const rawChange = token.priceChange?.h1 ?? token.priceChange?.h24 ?? null;
  const change = rawChange != null ? Number(rawChange) : null;
  const isRevival = token.source === 'revival';
  const updatedAt = token.enrichedAt || token.analyzedAt || token.updatedAt;
  const stale = !updatedAt || Date.now() - updatedAt > 2 * 60_000;
  const strategy = (token.state === 'curated' || activeFeed === 'alpha' || activeFeed === 'curated') ? strategyFor(token) : null;

  const mint = token.mint || '';
  const chain = token.chain || 'solana';
  const encodedMint = encodeURIComponent(mint);

  const ecoLinks = ecosystemLinks(chain, mint).map(link => ({
    ...link,
    icon: ExternalLink,
  }));

  const links = [
    ...ecoLinks,
    { label: 'DexScreener', href: `https://dexscreener.com/${chain}/${encodedMint}`, icon: ExternalLink },
    { label: 'Explorer', href: explorerUrl(chain, mint), icon: Link2 },
    token.socials?.website && { label: 'Website', href: token.socials.website, icon: Globe },
    token.socials?.twitter && { label: 'X', href: token.socials.twitter, icon: AtSign },
    token.socials?.telegram && { label: 'Telegram', href: token.socials.telegram, icon: Send },
  ].filter(Boolean);

  return (
    <Fragment>
      <tr 
        id={`token-row-${token.mint}`}
        className={`${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''} ${stale ? 'stale' : ''} scanner-row-interactive`} 
        onClick={() => {
          onSelect(token);
          onToggle(token);
        }}
      >
        <td>
          <div className="scanner-token-cell">
            <button 
              className="scanner-expand" 
              type="button" 
              aria-label={expanded ? 'Collapse token details' : 'Expand token details'} 
              aria-expanded={expanded} 
              onClick={event => { 
                event.stopPropagation(); 
                onSelect(token);
                onToggle(token); 
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <TokenAvatar token={token} size={24} />
            <div className="scanner-token-info">
              <div className="scanner-symbol-row">
                <strong className="scanner-symbol">{token.symbol || '?'}</strong>
                {strategy && strategy !== 'Curated' && (
                  <span className={`scanner-strategy-tag strategy-${strategy.toLowerCase().replace(/\s+/g, '-')}`}>
                    {strategy}
                  </span>
                )}
                {token.climber && <Pill color="yellow">climber</Pill>}
                {token.state === 'curated' && !strategy && <Pill color="green">curated</Pill>}
                {token.wokeRecently && <Pill color="purple">awake</Pill>}
                {token.state === 'tracked' && !token.climber && !token.wokeRecently && <Pill color="blue">sleeper</Pill>}
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
            {token.smartWallets != null && token.smartWallets > 0 && (
              <span className="smart-wallets-mini" title={`${token.smartWallets} smart wallets holding`}>
                ⚡ {token.smartWallets}
              </span>
            )}
          </div>
        </td>
        <td>
          <div className="scanner-row-actions">
            <button
              type="button"
              className={isTracked ? 'active-track' : ''}
              title={isTracked ? 'Remove from tracked watchlist' : 'Add to tracked watchlist'}
              onClick={event => { event.stopPropagation(); onTrack(token); }}
            >
              <Star size={12} fill={isTracked ? 'currentColor' : 'none'} />
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
            <div className="scanner-dropdown-wrap">
              {/* Dropdown Top Bar: Identity, Links & Fast Actions */}
              <div className="scanner-dropdown-topbar">
                <div className="scanner-dropdown-identity">
                  <TokenAvatar token={token} size={36} />
                  <div className="sd-identity-meta">
                    <div className="sd-identity-title">
                      <strong className="sd-token-symbol">${token.symbol || '?'}</strong>
                      <span className="sd-token-name">{token.name || 'Meme Token'}</span>
                      <span className="sd-token-chain-badge" style={{ backgroundColor: `${CHAIN_COLORS[chain] || '#5046e5'}20`, color: CHAIN_COLORS[chain] || '#5046e5' }}>
                        {chain}
                      </span>
                      {strategy && <span className="scanner-strategy-tag">{strategy}</span>}
                      {token.climber && <Pill color="yellow">climber</Pill>}
                      {token.wokeRecently && <Pill color="purple">awake</Pill>}
                      {isRevival && <Pill color="green">revival</Pill>}
                    </div>
                    <div className="sd-address-chip" onClick={e => handleCopy(e, mint)} title="Click to copy contract address">
                      <span className="mono">{mint.slice(0, 8)}…{mint.slice(-6)}</span>
                      {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                      <span className="sd-chip-hint">{copied ? 'Copied!' : 'Copy'}</span>
                    </div>
                  </div>
                </div>

                <div className="scanner-dropdown-links">
                  {links.map(link => (
                    <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="scanner-dropdown-link" onClick={e => e.stopPropagation()}>
                      <link.icon size={11} /> {link.label} <ArrowUpRight size={10} />
                    </a>
                  ))}
                </div>

                <div className="scanner-dropdown-actions">
                  {customList && (
                    <div className="sd-custom-actions">
                      <button
                        type="button"
                        className="btn-outline btn-xs"
                        onClick={e => { e.stopPropagation(); onPin?.(token); }}
                        title={`Pin to ${customList.name}`}
                      >
                        <Star size={11} /> Pin
                      </button>
                      <button
                        type="button"
                        className="btn-outline btn-xs btn-outline-danger"
                        onClick={e => { e.stopPropagation(); onExclude?.(token); }}
                        title="Exclude from strategy"
                      >
                        <AlertTriangle size={11} /> Exclude
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className={`btn-outline btn-xs ${isTracked ? 'active-track' : ''}`}
                    onClick={e => { e.stopPropagation(); onTrack(token); }}
                  >
                    <Star size={11} fill={isTracked ? 'currentColor' : 'none'} /> {isTracked ? 'Untrack' : 'Track'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-xs"
                    onClick={e => { e.stopPropagation(); onTrade(token, 'buy'); }}
                  >
                    Quick Buy {chain === 'solana' ? 'SOL' : chain === 'robinhood' ? 'Hood' : 'Tokens'}
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    disabled={!canSell}
                    onClick={e => { e.stopPropagation(); onTrade(token, 'sell'); }}
                    title={canSell ? 'Prepare quick sell order' : 'No open position to sell'}
                  >
                    Quick Sell
                  </button>
                </div>
              </div>

              {/* Metrics Bar */}
              <div className="scanner-dropdown-metrics">
                <div className="sd-metric">
                  <span>Price (USD)</span>
                  <strong>{fmtUsdPrecise(token.priceUsd)}</strong>
                  {change != null && Number.isFinite(change) && (
                    <small className={change >= 0 ? 'text-green' : 'text-red'}>
                      {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                    </small>
                  )}
                </div>
                <div className="sd-metric">
                  <span>Liquidity</span>
                  <strong>{fmtUsd(token.liquidityUsd)}</strong>
                  {token.marketCapUsd && token.liquidityUsd ? (
                    <small className="text-muted">MC/Liq: {(token.marketCapUsd / Math.max(token.liquidityUsd, 1)).toFixed(1)}x</small>
                  ) : null}
                </div>
                <div className="sd-metric">
                  <span>Market Cap</span>
                  <strong>{fmtUsd(token.marketCapUsd)}</strong>
                  <small className="text-muted">{token.holderCount ? `${token.holderCount.toLocaleString()} holders` : '—'}</small>
                </div>
                <div className="sd-metric">
                  <span>5m Volume</span>
                  <strong>{fmtUsd(token.volume5mUsd)}</strong>
                  {token.marketCapUsd && token.volume5mUsd ? (
                    <small className="text-muted">Vel: {((token.volume5mUsd / Math.max(token.marketCapUsd, 1)) * 100).toFixed(1)}%</small>
                  ) : null}
                </div>
                <div className="sd-metric">
                  <span>24h Volume</span>
                  <strong>{fmtUsd(token.volume24hUsd)}</strong>
                </div>
                <div className="sd-metric">
                  <span>5m Order Flow</span>
                  <strong>{token.txns?.m5 ? `${token.txns.m5.buys || 0}B / ${token.txns.m5.sells || 0}S` : '—'}</strong>
                  <small className={ratio >= 1.25 ? 'text-green' : ratio > 0 ? 'text-muted' : 'text-red'}>
                    {Number.isFinite(ratio) && ratio > 0 ? `${Math.round((ratio / (ratio + 1)) * 100)}% buys` : '—'}
                  </small>
                </div>
                <div className="sd-metric">
                  <span>Safety Score</span>
                  <strong className={token.safety?.score >= 60 ? 'text-green' : token.safety?.score ? 'text-red' : ''}>
                    {token.safety ? `${token.safety.score}/100` : '—'}
                  </strong>
                  <small className="text-muted">{token.safety?.score >= 60 ? 'Safe checks' : 'Elevated risk'}</small>
                </div>
                <div className="sd-metric">
                  <span>Traction Score</span>
                  <strong className={(token.traction?.tractionScore ?? 0) >= 45 ? 'text-purple' : ''}>
                    {token.traction ? `${token.traction.tractionScore}/100` : '—'}
                  </strong>
                  <small className="text-muted">{token.traction?.acceleration ? `Acc: ${token.traction.acceleration}` : 'Standard'}</small>
                </div>
                <div className="sd-metric">
                  <span>Smart Wallets</span>
                  <strong style={{ color: '#7c3aed' }}>⚡ {token.smartWallets ?? 0}</strong>
                  <small className="text-muted">{token.renownedCount ? `${token.renownedCount} renowned` : 'Tracked degens'}</small>
                </div>
                <div className="sd-metric">
                  <span>Bundlers &amp; Insiders</span>
                  <strong className={(token.bundlerPct ?? 0) > 25 ? 'text-red' : ''}>
                    {token.bundlerPct != null ? `${token.bundlerPct}%` : '0%'}
                  </strong>
                  <small className="text-muted">{token.ratTraderRate ? `Rats: ${(token.ratTraderRate * 100).toFixed(0)}%` : 'Bundle rate'}</small>
                </div>
              </div>

              {/* Price History Chart */}
              <div className="scanner-dropdown-chart-card">
                <div className="sd-chart-header">
                  <div className="sd-chart-title">
                    <Activity size={13} />
                    <span>Price &amp; Volume History</span>
                  </div>
                  <span className="sd-chart-live-tag"><span className="live-dot" /> Real-time candles</span>
                </div>
                <TokenChart token={token} />
              </div>

              {/* 4-Card Intelligence Grid: Risk, Signal Context, Developer, Insiders */}
              <div className="scanner-dropdown-intel-grid">
                {/* Card 1: Risk & Safety Breakdown */}
                <div className="sd-intel-card">
                  <div className="sd-intel-title">
                    <ShieldCheck size={14} className="text-green" />
                    <span>Risk &amp; Safety Audit</span>
                  </div>
                  <div className="sd-detail-row">
                    <span>Mint Authority:</span>
                    <strong className={token.renouncedMint || token.mintAuthority === null ? 'text-green' : 'text-red'}>
                      {token.renouncedMint || token.mintAuthority === null ? 'Revoked (Safe)' : 'Mutable (Risk)'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Freeze Authority:</span>
                    <strong className={token.renouncedFreeze || token.freezeAuthority === null ? 'text-green' : 'text-red'}>
                      {token.renouncedFreeze || token.freezeAuthority === null ? 'Revoked (Safe)' : 'Active (Can Freeze)'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>LP Status:</span>
                    <strong>
                      {token.lpBurned ? 'Burned (Safe)' : token.onCurve ? 'Bonding curve' : token.lockPercent ? `${token.lockPercent}% Locked` : 'Standard Pool'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Top 10 Concentration:</span>
                    <strong className={(token.top10HolderPct ?? 0) > 35 ? 'text-red' : (token.top10HolderPct ?? 0) > 20 ? 'text-warning' : 'text-green'}>
                      {token.top10HolderPct != null ? `${token.top10HolderPct}%` : 'Unavailable'}
                    </strong>
                  </div>
                  {Array.isArray(token.safety?.checks) && token.safety.checks.length > 0 && (
                    <div className="sd-checks-container">
                      {token.safety.checks.slice(0, 3).map((check, i) => (
                        <div className="sd-check-line" key={check.id || i}>
                          {check.status === 'pass' ? <CheckCircle size={11} className="text-green" /> : check.status === 'fail' ? <AlertTriangle size={11} className="text-red" /> : <Info size={11} className="text-muted" />}
                          <span>{check.detail || check.label || check.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card 2: Signal Context & Traction */}
                <div className="sd-intel-card">
                  <div className="sd-intel-title">
                    <Zap size={14} className="text-purple" />
                    <span>Signal Context &amp; Traction</span>
                  </div>
                  <div className="sd-detail-row">
                    <span>Traction Score:</span>
                    <strong>{token.traction ? `${token.traction.tractionScore}/100` : '—'}</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>5m Net Flow:</span>
                    <strong className={ratio >= 1.25 ? 'text-green' : ratio > 0 ? '' : 'text-red'}>
                      {token.txns?.m5 ? `${token.txns.m5.buys || 0} buys / ${token.txns.m5.sells || 0} sells` : '—'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Attention / Narrative:</span>
                    <strong>{token.attentionBoost || 'Standard momentum'}</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Fresh Wallets (&lt;24h):</span>
                    <strong>{token.freshWallets ?? 'Standard'}</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Launch Stage:</span>
                    <strong>{token.launchpad || (token.onCurve ? `Bonding curve (${token.bondingCurvePct || 0}%)` : 'DEX AMM Pool')}</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Discovery Feed:</span>
                    <strong>{token.source || 'Live stream'}</strong>
                  </div>
                </div>

                {/* Card 3: Developer & Origin */}
                <div className="sd-intel-card">
                  <div className="sd-intel-title">
                    <User size={14} className="text-blue" />
                    <span>Developer &amp; Origin</span>
                  </div>
                  <div className="sd-detail-row">
                    <span>Deployer:</span>
                    <div className="sd-inline-copy">
                      <strong className="mono">{token.developer?.address ? `${token.developer.address.slice(0, 6)}…${token.developer.address.slice(-4)}` : token.creator ? `${token.creator.slice(0, 6)}…${token.creator.slice(-4)}` : 'Unavailable'}</strong>
                      {(token.developer?.address || token.creator) && (
                        <button
                          type="button"
                          className="icon-btn-tiny"
                          onClick={e => handleCopy(e, token.developer?.address || token.creator)}
                          title="Copy deployer address"
                        >
                          <Copy size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="sd-detail-row">
                    <span>Prior Launches:</span>
                    <strong>{token.developer?.createdCount ?? token.creatorTokenCount ?? '1'} tokens created</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Dev Holding:</span>
                    <strong className={(token.developer?.holdingPct ?? token.devHoldingPct ?? 0) > 10 ? 'text-red' : ''}>
                      {token.developer?.holdingPct != null ? `${token.developer.holdingPct}%` : token.devHoldingPct != null ? `${token.devHoldingPct}%` : 'Low / Distributed'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Related History:</span>
                    <strong>{token.developer?.relatedTokenCount ?? '0'} connected contracts</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Token Age:</span>
                    <strong>{ago(token.createdAt)}</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Data Enriched:</span>
                    <strong>{token.enrichedAt ? ago(token.enrichedAt) : 'Just now'}</strong>
                  </div>
                </div>

                {/* Card 4: Smart Money & Insiders */}
                <div className="sd-intel-card">
                  <div className="sd-intel-title">
                    <Users size={14} style={{ color: '#8b6dff' }} />
                    <span>Smart Money &amp; Insiders</span>
                  </div>
                  <div className="sd-detail-row">
                    <span>Smart Wallets:</span>
                    <strong style={{ color: '#8b6dff' }}>{token.smartWallets ?? 0} holding</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Whales &amp; Snipers:</span>
                    <strong>{token.whales ?? 0} whales · {token.snipers ?? 0} snipers</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Bundled Supply:</span>
                    <strong className={(token.bundlerPct ?? 0) > 20 ? 'text-red' : ''}>
                      {token.bundlerPct != null ? `${token.bundlerPct}%` : '0%'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Wash Trading:</span>
                    <strong className={token.washTrading ? 'text-red' : 'text-green'}>
                      {token.washTrading ? '⚠️ Wash risk' : 'Clean trade flow'}
                    </strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Bluechip Holders:</span>
                    <strong>{token.bluechipPct != null ? `${token.bluechipPct}%` : 'Standard'}</strong>
                  </div>
                  <div className="sd-detail-row">
                    <span>Rat / Insider Rate:</span>
                    <strong>{token.ratTraderRate != null ? `${(token.ratTraderRate * 100).toFixed(1)}%` : 'Minimal'}</strong>
                  </div>
                </div>
              </div>
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
  && prev.isTracked === next.isTracked
  && prev.customList === next.customList
  && prev.onSelect === next.onSelect
  && prev.onToggle === next.onToggle
  && prev.onTrack === next.onTrack
  && prev.onTrade === next.onTrade
  && prev.activeFeed === next.activeFeed
  && prev.token === next.token
  && prev.token.priceUsd === next.token.priceUsd
  && prev.token.enrichedAt === next.token.enrichedAt
  && prev.token.safety?.score === next.token.safety?.score
  && prev.token.traction?.tractionScore === next.token.traction?.tractionScore
  && prev.token.smartWallets === next.token.smartWallets,
);
