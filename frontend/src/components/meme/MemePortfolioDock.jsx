import React, { useEffect, useState } from 'react';
import { Activity, ArrowUpFromLine, BarChart3, Clock3, ExternalLink, RefreshCw, Timer, X } from 'lucide-react';
import { api } from '../../utils/sniperApi';
import { ago, fmtSol, fmtUsdPrecise } from '../../utils/format';
import { Pill } from '../ui/Primitives';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import { WalletTagSelector } from '../ui/WalletSelectors';

function PnlValue({ value, suffix = 'SOL' }) {
  const amount = Number(value || 0);
  return <span className={amount > 0 ? 'text-green' : amount < 0 ? 'text-red' : 'text-muted'}>{amount >= 0 ? '+' : ''}{amount.toFixed(4)} {suffix}</span>;
}

function LimitSellModal({ position, onClose, onPlaced }) {
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [fraction, setFraction] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (position) setPrice(position.currentPriceUsd ? String(position.currentPriceUsd) : '');
  }, [position]);

  if (!position) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.createLimitOrder({ side: 'sell', positionId: position.id, triggerPriceUsd: Number(price), fraction });
      toast.success(`Limit sell placed for ${position.symbol || 'position'}`);
      onPlaced?.();
      onClose();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!position} onClose={onClose} title={`Limit sell ${position.symbol || 'position'}`} actions={
      <><button className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary btn-sm" disabled={busy || !(Number(price) > 0)} onClick={submit}>{busy ? 'Placing…' : 'Place limit sell'}</button></>
    }>
      <div className="form-group"><label className="form-label">Trigger price (USD)</label><input className="input-field mono" type="number" step="any" min="0" value={price} onChange={event => setPrice(event.target.value)} /></div>
      <div className="form-group"><label className="form-label">Position to sell</label><div className="ticket-presets">{[0.25, 0.5, 0.75, 1].map(value => <button key={value} className={fraction === value ? 'active' : ''} onClick={() => setFraction(value)}>{value * 100}%</button>)}</div></div>
      <p className="text-dim" style={{ fontSize: '0.75rem' }}>This order is monitored by the backend and submits a market sell when the trigger crosses.</p>
    </Modal>
  );
}

