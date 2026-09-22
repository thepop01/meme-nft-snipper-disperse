import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { 
  ArrowRight, Search, ExternalLink, RefreshCw, ChevronDown, 
  Flame, Clock, AlertTriangle, Image as ImageIcon, Box, Lock, 
  Check, Copy, Zap, X
} from 'lucide-react';
import { nftApi } from '../utils/nftApi.js';
import { subscribeWs } from '../utils/sniperApi.js';
import { shortAddr } from '../utils/format.js';
import { ChainSvgIcon } from './ui/ChainBar';
import { ResolvedWalletPreview, WalletSelector, WalletTagSelector } from './ui/WalletSelectors.jsx';
import { useToast } from './ui/useToast';

const isEvmAddress = address => /^0x[0-9a-fA-F]{40}$/.test(String(address));

const fmtEth = (wei) => {
  if (!wei || wei === '0') return 'Free';
  try { return parseFloat(ethers.formatEther(wei)).toFixed(4) + ' ETH'; } catch { return wei + ' wei'; }
};
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : '--');

function useTick(intervalMs = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(n => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

function fmtCountdown(ms) {
  if (ms == null) return null;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button 
      type="button"
      className="umi-copy-btn-mini" 
      title="Copy" 
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
    >
      {copied ? <Check size={11} style={{ color: '#10b981' }} /> : <Copy size={11} />}
    </button>
  );
}

// Initial fallback mock collections matching mint.png if backend discovery is offline
const MOCK_COLLECTIONS_FALLBACK = [
  {
    id: 'dino-gotchis',
    name: 'Dino Gotchis',
    contract: '0x66b976159c35489f074efc2834b6b668045F8C0c',
    chain: 'ethereum',
    chainType: 'eth',
    slug: 'dino-gotchis',
    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
    status: 'live',
  },
  {
    id: 'something-genesis-pass',
    name: 'Something Genesis Pass',
    contract: '0x545c84a86ad60775d7b5ba772fa845f0962b6fb2',
    chain: 'base',
    chainType: 'base',
    slug: 'something-genesis-pass',
    image: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=100&h=100&fit=crop&q=80',
    status: 'upcoming',
  },
  {
    id: 'serenia-seres',
    name: 'Serenia: SERES',
    contract: '0x591ec72b4cb1c633a25cb31165a3bb45f952c58c',
    chain: 'apechain',
    chainType: 'ape',
    slug: 'serenia-seres',
    image: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=100&h=100&fit=crop&q=80',
    status: 'live',
  },
  {
    id: 'nwo',
    name: 'NWO',
    contract: '0xc46b146430372df03d425c2ffcf442e07ecC39Fb',
    chain: 'mantle',
    chainType: 'mantle',
    slug: 'nwo',
    image: '',
    status: 'upcoming',
  },
  {
    id: 'scale',
    name: 'SCALE',
    contract: '0x042531e21b790d96d744b82c686bc39a130bc50a',
    chain: 'base',
    chainType: 'base',
    slug: 'scale',
    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
    status: 'live',
  },
  {
    id: 'cattana-catz',
    name: 'Cattana Catz',
    contract: '0x5a9fa2472b53509988182b8bb4a41315b97203C',
    chain: 'mantle',
    chainType: 'mantle',
    slug: 'cattana-catz',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=100&h=100&fit=crop&q=80',
    status: 'live',
  },
  {
    id: 'the-utility-card',
    name: 'THE UTILITY CARD',
    contract: '0xB2F9f993d052b66236b334653fa3ca02e5b6e678',
    chain: 'base',
    chainType: 'base',
    slug: 'the-utility-card',
    image: '',
    status: 'upcoming',
  },
  {
    id: 'gloom',
    name: 'Gloom',
    contract: '0xBc5561a34079ea9ab5cbeea8d49df29e730aA05',
    chain: 'ethereum',
    chainType: 'eth',
    slug: 'gloom',
    image: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=100&h=100&fit=crop&q=80',
    status: 'upcoming',
  },
  {
    id: 'mozetardio',
    name: 'Mozetardio',
    contract: '0x3e18a9947c69992f8efb9020914185799a9b412a',
    chain: 'ethereum',
    chainType: 'eth',
    slug: 'mozetardio',
    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
    status: 'live',
  },
];

// --- OpenSea URL paste search bar ---
function UrlBar({ onDrop }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    setError('');
    const trimmed = url.trim();
    if (!trimmed) return;
    const slugMatch = trimmed.match(/opensea\.io\/collection\/([a-z0-9_-]+)/i);
    const slug = slugMatch ? slugMatch[1] : (trimmed.startsWith('/') ? trimmed.slice(1) : trimmed);
    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      setError('Paste an OpenSea collection URL or a plain slug');
      return;
    }
    setLoading(true);
    try {
      const { drop } = await nftApi.lookupDrop(slug);
      if (drop) onDrop(drop);
      else setError('Drop not found — is the collection minting on OpenSea?');
    } catch (err) {
      setError(err.message || 'Lookup failed');
    }
    setLoading(false);
  };

  return (
    <div className="umi-mint-top-search-wrap">
      <input
        type="text"
        className="umi-mint-top-search-input"
        placeholder="https://opensea.io/collection/collection-name/overview"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && go()}
        spellCheck="false"
      />
      <button 
        type="button"
        className="umi-mint-top-search-btn" 
        onClick={go} 
        disabled={loading} 
        title="Load Drop"
      >
        {loading ? <RefreshCw size={16} className="spin" /> : <ArrowRight size={16} />}
      </button>
      {error && <div className="umi-urlerror-toast"><AlertTriangle size={12} /> {error}</div>}
    </div>
  );
}

