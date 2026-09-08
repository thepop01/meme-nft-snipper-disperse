import React, { useEffect, useState } from 'react';
import { Crosshair, Eye, ExternalLink, RefreshCw, Timer } from 'lucide-react';
import { api, subscribeWs } from '../utils/sniperApi';
import { ago, fmtSol, fmtUsdPrecise } from '../utils/format';
import { Pill, StatusDot } from './ui/Primitives';
import { Modal } from './ui/Modal';
import { useToast } from './ui/useToast';
import { TokenAvatar } from './meme/TokenRow';

function PnlCell({ pct, sol }) {
  const tone = (pct ?? 0) > 0 ? 'text-green' : (pct ?? 0) < 0 ? 'text-red' : '';
  return (
    <span className={`pnl-cell ${tone}`}>
      {pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '--'}
      {sol != null && <span style={{ fontWeight: 400, marginLeft: 6, fontSize: '0.75rem' }}>({sol >= 0 ? '+' : ''}{fmtSol(sol)} ◎)</span>}
    </span>
  );
}

function LimitSellModal({ position, onClose, onPlaced }) {
  const toast = useToast();
  const preset = position?._preset;
  const [triggerPrice, setTriggerPrice] = useState('');
  const [fraction, setFraction] = useState(1);
  const [busy, setBusy] = useState(false);

  const trigger = Number(triggerPrice);
  const current = position?.currentPriceUsd ?? position?.entryPriceUsd ?? 0;
  const hint = trigger > 0
    ? (trigger > current ? `take profit: sells if price rises to $${trigger}` : `stop: sells if price falls to $${trigger}`)
    : null;

  useEffect(() => {
    if (!position) return;
    if (preset === 'tp' && current > 0) {
      setTriggerPrice((current * 1.5).toFixed(8));
      setFraction(0.25);
    } else if (preset === 'sl' && current > 0) {
      setTriggerPrice((current * 0.7).toFixed(8));
      setFraction(1);
    } else {
      setTriggerPrice('');
      setFraction(1);
    }
  }, [position, preset, current]);

  if (!position) return null;

  const title = preset === 'tp' ? 'Take profit'
    : preset === 'sl' ? 'Stop loss'
    : `Limit sell ${position.symbol || position.mint.slice(0, 8)}`;

  const place = async () => {
    setBusy(true);
    try {
      await api.createLimitOrder({
        side: 'sell', positionId: position.id, triggerPriceUsd: trigger, fraction,
      });
      toast.success(`Limit sell placed for ${position.symbol || 'position'} @ $${trigger}`);
      onPlaced?.();
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  return (
    <Modal
      open={!!position}
      onClose={onClose}
      title={title}
      actions={
        <>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={place} disabled={busy || !(trigger > 0)}>
            {busy ? 'Placing…' : `Place @ $${triggerPrice || '—'}`}
          </button>
        </>
      }
    >
      <div className="param-grid" style={{ marginTop: '0.75rem' }}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Trigger price (USD) — now {fmtUsdPrecise(current)}</label>
          <input
            className="input-field" type="number" step="any" min="0"
            value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)}
          />
          {hint && <span className="text-dim" style={{ fontSize: '0.72rem' }}>{hint}</span>}
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Sell amount</label>
          <div className="sell-btn-group">
            {[0.25, 0.5, 1].map(f => (
              <button
                key={f}
                className={fraction === f ? 'btn-primary btn-xs' : 'sell-btn'}
                onClick={() => setFraction(f)}
              >
                {f === 1 ? 'ALL' : `${f * 100}%`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const ORDER_STATUS_COLOR = { open: 'blue', filled: 'green', cancelled: 'gray', expired: 'gray', failed: 'red' };

const SniperView = () => {
  const toast = useToast();
  const [backend, setBackend] = useState(undefined);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [limitOrders, setLimitOrders] = useState([]);
  const [limitSellPos, setLimitSellPos] = useState(null);
  const [wsOn, setWsOn] = useState(false);
  const [selling, setSelling] = useState({});

  const refresh = async () => {
    try {
      const [status, pos, tr, wl, lo] = await Promise.all([
        api.status(), api.positions(), api.trades(), api.watchlist(), api.limitOrders(),
      ]);
      setBackend(status);
      setPositions(pos.positions || []);
      setTrades(tr.trades || []);
      setWatchlist(wl.watchlist || []);
      setLimitOrders(lo.orders || []);
    } catch {
      setBackend(null);
    }
  };

  const refreshWatchlist = async () => {
    try {
      const wl = await api.watchlist();
      setWatchlist(wl.watchlist || []);
    } catch { /* backend offline; main refresh handles banner */ }
  };

  useEffect(() => {
    refresh();
    const unsub = subscribeWs((msg) => {
      if (msg.type === 'ws:status') {
        setWsOn(msg.connected);
        if (msg.connected) refresh();
      }
      if (msg.type === 'position:update' && msg.position) {
        setPositions(prev => {
          const others = prev.filter(p => p.id !== msg.position.id);
          return [...others, msg.position];
        });
      }
      if (msg.type === 'trade:executed') refresh();
      if (msg.type === 'bot:watching') refreshWatchlist();
      if (msg.type === 'limitorder:update' && msg.order) {
        setLimitOrders(prev => {
          const others = prev.filter(o => o.id !== msg.order.id);
          return [msg.order, ...others];
        });
      }
    });
    return unsub;
  }, []);

  const sell = async (position, fraction) => {
    setSelling(s => ({ ...s, [position.id]: true }));
    try {
      await api.sell({ positionId: position.id, fraction });
      toast.success(`Sold ${Math.round(fraction * 100)}% of ${position.symbol || 'position'}`);
    } catch (err) {
      toast.error(err.message);
    }
    setSelling(s => ({ ...s, [position.id]: false }));
  };

  const cancelOrder = async (order) => {
    try {
      await api.cancelLimitOrder(order.id);
      toast.success(`Cancelled limit ${order.side} for ${order.symbol || order.mint.slice(0, 6)}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const open = positions.filter(p => p.status === 'open').sort((a, b) => b.openedAt - a.openedAt);
  const totalPnl = open.reduce((n, p) => n + (p.pnlSol || 0), 0);
  const openOrders = limitOrders.filter(o => o.status === 'open');
  const recentClosedOrders = limitOrders.filter(o => o.status !== 'open').slice(0, 5);
  const shownOrders = [...openOrders, ...recentClosedOrders];

  return (
    <div className="solana-container">
      <div className="page-header">
        <h2>Sniper</h2>
        <p>Open positions with live PnL, automatic exits, and trade history</p>
      </div>

      {backend === null && (
        <div className="conn-banner offline">
          <StatusDot on={false} />
          <span>Backend offline — start it with <span className="mono">cd backend && npm start</span></span>
        </div>
      )}
      {backend?.dryRun && (
        <div className="conn-banner dryrun">
          <span>🧪</span>
          <span><b>Paper trading</b> — positions below are simulated fills against live prices.</span>
        </div>
      )}

      {backend && watchlist.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Eye size={14} /> Agent Watchlist ({watchlist.length})
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>
              observed, not bought — waiting for traction confirmation
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Bot</th>
                  <th>Watching for</th>
                  <th>Waiting on</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((w, i) => (
                  <tr key={`${w.botId}-${w.mint}-${i}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <TokenAvatar token={w} size={24} />
                        <span style={{ fontWeight: 700 }}>{w.symbol || w.mint.slice(0, 6)}</span>
                        <a href={`https://dexscreener.com/${w.chain || 'solana'}/${w.mint}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </td>
                    <td><Pill color="violet">{w.botName}</Pill></td>
                    <td className="mono text-dim">{ago(w.addedAt)}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-dim)', maxWidth: 360 }}>{w.lastReason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {backend && shownOrders.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Timer size={14} /> Limit Orders ({openOrders.length} open)
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>
              fires a market order when the trigger price crosses — backend must stay running
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Order</th>
                  <th>Trigger</th>
                  <th>Last price</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Placed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shownOrders.map(o => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700 }}>{o.symbol || o.mint.slice(0, 6)}</span>
                        <a href={`https://dexscreener.com/${o.chain || 'solana'}/${o.mint}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </td>
                    <td>
                      <Pill color={o.side === 'buy' ? 'blue' : 'green'}>
                        {o.side} {o.direction === 'below' ? '≤' : '≥'}
                      </Pill>
                    </td>
                    <td className="mono">{fmtUsdPrecise(o.triggerPriceUsd)}</td>
                    <td className="mono text-dim">{o.lastPriceUsd != null ? fmtUsdPrecise(o.lastPriceUsd) : '--'}</td>
                    <td className="mono">
                      {o.side === 'buy' ? `${fmtSol(o.solAmount)} ◎` : `${Math.round((o.fraction ?? 1) * 100)}%`}
                    </td>
                    <td>
                      <Pill color={ORDER_STATUS_COLOR[o.status] || 'gray'}>{o.status}</Pill>
                      {o.status === 'failed' && o.error && (
                        <span className="text-dim" style={{ fontSize: '0.68rem', marginLeft: 6 }} title={o.error}>ⓘ</span>
                      )}
                    </td>
                    <td className="mono text-dim" style={{ fontSize: '0.75rem' }}>{ago(o.createdAt)}</td>
                    <td>
                      {o.status === 'open' && (
                        <button className="btn-outline btn-xs" onClick={() => cancelOrder(o)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {backend && (
        <div className="panel">
          <div className="panel-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Open Positions ({open.length})
              <StatusDot on={wsOn} pulse />
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <PnlCell sol={totalPnl} pct={null} />
              <button className="btn-outline btn-xs" onClick={refresh}>
                <RefreshCw size={12} />
              </button>
            </span>
          </div>

          {open.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem' }}>
              <Crosshair size={36} color="var(--text-dim)" />
              <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No open positions. Buy from the Meme Finder or start a bot.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Entry</th>
                    <th>Current</th>
                    <th>PnL</th>
                    <th>Size (◎)</th>
                    <th>Exits</th>
                    <th>Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <TokenAvatar token={p} size={26} />
                          <span style={{ fontWeight: 700 }}>{p.symbol || p.mint.slice(0, 6)}</span>
                          {p.dryRun && <Pill color="yellow">paper</Pill>}
                          {p.botId && <Pill color="violet">bot</Pill>}
                          <a href={`https://dexscreener.com/${p.chain || 'solana'}/${p.mint}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      </td>
                      <td className="mono">{fmtUsdPrecise(p.entryPriceUsd)}</td>
                      <td className="mono">{fmtUsdPrecise(p.currentPriceUsd)}</td>
                      <td><PnlCell pct={p.pnlPct} sol={p.pnlSol} /></td>
                      <td className="mono">{fmtSol(p.solSpent)}</td>
                      <td style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                        {[
                          p.exitRules?.takeProfitPct && `TP +${p.exitRules.takeProfitPct}%`,
                          p.exitRules?.stopLossPct && `SL -${p.exitRules.stopLossPct}%`,
                          p.exitRules?.trailingStopPct && `Trail ${p.exitRules.trailingStopPct}%`,
                          p.exitRules?.maxHoldMin && `${p.exitRules.maxHoldMin}min`,
                        ].filter(Boolean).join(' · ') || 'manual'}
                      </td>
                      <td>
                        <div className="sell-btn-group">
                          {[0.25, 0.5, 1].map(f => (
                            <button
                              key={f}
                              className="sell-btn"
                              disabled={selling[p.id]}
                              onClick={() => sell(p, f)}
                            >
                              {f === 1 ? 'ALL' : `${f * 100}%`}
                            </button>
                          ))}
                          <button
                            className="sell-btn sell-btn-tp"
                            title="Take profit — sell when price rises"
                            onClick={() => setLimitSellPos({ ...p, _preset: 'tp' })}
                          >
                            TP
                          </button>
                          <button
                            className="sell-btn sell-btn-sl"
                            title="Stop loss — sell when price drops"
                            onClick={() => setLimitSellPos({ ...p, _preset: 'sl' })}
                          >
                            SL
                          </button>
                          <button
                            className="sell-btn"
                            title="Custom limit sell (trigger price)"
                            onClick={() => setLimitSellPos({ ...p, _preset: null })}
                          >
                            LMT
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {backend && (
        <div className="panel">
          <div className="panel-title"><span>Trade History</span></div>
          {trades.length === 0 ? (
            <p className="text-dim" style={{ fontSize: '0.82rem' }}>No trades yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Token</th>
                    <th>SOL</th>
                    <th>PnL</th>
                    <th>Reason</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 30).map((t, i) => (
                    <tr key={i}>
                      <td className="mono text-dim" style={{ fontSize: '0.75rem' }}>{new Date(t.timestamp).toLocaleTimeString()}</td>
                      <td><Pill color={t.side === 'buy' ? 'blue' : 'green'}>{t.side}</Pill></td>
                      <td style={{ fontWeight: 600 }}>{t.symbol || t.mint?.slice(0, 6)}</td>
                      <td className="mono">{fmtSol(t.solAmount)}</td>
                      <td>{t.side === 'sell' ? <PnlCell sol={t.pnlSol} pct={null} /> : '--'}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{t.reason || (t.dryRun ? 'paper' : '')}</td>
                      <td>
                        {t.txSignature && !t.txSignature.startsWith('paper') ? (
                          <a href={`https://solscan.io/tx/${t.txSignature}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                            {t.txSignature.slice(0, 8)}… <ExternalLink size={10} />
                          </a>
                        ) : <span className="text-dim" style={{ fontSize: '0.75rem' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <LimitSellModal
        position={limitSellPos}
        onClose={() => setLimitSellPos(null)}
        onPlaced={refresh}
      />
    </div>
  );
};

export default SniperView;