export default function MemePortfolioDock({
  positions, orders, trades, fills = [], pnl, loading, onRefresh,
  wallets = [], selectedWalletAddress = '', onWalletChange,
  tags = [], selectedTagIds = [], onTagChange,
}) {
  const toast = useToast();
  const [tab, setTab] = useState('positions');
  const [limitSell, setLimitSell] = useState(null);
  const [selling, setSelling] = useState({});

  const filteredPositions = selectedWalletAddress
    ? positions.filter(position => String(position.walletAddress || '').toLowerCase() === selectedWalletAddress.toLowerCase())
    : positions;
  const open = filteredPositions.filter(position => position.status === 'open').sort((a, b) => b.openedAt - a.openedAt);
  const openOrders = orders.filter(order => order.status === 'open' && (!selectedWalletAddress || String(order.walletAddress || '').toLowerCase() === selectedWalletAddress.toLowerCase()));
  const displayOrders = (selectedWalletAddress
    ? orders.filter(order => String(order.walletAddress || '').toLowerCase() === selectedWalletAddress.toLowerCase())
    : orders).sort((a, b) => b.createdAt - a.createdAt);
  const unrealized = open.reduce((sum, position) => sum + (position.pnlSol || 0), 0);
  const realized = pnl?.realizedPnlSol ?? trades.filter(trade => trade.side === 'sell').reduce((sum, trade) => sum + (trade.pnlSol || 0), 0);
  const invested = open.reduce((sum, position) => sum + (position.solSpent || 0), 0);
  const wins = fills.length ? fills.filter(fill => fill.side === 'sell') : trades.filter(trade => trade.side === 'sell');
  const winRate = pnl?.winRate != null ? pnl.winRate * 100 : (wins.length ? wins.filter(trade => ((trade.realizedPnlSol ?? trade.pnlSol) || 0) > 0).length / wins.length * 100 : null);
  const history = (selectedWalletAddress
    ? (fills.length ? fills : trades).filter(t => String(t.walletAddress || '').toLowerCase() === selectedWalletAddress.toLowerCase())
    : (fills.length ? fills : trades));

  const quickSell = async (position, fraction) => {
    setSelling(current => ({ ...current, [position.id]: true }));
    try {
      await api.sell({ positionId: position.id, fraction });
      toast.success(`Quick sell submitted for ${position.symbol || 'position'}`);
      onRefresh?.();
    } catch (error) { toast.error(error.message); }
    finally { setSelling(current => ({ ...current, [position.id]: false })); }
  };

  const cancel = async order => {
    try { await api.cancelLimitOrder(order.id); toast.success(`Cancelled ${order.side} order`); onRefresh?.(); }
    catch (error) { toast.error(error.message); }
  };

  return (
    <section className="portfolio-dock">
      <div className="portfolio-filter-bar">
        <span style={{ fontSize: '0.8rem', color: '#4b5563', fontWeight: 600 }}>Wallet:</span>
        <select
          className="select-field"
          style={{ minWidth: '220px', height: '30px', fontSize: '0.8rem', padding: '2px 8px' }}
          value={selectedWalletAddress}
          onChange={e => onWalletChange?.(e.target.value)}
        >
          <option value="">All Wallets ({wallets.length})</option>
          {wallets.map(w => (
            <option key={w.id || w.address} value={w.address}>
              {w.name ? `${w.name} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : `${w.address.slice(0, 8)}…${w.address.slice(-6)}`}
            </option>
          ))}
        </select>
        {selectedWalletAddress && (
          <button className="btn-outline btn-xs" type="button" onClick={() => onWalletChange?.('')}>Clear</button>
        )}
      </div>
      <div className="portfolio-summary">
        <div><span className="summary-label">Open positions</span><strong>{open.length}</strong></div>
        <div><span className="summary-label">Unrealized PnL</span><strong><PnlValue value={unrealized} /></strong></div>
        <div><span className="summary-label">Realized PnL</span><strong><PnlValue value={realized} /></strong></div>
        <div><span className="summary-label">Capital at risk</span><strong>{invested.toFixed(4)} SOL</strong></div>
        <div><span className="summary-label">Win rate</span><strong>{winRate == null ? '--' : `${winRate.toFixed(0)}%`}</strong></div>
        <button className="icon-button-ghost" onClick={onRefresh} title="Refresh portfolio"><RefreshCw size={14} /></button>
      </div>
      <div className="portfolio-tabs">
        <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}><BarChart3 size={14} /> Positions <b>{open.length}</b></button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}><Timer size={14} /> Orders <b>{openOrders.length}</b></button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Activity size={14} /> Trade History</button>
        <button className={tab === 'pnl' ? 'active' : ''} onClick={() => setTab('pnl')}><ArrowUpFromLine size={14} /> PnL Analytics</button>
      </div>
      <div className="portfolio-content">
        {loading ? <div className="portfolio-empty">Loading portfolio…</div> : tab === 'positions' && (
          open.length === 0 ? <div className="portfolio-empty"><BarChart3 size={24} /><strong>No meme positions yet</strong><span>Select a token above to make a paper or live trade.</span></div> : (
            <div className="portfolio-table-wrap"><table className="data-table portfolio-table"><thead><tr><th>Position</th><th>Entry</th><th>Mark</th><th>Size</th><th>PnL</th><th>Exit actions</th></tr></thead><tbody>
              {open.map(position => <tr key={position.id}>
                <td><strong>{position.symbol || (position.mint || '').slice(0, 8)}</strong><div className="text-dim mono" style={{ fontSize: '0.68rem' }}>{(position.mint || '').slice(0, 8)}… · {(position.walletAddress || 'paper').slice(0, 6)}</div></td>
                <td className="mono">{fmtUsdPrecise(position.entryPriceUsd)}</td><td className="mono">{fmtUsdPrecise(position.currentPriceUsd)}</td><td className="mono">{fmtSol(position.solSpent)} SOL</td>
                <td><PnlValue value={position.pnlSol} /><div className={position.pnlPct >= 0 ? 'text-green' : 'text-red'} style={{ fontSize: '0.68rem' }}>{position.pnlPct >= 0 ? '+' : ''}{(position.pnlPct || 0).toFixed(1)}%</div></td>
                <td><div className="portfolio-actions"><button className="quick-sell-button" disabled={selling[position.id]} onClick={() => quickSell(position, 1)}><ArrowUpFromLine size={12} /> Quick Sell</button><button className="limit-sell-button" onClick={() => setLimitSell(position)}><Clock3 size={12} /> Limit Sell</button></div></td>
              </tr>)}
            </tbody></table></div>
          )
        )}
        {!loading && tab === 'orders' && (
          displayOrders.length === 0 ? <div className="portfolio-empty"><Timer size={24} /><strong>No orders</strong><span>Trigger orders will appear here with their complete lifecycle.</span></div> : <div className="portfolio-table-wrap"><table className="data-table portfolio-table"><thead><tr><th>Token</th><th>Side / type</th><th>Trigger</th><th>Original / remaining</th><th>Status</th><th>Created / filled</th><th /></tr></thead><tbody>{displayOrders.map(order => <tr key={order.id}><td><strong>{order.symbol || (order.mint || '').slice(0, 8)}</strong></td><td><Pill color={order.side === 'buy' ? 'blue' : 'green'}>{order.side} {order.direction === 'below' ? '≤' : '≥'}</Pill><div className="text-dim">{order.type || 'server-trigger'}</div></td><td className="mono">{fmtUsdPrecise(order.triggerPriceUsd)}</td><td className="mono">{order.side === 'buy' ? `${fmtSol(order.originalAmount ?? order.solAmount)} / ${fmtSol(order.remainingAmount ?? order.solAmount)} SOL` : `${Math.round(((order.originalAmount ?? order.fraction) || 1) * 100)}% / ${Math.round(((order.remainingAmount ?? order.fraction) || 0) * 100)}%`}</td><td><Pill color={order.status === 'filled' ? 'green' : order.status === 'failed' ? 'red' : order.status === 'open' ? 'blue' : 'gray'}>{order.status}</Pill>{order.error && <div className="text-red">{order.error}</div>}</td><td className="text-dim">{ago(order.createdAt)}{order.filledAt && <div>filled {ago(order.filledAt)}</div>}</td><td>{order.status === 'open' && <button className="btn-outline btn-xs" onClick={() => cancel(order)}><X size={12} /> Cancel</button>}</td></tr>)}</tbody></table></div>
        )}
        {!loading && tab === 'history' && (
          history.length === 0 ? <div className="portfolio-empty"><Activity size={24} /><strong>No fill history</strong><span>Confirmed buys and sells will be recorded here.</span></div> : <div className="portfolio-table-wrap"><table className="data-table portfolio-table"><thead><tr><th>Time</th><th>Side</th><th>Token / wallet</th><th>Amount</th><th>Fees</th><th>PnL</th><th>Tx</th></tr></thead><tbody>{history.slice(0, 50).map((trade, index) => <tr key={trade.id || `${trade.timestamp}-${index}`}><td className="text-dim">{ago(trade.filledAt || trade.timestamp)}</td><td><Pill color={trade.side === 'buy' ? 'blue' : 'green'}>{trade.side}</Pill></td><td><strong>{trade.symbol || trade.tokenAddress?.slice(0, 8) || trade.mint?.slice(0, 8)}</strong><div className="text-dim mono">{trade.walletAddress?.slice(0, 8) || '--'}</div></td><td className="mono">{fmtSol(trade.quoteQuantitySol ?? trade.solAmount)} SOL</td><td className="mono">{fmtSol((trade.feeSol || 0) + (trade.networkFeeSol || 0))}</td><td>{trade.side === 'sell' ? <PnlValue value={trade.realizedPnlSol ?? trade.pnlSol} /> : '--'}</td><td>{trade.txSignature && !trade.txSignature.startsWith('paper') ? <a className="tx-link" href={`https://solscan.io/tx/${trade.txSignature}`} target="_blank" rel="noreferrer"><ExternalLink size={11} /></a> : '--'}</td></tr>)}</tbody></table></div>
        )}
        {!loading && tab === 'pnl' && <div className="pnl-analytics"><div className="pnl-hero"><span>Net tracked PnL</span><strong><PnlValue value={pnl?.totalPnlSol ?? realized + unrealized} /></strong><small>FIFO realized fills plus open-position mark-to-market</small></div><div className="pnl-grid"><div><span>Realized</span><strong><PnlValue value={realized} /></strong></div><div><span>Unrealized</span><strong><PnlValue value={pnl?.unrealizedPnlSol ?? unrealized} /></strong></div><div><span>Fees & network</span><strong>{fmtSol(pnl?.feesSol || 0)} SOL</strong></div><div><span>Win rate</span><strong>{winRate == null ? '--' : `${winRate.toFixed(1)}%`}</strong></div><div><span>Average win</span><strong><PnlValue value={pnl?.averageWinSol || 0} /></strong></div><div><span>Average loss</span><strong><PnlValue value={pnl?.averageLossSol || 0} /></strong></div></div>{pnl?.equityCurve?.length > 0 && <div className="equity-curve-list">{pnl.equityCurve.slice(-14).map(point => <div key={point.date}><span>{point.date}</span><PnlValue value={point.totalPnlSol} /></div>)}</div>}<p className="text-dim pnl-note">Confirmed fills are immutable. Cost basis uses FIFO and includes recorded fees and network costs.</p></div>}
      </div>
      <LimitSellModal position={limitSell} onClose={() => setLimitSell(null)} onPlaced={onRefresh} />
    </section>
  );
}
