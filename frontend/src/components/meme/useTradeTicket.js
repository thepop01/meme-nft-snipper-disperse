import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/sniperApi';
import { useToast } from '../ui/useToast';

export function useTradeTicket({
  token,
  positions = [],
  requestedSide,
  onChanged,
  dryRun,
  backend,
  wallets = [],
}) {
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
  const [selectedWalletAddresses, setSelectedWalletAddresses] = useState([]);
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);

  const openPositions = useMemo(
    () => (positions || []).filter(item => item.status === 'open' && item.mint === token?.mint),
    [positions, token],
  );
  const position = useMemo(
    () => openPositions[0] || null,
    [openPositions],
  );
  const targetSellPositions = useMemo(() => {
    if (selectedWalletAddresses.length === 0) return openPositions;
    const addrSet = new Set(selectedWalletAddresses.map(a => a.toLowerCase()));
    const matched = openPositions.filter(p => addrSet.has(String(p.walletAddress || '').toLowerCase()));
    return matched.length > 0 ? matched : openPositions;
  }, [selectedWalletAddresses, openPositions]);

  const current = token?.priceUsd ?? position?.currentPriceUsd ?? null;
  const supported = !token || (token.chain || 'solana') === 'solana';
  const isPaper = dryRun !== false;
  const provider = typeof window !== 'undefined' ? (window.phantom?.solana || window.solana) : null;
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
        const targetWallets = selectedWalletAddresses.length > 0 ? selectedWalletAddresses : [null];
        let count = 0;
        for (const wAddr of targetWallets) {
          if (orderType === 'limit') {
            await api.createLimitOrder({
              side: 'buy', mint: token.mint, symbol: token.symbol, name: token.name,
              triggerPriceUsd: Number(triggerPrice), solAmount: Number(amount), slippagePct: Number(slippage),
              exitRules: { takeProfitPct: Number(takeProfit) || null, stopLossPct: Number(stopLoss) || null },
              walletAddress: wAddr || undefined,
            });
          } else {
            await api.buy({
              mint: token.mint, solAmount: Number(amount), slippagePct: Number(slippage),
              takeProfitPct: Number(takeProfit) || null, stopLossPct: Number(stopLoss) || null,
              walletAddress: wAddr || undefined,
              idempotencyKey: wAddr ? `manual:buy:${token.mint}:${wAddr}:${Date.now()}` : undefined,
            });
          }
          count++;
        }
        toast.success(`${orderType === 'quick' ? 'Quick buy' : 'Limit buy'} submitted for ${token.symbol || 'token'}${count > 1 ? ` across ${count} wallets` : ''}`);
      } else {
        const targets = targetSellPositions;
        if (!targets || targets.length === 0) {
          throw new Error('No open position found to sell for selected wallet(s)');
        }
        let count = 0;
        for (const pos of targets) {
          if (orderType === 'limit') {
            await api.createLimitOrder({
              side: 'sell', positionId: pos.id, triggerPriceUsd: Number(triggerPrice), fraction,
              walletAddress: pos.walletAddress,
            });
          } else {
            await api.sell({ positionId: pos.id, fraction });
          }
          count++;
        }
        toast.success(`${orderType === 'quick' ? 'Quick sell' : 'Limit sell'} submitted for ${token.symbol || 'position'}${count > 1 ? ` across ${count} positions` : ''}`);
      }
      onChanged?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const canSell = side === 'sell' ? (targetSellPositions.length > 0) : true;
  const valid = Boolean(token) && supported && (side === 'buy' || canSell)
    && (side === 'sell' || Number(amount) > 0)
    && (orderType === 'quick' || Number(triggerPrice) > 0)
    && (orderType === 'quick' ? liveQuickEnabled : liveLimitEnabled);

  const numSelected = selectedWalletAddresses.length;
  const totalBuySpendSol = numSelected > 1 ? (Number(amount) * numSelected).toFixed(3) : null;

  return {
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
    openPositions,
    position,
    targetSellPositions,
    current,
    supported,
    isPaper,
    liveQuickEnabled,
    liveLimitEnabled,
    connectSolana,
    prepareConnectedTrade,
    signPrepared,
    submit,
    canSell,
    valid,
    numSelected,
    totalBuySpendSol,
    toast,
  };
}

export default useTradeTicket;