// --- Interactive Drop detail panel (Umi style) ---
function DropPanel({ drop, onClose, onScheduled, walletDirectory }) {
  useTick();
  const [showEnded, setShowEnded] = useState(true);
  const [stageIndex, setStageIndex] = useState(() => {
    const i = (drop.stages || []).findIndex(s => s.isActive);
    return i >= 0 ? i : 0;
  });
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState([]);
  const [gasMode, setGasMode] = useState('caps');
  const [maxFeeGwei, setMaxFeeGwei] = useState(50);
  const [maxPriorityGwei, setMaxPriorityGwei] = useState(2);
  const [gasNow, setGasNow] = useState(null);
  const [customTime, setCustomTime] = useState('');
  const [stopFirst, setStopFirst] = useState(false);
  const [autoList, setAutoList] = useState(false);
  const [listMult, setListMult] = useState(2);
  const [error, setError] = useState('');
  const [showWallets, setShowWallets] = useState(true);

  const stagesList = drop.stages || [
    { label: 'Public Mint', priceWei: '0', isActive: true, startTime: Date.now() }
  ];
  const stage = stagesList[stageIndex] || stagesList[0] || {};
  const now = Date.now();
  const stageState = stage.startTime == null ? 'unscheduled'
    : stage.startTime > now ? 'upcoming' : (stage.endTime && stage.endTime < now) ? 'ended' : 'live';
  const countdown = stageState === 'upcoming' ? fmtCountdown(stage.startTime - now) : null;

  const visibleStages = stagesList
    .map((s, i) => ({ ...s, i }))
    .filter(s => showEnded || s.startTime == null || (s.endTime ?? Infinity) >= now - 60_000);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { 
        const g = await nftApi.gas(drop.chain || 'ethereum'); 
        if (alive) setGasNow(g); 
      } catch {}
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [drop.chain]);

  const schedule = async () => {
    setError('');
    if (selected.length === 0) return setError('Select at least one wallet with a private key (Signer)');
    try {
      const { job } = await nftApi.schedule({
        drop: { 
          chain: drop.chain || 'ethereum', 
          slug: drop.slug, 
          contract: drop.contract, 
          name: drop.name,
          image: drop.image, 
          stageIndex, 
          stageLabel: stage.label, 
          price: stage.priceWei 
        },
        scheduledTime: customTime ? new Date(customTime).getTime() : (stage.startTime ?? Date.now()),
        wallets: selected.map(address => ({ address, quantity })),
        gas: gasMode === 'caps'
          ? { mode: 'caps', maxFeeGwei: Number(maxFeeGwei), maxPriorityGwei: Number(maxPriorityGwei) }
          : { mode: 'all-in' },
        policy: { 
          stopOnFirstSuccess: stopFirst, 
          abortIfGasAboveCap: true,
          ...(autoList && { autoList: { multiplier: Number(listMult), durationDays: 7 } }) 
        },
      });
      onScheduled(job);
    } catch (err) { 
      setError(err.message || 'Scheduling failed'); 
    }
  };

  return (
    <div className="umi-drop-panel-card">
      <div className="umi-drop-panel-header">
        <div className="umi-drop-banner-main">
          {drop.image ? (
            <img src={drop.image} alt="" className="umi-drop-header-thumb" />
          ) : (
            <div className="umi-drop-header-thumb-ph"><ImageIcon size={22} /></div>
          )}
          <div className="umi-drop-header-info">
            <div className="umi-drop-header-title-row">
              <h3>{drop.name}</h3>
              {drop.mintPageUrl && (
                <a href={drop.mintPageUrl} target="_blank" rel="noreferrer" className="umi-drop-opensea-btn">
                  Open in OpenSea <ExternalLink size={11} />
                </a>
              )}
            </div>
            {drop.contract && (
              <span className="umi-drop-contract-badge">
                {shortAddr(drop.contract)} <CopyButton text={drop.contract} />
              </span>
            )}
            <div className="umi-drop-status-pill">
              <Flame size={12} style={{ color: '#ef4444' }} />
              <span>{drop.status?.toUpperCase() || 'MINTING'}</span>
            </div>
          </div>
        </div>

        <button type="button" className="umi-drop-close-btn" onClick={onClose} title="Close Panel">
          <X size={16} />
        </button>
      </div>

      <div className="umi-drop-body-grid">
        {/* Stages Column */}
        <div className="umi-drop-stages-column">
          <div className="umi-stages-head">
            <span className="umi-drop-section-title">MINT STAGES</span>
            <label className="umi-show-ended-toggle">
              <input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} />
              <span>Show ended</span>
            </label>
          </div>

          <div className="umi-stages-list">
            {visibleStages.map(s => {
              const st = s.startTime == null ? 'unscheduled'
                : s.startTime > now ? 'upcoming' : (s.endTime && s.endTime < now) ? 'ended' : 'live';
              const cd = st === 'upcoming' ? fmtCountdown(s.startTime - now) : null;
              const isSelected = stageIndex === s.i;

              return (
                <button
                  key={s.uuid || s.i}
                  type="button"
                  className={`umi-stage-box ${isSelected ? 'selected' : ''} ${st}`}
                  onClick={() => setStageIndex(s.i)}
                >
                  <div className="umi-stage-box-top">
                    <span className="umi-stage-box-name">{s.label || 'PUBLIC MINT'}</span>
                    <span className={`umi-stage-state-tag ${st}`}>
                      {st === 'live' && 'LIVE NOW'}
                      {st === 'upcoming' && `STARTS IN ${cd}`}
                      {st === 'ended' && 'ENDED'}
                      {st === 'unscheduled' && 'UNSCHEDULED'}
                    </span>
                  </div>
                  <div className="umi-stage-box-bottom">
                    <span>PRICE: <strong>{fmtEth(s.priceWei)}</strong></span>
                    {s.maxPerWallet && <span>MAX: {s.maxPerWallet}/wallet</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Wallets & Gas Section */}
          <div className="umi-drop-wallets-section">
            <WalletPanel 
              drop={drop} 
              quantity={quantity} 
              selected={selected} 
              setSelected={setSelected} 
              walletDirectory={walletDirectory} 
            />

            {/* Gas Configuration */}
            <div className="umi-drop-gas-config-box">
              <label className="umi-drop-section-title">
                Gas Settings {gasNow && <span className="umi-gas-current">— Live: {gasNow.baseFeeGwei?.toFixed(1)} / {gasNow.priorityFeeGwei?.toFixed(1)} gwei</span>}
              </label>
              <div className="umi-gas-inputs-row">
                <select 
                  className="select-field" 
                  value={gasMode} 
                  onChange={e => setGasMode(e.target.value)}
                  style={{ width: 140 }}
                >
                  <option value="caps">Max Caps</option>
                  <option value="all-in">All-in Balance</option>
                </select>
                {gasMode === 'caps' && (
                  <>
                    <input 
                      type="number" 
                      className="input-field" 
                      value={maxFeeGwei} 
                      onChange={e => setMaxFeeGwei(e.target.value)} 
                      placeholder="Max Gwei" 
                      style={{ width: 100 }}
                    />
                    <input 
                      type="number" 
                      className="input-field" 
                      value={maxPriorityGwei} 
                      onChange={e => setMaxPriorityGwei(e.target.value)} 
                      placeholder="Priority" 
                      style={{ width: 90 }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Rail: Schedule Controls */}
        <div className="umi-drop-rail-column">
          <div className="form-group">
            <label className="umi-drop-section-title">QUANTITY / WALLET</label>
            <div className="umi-exp-qty-row">
              <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))}>−</button>
              <span>{quantity}</span>
              <button type="button" onClick={() => setQuantity(q => q + 1)}>+</button>
            </div>
          </div>

          <div className="form-group">
            <label className="umi-drop-section-title">FIRE TIME OVERRIDE</label>
            <input 
              type="datetime-local" 
              className="input-field" 
              value={customTime}
              onChange={e => setCustomTime(e.target.value)} 
            />
            <p className="umi-hint-text">Blank = stage start{stage.startTime ? ` (${fmtTime(stage.startTime)})` : ''}</p>
          </div>

          <div className="umi-policy-checklist">
            <label className="umi-policy-check">
              <input type="checkbox" checked={stopFirst} onChange={e => setStopFirst(e.target.checked)} />
              <span>Stop on first success</span>
            </label>
            <label className="umi-policy-check">
              <input type="checkbox" checked={autoList} onChange={e => setAutoList(e.target.checked)} />
              <span>Auto-list at</span>
              <input 
                type="number" 
                className="input-field compact" 
                style={{ width: 50, padding: '2px 4px' }} 
                step="0.5" 
                min="1" 
                value={listMult} 
                onChange={e => setListMult(e.target.value)} 
                disabled={!autoList} 
              />
              <span>x</span>
            </label>
          </div>

          {error && <div className="umi-rail-error-msg"><AlertTriangle size={13} /> {error}</div>}

          <button 
            type="button" 
            className="umi-btn-schedule-main" 
            onClick={schedule}
          >
            <Clock size={15} /> Schedule Mint
          </button>

          <div className={`umi-walletnote-banner ${selected.length === 0 ? 'warn' : ''}`}>
            <AlertTriangle size={13} /> {selected.length} wallet{selected.length === 1 ? '' : 's'} selected
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Wallet Eligibility Panel (Directory integration) ---
function WalletPanel({ drop, quantity, setSelected, walletDirectory }) {
  const [rows, setRows] = useState([]);
  const [checking, setChecking] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [individualWalletIds, setIndividualWalletIds] = useState([]);
  const [excludedAddresses, setExcludedAddresses] = useState([]);

  const selectableWallets = useMemo(
    () => (walletDirectory?.wallets || [])
      .filter(wallet => wallet.status === 'active')
      .filter(wallet => isEvmAddress(wallet.address)),
    [walletDirectory],
  );

  const resolved = useMemo(() => {
    const wanted = new Set(individualWalletIds);
    selectableWallets.forEach(wallet => {
      if (wallet.tagIds?.some(id => selectedTagIds.includes(id))) wanted.add(wallet.id);
    });
    const excluded = new Set(excludedAddresses.map(address => address.toLowerCase()));
    return selectableWallets.filter(wallet => wanted.has(wallet.id) && !excluded.has(wallet.address.toLowerCase()));
  }, [excludedAddresses, individualWalletIds, selectableWallets, selectedTagIds]);

  const unsupported = resolved.filter(wallet => !wallet.hasKey);

  useEffect(() => {
    setSelected(resolved.filter(wallet => wallet.hasKey).map(wallet => wallet.address));
  }, [resolved, setSelected]);

  const check = async () => {
    setChecking(true);
    try {
      const { wallets } = await nftApi.eligibility({
        slug: drop.slug, 
        chain: drop.chain || 'ethereum',
        wallets: resolved.filter(w => w.hasKey).map(w => w.address), 
        quantity,
      });
      setRows(wallets || []);
    } catch {}
    setChecking(false);
  };

  return (
    <div className="umi-wallet-selector-block">
      <div className="umi-wallet-selector-header">
        <span className="umi-drop-section-title">Eligible Signer Wallets</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" className="btn-outline btn-xs" onClick={check} disabled={checking}>
            {checking ? 'Checking…' : 'Check eligibility'}
          </button>
          <button 
            type="button" 
            className="btn-outline btn-xs" 
            onClick={() => setIndividualWalletIds(selectableWallets.filter(w => w.hasKey).map(w => w.id))}
          >
            Select All Signers
          </button>
          <button 
            type="button" 
            className="btn-outline btn-xs" 
            onClick={() => { setSelectedTagIds([]); setIndividualWalletIds([]); setExcludedAddresses([]); }}
          >
            Clear
          </button>
        </div>
      </div>

      <WalletTagSelector 
        tags={walletDirectory?.tags || []} 
        selectedIds={selectedTagIds} 
        onChange={setSelectedTagIds} 
        label="Select Basket / Tags" 
      />
      
      <WalletSelector 
        wallets={selectableWallets} 
        selectedIds={individualWalletIds} 
        onChange={setIndividualWalletIds} 
      />

      <ResolvedWalletPreview 
        wallets={resolved} 
        tags={walletDirectory?.tags || []} 
        onExclude={address => setExcludedAddresses(current => [...new Set([...current, address])])} 
        title="Active Selected Wallets" 
      />

      {unsupported.length > 0 && (
        <p className="umi-watch-warn">
          <AlertTriangle size={12} /> {unsupported.length} watch-only wallet(s) cannot sign transactions. Attach private keys in Wallets page.
        </p>
      )}
    </div>
  );
}

// --- Drops Browser Feed ---
function DropsBrowser({ onSelect }) {
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [data, setData] = useState({ drops: [], chains: [] });
  const [loading, setLoading] = useState(false);

  const fetchDrops = useCallback(async () => {
    setLoading(true);
    try {
      const result = await nftApi.drops({ status, ...(q && { q }) });
      if (result?.drops?.length) {
        setData(result);
      } else {
        setData({ drops: MOCK_COLLECTIONS_FALLBACK, chains: [] });
      }
    } catch {
      setData({ drops: MOCK_COLLECTIONS_FALLBACK, chains: [] });
    }
    setLoading(false);
  }, [status, q]);

  useEffect(() => { fetchDrops(); }, [fetchDrops]);
  useEffect(() => subscribeWs(m => { if (m.type === 'nft:drops') fetchDrops(); }), [fetchDrops]);

  const displayDrops = data.drops.length > 0 ? data.drops : MOCK_COLLECTIONS_FALLBACK;

  return (
    <div className="umi-drops-feed-wrapper">
      <div className="umi-mint-subsearch-wrap">
        <div className="umi-drops-tabs">
          {['active', 'live', 'upcoming', 'all'].map(s => (
            <button 
              key={s} 
              type="button"
              className={`umi-drops-tab ${status === s ? 'active' : ''}`}
              onClick={() => setStatus(s)}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>

        <input
          type="text"
          className="umi-mint-subsearch-input"
          placeholder="Filter collections..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div className="umi-mint-collections-card">
        {displayDrops.map(item => (
          <div key={item.slug || item.contract || item.id} className="umi-mint-row-item-wrapper">
            <div className="umi-mint-row-item">
              <div className="umi-mint-thumb">
                {item.image ? (
                  <img 
                    src={item.image} 
                    alt="" 
                    className="umi-mint-thumb-img" 
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="umi-mint-thumb-placeholder">
                    <ImageIcon size={20} />
                  </div>
                )}
                <div className="umi-mint-chain-badge">
                  <ChainSvgIcon type={item.chainType || (item.chain === 'base' ? 'base' : item.chain === 'apechain' ? 'ape' : item.chain === 'mantle' ? 'mantle' : 'eth')} size={12} />
                </div>
              </div>

              <div className="umi-mint-info">
                <div className="umi-mint-name-row">
                  <span className="umi-mint-title">{item.name}</span>
                  <a 
                    href={`https://opensea.io/collection/${item.slug}`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="umi-mint-ext-link"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
                <div className="umi-mint-addr-row">
                  <span className="umi-mint-contract-addr">{shortAddr(item.contract || '0x66b...F8C0c')}</span>
                </div>
              </div>

              <div className="umi-mint-actions">
                <button 
                  type="button" 
                  className="umi-mint-action-icon-btn"
                  onClick={() => onSelect(item)}
                  title="Inspect Drop"
                >
                  <Search size={14} />
                </button>

                <button 
                  type="button" 
                  className="umi-mint-action-icon-btn"
                  onClick={() => onSelect(item)}
                  title="Open Mint Scheduler"
                >
                  <Box size={14} />
                </button>

                <button 
                  type="button" 
                  className="umi-mint-action-icon-btn"
                  onClick={() => onSelect(item)}
                  title="Expand"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Jobs Board (Scheduled Mint Runner) ---
function JobsBoard() {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  useTick(1000);

  const fetchJobs = useCallback(async () => {
    try { 
      const res = await nftApi.jobs();
      setJobs(res.jobs || []); 
    } catch {}
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => subscribeWs(m => {
    if (m.type === 'nft:job') {
      setJobs(prev => {
        const rest = prev.filter(j => j.id !== m.job.id);
        return [m.job, ...rest];
      });
    }
  }), []);

  const arm = async (job) => {
    setError('');
    try {
      await nftApi.arm(job.id, {});
      fetchJobs();
    } catch (err) { 
      setError(err.message || 'Arming failed'); 
    }
  };

  return (
    <div className="umi-card-container umi-jobs-board-card">
      <div className="umi-jobs-header">
        <Clock size={16} />
        <h4>Scheduled Mint Jobs</h4>
      </div>

      {jobs.length === 0 && (
        <p className="text-dim" style={{ fontSize: '0.85rem', padding: '0.5rem 0' }}>
          No scheduled mint jobs yet. Paste an OpenSea collection or select one above to schedule a mint.
        </p>
      )}

      {jobs.map(job => {
        const cd = ['scheduled', 'armed'].includes(job.status) ? fmtCountdown(job.scheduledTime - Date.now()) : null;
        return (
          <div key={job.id} className={`umi-job-card-row status-${job.status}`}>
            <div className="umi-job-info-left">
              <div className="umi-job-title">
                <strong>{job.drop.name}</strong>
                <span className="umi-job-stage-pill">{job.drop.stageLabel || 'Mint'}</span>
              </div>
              <div className="umi-job-details">
                <span className={`umi-job-status-badge ${job.status}`}>
                  {cd ? `Fires in ${cd}` : job.status.toUpperCase()}
                </span>
                <span>{fmtTime(job.scheduledTime)}</span>
                <span>{job.wallets?.length || 0} wallet(s)</span>
              </div>
            </div>

            <div className="umi-job-actions">
              {['scheduled', 'awaiting-keys', 'armed'].includes(job.status) && (
                <button 
                  type="button"
                  className="btn-primary btn-xs" 
                  onClick={() => arm(job)} 
                  title="Arm using credentials from vault"
                >
                  <Zap size={12} /> Arm from Vault
                </button>
              )}
              {['scheduled', 'armed', 'awaiting-keys'].includes(job.status) && (
                <button 
                  type="button"
                  className="btn-outline btn-xs" 
                  onClick={() => nftApi.cancel(job.id).then(fetchJobs)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        );
      })}

      {error && <div className="umi-rail-error-msg" style={{ marginTop: '0.5rem' }}>{error}</div>}
    </div>
  );
}

const NFTMintBotView = ({ walletDirectory = { wallets: [], tags: [] } }) => {
  const toast = useToast();
  const [selectedDrop, setSelectedDrop] = useState(null);
  const [justScheduled, setJustScheduled] = useState(null);

  const openDrop = useCallback(async drop => {
    setSelectedDrop(drop);
    try {
      const { drop: full } = await nftApi.lookupDrop(drop.slug);
      if (full?.stages?.length) {
        setSelectedDrop(current => current && current.slug === drop.slug ? { ...current, ...full } : current);
      }
    } catch {}
  }, []);

  return (
    <div className="umi-page-container">
      {justScheduled && (
        <div className="umi-success-scheduled-banner">
          <Zap size={15} />
          <span>
            <strong>Mint job scheduled!</strong> {justScheduled.drop.name} fires {fmtTime(justScheduled.scheduledTime)} — unlock &amp; arm below before start.
          </span>
        </div>
      )}

      {/* Top Search / OpenSea URL Bar */}
      <UrlBar onDrop={openDrop} />

      {/* Active Drop Scheduling Panel */}
      {selectedDrop && (
        <DropPanel 
          drop={selectedDrop} 
          onClose={() => setSelectedDrop(null)} 
          walletDirectory={walletDirectory}
          onScheduled={job => { 
            setJustScheduled(job); 
            setSelectedDrop(null); 
            toast.success('Mint job scheduled!');
          }} 
        />
      )}

      {/* Discovery / Collections Browser Feed */}
      <DropsBrowser onSelect={openDrop} />

      {/* Scheduled Jobs Board */}
      <div style={{ marginTop: '1.5rem' }}>
        <JobsBoard />
      </div>
    </div>
  );
};

export default NFTMintBotView;
