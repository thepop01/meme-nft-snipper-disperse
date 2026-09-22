import React from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, Clock3,
  ExternalLink, Info, LoaderCircle, WalletCards, Zap,
} from 'lucide-react';
import { fmtUsdPrecise } from '../../utils/format';
import { Pill } from '../ui/Primitives';
import { Modal } from '../ui/Modal';
import { useTradeTicket } from './useTradeTicket';

const PRESETS = ['0.05', '0.1', '0.25', '0.5'];

export default function TradeTicket({
  token, positions = [], requestedSide, onChanged, dryRun, backend, wallets = [],
}) {
  const {
    side,
    setSide,
    orderType,
    setOrderType,
    amount,
    setAmount,
    fraction,
    setFraction,
    triggerPrice,
    setTriggerPrice,
    slippage,
    setSlippage,
    takeProfit,
    setTakeProfit,
    stopLoss,
    setStopLoss,
    busy,
    solWallet,
    prepared,
    setPrepared,
    selectedWalletAddresses,
    setSelectedWalletAddresses,
    walletDropdownOpen,
    setWalletDropdownOpen,
    targetSellPositions,
    current,
    supported,
    isPaper,
    liveLimitEnabled,
    connectSolana,
    signPrepared,
    submit,
    valid,
    numSelected,
    totalBuySpendSol,
    toast,
  } = useTradeTicket({
    token,
    positions,
    requestedSide,
    onChanged,
    dryRun,
    backend,
    wallets,
  });

  return (
    <aside className="trade-ticket">
      <div className="trade-ticket-head">
        <div>
          <span className="section-kicker">Execution</span>
          <h3>Trade terminal</h3>
        </div>
        {isPaper && <Pill color="yellow">paper</Pill>}
      </div>
      {!isPaper && (
        <div className="ticket-position-hint">
          <span>Execution wallet</span>
          <button className="btn-outline btn-xs" type="button" onClick={() => connectSolana().catch(error => toast.error(error.message))}>
            {solWallet ? `${solWallet.slice(0, 5)}…${solWallet.slice(-4)}` : 'Connect Solana wallet'}
          </button>
        </div>
      )}

      {/* Wallet Selector Dropdown with Multi-Select */}
      <div style={{ margin: '0.6rem 0 0.8rem 0', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
          <label className="ticket-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
            <WalletCards size={13} />
            Execution Wallets
          </label>
          {numSelected > 0 ? (
            <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>
              {numSelected} wallet{numSelected > 1 ? 's' : ''} selected
            </span>
          ) : (
            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              All / Default
            </span>
          )}
        </div>

        <button
          type="button"
          className="input-field"
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 10px',
            fontSize: '0.78rem',
            cursor: 'pointer',
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: '6px',
            color: '#f9fafb',
            textAlign: 'left',
          }}
          onClick={() => setWalletDropdownOpen(open => !open)}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
            {numSelected === 0
              ? `All / Default (${wallets.length ? `${wallets.length} available` : 'Paper'})`
              : numSelected === 1
                ? (() => {
                    const found = wallets.find(w => w.address === selectedWalletAddresses[0]);
                    return found?.name ? `${found.name} (${found.address.slice(0, 6)}…)` : `${selectedWalletAddresses[0].slice(0, 6)}…${selectedWalletAddresses[0].slice(-4)}`;
                  })()
                : `${numSelected} Wallets Selected`}
          </span>
          <ChevronDown
            size={14}
            style={{
              opacity: 0.7,
              transform: walletDropdownOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          />
        </button>

        {walletDropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '4px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '8px',
              zIndex: 99,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)',
              maxHeight: '260px',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #1e293b' }}>
              <button
                type="button"
                className="btn-outline btn-xs"
                style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                onClick={() => setSelectedWalletAddresses(wallets.map(w => w.address))}
              >
                Select All ({wallets.length})
              </button>
              <button
                type="button"
                className="btn-outline btn-xs"
                style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                onClick={() => setSelectedWalletAddresses([])}
              >
                Clear (Default)
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {wallets.length === 0 && (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '6px 4px' }}>
                  No directory wallets configured yet. Trade executes on default paper wallet.
                </div>
              )}
              {wallets.map(w => {
                const isChecked = selectedWalletAddresses.includes(w.address);
                return (
                  <label
                    key={w.id || w.address}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: isChecked ? '#1e293b' : 'transparent',
                      color: isChecked ? '#38bdf8' : '#cbd5e1',
                      fontSize: '0.75rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        setSelectedWalletAddresses(prev =>
                          prev.includes(w.address)
                            ? prev.filter(a => a !== w.address)
                            : [...prev, w.address]
                        );
                      }}
                    />
                    <span style={{ fontWeight: 600 }}>{w.name || 'Wallet'}</span>
                    <span className="mono" style={{ fontSize: '0.7rem', opacity: 0.7, marginLeft: 'auto' }}>
                      {w.address.slice(0, 5)}…{w.address.slice(-4)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!token ? (
        <div className="trade-ticket-empty">
          <Zap size={24} />
          <strong>Select a token</strong>
          <span>Choose a market from the scanner to prepare an order.</span>
        </div>
      ) : (
        <>
          <div className="ticket-token">
            {token.imageUrl ? <img src={token.imageUrl} alt="" /> : <span>{(token.symbol || '?').slice(0, 2)}</span>}
            <div><strong>{token.symbol || 'Unknown'}</strong><small>{token.name || 'Meme token'}</small></div>
            <div className="ticket-price"><strong>{fmtUsdPrecise(current)}</strong><small>USD</small></div>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
            {((token.chain || 'solana') === 'solana') && (
              <a
                href={`https://pump.fun/coin/${encodeURIComponent(token.mint || '')}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.72rem', color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid #e5e7eb', background: '#f9fafb', textDecoration: 'none' }}
              >
                pump.fun <ExternalLink size={10} />
              </a>
            )}
            <a
              href={`https://gmgn.ai/${(token.chain || 'solana') === 'robinhood' ? 'robinhood' : 'sol'}/token/${encodeURIComponent(token.mint || '')}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.72rem', color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid #e5e7eb', background: '#f9fafb', textDecoration: 'none' }}
            >
              GMGN <ExternalLink size={10} />
            </a>
            <a
              href={`https://dexscreener.com/${token.chain || 'solana'}/${encodeURIComponent(token.mint || '')}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.72rem', color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid #e5e7eb', background: '#f9fafb', textDecoration: 'none' }}
            >
              DexScreener <ExternalLink size={10} />
            </a>
          </div>

          <div className="ticket-side-toggle">
            <button className={side === 'buy' ? 'buy active' : 'buy'} onClick={() => setSide('buy')}><ArrowDownToLine size={14} /> Buy</button>
            <button className={side === 'sell' ? 'sell active' : 'sell'} onClick={() => setSide('sell')}><ArrowUpFromLine size={14} /> Sell</button>
          </div>

          <div className="ticket-order-toggle">
            <button className={orderType === 'quick' ? 'active' : ''} onClick={() => setOrderType('quick')}>{side === 'buy' ? 'Quick Buy' : 'Quick Sell'}</button>
            <button className={orderType === 'limit' ? 'active' : ''} onClick={() => setOrderType('limit')}>{side === 'buy' ? 'Limit Buy' : 'Limit Sell'}</button>
          </div>

          {side === 'buy' ? (
            <>
              <label className="ticket-label">Amount per wallet (SOL)</label>
              <div className="ticket-presets">
                {PRESETS.map(value => <button key={value} className={amount === value ? 'active' : ''} onClick={() => setAmount(value)}>{value}</button>)}
              </div>
              <input className="input-field ticket-input" type="number" min="0" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
              {totalBuySpendSol && (
                <div style={{
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  marginTop: '0.4rem',
                  fontSize: '0.74rem',
                  color: '#38bdf8',
                }}>
                  <strong>Multi-Wallet:</strong> {amount} SOL × {numSelected} wallets = <strong className="mono">{totalBuySpendSol} SOL</strong> total
                </div>
              )}
            </>
          ) : (
            <>
              <div className="ticket-position-hint">
                <span>Position ({targetSellPositions.length})</span>
                <strong>{targetSellPositions.length > 0 ? `${targetSellPositions[0].symbol || token.symbol} · ${targetSellPositions[0].pnlPct >= 0 ? '+' : ''}${(targetSellPositions[0].pnlPct || 0).toFixed(1)}%` : 'No open position'}</strong>
              </div>
              <label className="ticket-label">Sell amount</label>
              <div className="ticket-presets">
                {[0.25, 0.5, 0.75, 1].map(value => <button key={value} className={fraction === value ? 'active' : ''} onClick={() => setFraction(value)}>{value * 100}%</button>)}
              </div>
            </>
          )}

          {orderType === 'limit' && (
            <>
              <label className="ticket-label">Trigger price (USD)</label>
              <input className="input-field ticket-input mono" type="number" min="0" step="any" value={triggerPrice} onChange={event => setTriggerPrice(event.target.value)} placeholder={current ? String(current) : '0.000001'} />
              <div className="ticket-hint"><Clock3 size={12} /> Backend watches the trigger and submits a market fill.</div>
            </>
          )}

          <div className="ticket-two-col">
            <label className="ticket-label">Slippage %<input className="input-field ticket-input" type="number" min="0" value={slippage} onChange={event => setSlippage(event.target.value)} /></label>
            {side === 'buy' && <label className="ticket-label">Take profit %<input className="input-field ticket-input" type="number" min="0" value={takeProfit} onChange={event => setTakeProfit(event.target.value)} /></label>}
          </div>

          {side === 'buy' && <label className="ticket-label">Stop loss %<input className="input-field ticket-input" type="number" min="0" value={stopLoss} onChange={event => setStopLoss(event.target.value)} /></label>}

          {!supported && <div className="ticket-warning"><Info size={14} /> Trading adapter is not enabled for {token.chain || 'this chain'} yet.</div>}
          {!isPaper && !backend?.liveTradingEnabled && <div className="ticket-warning"><Info size={14} /> Live trading is locked by the backend kill switch.</div>}
          {!isPaper && orderType === 'limit' && !liveLimitEnabled && <div className="ticket-warning"><Info size={14} /> Provider-native limit orders are unavailable. Server-triggered live orders remain disabled without the reviewed signer service.</div>}
          {supported && orderType === 'limit' && current && Number(triggerPrice) > 0 && (
            <div className="ticket-hint"><Check size={12} /> {side === 'buy' ? (Number(triggerPrice) < current ? 'Buy the dip' : 'Buy a breakout') : (Number(triggerPrice) > current ? 'Take profit' : 'Stop loss')}</div>
          )}
          <button className={`btn-block ${side === 'sell' ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={!valid || busy}>
            {busy ? <><LoaderCircle size={15} className="spin" /> Submitting…</> : (
              <>
                {side === 'buy' ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}
                {orderType === 'quick'
                  ? (side === 'buy'
                    ? `Quick Buy ${amount} SOL${numSelected > 1 ? ` × ${numSelected} (${totalBuySpendSol} SOL)` : ''}`
                    : `Quick Sell ${fraction * 100}%${targetSellPositions.length > 1 ? ` (${targetSellPositions.length} pos)` : ''}`)
                  : (side === 'buy'
                    ? `Place Limit Buy${numSelected > 1 ? ` (${numSelected} wallets)` : ''}`
                    : `Place Limit Sell${targetSellPositions.length > 1 ? ` (${targetSellPositions.length} pos)` : ''}`)
                }
              </>
            )}
          </button>
          <span className="ticket-disclaimer">{isPaper ? 'Paper fills do not submit a transaction.' : 'A quote is simulated first. Your connected wallet signs only after confirmation.'}</span>
        </>
      )}
      <Modal
        open={Boolean(prepared)}
        onClose={() => !busy && setPrepared(null)}
        title={`Confirm ${prepared?.intent?.side || ''} quote`}
        actions={<><button className="btn-outline" onClick={() => setPrepared(null)} disabled={busy}>Cancel</button><button className="btn-primary" onClick={signPrepared} disabled={busy}>{busy ? 'Confirming…' : 'Sign and submit'}</button></>}
      >
        {prepared && (
          <div className="quote-review">
            <div><span>Wallet</span><strong className="mono">{prepared.intent.walletAddress.slice(0, 8)}…{prepared.intent.walletAddress.slice(-6)}</strong></div>
            <div><span>Route</span><strong>{prepared.intent.route}</strong></div>
            <div><span>Expected output</span><strong className="mono">{prepared.intent.expectedOutputAmount || 'Calculated on receipt'}</strong></div>
            <div><span>Minimum output</span><strong className="mono">{prepared.intent.minimumOutputAmount || 'Provider protected'}</strong></div>
            <div><span>Price impact</span><strong>{prepared.intent.priceImpactPct == null ? 'Unavailable' : `${prepared.intent.priceImpactPct.toFixed(3)}%`}</strong></div>
            <div><span>Quote expires</span><strong>{new Date(prepared.intent.expiresAt).toLocaleTimeString()}</strong></div>
            <div><span>Simulation</span><strong>{prepared.simulation?.unitsConsumed ? `${prepared.simulation.unitsConsumed} units` : 'Passed'}</strong></div>
          </div>
        )}
      </Modal>
    </aside>
  );
}
