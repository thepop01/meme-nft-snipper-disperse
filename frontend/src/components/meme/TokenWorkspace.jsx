import React from 'react';
import { AlertTriangle, ArrowUpRight, AtSign, CheckCircle, ExternalLink, Globe, Info, Link2, Radio, ShieldCheck, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { ago, fmtUsd, fmtUsdPrecise } from '../../utils/format';
import { Pill } from '../ui/Primitives';
import TokenChart from './TokenChart';
import { TokenAvatar } from './TokenRow';

function Metric({ label, value, tone }) {
  return <div className="market-metric"><span>{label}</span><strong className={tone || ''}>{value}</strong></div>;
}

function IntelligenceRow({ label, value, tone }) {
  return <div className="intelligence-row"><span>{label}</span><strong className={tone || ''}>{value ?? 'Unavailable'}</strong></div>;
}

export default function TokenWorkspace({ token, onTrack, customList, onPin, onExclude }) {
  if (!token) return (
    <div className="market-empty">
      <Radio size={28} />
      <strong>Select a market</strong>
      <span>Choose a token from the scanner to inspect its flow, holders, and risk signals.</span>
    </div>
  );

  const mint = token.mint || '';
  const buys = token.txns?.m5?.buys ?? null;
  const sells = token.txns?.m5?.sells ?? null;
  const rawChange = token.priceChange?.h1 ?? token.priceChange?.h24 ?? null;
  const change = rawChange != null ? Number(rawChange) : null;
  const chain = token.chain || 'solana';
  const encodedMint = encodeURIComponent(mint);
  const explorerUrls = {
    solana: `https://solscan.io/token/${encodedMint}`,
    monad: `https://monadscan.com/token/${encodedMint}`,
    robinhood: `https://robinhoodchain.blockscout.com/token/${encodedMint}`,
    ethereum: `https://etherscan.io/token/${encodedMint}`,
    base: `https://basescan.org/token/${encodedMint}`,
  };

  const ecosystemLinks = chain === 'solana' ? [
    { label: 'Pump.fun', href: `https://pump.fun/coin/${encodedMint}`, icon: ExternalLink },
    { label: 'GMGN', href: `https://gmgn.ai/sol/token/${encodedMint}`, icon: ExternalLink },
  ] : chain === 'monad' ? [
    { label: 'nad.fun', href: `https://nad.fun/tokens/${encodedMint}`, icon: ExternalLink },
    { label: 'GMGN', href: `https://gmgn.ai/monad/token/${encodedMint}`, icon: ExternalLink },
  ] : chain === 'robinhood' ? [
    { label: 'Hood Runs', href: `https://hood.run/#${mint}`, icon: ExternalLink },
    { label: 'GMGN', href: `https://gmgn.ai/robinhood/token/${encodedMint}`, icon: ExternalLink },
  ] : [];

  const links = [
    ...ecosystemLinks,
    { label: 'DexScreener', href: `https://dexscreener.com/${chain}/${encodedMint}`, icon: ExternalLink },
    { label: 'Explorer', href: explorerUrls[chain], icon: Link2 },
    token.socials?.website && { label: 'Website', href: token.socials.website, icon: Globe },
    token.socials?.twitter && { label: 'X', href: token.socials.twitter, icon: AtSign },
  ].filter(Boolean);

  return (
    <section className="market-workspace">
      <div className="selected-token-header">
        <div className="selected-token-identity">
          <TokenAvatar token={token} size={44} />
          <div>
            <div className="selected-token-title">
              <h3>{token.symbol || 'Unknown'}</h3>
              <Pill color={chain === 'solana' ? 'green' : chain === 'monad' ? 'violet' : 'blue'}>{chain}</Pill>
              <Pill color={token.state === 'curated' ? 'green' : 'gray'}>{token.state || 'observing'}</Pill>
            </div>
            <p className="selected-token-subline">
              <span>{token.name || 'Meme token'}</span>
              <span className="mono token-address">{mint.slice(0, 6)}…{mint.slice(-4)}</span>
            </p>
            {customList && (
              <div className="portfolio-actions">
                <button className="btn-outline btn-xs" onClick={() => onPin?.(token)}>
                  <Star size={11} /> Pin to {customList.name}
                </button>
                <button className="btn-outline btn-xs" onClick={() => onExclude?.(token)}>
                  <AlertTriangle size={11} /> Exclude
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="selected-token-price">
          <strong>{fmtUsdPrecise(token.priceUsd)}</strong>
          <span className={change == null || !Number.isFinite(change) ? 'text-dim' : change >= 0 ? 'text-green' : 'text-red'}>
            {change == null || !Number.isFinite(change) ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
          </span>
          {onTrack && (
            <button className="btn-outline btn-xs workspace-track" onClick={() => onTrack(token)} title="Add to tracked watchlist">
              <Star size={12} /> Track
            </button>
          )}
        </div>
      </div>

      <div className="market-metrics">
        <Metric label="Liquidity" value={fmtUsd(token.liquidityUsd)} />
        <Metric label="Market cap" value={fmtUsd(token.marketCapUsd)} />
        <Metric label="Volume 5m" value={fmtUsd(token.volume5mUsd)} />
        <Metric label="Buys / sells" value={buys == null ? '—' : `${buys} / ${sells}`} />
        <Metric label="Safety" value={token.safety ? `${token.safety.score}/100` : '—'} tone={token.safety ? (token.safety.score >= 60 ? 'text-green' : 'text-red') : ''} />
        <Metric label="Traction" value={token.traction ? `${token.traction.tractionScore}/100` : '—'} />
      </div>

      <div className="market-link-row">
        {links.map(link => { 
          const Icon = link.icon; 
          return (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
              <Icon size={12} /> {link.label} <ArrowUpRight size={11} />
            </a>
          ); 
        })}
        <span className="market-updated"><Radio size={11} /> Updated {ago(token.enrichedAt || token.analyzedAt)}</span>
      </div>

      <TokenChart token={token} />

      <div className="intelligence-grid">
        <div className="intelligence-panel">
          <div className="intelligence-title"><ShieldCheck size={14} /> Risk &amp; quality</div>
          {Array.isArray(token.safety?.checks) ? token.safety.checks.slice(0, 4).map((check, index) => (
            <div className="signal-row" key={check.id || index}>
              {check.status === 'pass' ? <CheckCircle size={13} className="text-green" /> : check.status === 'fail' ? <AlertTriangle size={13} className="text-red" /> : <Info size={13} className="text-muted" />}
              <span>{check.detail || check.label || check.id}</span>
            </div>
          )) : (
            <div className="signal-row"><Info size={13} /><span>Provider analysis is still running.</span></div>
          )}
        </div>

        <div className="intelligence-panel">
          <div className="intelligence-title"><TrendingUp size={14} /> Flow snapshot</div>
          <IntelligenceRow label="5m buys" value={buys ?? 'Unavailable'} tone="text-green" />
          <IntelligenceRow label="5m sells" value={sells ?? 'Unavailable'} tone="text-red" />
          <IntelligenceRow label="Top 10 holders" value={token.top10HolderPct != null ? `${token.top10HolderPct}%` : 'Unavailable'} />
          <IntelligenceRow label="Smart / whales / snipers" value={`${token.smartWallets ?? '—'} / ${token.whales ?? '—'} / ${token.snipers ?? '—'}`} />
        </div>

        <div className="intelligence-panel">
          <div className="intelligence-title"><TrendingDown size={14} /> Signal context</div>
          <IntelligenceRow label="Attention" value={token.attentionBoost || 'None detected'} />
          <IntelligenceRow label="Fresh wallets" value={token.freshWallets ?? 'Unavailable'} />
          <IntelligenceRow label="Bundlers" value={token.bundlerPct != null ? `${token.bundlerPct}%` : 'Unavailable'} />
          <IntelligenceRow label="Source" value={token.source || 'Unknown'} />
        </div>

        <div className="intelligence-panel">
          <div className="intelligence-title"><Info size={14} /> Developer &amp; freshness</div>
          <IntelligenceRow label="Developer" value={token.developer?.address || token.creator || 'Unavailable'} />
          <IntelligenceRow label="Tokens created" value={token.developer?.createdCount ?? token.creatorTokenCount ?? 'Unavailable'} />
          <IntelligenceRow label="Related history" value={token.developer?.relatedTokenCount ?? 'Unavailable'} />
          <IntelligenceRow label="Provider updated" value={token.enrichedAt ? ago(token.enrichedAt) : 'Unavailable'} />
          <IntelligenceRow label="Risk updated" value={token.analyzedAt ? ago(token.analyzedAt) : 'Unavailable'} />
        </div>
      </div>
    </section>
  );
}
