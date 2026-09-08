import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { 
  ArrowRight, ArrowLeftRight, X, Droplet, Plus, Minus, Info, 
  RefreshCw, Check, Copy, ExternalLink, ChevronDown 
} from 'lucide-react';
import { disperseApi } from '../utils/disperseApi.js';
import { subscribeWs } from '../utils/sniperApi.js';
import { walletApi } from '../utils/walletApi.js';
import { UmiBanner } from './ui/UmiBanner';
import { ChainBar, EthGlyphSmall } from './ui/ChainBar';
import { disperseChainFor, chainLabelFor, DISPERSE_SUPPORTED_LABELS } from '../utils/chainCatalog.js';
import { useToast } from './ui/useToast';

const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

const DISPERSE_ABI = [
  'function disperseEther(address[] recipients, uint256[] values) payable',
  'function disperseToken(address token, address[] recipients, uint256[] values)',
];

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const DisperseView = ({ account, walletDirectory = { wallets: [], tags: [] } }) => {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [activeChain, setActiveChain] = useState('ethereum');
  const [isNftErc20, setIsNftErc20] = useState(false);
  const [currencyMode, setCurrencyMode] = useState('ETH'); // 'ETH' | 'USD'
  const [mode, setMode] = useState('Flat'); // 'Flat' | 'Custom' | 'Total'
  const [perWalletAmount, setPerWalletAmount] = useState('0');
  const [senderSelection, setSenderSelection] = useState('connected');
  const [recipientSelection, setRecipientSelection] = useState('');
  const [externalAddress, setExternalAddress] = useState('');
  const [recipientsList, setRecipientsList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    disperseApi.config().then(setCfg).catch(e => setError(e.message));
  }, []);

  const refreshJobs = async () => {
    try {
      const res = await disperseApi.jobs();
      setJobs(res.jobs || []);
    } catch {}
  };

  useEffect(() => { refreshJobs(); }, []);

  useEffect(() => subscribeWs((msg) => {
    if (msg.type === 'disperse:job' && msg.job) {
      if (job && msg.job.id === job.id) setJob(msg.job);
      setJobs(current => [msg.job, ...current.filter(item => item.id !== msg.job.id)]);
    }
  }), [job]);

  const handleReset = () => {
    setPerWalletAmount('0');
    setSenderSelection('connected');
    setRecipientSelection('');
    setExternalAddress('');
    setRecipientsList([]);
    setPlan(null);
    setJob(null);
    setError('');
    toast.success('Form reset');
  };

  const handleSwap = () => {
    // Swap sender and recipient logic
    toast.success('Swapped sender & recipient mode');
  };

  const handleAddExternal = () => {
    const trimmed = externalAddress.trim();
    if (!trimmed) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      toast.error('Invalid EVM address');
      return;
    }
    if (!recipientsList.includes(trimmed)) {
      setRecipientsList(prev => [...prev, trimmed]);
      toast.success('Added recipient');
    }
    setExternalAddress('');
  };

  const handleQuantityAdjust = (delta) => {
    const curr = parseFloat(perWalletAmount) || 0;
    const next = Math.max(0, curr + delta);
    setPerWalletAmount(next.toString());
  };

  const handleMax = () => {
    setPerWalletAmount('0.05');
  };

  const storedSignerWallets = useMemo(() => {
    return (walletDirectory?.wallets || []).filter(w => w.status === 'active');
  }, [walletDirectory]);

  // Compute total recipients
  const allResolvedRecipients = useMemo(() => {
    const set = new Set(recipientsList);
    if (recipientSelection.startsWith('tag:')) {
      const tagId = recipientSelection.slice(4);
      walletDirectory.wallets
        .filter(w => w.tagIds?.includes(tagId) && w.status === 'active')
        .forEach(w => set.add(w.address));
    } else if (recipientSelection.startsWith('wallet:')) {
      const walletId = recipientSelection.slice(7);
      const w = walletDirectory.wallets.find(x => x.id === walletId);
      if (w) set.add(w.address);
    } else if (recipientSelection === 'all') {
      walletDirectory.wallets.forEach(w => set.add(w.address));
    }
    return Array.from(set);
  }, [recipientSelection, recipientsList, walletDirectory.wallets]);

  const handleDisperse = async () => {
    setError('');
    const disperseChain = disperseChainFor(activeChain);
    if (!disperseChain) {
      const msg = `Disperse isn't available on ${chainLabelFor(activeChain)} yet — pick ${DISPERSE_SUPPORTED_LABELS}.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    if (allResolvedRecipients.length === 0) {
      toast.error('Please select or enter at least one recipient');
      return;
    }
    const amt = parseFloat(perWalletAmount);
    if (!amt || amt <= 0) {
      toast.error('Please specify an amount greater than 0');
      return;
    }

    setBusy(true);
    try {
      const senders = senderSelection === 'connected' ? (account ? [account] : []) : [storedSignerWallets[0]?.address].filter(Boolean);
      const recipientsText = allResolvedRecipients.join('\n');

      const planInput = {
        sourceChain: disperseChain,
        destChain: disperseChain,
        asset: 'NATIVE',
        senders: senders.length > 0 ? senders : (account ? [account] : []),
        recipientsText,
        amountMode: 'equal',
        perRecipient: perWalletAmount,
      };

      const result = await disperseApi.plan(planInput);
      setPlan(result.plan);
      toast.success('Disperse plan generated! Click execute to send.');
    } catch (err) {
      setError(err.message || 'Failed to prepare disperse');
      toast.error(err.message || 'Failed to prepare disperse');
    }
    setBusy(false);
  };

  return (
    <div className="umi-page-container">
      {/* Purple Top Banner */}
      <UmiBanner />

      {/* Main Card Container */}
      <div className="umi-card-container umi-disperse-card">
        {/* Chain Bar */}
        <div className="umi-disperse-chain-wrap">
          <ChainBar activeChain={activeChain} onSelectChain={setActiveChain} />
        </div>

        {/* Action Header Row inside Card: NFT/ERC20 Toggle on left, Swap & Reset on right */}
        <div className="umi-disperse-toolbar">
          <label className="umi-pill-toggle">
            <span>NFT/ERC20</span>
            <input
              type="checkbox"
              checked={isNftErc20}
              onChange={e => setIsNftErc20(e.target.checked)}
            />
            <span className="umi-pill-track">
              <span className="umi-pill-dot" />
            </span>
          </label>

          <div className="umi-disperse-toolbar-right">
            <button 
              type="button" 
              className="umi-btn-tool" 
              onClick={handleSwap}
            >
              <ArrowLeftRight size={13} /> Swap
            </button>
            <button 
              type="button" 
              className="umi-btn-tool" 
              onClick={handleReset}
            >
              <X size={13} /> Reset
            </button>
          </div>
        </div>

        {/* Dotted Canvas Area with Senders, Recipients, and External Address */}
        <div className="umi-dotted-canvas">
          <div className="umi-form-section">
            <label className="umi-canvas-label">SENDERS</label>
            <div className="umi-select-wrap">
              <select
                className="umi-canvas-select"
                value={senderSelection}
                onChange={e => setSenderSelection(e.target.value)}
              >
                <option value="connected">Select (Connected Wallet)</option>
                {storedSignerWallets.map(w => (
                  <option key={w.id} value={`wallet:${w.id}`}>{w.name || short(w.address)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="umi-form-section">
            <label className="umi-canvas-label">RECIPIENTS</label>
            <div className="umi-select-wrap">
              <select
                className="umi-canvas-select"
                value={recipientSelection}
                onChange={e => setRecipientSelection(e.target.value)}
              >
                <option value="">Select</option>
                <option value="all">All Directory Wallets ({walletDirectory.wallets.length})</option>
                {walletDirectory.tags.map(t => (
                  <option key={t.id} value={`tag:${t.id}`}>Tag: {t.name}</option>
                ))}
                {walletDirectory.wallets.map(w => (
                  <option key={w.id} value={`wallet:${w.id}`}>{w.name || short(w.address)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="umi-form-section">
            <label className="umi-canvas-label">OR</label>
            <div className="umi-external-input-row">
              <input
                type="text"
                className="umi-canvas-text-input"
                placeholder="External Address"
                value={externalAddress}
                onChange={e => setExternalAddress(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddExternal()}
              />
              <button 
                type="button" 
                className="umi-external-arrow-btn"
                onClick={handleAddExternal}
                title="Add Address"
              >
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {allResolvedRecipients.length > 0 && (
            <div className="umi-canvas-recipients-summary">
              <Check size={13} style={{ color: '#10b981' }} />
              <span>{allResolvedRecipients.length} recipient(s) ready</span>
            </div>
          )}
        </div>

        {/* Bottom Control Bar / Footer inside Card */}
        <div className="umi-disperse-bottom-bar">
          {/* Top-Right Currency Switcher: ETH | USD */}
          <div className="umi-currency-switch-row">
            <div className="umi-currency-pill-tabs">
              <button
                type="button"
                className={`umi-currency-pill-tab ${currencyMode === 'ETH' ? 'active' : ''}`}
                onClick={() => setCurrencyMode('ETH')}
              >
                ETH
              </button>
              <button
                type="button"
                className={`umi-currency-pill-tab ${currencyMode === 'USD' ? 'active' : ''}`}
                onClick={() => setCurrencyMode('USD')}
              >
                USD
              </button>
            </div>
          </div>

          {/* Controls: Mode Dropdown & Per Wallet Input */}
          <div className="umi-controls-flex-row">
            <div className="umi-mode-col">
              <label className="umi-bottom-label">MODE</label>
              <div className="umi-mode-dropdown-wrap">
                <select
                  className="umi-mode-dropdown"
                  value={mode}
                  onChange={e => setMode(e.target.value)}
                >
                  <option value="Flat">Flat</option>
                  <option value="Custom">Custom</option>
                  <option value="Total">Total</option>
                </select>
                <Droplet size={14} className="umi-mode-droplet" />
                <ChevronDown size={14} className="umi-mode-chevron" />
              </div>
            </div>

            <div className="umi-perwallet-col">
              <label className="umi-bottom-label">PER WALLET</label>
              <div className="umi-qty-control-box">
                <button
                  type="button"
                  className="umi-qty-btn"
                  onClick={() => handleQuantityAdjust(-0.001)}
                >
                  <Minus size={13} />
                </button>
                <div className="umi-qty-input-wrap">
                  <input
                    type="text"
                    className="umi-qty-input"
                    value={perWalletAmount}
                    onChange={e => setPerWalletAmount(e.target.value)}
                  />
                  <EthGlyphSmall />
                </div>
                <button
                  type="button"
                  className="umi-qty-btn"
                  onClick={() => handleQuantityAdjust(0.001)}
                >
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  className="umi-qty-max-btn"
                  onClick={handleMax}
                >
                  MAX
                </button>
              </div>
            </div>
          </div>

          {/* Max Info Line */}
          <div className="umi-max-info-line">
            <Info size={13} className="umi-info-icon" />
            <span>MAX · <strong>0</strong> <EthGlyphSmall /> ($0)</span>
          </div>

          {/* Error Message */}
          {error && <div className="umi-error-text">{error}</div>}

          {/* Big CTA Disperse Button */}
          <div className="umi-cta-container">
            <button
              type="button"
              className="umi-btn-disperse-cta"
              onClick={handleDisperse}
              disabled={busy}
            >
              {busy ? 'Preparing...' : 'Disperse'} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DisperseView;
