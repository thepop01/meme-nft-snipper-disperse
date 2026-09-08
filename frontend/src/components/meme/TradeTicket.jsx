import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Clock3, Info, LoaderCircle, Zap } from 'lucide-react';
import { api } from '../../utils/sniperApi';
import { fmtUsdPrecise } from '../../utils/format';
import { Pill } from '../ui/Primitives';
import { useToast } from '../ui/useToast';
import { Modal } from '../ui/Modal';

const PRESETS = ['0.05', '0.1', '0.25', '0.5'];

export default function TradeTicket({ token, positions, requestedSide, onChanged, dryRun, backend }) {
  const toast = useToast();
  const [side, setSide] = useState('buy');
  const [orderType, setOrderType] = useState('quick');
  const [amount, setAmount] = useState('0.1');
  const [fraction, setFraction] = useState(1);
  const [triggerPrice, setTriggerPrice] = useState('');
  const [slippage, setSlippage] = useState('10');
  const [takeProfit, setTakeProfit] = useState('100');
  const [stopLoss, setStopLoss] = useState('30');
  const [busy, setBusy] = useState(false);
  const [solWallet, setSolWallet] = useState(null);
  const [prepared, setPrepared] = useState(null);

  const position = useMemo(
    () => positions.find(item => item.status === 'open' && item.mint === token?.mint),
    [positions, token],
  );
  const current = token?.priceUsd ?? position?.currentPriceUsd ?? null;
  const supported = !token || (token.chain || 'solana') === 'solana';
  const isPaper = dryRun !== false;
  const provider = window.phantom?.solana || window.solana;
  const liveQuickEnabled = isPaper || backend?.liveTradingEnabled;
  const liveLimitEnabled = isPaper || backend?.executionMode === 'server-signer';

  const connectSolana = async () => {
    if (!provider?.connect) throw new Error('Install or unlock a Solana wallet such as Phantom');
    const result = await provider.connect();
    const address = (result.publicKey || provider.publicKey)?.toString();
    if (!address) throw new Error('The Solana wallet did not return an address');
    setSolWallet(address);
    return address;
  };

  const prepareConnectedTrade = async () => {
    const walletAddress = solWallet || await connectSolana();
    const payload = side === 'buy'
      ? {
          side, mint: token.mint, walletAddress, solAmount: Number(amount), slippagePct: Number(slippage),
          exitRules: { takeProfitPct: Number(takeProfit) || null, stopLossPct: Number(stopLoss) || null },
        }
      : { side, positionId: position.id, walletAddress, fraction, slippagePct: Number(slippage) };
    const quote = await api.prepareExternalTrade(payload);
    setPrepared(quote);
  };

  const signPrepared = async () => {
    if (!prepared) return;
    if (Date.now() >= prepared.intent.expiresAt) {
      setPrepared(null);
      toast.error('The quote expired; request a fresh quote');
      return;
    }
    if (!provider?.signAndSendTransaction) throw new Error('The connected wallet cannot sign Solana transactions');
    setBusy(true);
    try {
      const bytes = Uint8Array.from(atob(prepared.transactionBase64), character => character.charCodeAt(0));
      const { VersionedTransaction } = await import('@solana/web3.js');
      const transaction = VersionedTransaction.deserialize(bytes);
      const sent = await provider.signAndSendTransaction(transaction);
      const signature = sent?.signature || sent;
      await api.reconcileExternalTrade({ intentId: prepared.intent.id, signature });
      toast.success(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed and reconciled`);
      setPrepared(null);
      onChanged?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setTriggerPrice('');
    setSide('buy');
    setOrderType('quick');
  }, [token?.mint]);

  useEffect(() => {
    if (!requestedSide || !token) return;
    const tokenKey = token.key || `${token.chain || 'solana'}:${token.mint}`;
    if (requestedSide.tokenKey === tokenKey) {
      setSide(requestedSide.side === 'sell' ? 'sell' : 'buy');
      setOrderType('quick');
    }
  }, [requestedSide, token]);

  const submit = async () => {
    if (!token || !supported) return;
    setBusy(true);
    try {
      if (orderType === 'quick' && !isPaper) {
        if (!backend?.liveTradingEnabled) throw new Error('The live trading kill switch is disabled');
        await prepareConnectedTrade();
        return;
      }
      if (side === 'buy') {
        if (orderType === 'limit') {
          await api.createLimitOrder({
            side: 'buy', mint: token.mint, symbol: token.symbol, name: token.name,
            triggerPriceUsd: Number(triggerPrice), solAmount: Number(amount), slippagePct: Number(slippage),
            exitRules: { takeProfitPct: Number(takeProfit) || null, stopLossPct: Number(stopLoss) || null },
          });
          toast.success(`Limit buy placed for ${token.symbol || 'token'}`);
        } else {
          await api.buy({
            mint: token.mint, solAmount: Number(amount), slippagePct: Number(slippage),
            takeProfitPct: Number(takeProfit) || null, stopLossPct: Number(stopLoss) || null,
          });
          toast.success(`Quick buy submitted for ${token.symbol || 'token'}`);
        }
      } else if (position) {
        if (orderType === 'limit') {
          await api.createLimitOrder({
            side: 'sell', positionId: position.id, triggerPriceUsd: Number(triggerPrice), fraction,
          });
          toast.success(`Limit sell placed for ${token.symbol || 'position'}`);
        } else {
          await api.sell({ positionId: position.id, fraction });
          toast.success(`Quick sell submitted for ${token.symbol || 'position'}`);
        }
      }
      onChanged?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const valid = Boolean(token) && supported && (side === 'buy' || position)
    && (side === 'sell' || Number(amount) > 0)
    && (orderType === 'quick' || Number(triggerPrice) > 0)
    && (orderType === 'quick' ? liveQuickEnabled : liveLimitEnabled);

  return (
    <aside className="trade-ticket">
      <div className="trade-ticket-head">
        <div>
          <span className="section-kicker">Execution</span>
          <h3>Trade terminal</h3>
        </div>
        {isPaper && <Pill color="yellow">paper</Pill>}
      </div>
      {!isPaper && <div className="ticket-position-hint"><span>Execution wallet</span><button className="btn-outline btn-xs" type="button" onClick={() => connectSolana().catch(error => toast.error(error.message))}>{solWallet ? `${solWallet.slice(0, 5)}…${solWallet.slice(-4)}` : 'Connect Solana wallet'}</button></div>}

      {!token ? (
        <div className="trade-ticket-empty"><Zap size={24} /><strong>Select a token</strong><span>Choose a market from the scanner to prepare an order.</span></div>
      ) : (
        <>
          <div className="ticket-token">
            {token.imageUrl ? <img src={token.imageUrl} alt="" /> : <span>{(token.symbol || '?').slice(0, 2)}</span>}
            <div><strong>{token.symbol || 'Unknown'}</strong><small>{token.name || 'Meme token'}</small></div>
            <div className="ticket-price"><strong>{fmtUsdPrecise(current)}</strong><small>USD</small></div>
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
              <label className="ticket-label">Amount (SOL)</label>
              <div className="ticket-presets">
                {PRESETS.map(value => <button key={value} className={amount === value ? 'active' : ''} onClick={() => setAmount(value)}>{value}</button>)}
              </div>
              <input className="input-field ticket-input" type="number" min="0" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
            </>
          ) : (
            <>
              <div className="ticket-position-hint">
                <span>Position</span>
                <strong>{position ? `${position.symbol || token.symbol} · ${position.pnlPct >= 0 ? '+' : ''}${(position.pnlPct || 0).toFixed(1)}%` : 'No open position'}</strong>
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
            {busy ? <><LoaderCircle size={15} className="spin" /> Submitting…</> : <>{side === 'buy' ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}{orderType === 'quick' ? `${side === 'buy' ? 'Quick Buy' : 'Quick Sell'} ${side === 'buy' ? `${amount} SOL` : `${fraction * 100}%`}` : `${side === 'buy' ? 'Place Limit Buy' : 'Place Limit Sell'}`}</>}
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
        {prepared && <div className="quote-review"><div><span>Wallet</span><strong className="mono">{prepared.intent.walletAddress.slice(0, 8)}…{prepared.intent.walletAddress.slice(-6)}</strong></div><div><span>Route</span><strong>{prepared.intent.route}</strong></div><div><span>Expected output</span><strong className="mono">{prepared.intent.expectedOutputAmount || 'Calculated on receipt'}</strong></div><div><span>Minimum output</span><strong className="mono">{prepared.intent.minimumOutputAmount || 'Provider protected'}</strong></div><div><span>Price impact</span><strong>{prepared.intent.priceImpactPct == null ? 'Unavailable' : `${prepared.intent.priceImpactPct.toFixed(3)}%`}</strong></div><div><span>Quote expires</span><strong>{new Date(prepared.intent.expiresAt).toLocaleTimeString()}</strong></div><div><span>Simulation</span><strong>{prepared.simulation?.unitsConsumed ? `${prepared.simulation.unitsConsumed} units` : 'Passed'}</strong></div></div>}
      </Modal>
    </aside>
  );
}
