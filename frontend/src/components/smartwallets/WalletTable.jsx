import React from 'react';
import {
  Sparkles, Copy, Check, ExternalLink, GitFork, UserCheck, Trash2, Crown,
} from 'lucide-react';
import {
  fmtUsd, fmtCurrency, fmtPrice, fmtHoldingTime, fmtPct, fmtSignedPct, fmtRelativeTime,
} from './format.js';

export function WalletTable({
  wallets,
  listCategory,
  chainTab,
  copiedAddr,
  onCopy,
  onPromote,
  onDelete,
  onConnectChild,
  onScan,
  scanning,
  scanSource,
  onOpenWhaleModal,
  onOpenLineageModal,
}) {
  if (!wallets || wallets.length === 0) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#6b7280' }}>
        <Sparkles size={32} style={{ margin: '0 auto 0.8rem auto', color: '#9ca3af' }} />
        <h4 style={{ color: '#111827', marginBottom: '0.4rem' }}>
          No {chainTab === 'solana' ? 'Solana' : 'Robinhood'} {
            listCategory === 'smart' ? 'Smart' :
            listCategory === 'whale' ? 'Whale' :
            listCategory === 'lineage' ? 'Lineage' :
            listCategory === 'sniper' ? 'Sniper & Bundler' : 'Tracked'
          } Wallets Found
        </h4>
        <p style={{ fontSize: '0.85rem', maxWidth: '440px', margin: '0 auto 1.2rem auto' }}>
          {listCategory === 'smart' && 'Run the Smart Wallet Finder to discover profitable degens with verified track records.'}
          {listCategory === 'whale' && 'Add a known whale wallet holding >$5,000 in meme coins or wallet balance.'}
          {listCategory === 'lineage' && 'Connect a Lineage wallet to trace sub-wallets funded by smart or whale wallets.'}
          {listCategory === 'tracked' && 'No candidate wallets found. Scan runner tokens or add candidates to track.'}
          {listCategory === 'sniper' && 'Scan MadeOnSol or Kolscan to detect active Solana snipers, rank 1 early buyers, and deployer hunters.'}
        </p>
        {listCategory === 'smart' || listCategory === 'sniper' ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => onScan(chainTab, listCategory === 'sniper' ? 'madeonsol' : scanSource)}
            disabled={scanning}
          >
            <Sparkles size={14} className={scanning ? 'spin' : ''} /> {listCategory === 'sniper' ? 'Scan MadeOnSol Snipers' : `Run ${chainTab === 'solana' ? 'Solana' : 'Robinhood'} Finder`}
          </button>
        ) : listCategory === 'whale' ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={onOpenWhaleModal}
          >
            <Crown size={14} /> Add Whale Wallet
          </button>
        ) : listCategory === 'lineage' ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={onOpenLineageModal}
          >
            <GitFork size={14} /> Connect Lineage Wallet
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
        <thead>
          {(listCategory === 'smart' || listCategory === 'tracked' || listCategory === 'sniper') && (
            <tr>
              <th>Wallet Address</th>
              <th>Balance</th>
              <th>PnL</th>
              <th>ROI</th>
              <th>Win Rate</th>
              <th>Buy/Win</th>
              <th>Avg Buy Mcap</th>
              <th>Avg Sell Mcap</th>
              <th>Avg Holding Time</th>
              <th>Capture Ratio</th>
              <th>Round-Trip</th>
              <th>Sold &gt;50% ATH</th>
              <th>&ge;$2M Hit Rate</th>
              <th>Watermark</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          )}
          {listCategory === 'whale' && (
            <tr>
              <th>Whale Wallet Address</th>
              <th>Wallet Balance (USD)</th>
              <th>Meme Holdings (USD)</th>
              <th>30d Realized PnL</th>
              <th>Condition Met</th>
              <th>Tags</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          )}
          {listCategory === 'lineage' && (
            <tr>
              <th>Lineage Child Address</th>
              <th>Parent / Funder Wallet</th>
              <th>Transfer Amount</th>
              <th>Funding TX</th>
              <th>Status</th>
              <th>Tags</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          )}
        </thead>
        <tbody>
          {wallets.map(w => {
            const explorerUrl = w.chain === 'solana'
              ? `https://solscan.io/account/${w.address}`
              : `https://robinhoodchain.blockscout.com/address/${w.address}`;
            const gmgnUrl = `https://gmgn.ai/${w.chain === 'solana' ? 'sol' : 'robinhood'}/address/${w.address}`;
            const earned = w.realizedProfitUsd ?? w.score ?? 0;
            const winRate = w.winRatePct ?? 0;

            return (
              <tr key={`${w.chain}:${w.address}`}>
                {/* 1. Wallet Address Column */}
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span className="mono" style={{ fontWeight: 600, color: '#737373', fontSize: '0.6875rem' }}>
                        {w.address.slice(0, 6)}…{w.address.slice(-4)}
                      </span>
                      <button
                        type="button"
                        className="icon-button-ghost"
                        style={{ padding: '2px' }}
                        onClick={() => onCopy(w.address)}
                        title="Copy address"
                      >
                        {copiedAddr === w.address ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                      </button>
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="View on Explorer"
                        style={{ color: '#9ca3af', display: 'inline-flex' }}
                      >
                        <ExternalLink size={11} />
                      </a>
                    </div>

                    {w.twitterUsername && (
                      <span style={{ fontSize: '0.6875rem', color: '#0284c7' }}>
                        @{w.twitterUsername}
                      </span>
                    )}

                    {/* Scam & Badges */}
                    <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                      {((w.methods?.includes('buying_mcap') && w.methods?.includes('first_n_buyers')) || w.source === 'early-buyer-dual') ? (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }} title="Qualified via both Mcap (≤25% ATH) and First N Early Buyers">
                          ⚡ Mcap ≤25% + First N
                        </span>
                      ) : (
                        <>
                          {(w.methods?.includes('buying_mcap') || w.qualificationMethod === 'buying_mcap' || w.source === 'early-buy-mcap' || w.tags?.includes('early_mcap_buyer')) && (
                            <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }} title="Method 1: Qualified via Early Mcap (≤25% ATH)">
                              🎯 Mcap ≤25%
                            </span>
                          )}
                          {(w.methods?.includes('first_n_buyers') || w.qualificationMethod === 'first_n_buyers' || w.source === 'first-n-buyers' || w.tags?.includes('first_n_buyer')) && (
                            <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#fef3c7', color: '#b45309', fontWeight: 600 }} title="Method 2: Qualified via First N Early Buyers">
                              ⏱ First N
                            </span>
                          )}
                        </>
                      )}
                      {w.walletType === 'scam_wallet' && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>
                          🚨 Dev Scam
                        </span>
                      )}
                      {w.walletType === 'scammer_lineage_wallet' && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#ffedd5', color: '#ea580c', fontWeight: 600 }}>
                          ⚠️ Scammer Lineage
                        </span>
                      )}
                      {(w.retardPoints || 0) > 0 && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#fef3c7', color: '#b45309', fontWeight: 600 }}>
                          {w.retardPoints} retard pt
                        </span>
                      )}
                      {(w.susWalletPoints || 0) > 0 && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#f3e8ff', color: '#7e22ce', fontWeight: 600 }}>
                          {w.susWalletPoints} sus pt
                        </span>
                      )}
                      {w.earlyBuyerInfo && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }} title={`Early Buyer #${w.earlyBuyerInfo.rank || 1} on $${w.earlyBuyerInfo.symbol || 'TOKEN'}`}>
                          🎯 Early #{w.earlyBuyerInfo.rank || 1} · ${w.earlyBuyerInfo.symbol || 'TOKEN'}
                        </span>
                      )}
                      {w.tags?.includes('fomo_network_followed') && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#f0fdf4', color: '#15803d', fontWeight: 600 }} title="Followed by Top Leaderboard Traders on FOMO">
                          👥 Followed by Leaders
                        </span>
                      )}
                      {(w.flags?.is_sniper || w.tags?.includes('sniper') || w.tags?.includes('madeonsol_sniper')) && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#fee2e2', color: '#b91c1c', fontWeight: 600 }}>
                          ⚡ Sniper
                        </span>
                      )}
                      {(w.flags?.is_bundler || w.tags?.includes('bundler')) && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#ffedd5', color: '#c2410c', fontWeight: 600 }}>
                          📦 Bundler
                        </span>
                      )}
                      {w.tags?.includes('rank_1_buyer') && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                          🎯 Rank 1 Buyer
                        </span>
                      )}
                      {w.tags?.includes('alpha_buyer') && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>
                          🚀 Alpha Early Buyer
                        </span>
                      )}
                      {w.tags?.includes('kol') && (
                        <span style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#f5f3ff', color: '#6d28d9', fontWeight: 600 }}>
                          📢 KOL Caller
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* SMART, TRACKED & SNIPER TABLE BODY */}
                {(listCategory === 'smart' || listCategory === 'tracked' || listCategory === 'sniper') && (
                  <>
                    <td>
                      <strong style={{ color: Number(w.balanceUsd || 0) >= 5000 ? '#059669' : '#111827', fontSize: '0.78rem' }}>
                        {w.balanceUsd ? fmtUsd(w.balanceUsd) : '—'}
                      </strong>
                    </td>
                    <td>
                      <strong style={{ color: earned >= 0 ? '#059669' : '#dc2626', fontSize: '0.8rem' }}>
                        {fmtUsd(earned)}
                      </strong>
                    </td>
                    <td>
                      {w.roiPct != null && Number.isFinite(Number(w.roiPct)) ? (
                        <span style={{
                          fontWeight: 600,
                          color: Number(w.roiPct) >= 0 ? '#059669' : '#dc2626',
                          fontSize: '0.78rem',
                        }}>
                          {fmtSignedPct(w.roiPct)}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.12rem 0.35rem',
                        borderRadius: '3px',
                        fontWeight: 600,
                        fontSize: '0.72rem',
                        background: winRate >= 50 ? '#dcfce7' : winRate >= 35 ? '#fef3c7' : '#fee2e2',
                        color: winRate >= 50 ? '#15803d' : winRate >= 35 ? '#b45309' : '#b91c1c',
                      }}>
                        {winRate.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.75rem' }}>
                        <strong style={{ color: '#059669' }}>{w.profitableTrades || 0} won</strong>
                        <span style={{ color: '#6b7280', fontSize: '0.7rem' }}> / {w.tokenNum || w.totalTrades || 0} buys</span>
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ color: '#111827', fontSize: '0.78rem' }}>
                          {w.avgBuyMcap ? fmtCurrency(w.avgBuyMcap) : (w.avgBuyPrice ? fmtPrice(w.avgBuyPrice) : '—')}
                        </strong>
                        {w.avgBuyPrice ? (
                          <span style={{ color: '#6b7280', fontSize: '0.6875rem' }}>
                            {fmtPrice(w.avgBuyPrice)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ color: '#111827', fontSize: '0.78rem' }}>
                          {w.avgSellMcap
                            ? fmtCurrency(w.avgSellMcap)
                            : (w.avgSellPrice && w.avgBuyPrice && w.avgBuyMcap
                              ? fmtCurrency(Math.round(w.avgBuyMcap * (w.avgSellPrice / w.avgBuyPrice)))
                              : (w.avgSellPrice ? fmtPrice(w.avgSellPrice) : '—'))}
                        </strong>
                        {w.avgSellPrice ? (
                          <span style={{ color: '#6b7280', fontSize: '0.6875rem' }}>
                            {fmtPrice(w.avgSellPrice)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: '#374151',
                        background: '#f3f4f6',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        display: 'inline-block',
                      }}>
                        {fmtHoldingTime(w.avgHoldingTimeSec)}
                      </span>
                    </td>
                    <td>
                      {w.captureRatioPct != null && Number.isFinite(Number(w.captureRatioPct)) ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '0.12rem 0.35rem',
                          borderRadius: '3px',
                          fontWeight: 600,
                          fontSize: '0.72rem',
                          background: Number(w.captureRatioPct) >= 70 ? '#dcfce7' : Number(w.captureRatioPct) >= 40 ? '#f0f9ff' : '#f3f4f6',
                          color: Number(w.captureRatioPct) >= 70 ? '#15803d' : Number(w.captureRatioPct) >= 40 ? '#0369a1' : '#4b5563',
                        }}>
                          {fmtPct(w.captureRatioPct)}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td>
                      {w.roundTripRatePct != null && Number.isFinite(Number(w.roundTripRatePct)) ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '0.12rem 0.35rem',
                          borderRadius: '3px',
                          fontWeight: 600,
                          fontSize: '0.72rem',
                          background: Number(w.roundTripRatePct) <= 20 ? '#dcfce7' : Number(w.roundTripRatePct) <= 40 ? '#fef3c7' : '#fee2e2',
                          color: Number(w.roundTripRatePct) <= 20 ? '#15803d' : Number(w.roundTripRatePct) <= 40 ? '#b45309' : '#b91c1c',
                        }}>
                          {fmtPct(w.roundTripRatePct)}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td>
                      {w.soldAbove50AthPct != null && Number.isFinite(Number(w.soldAbove50AthPct)) ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '0.12rem 0.35rem',
                          borderRadius: '3px',
                          fontWeight: 600,
                          fontSize: '0.72rem',
                          background: Number(w.soldAbove50AthPct) >= 50 ? '#dcfce7' : '#f3f4f6',
                          color: Number(w.soldAbove50AthPct) >= 50 ? '#15803d' : '#4b5563',
                        }}>
                          {fmtPct(w.soldAbove50AthPct)}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td>
                      {(w.tokensTradedGt2m != null || w.hitRateGt2mPct != null) ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <strong style={{ color: '#111827', fontSize: '0.78rem' }}>
                            {(w.tokensTradedGt2m || 0)}/{(w.tokensTradedGt2m || 0) + (w.tokensTradedLt2m || 0)}
                          </strong>
                          <span style={{ color: '#6b7280', fontSize: '0.6875rem' }}>
                            {w.hitRateGt2mPct != null ? `${Number(w.hitRateGt2mPct).toFixed(0)}%` : '0%'}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td>
                      {(w.lastProcessedTxSignature || w.lastProcessedTimestamp) ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {w.lastProcessedTxSignature ? (
                            <span className="mono" style={{ fontSize: '0.6875rem', color: '#737373' }} title={w.lastProcessedTxSignature}>
                              {w.lastProcessedTxSignature.slice(0, 4)}…{w.lastProcessedTxSignature.slice(-4)}
                            </span>
                          ) : null}
                          {w.lastProcessedTimestamp ? (
                            <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>
                              {fmtRelativeTime(w.lastProcessedTimestamp) || new Date(Number(w.lastProcessedTimestamp) < 1e11 ? Number(w.lastProcessedTimestamp) * 1000 : Number(w.lastProcessedTimestamp)).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>—</span>
                      )}
                    </td>
                  </>
                )}

                {/* WHALE TABLE BODY */}
                {listCategory === 'whale' && (
                  <>
                    <td>
                      <strong style={{ color: '#111827', fontSize: '0.8rem' }}>
                        {fmtCurrency(w.balanceUsd || 0)}
                      </strong>
                    </td>
                    <td>
                      <strong style={{ color: '#059669', fontSize: '0.8rem' }}>
                        {fmtCurrency(w.memeHoldingsUsd || 0)}
                      </strong>
                    </td>
                    <td>
                      <span style={{ color: earned >= 0 ? '#059669' : '#dc2626', fontWeight: 600, fontSize: '0.78rem' }}>
                        {fmtUsd(earned)}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.6875rem',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: '#fefce8',
                        color: '#854d0e',
                        fontWeight: 600,
                      }}>
                        {Number(w.balanceUsd || 0) >= 5000 && Number(w.memeHoldingsUsd || 0) >= 5000
                          ? 'Balance & Meme >$5k'
                          : Number(w.balanceUsd || 0) >= 5000
                          ? 'Balance >$5k'
                          : 'Meme Holdings >$5k'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {Array.isArray(w.tags) && w.tags.map(t => (
                          <span key={t} style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#f3f4f6', color: '#4b5563' }}>{t}</span>
                        ))}
                      </div>
                    </td>
                  </>
                )}

                {/* LINEAGE TABLE BODY */}
                {listCategory === 'lineage' && (
                  <>
                    <td>
                      {w.lineageParent ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span className="mono" style={{ fontSize: '0.72rem', color: '#4338ca', fontWeight: 600 }} title={w.lineageParent}>
                            {w.lineageParent.slice(0, 6)}…{w.lineageParent.slice(-4)}
                          </span>
                          <button
                            type="button"
                            className="icon-button-ghost"
                            style={{ padding: '2px' }}
                            onClick={() => onCopy(w.lineageParent)}
                            title="Copy parent address"
                          >
                            <Copy size={10} />
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Unknown Funder</span>
                      )}
                    </td>
                    <td>
                      <strong style={{ color: '#0f172a', fontSize: '0.78rem' }}>
                        {w.lineageAmount ? `${w.lineageAmount} ${w.chain === 'solana' ? 'SOL' : 'ETH'}` : '—'}
                      </strong>
                    </td>
                    <td>
                      {w.lineageTx ? (
                        <a
                          href={w.chain === 'solana' ? `https://solscan.io/tx/${w.lineageTx}` : `https://robinhoodchain.blockscout.com/tx/${w.lineageTx}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#0284c7', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                        >
                          {w.lineageTx.slice(0, 8)}… <ExternalLink size={9} />
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Internal / off-chain</span>
                      )}
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.6875rem',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: '#ede9fe',
                        color: '#5b21b6',
                        fontWeight: 600,
                      }}>
                        {w.status || 'Active Child'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {Array.isArray(w.tags) && w.tags.map(t => (
                          <span key={t} style={{ fontSize: '0.625rem', padding: '1px 4px', borderRadius: '3px', background: '#f3f4f6', color: '#4b5563' }}>{t}</span>
                        ))}
                      </div>
                    </td>
                  </>
                )}

                {/* Actions Column */}
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
                    {listCategory === 'whale' && (
                      <button
                        type="button"
                        className="btn-outline btn-sm"
                        onClick={() => onConnectChild(w)}
                        title="Link a child wallet funded by this whale"
                        style={{ padding: '0.18rem 0.45rem', fontSize: '0.6875rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                      >
                        <GitFork size={11} /> Connect Child
                      </button>
                    )}
                    {(listCategory === 'tracked' || listCategory === 'lineage' || listCategory === 'sniper') && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => onPromote(w)}
                        title="Promote to Smart Wallet"
                        style={{ padding: '0.18rem 0.45rem', fontSize: '0.6875rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', background: '#059669', borderColor: '#059669' }}
                      >
                        <UserCheck size={11} /> Promote
                      </button>
                    )}
                    <a
                      href={gmgnUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-outline btn-sm"
                      style={{ padding: '0.18rem 0.4rem', fontSize: '0.6875rem', textDecoration: 'none' }}
                      title="Inspect on GMGN.ai"
                    >
                      GMGN
                    </a>

                    <button
                      type="button"
                      className="icon-button-ghost"
                      onClick={() => onDelete(w)}
                      title="Delete wallet"
                      style={{ color: '#9ca3af', padding: '2px' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
