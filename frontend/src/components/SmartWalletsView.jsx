import React, { useEffect, useState, useMemo } from 'react';
import { 
  Sparkles, RefreshCw, Copy, Check, ExternalLink, Trash2, 
  Search, TrendingUp, DollarSign, Target, Award, ShieldAlert,
  GitFork, UserCheck, Plus, X, ArrowUpRight, Crown, Coins
} from 'lucide-react';
import { getBackendUrl, authHeaders } from '../utils/sniperApi';
import { useToast } from './ui/useToast';

const TIERS = [
  { ath: '≥ $50M', buyBelow: '≤ $12.5M (25%)', label: 'Megacap Runners' },
  { ath: '~$10M', buyBelow: '≤ $2.5M (25%)', label: '10M Breakouts' },
  { ath: '~$5M', buyBelow: '≤ $1.25M (25%)', label: '5M Early Runners' },
  { ath: '≥ $1M', buyBelow: '≤ $250k (25%)', label: '1M Baseline Runners' },
];

function fmtUsd(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  const prefix = n >= 0 ? '+$' : '-$';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}k`;
  return `${prefix}${abs.toFixed(2)}`;
}

function fmtCurrency(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}k`;
  return `$${abs.toFixed(2)}`;
}

function fmtPrice(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtHoldingTime(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

function fmtPct(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtSignedPct(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  const prefix = n >= 0 ? '+' : '';
  return `${prefix}${n.toFixed(1)}%`;
}

function fmtRelativeTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e11 ? n * 1000 : n;
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function SmartWalletsView({ initialWallets = null, initialCategory = 'smart' } = {}) {
  let toast = { success: () => {}, error: () => {}, info: () => {} };
  try { toast = useToast(); } catch {}

  // Primary list selection: 'smart' | 'tracked' | 'whale' | 'lineage' | 'tiers'
  const [listCategory, setListCategory] = useState(initialCategory);
  const [chainTab, setChainTab] = useState('solana'); // 'solana' | 'robinhood'
  const [trackedSubfilter, setTrackedSubfilter] = useState('all'); // 'all' | 'early_buyer' | 'other'
  const [scanSource, setScanSource] = useState('gmgn'); // 'gmgn' | 'fomo' | 'kolscan' | 'nock'

  const [data, setData] = useState(initialWallets ? { wallets: initialWallets } : null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [consistentOnly, setConsistentOnly] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(null);

  // Lineage connect modal state
  const [showLineageModal, setShowLineageModal] = useState(false);
  const [lineageForm, setLineageForm] = useState({
    parentAddress: '',
    childAddress: '',
    chain: 'solana',
    amount: '',
    txHash: '',
  });
  const [submittingLineage, setSubmittingLineage] = useState(false);

  // Whale connect modal state
  const [showWhaleModal, setShowWhaleModal] = useState(false);
  const [whaleForm, setWhaleForm] = useState({
    address: '',
    chain: 'solana',
    balanceUsd: '',
    memeHoldingsUsd: '',
    tagInput: 'whale, top_holder',
  });
  const [submittingWhale, setSubmittingWhale] = useState(false);

  const fetchWallets = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets?limit=all`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Backend response ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, []);

  const handleScan = async (chain, source = scanSource) => {
    setScanning(true);
    const sourceName = source === 'gmgn' ? 'GMGN' : source === 'fomo' ? 'FOMO' : source === 'kolscan' ? 'Kolscan' : 'Nock Scout';
    toast.info(`Scanning 30-day top ${chain === 'solana' ? 'Solana' : 'Robinhood'} meme traders via ${sourceName}...`);
    try {
      const endpoint = source === 'gmgn' 
        ? `${getBackendUrl()}/api/smart-wallets/scan` 
        : `${getBackendUrl()}/api/smart-wallets/scan/${source}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain, limit: 20 }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Scan failed (${res.status})`);
      }
      const result = await res.json();
      toast.success(`Found and analyzed ${result.count || 0} smart wallets via ${sourceName} on ${chain}!`);
      await fetchWallets();
    } catch (e) {
      toast.error(`Finder scan failed: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (wallet) => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets/${wallet.chain}/${wallet.address}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success(`Removed wallet ${wallet.address.slice(0, 6)}…`);
      await fetchWallets();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handlePromote = async (wallet) => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets/promote/${wallet.chain}/${wallet.address}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Promotion failed (${res.status})`);
      toast.success(`Promoted wallet ${wallet.address.slice(0, 6)}… to Smart Wallet!`);
      await fetchWallets();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleLineageSubmit = async (e) => {
    e.preventDefault();
    if (!lineageForm.parentAddress.trim() || !lineageForm.childAddress.trim()) {
      toast.error('Both parent and child wallet addresses are required.');
      return;
    }
    setSubmittingLineage(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets/lineage`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentAddress: lineageForm.parentAddress.trim(),
          childAddress: lineageForm.childAddress.trim(),
          chain: lineageForm.chain,
          amount: Number(lineageForm.amount) || 0,
          txHash: lineageForm.txHash.trim() || null,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to connect lineage wallet');
      }
      toast.success('Successfully connected lineage wallet and added to Lineage Wallets table!');
      setShowLineageModal(false);
      setLineageForm({ parentAddress: '', childAddress: '', chain: 'solana', amount: '', txHash: '' });
      setListCategory('lineage');
      await fetchWallets();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingLineage(false);
    }
  };

  const handleWhaleSubmit = async (e) => {
    e.preventDefault();
    if (!whaleForm.address.trim()) {
      toast.error('Whale wallet address is required.');
      return;
    }
    const bUsd = Number(whaleForm.balanceUsd) || 0;
    const mUsd = Number(whaleForm.memeHoldingsUsd) || 0;
    if (bUsd < 5000 && mUsd < 5000) {
      toast.error('Whale wallet must hold >$5,000 in meme coins or total balance >$5,000.');
      return;
    }
    setSubmittingWhale(true);
    try {
      const tags = whaleForm.tagInput.split(',').map(t => t.trim()).filter(Boolean);
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets/whale`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: whaleForm.address.trim(),
          chain: whaleForm.chain,
          balanceUsd: bUsd,
          memeHoldingsUsd: mUsd,
          tags,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to register whale wallet');
      }
      toast.success('Successfully registered Whale Wallet!');
      setShowWhaleModal(false);
      setWhaleForm({ address: '', chain: 'solana', balanceUsd: '', memeHoldingsUsd: '', tagInput: 'whale, top_holder' });
      setListCategory('whale');
      await fetchWallets();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingWhale(false);
    }
  };

  const openLineageWithParent = (parentWallet) => {
    setLineageForm({
      parentAddress: parentWallet.address,
      childAddress: '',
      chain: parentWallet.chain || 'solana',
      amount: '',
      txHash: '',
    });
    setShowLineageModal(true);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedAddr(text);
    setTimeout(() => setCopiedAddr(null), 2000);
    toast.success('Address copied to clipboard');
  };

  const allWallets = data?.wallets || [];

  // Partition into 4 distinct lists
  // 1. Lineage: wallets linked to/funded by another wallet
  const lineageWalletsAll = useMemo(() => {
    return allWallets.filter(w => w.category === 'lineage' || Boolean(w.lineageParent));
  }, [allWallets]);

  // 2. Whale: holding meme coins > $5,000 or balance > $5,000
  const whaleWalletsAll = useMemo(() => {
    return allWallets.filter(w => {
      if (w.category === 'lineage' || w.lineageParent) return false;
      return w.category === 'whale' || (Number(w.balanceUsd || 0) >= 5000 || Number(w.memeHoldingsUsd || 0) >= 5000);
    });
  }, [allWallets]);

  // 3. Tracked: candidate discovery wallets (ATH early buyers, runners, watchlists)
  const trackedWalletsAll = useMemo(() => {
    return allWallets.filter(w => {
      if (w.category === 'lineage' || w.lineageParent) return false;
      if (w.category === 'whale' || Number(w.balanceUsd || 0) >= 5000 || Number(w.memeHoldingsUsd || 0) >= 5000) return false;
      return w.category === 'tracked';
    });
  }, [allWallets]);

  // 4. Smart: verified high-conviction traders
  const smartWalletsAll = useMemo(() => {
    return allWallets.filter(w => {
      if (w.category === 'lineage' || w.lineageParent) return false;
      if (w.category === 'whale' || Number(w.balanceUsd || 0) >= 5000 || Number(w.memeHoldingsUsd || 0) >= 5000) return false;
      if (w.category === 'tracked') return false;
      return true; // default smart
    });
  }, [allWallets]);

  // Active pool based on listCategory and chainTab
  const activePool = useMemo(() => {
    let base = smartWalletsAll;
    if (listCategory === 'tracked') base = trackedWalletsAll;
    else if (listCategory === 'whale') base = whaleWalletsAll;
    else if (listCategory === 'lineage') base = lineageWalletsAll;
    return base.filter(w => w.chain === chainTab);
  }, [listCategory, smartWalletsAll, trackedWalletsAll, whaleWalletsAll, lineageWalletsAll, chainTab]);

  // Filtered list with search & strict qualification
  const filteredWallets = useMemo(() => {
    let list = activePool;

    // Subfilter for tracked / smart wallets by addition method
    if (listCategory === 'tracked' || listCategory === 'smart') {
      if (trackedSubfilter === 'buying_mcap') {
        list = list.filter(w =>
          w.methods?.includes('buying_mcap') ||
          w.qualificationMethod === 'buying_mcap' ||
          w.source === 'early-buy-mcap' ||
          w.tags?.includes('early_mcap_buyer') ||
          (w.earlyBuyerInfo?.method === 'buying_mcap')
        );
      } else if (trackedSubfilter === 'first_n_buyers') {
        list = list.filter(w =>
          w.methods?.includes('first_n_buyers') ||
          w.qualificationMethod === 'first_n_buyers' ||
          w.source === 'first-n-buyers' ||
          w.tags?.includes('first_n_buyer') ||
          (w.earlyBuyerInfo?.method === 'first_n_buyers')
        );
      } else if (trackedSubfilter === 'both') {
        list = list.filter(w =>
          (w.methods?.includes('buying_mcap') && w.methods?.includes('first_n_buyers')) ||
          w.source === 'early-buyer-dual'
        );
      } else if (trackedSubfilter === 'early_buyer') {
        list = list.filter(w => w.source?.includes('early') || w.earlyBuyerInfo);
      }
    }

    // Strict qualification (>= 5 open trades and > $100 30d realized PnL)
    if (listCategory === 'smart' && consistentOnly) {
      list = list.filter(w => {
        const open = w.openTrades ?? 0;
        const pnl = w.realizedProfitUsd ?? w.score ?? 0;
        return open >= 5 && pnl > 100;
      });
    }

    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(w => 
      w.address?.toLowerCase().includes(q) ||
      w.twitterUsername?.toLowerCase().includes(q) ||
      w.lineageParent?.toLowerCase().includes(q) ||
      (w.earlyBuyerInfo?.symbol && w.earlyBuyerInfo.symbol.toLowerCase().includes(q)) ||
      (Array.isArray(w.tags) && w.tags.some(t => t.toLowerCase().includes(q)))
    );
  }, [activePool, listCategory, trackedSubfilter, consistentOnly, search]);

  // Aggregate KPIs
  const totalSmartCount = smartWalletsAll.length;
  const totalTrackedCount = trackedWalletsAll.length;
  const totalWhaleCount = whaleWalletsAll.length;
  const totalLineageCount = lineageWalletsAll.length;

  const totalEarned = useMemo(() => smartWalletsAll.reduce((acc, w) => acc + (w.realizedProfitUsd || 0), 0), [smartWalletsAll]);

  return (
    <div className="meme-terminal-container">
      {/* Page Header */}
      <div className="page-header page-header-row meme-page-header">
        <div>
          <span className="page-eyebrow">Onchain Intelligence · 4-Tier Registry</span>
          <h2>Smart, Tracked, Whale &amp; Lineage Wallets</h2>
          <p>Full spectrum wallet tracking across Solana &amp; Robinhood: Verified Smart Money, Candidate Watchlists, &gt;$5k Whales, and Lineage Funder Trees.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#f9fafb', border: '1px solid #e5e7eb', padding: '0.15rem 0.4rem', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 500 }}>Source:</span>
            <select
              value={scanSource}
              onChange={(e) => setScanSource(e.target.value)}
              disabled={scanning}
              style={{
                fontSize: '0.75rem',
                border: 'none',
                background: 'transparent',
                color: '#111827',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="gmgn">GMGN (Multi-chain)</option>
              <option value="fomo">FOMO.family (Solana)</option>
              <option value="kolscan">Kolscan (Solana)</option>
              <option value="nock">Nock Scout (Solana)</option>
            </select>
          </div>
          <button 
            type="button" 
            className="btn-primary btn-sm"
            onClick={() => handleScan(chainTab, scanSource)}
            disabled={scanning}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Sparkles size={14} className={scanning ? 'spin' : ''} />
            {scanning ? 'Analyzing Wallets…' : `Scan ${chainTab === 'solana' ? 'Solana' : 'Robinhood'} Smart Money`}
          </button>
          <button 
            type="button" 
            className="btn-outline btn-sm"
            onClick={() => setShowWhaleModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Crown size={14} color="#eab308" /> Add Whale Wallet
          </button>
          <button 
            type="button" 
            className="btn-outline btn-sm"
            onClick={() => setShowLineageModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <GitFork size={14} color="#6366f1" /> Connect Lineage Wallet
          </button>
          <button 
            type="button" 
            className="icon-button-ghost" 
            onClick={fetchWallets}
            title="Refresh wallets"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* 4 KPI Cards for the 4 Categories */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div 
          className="card" 
          onClick={() => setListCategory('smart')}
          style={{ padding: '0.9rem 1.1rem', background: 'var(--card-bg, #ffffff)', border: listCategory === 'smart' ? '2px solid #6366f1' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Award size={15} color="#6366f1" /> Smart Wallets
            </span>
            <span style={{ fontSize: '0.7rem', background: '#eef2ff', color: '#4338ca', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Verified</span>
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#111827' }}>
            {totalSmartCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' }}>
            ≥5 open trades &amp; &gt;$100 30d PnL · {fmtUsd(totalEarned)} earned
          </div>
        </div>

        <div 
          className="card" 
          onClick={() => setListCategory('tracked')}
          style={{ padding: '0.9rem 1.1rem', background: 'var(--card-bg, #ffffff)', border: listCategory === 'tracked' ? '2px solid #0284c7' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Target size={15} color="#0284c7" /> Tracked Wallets
            </span>
            <span style={{ fontSize: '0.7rem', background: '#f0f9ff', color: '#0369a1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Candidates</span>
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#0284c7' }}>
            {totalTrackedCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' }}>
            ATH early buyers &amp; discovery watchlists
          </div>
        </div>

        <div 
          className="card" 
          onClick={() => setListCategory('whale')}
          style={{ padding: '0.9rem 1.1rem', background: 'var(--card-bg, #ffffff)', border: listCategory === 'whale' ? '2px solid #eab308' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Crown size={15} color="#eab308" /> Whale Wallets
            </span>
            <span style={{ fontSize: '0.7rem', background: '#fefce8', color: '#a16207', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>&gt;$5,000</span>
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#b45309' }}>
            {totalWhaleCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' }}>
            &gt;$5k meme holdings or wallet balance
          </div>
        </div>

        <div 
          className="card" 
          onClick={() => setListCategory('lineage')}
          style={{ padding: '0.9rem 1.1rem', background: 'var(--card-bg, #ffffff)', border: listCategory === 'lineage' ? '2px solid #8b5cf6' : '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6b7280', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <GitFork size={15} color="#8b5cf6" /> Lineage Wallets
            </span>
            <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Linked</span>
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#7c3aed' }}>
            {totalLineageCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' }}>
            Funded by smart or whale wallets
          </div>
        </div>
      </div>

      {/* 4 CATEGORY TAB SWITCHER */}
      <div className="strategy-tab-bar" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        <button
          type="button"
          className={`strategy-tab ${listCategory === 'smart' ? 'active' : ''}`}
          onClick={() => setListCategory('smart')}
        >
          <Award size={15} style={{ marginRight: '0.3rem' }} />
          <span>1. Smart Wallets</span>
          <span className="strategy-tab-badge">{smartWalletsAll.length}</span>
        </button>

        <button
          type="button"
          className={`strategy-tab ${listCategory === 'tracked' ? 'active' : ''}`}
          onClick={() => setListCategory('tracked')}
        >
          <Target size={15} style={{ marginRight: '0.3rem' }} />
          <span>2. Tracked Wallets</span>
          <span className="strategy-tab-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>{trackedWalletsAll.length}</span>
        </button>

        <button
          type="button"
          className={`strategy-tab ${listCategory === 'whale' ? 'active' : ''}`}
          onClick={() => setListCategory('whale')}
        >
          <Crown size={15} style={{ marginRight: '0.3rem', color: '#eab308' }} />
          <span>3. Whale Wallets (&gt;$5k)</span>
          <span className="strategy-tab-badge" style={{ background: '#fef9c3', color: '#854d0e' }}>{whaleWalletsAll.length}</span>
        </button>

        <button
          type="button"
          className={`strategy-tab ${listCategory === 'lineage' ? 'active' : ''}`}
          onClick={() => setListCategory('lineage')}
        >
          <GitFork size={15} style={{ marginRight: '0.3rem', color: '#8b5cf6' }} />
          <span>4. Lineage Wallets</span>
          <span className="strategy-tab-badge" style={{ background: '#ede9fe', color: '#5b21b6' }}>{lineageWalletsAll.length}</span>
        </button>

        <button
          type="button"
          className={`strategy-tab ${listCategory === 'tiers' ? 'active' : ''}`}
          onClick={() => setListCategory('tiers')}
        >
          <span>Tier &amp; Classification Rules</span>
        </button>
      </div>

      {/* CHAIN SUB-TABS (FOR ALL 4 TABLES) */}
      {listCategory !== 'tiers' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
          {/* Chain Selector */}
          <div style={{ display: 'inline-flex', background: '#f3f4f6', padding: '3px', borderRadius: '6px' }}>
            <button
              type="button"
              onClick={() => setChainTab('solana')}
              style={{
                border: 'none',
                background: chainTab === 'solana' ? '#ffffff' : 'transparent',
                color: chainTab === 'solana' ? '#111827' : '#6b7280',
                padding: '0.35rem 0.8rem',
                borderRadius: '4px',
                fontSize: '0.82rem',
                fontWeight: chainTab === 'solana' ? 600 : 400,
                cursor: 'pointer',
                boxShadow: chainTab === 'solana' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Solana ({
                listCategory === 'smart' ? smartWalletsAll.filter(w => w.chain === 'solana').length :
                listCategory === 'tracked' ? trackedWalletsAll.filter(w => w.chain === 'solana').length :
                listCategory === 'whale' ? whaleWalletsAll.filter(w => w.chain === 'solana').length :
                lineageWalletsAll.filter(w => w.chain === 'solana').length
              })
            </button>
            <button
              type="button"
              onClick={() => setChainTab('robinhood')}
              style={{
                border: 'none',
                background: chainTab === 'robinhood' ? '#ffffff' : 'transparent',
                color: chainTab === 'robinhood' ? '#111827' : '#6b7280',
                padding: '0.35rem 0.8rem',
                borderRadius: '4px',
                fontSize: '0.82rem',
                fontWeight: chainTab === 'robinhood' ? 600 : 400,
                cursor: 'pointer',
                boxShadow: chainTab === 'robinhood' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Robinhood / EVM ({
                listCategory === 'smart' ? smartWalletsAll.filter(w => w.chain === 'robinhood').length :
                listCategory === 'tracked' ? trackedWalletsAll.filter(w => w.chain === 'robinhood').length :
                listCategory === 'whale' ? whaleWalletsAll.filter(w => w.chain === 'robinhood').length :
                lineageWalletsAll.filter(w => w.chain === 'robinhood').length
              })
            </button>
          </div>

          {/* Subfilter for Tracked / Smart Wallets by Addition Method */}
          {(listCategory === 'tracked' || listCategory === 'smart') && (
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.74rem', color: '#6b7280', fontWeight: 500 }}>Filter:</span>
              <button
                type="button"
                className={`btn-sm ${trackedSubfilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setTrackedSubfilter('all')}
                style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem' }}
              >
                All
              </button>
              <button
                type="button"
                className={`btn-sm ${trackedSubfilter === 'buying_mcap' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setTrackedSubfilter('buying_mcap')}
                style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                title="Qualified by Buying Market Cap ≤ 25% of ATH"
              >
                🎯 Buying Mcap (≤25%)
              </button>
              <button
                type="button"
                className={`btn-sm ${trackedSubfilter === 'first_n_buyers' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setTrackedSubfilter('first_n_buyers')}
                style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                title="Qualified as First N Chronological Buyers"
              >
                ⏱ First N Buyers
              </button>
              <button
                type="button"
                className={`btn-sm ${trackedSubfilter === 'both' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setTrackedSubfilter('both')}
                style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                title="Qualifies under both Buying Mcap AND First N Buyers"
              >
                ⚡ Both Methods
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#b91c1c', marginBottom: '1rem', fontSize: '0.85rem' }}>
          <strong>Backend Notice:</strong> {error}
        </div>
      )}

      {/* SEARCH BAR & BANNER */}
      {listCategory !== 'tiers' && (
        <>
          <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="search-field" style={{ flex: 1, minWidth: '240px', maxWidth: '380px' }}>
              <Search size={15} />
              <input 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                placeholder={`Search ${chainTab === 'solana' ? 'Solana' : 'Robinhood'} ${listCategory} address or tag...`} 
              />
            </div>

            {listCategory === 'smart' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#374151', cursor: 'pointer', background: consistentOnly ? '#ecfdf5' : '#f9fafb', padding: '0.35rem 0.65rem', borderRadius: '6px', border: consistentOnly ? '1px solid #a7f3d0' : '1px solid #e5e7eb', userSelect: 'none' }}>
                <input type="checkbox" checked={consistentOnly} onChange={e => setConsistentOnly(e.target.checked)} style={{ accentColor: '#059669' }} />
                <ShieldAlert size={14} color={consistentOnly ? '#059669' : '#6b7280'} />
                <span>Strict qualification (≥5 open trades &amp; &gt;$100 30d PnL)</span>
              </label>
            )}

            <span style={{ fontSize: '0.82rem', color: '#6b7280', marginLeft: 'auto' }}>
              Showing {filteredWallets.length} of {activePool.length} {listCategory} wallets on {chainTab === 'solana' ? 'Solana' : 'Robinhood'}
            </span>
          </div>

          {/* Quick info banner */}
          <div style={{
            background: listCategory === 'smart' 
              ? 'linear-gradient(135deg, rgba(238, 242, 255, 0.6) 0%, rgba(243, 244, 246, 0.7) 100%)'
              : listCategory === 'whale'
              ? 'linear-gradient(135deg, rgba(254, 252, 232, 0.7) 0%, rgba(243, 244, 246, 0.7) 100%)'
              : listCategory === 'lineage'
              ? 'linear-gradient(135deg, rgba(245, 243, 255, 0.7) 0%, rgba(243, 244, 246, 0.7) 100%)'
              : 'linear-gradient(135deg, rgba(240, 249, 255, 0.7) 0%, rgba(243, 244, 246, 0.7) 100%)',
            border: listCategory === 'smart' ? '1px solid #e0e7ff' : listCategory === 'whale' ? '1px solid #fef08a' : listCategory === 'lineage' ? '1px solid #ddd6fe' : '1px solid #bae6fd',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '0.9rem',
            fontSize: '0.8rem',
            color: '#374151'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong style={{ 
                color: listCategory === 'smart' ? '#4338ca' : listCategory === 'whale' ? '#a16207' : listCategory === 'lineage' ? '#6d28d9' : '#0284c7', 
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem' 
              }}>
                {listCategory === 'smart' && <><Award size={13} /> Smart Wallet Standard:</>}
                {listCategory === 'tracked' && <><Target size={13} /> Tracked Wallet Protocol:</>}
                {listCategory === 'whale' && <><Crown size={13} /> Whale Wallet Threshold:</>}
                {listCategory === 'lineage' && <><GitFork size={13} /> Lineage Hierarchy:</>}
              </strong>
              <span>
                {listCategory === 'smart' && 'Verified traders with ≥5 open trades and >$100 30-day realized PnL. Monitored for active copy-trading signals.'}
                {listCategory === 'tracked' && 'Candidate early buyers on runners with ATH ≥ $1M (Method 1: entry ≤ 25% ATH, Method 2: first 100+20/M buyers; only profitable trades qualify). Awaiting qualification.'}
                {listCategory === 'whale' && 'Wallets holding >$5,000 in meme tokens or maintaining a total native balance >$5,000 on Solana or Robinhood. Tracked for large-scale accumulation and distribution.'}
                {listCategory === 'lineage' && 'Sub-wallets funded by identified Whales or Smart Wallets. Used to detect stealth buys, volume masking, and insider allocations.'}
              </span>
            </div>
          </div>
        </>
      )}

      {/* TAB CONTENT */}
      {listCategory === 'tiers' ? (
        <div className="panel" style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111827' }}>
            Database Architecture &amp; 4-Category System Rules
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.25rem' }}>
            How wallets are categorized in PostgreSQL and the JSON store, and the exact rules for Smart, Tracked, Whale, and Lineage classification.
          </p>

          {/* Section 1: Whale Wallet Criteria */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '6px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#854d0e', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Crown size={15} color="#eab308" /> 1. Whale Wallet Threshold
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#713f12', marginBottom: '0.6rem' }}>
              Wallets qualify as <strong>Whales</strong> if they satisfy either condition on Solana or Robinhood:
            </p>
            <ul style={{ fontSize: '0.82rem', color: '#854d0e', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li><strong>Meme Coin Holdings:</strong> Holds meme tokens valued at <strong>&gt; $5,000 USD</strong>.</li>
              <li><strong>Native / Total Balance:</strong> Has a wallet balance of <strong>&gt; $5,000 USD</strong>.</li>
            </ul>
          </div>

          {/* Section 2: Lineage Hierarchy */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '6px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#5b21b6', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <GitFork size={15} color="#8b5cf6" /> 2. Lineage Wallet Hierarchy
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#4c1d95', marginBottom: '0.6rem' }}>
              Sub-wallets funded by Whales or Smart Wallets to mask snipes and volume:
            </p>
            <ul style={{ fontSize: '0.82rem', color: '#5b21b6', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li>When a known Whale or Smart Wallet transfers funds, the recipient is categorized as a <strong>Lineage Wallet</strong>.</li>
              <li>Preserves parent link, transferred amount, and on-chain funding transaction.</li>
              <li>Can be promoted to Smart Wallet upon achieving independent track records.</li>
            </ul>
          </div>

          {/* Section 3: Smart Wallet Rules */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#eef2ff', border: '1px solid #e0e7ff', borderRadius: '6px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#3730a3', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Award size={15} color="#6366f1" /> 3. Smart Wallet Qualification Standard
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#312e81', marginBottom: '0.6rem' }}>
              To qualify as a verified <strong>Smart Wallet</strong>, an address must fulfill:
            </p>
            <ul style={{ fontSize: '0.82rem', color: '#3730a3', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li><strong>Open Trades:</strong> At least <strong>5 open trades</strong>.</li>
              <li><strong>30-Day Realized PnL:</strong> Greater than <strong>+$100 USD</strong>.</li>
            </ul>
          </div>

          {/* Section 4: ATH Quota Formula */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Target size={15} color="#0284c7" /> 4. ATH Early-Buyer Position Ingestion (Tracked Wallets)
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '0.6rem' }}>
              When a runner coin establishes an All-Time High (ATH ≥ $1,000,000), the bot captures early position-opening wallets into <strong>Tracked Wallets</strong> using two simultaneous methods:
            </p>
            <ul style={{ fontSize: '0.82rem', color: '#334155', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li><strong>ATH &lt; $1,000,000 ($1M):</strong> 0 wallets (minimum runner threshold is $1 Million; changed from $500k to $1M).</li>
              <li><strong>Trade Profitability Verification:</strong> Wallets are <em>only added if their trade was profitable</em> (<code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: '3px' }}>profitUsd &gt; 0</code>, sold above buy price, or won). Losing trades are excluded.</li>
              <li><strong>Method 1 (Buying Mcap):</strong> Captures wallets that bought at or below <strong>25% of runner ATH</strong> (e.g. entry &le; $250k for $1M ATH).</li>
              <li><strong>Method 2 (First N Buyers):</strong> Captures the first <strong>100 wallets</strong> for ATH &ge; $1M, plus <strong>+20 wallets</strong> per additional $1M in ATH (<code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: '3px' }}>100 + floor((ATH-1M)/1M)*20</code>).</li>
              <li><strong>Dual Qualification:</strong> If an address qualifies under both methods, both qualification origins and badges are preserved.</li>
            </ul>
          </div>

          {/* Section 5: 25% ATH Early-Buyer Tiers */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#166534', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Award size={15} color="#16a34a" /> 5. 25% ATH Early-Buyer Qualification Tiers
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#15803d', marginBottom: '0.6rem' }}>
              To qualify an early buy under Method 1, the entry purchase market cap must be at or below <strong>25% of the runner All-Time High (ATH)</strong> for coins with ATH &ge; $1,000,000, and the trade must be profitable:
            </p>
            <ul style={{ fontSize: '0.82rem', color: '#166534', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li><strong>Ath ~1M:</strong> Early buy entry <strong>&le; $250k</strong> (<span className="mono">&le; 25%</span> of 1M ATH).</li>
              <li><strong>Ath ~5M:</strong> Early buy entry <strong>&le; $1.25M</strong> (<span className="mono">&le; 25%</span> of 5M ATH).</li>
              <li><strong>Ath ~10M:</strong> Early buy entry <strong>&le; $2.5M</strong> (<span className="mono">&le; 25%</span> of 10M ATH).</li>
              <li><strong>Ath &gt;50M:</strong> Early buy entry <strong>&le; $12.5M</strong> (<span className="mono">&le; 25%</span> of 50M ATH).</li>
            </ul>
          </div>

          {/* Section 6: In-Memory Execution Metrics (Zero Transaction Storage) */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <TrendingUp size={15} color="#0284c7" /> 6. In-Memory Execution Metrics (Worker 4 &amp; 5)
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '0.6rem' }}>
              Advanced performance metrics computed in-flight without persisting raw swap transactions (Strict Zero Transaction Storage constraint):
            </p>
            <ul style={{ fontSize: '0.82rem', color: '#334155', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li><strong>Capture Ratio:</strong> Average realized exit market cap divided by token ATH. Higher means selling closer to peak ATH.</li>
              <li><strong>Round-Trip Rate:</strong> Percentage of winning trades held until price dropped below entry. Lower is better.</li>
              <li><strong>Sold &gt;50% ATH:</strong> Percentage of exit USD volume executed at or above 50% of the token ATH.</li>
              <li><strong>&ge;$2M Hit Rate:</strong> Ratio and percentage of traded tokens whose ATH reached &ge; $2M.</li>
              <li><strong>ROI %:</strong> Realized profit divided by total invested capital.</li>
              <li><strong>Watermark:</strong> Most recent transaction signature and timestamp cursor for resumable, incremental metric processing.</li>
            </ul>
          </div>
        </div>
      ) : (
        /* DEDICATED TABLE FOR EACH CATEGORY */
        <div className="panel" style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          {filteredWallets.length === 0 ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#6b7280' }}>
              <Sparkles size={32} style={{ margin: '0 auto 0.8rem auto', color: '#9ca3af' }} />
              <h4 style={{ color: '#111827', marginBottom: '0.4rem' }}>
                No {chainTab === 'solana' ? 'Solana' : 'Robinhood'} {
                  listCategory === 'smart' ? 'Smart' :
                  listCategory === 'whale' ? 'Whale' :
                  listCategory === 'lineage' ? 'Lineage' : 'Tracked'
                } Wallets Found
              </h4>
              <p style={{ fontSize: '0.85rem', maxWidth: '440px', margin: '0 auto 1.2rem auto' }}>
                {listCategory === 'smart' && 'Run the Smart Wallet Finder to discover profitable degens with verified track records.'}
                {listCategory === 'whale' && 'Add a known whale wallet holding >$5,000 in meme coins or wallet balance.'}
                {listCategory === 'lineage' && 'Connect a Lineage wallet to trace sub-wallets funded by smart or whale wallets.'}
                {listCategory === 'tracked' && 'No candidate wallets found. Scan runner tokens or add candidates to track.'}
              </p>
              {listCategory === 'smart' ? (
                <button 
                  type="button" 
                  className="btn-primary btn-sm"
                  onClick={() => handleScan(chainTab, scanSource)}
                  disabled={scanning}
                >
                  <Sparkles size={14} className={scanning ? 'spin' : ''} /> Run {chainTab === 'solana' ? 'Solana' : 'Robinhood'} Finder
                </button>
              ) : listCategory === 'whale' ? (
                <button 
                  type="button" 
                  className="btn-primary btn-sm"
                  onClick={() => setShowWhaleModal(true)}
                >
                  <Crown size={14} /> Add Whale Wallet
                </button>
              ) : listCategory === 'lineage' ? (
                <button 
                  type="button" 
                  className="btn-primary btn-sm"
                  onClick={() => setShowLineageModal(true)}
                >
                  <GitFork size={14} /> Connect Lineage Wallet
                </button>
              ) : null}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  {(listCategory === 'smart' || listCategory === 'tracked') && (
                    <tr>
                      <th>Wallet Address</th>
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
                  {filteredWallets.map(w => {
                    const explorerUrl = w.chain === 'solana' 
                      ? `https://solscan.io/account/${w.address}` 
                      : `https://robinhoodchain.blockscout.com/address/${w.address}`;
                    const gmgnUrl = `https://gmgn.ai/${w.chain === 'solana' ? 'sol' : 'robinhood'}/address/${w.address}`;
                    const earned = w.realizedProfitUsd ?? w.score ?? 0;
                    const winRate = w.winRatePct ?? 0;

                    return (
                      <tr key={`${w.chain}:${w.address}`}>
                        {/* 1. Wallet Address Column (Common across all) */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span className="mono" style={{ fontWeight: 600, color: '#111827' }}>
                                {w.address.slice(0, 6)}…{w.address.slice(-4)}
                              </span>
                              <button
                                type="button"
                                className="icon-button-ghost"
                                style={{ padding: '2px' }}
                                onClick={() => copyToClipboard(w.address)}
                                title="Copy address"
                              >
                                {copiedAddr === w.address ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                              </button>
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="View on Explorer"
                                style={{ color: '#6b7280', display: 'inline-flex' }}
                              >
                                <ExternalLink size={12} />
                              </a>
                            </div>

                            {w.twitterUsername && (
                              <span style={{ fontSize: '0.72rem', color: '#0284c7' }}>
                                @{w.twitterUsername}
                              </span>
                            )}

                            {/* Scam & Badges */}
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                              {((w.methods?.includes('buying_mcap') && w.methods?.includes('first_n_buyers')) || w.source === 'early-buyer-dual') ? (
                                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }} title="Qualified via both Mcap (≤25% ATH) and First N Early Buyers">
                                  ⚡ Mcap ≤25% + First N
                                </span>
                              ) : (
                                <>
                                  {(w.methods?.includes('buying_mcap') || w.qualificationMethod === 'buying_mcap' || w.source === 'early-buy-mcap' || w.tags?.includes('early_mcap_buyer')) && (
                                    <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }} title="Method 1: Qualified via Early Mcap (≤25% ATH)">
                                      🎯 Mcap ≤25%
                                    </span>
                                  )}
                                  {(w.methods?.includes('first_n_buyers') || w.qualificationMethod === 'first_n_buyers' || w.source === 'first-n-buyers' || w.tags?.includes('first_n_buyer')) && (
                                    <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#fef3c7', color: '#b45309', fontWeight: 600 }} title="Method 2: Qualified via First N Early Buyers">
                                      ⏱ First N
                                    </span>
                                  )}
                                </>
                              )}
                              {w.walletType === 'scam_wallet' && (
                                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>
                                  🚨 Dev Scam
                                </span>
                              )}
                              {w.walletType === 'scammer_lineage_wallet' && (
                                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#ffedd5', color: '#ea580c', fontWeight: 600 }}>
                                  ⚠️ Scammer Lineage
                                </span>
                              )}
                              {(w.retardPoints || 0) > 0 && (
                                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#fef3c7', color: '#b45309', fontWeight: 600 }}>
                                  {w.retardPoints} retard pt
                                </span>
                              )}
                              {(w.susWalletPoints || 0) > 0 && (
                                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#f3e8ff', color: '#7e22ce', fontWeight: 600 }}>
                                  {w.susWalletPoints} sus pt
                                </span>
                              )}
                              {w.earlyBuyerInfo && (
                                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }} title={`Early Buyer #${w.earlyBuyerInfo.rank || 1} on $${w.earlyBuyerInfo.symbol || 'TOKEN'}`}>
                                  🎯 Early #{w.earlyBuyerInfo.rank || 1} · ${w.earlyBuyerInfo.symbol || 'TOKEN'}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* SMART & TRACKED TABLE BODY */}
                        {(listCategory === 'smart' || listCategory === 'tracked') && (
                          <>
                            <td>
                              <strong style={{ color: earned >= 0 ? '#059669' : '#dc2626', fontSize: '0.9rem' }}>
                                {fmtUsd(earned)}
                              </strong>
                            </td>
                            <td>
                              {w.roiPct != null && Number.isFinite(Number(w.roiPct)) ? (
                                <span style={{
                                  fontWeight: 600,
                                  color: Number(w.roiPct) >= 0 ? '#059669' : '#dc2626',
                                  fontSize: '0.86rem',
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
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                fontWeight: 600,
                                background: winRate >= 50 ? '#dcfce7' : winRate >= 35 ? '#fef3c7' : '#fee2e2',
                                color: winRate >= 50 ? '#15803d' : winRate >= 35 ? '#b45309' : '#b91c1c',
                              }}>
                                {winRate.toFixed(1)}%
                              </span>
                            </td>
                            <td>
                              <span>
                                <strong style={{ color: '#059669' }}>{w.profitableTrades || 0} won</strong>
                                <span style={{ color: '#6b7280', fontSize: '0.75rem' }}> / {w.tokenNum || w.totalTrades || 0} buys</span>
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <strong style={{ color: '#111827', fontSize: '0.86rem' }}>
                                  {w.avgBuyMcap ? fmtCurrency(w.avgBuyMcap) : (w.avgBuyPrice ? fmtPrice(w.avgBuyPrice) : '—')}
                                </strong>
                                {w.avgBuyPrice ? (
                                  <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>
                                    {fmtPrice(w.avgBuyPrice)}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <strong style={{ color: '#111827', fontSize: '0.86rem' }}>
                                  {w.avgSellMcap
                                    ? fmtCurrency(w.avgSellMcap)
                                    : (w.avgSellPrice && w.avgBuyPrice && w.avgBuyMcap
                                      ? fmtCurrency(Math.round(w.avgBuyMcap * (w.avgSellPrice / w.avgBuyPrice)))
                                      : (w.avgSellPrice ? fmtPrice(w.avgSellPrice) : '—'))}
                                </strong>
                                {w.avgSellPrice ? (
                                  <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>
                                    {fmtPrice(w.avgSellPrice)}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <span style={{
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                color: '#374151',
                                background: '#f3f4f6',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                display: 'inline-block'
                              }}>
                                {fmtHoldingTime(w.avgHoldingTimeSec)}
                              </span>
                            </td>
                            <td>
                              {w.captureRatioPct != null && Number.isFinite(Number(w.captureRatioPct)) ? (
                                <span style={{
                                  display: 'inline-block',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  fontWeight: 600,
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
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  fontWeight: 600,
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
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  fontWeight: 600,
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
                                  <strong style={{ color: '#111827', fontSize: '0.84rem' }}>
                                    {(w.tokensTradedGt2m || 0)}/{(w.tokensTradedGt2m || 0) + (w.tokensTradedLt2m || 0)}
                                  </strong>
                                  <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>
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
                                    <span className="mono" style={{ fontSize: '0.72rem', color: '#4b5563' }} title={w.lastProcessedTxSignature}>
                                      {w.lastProcessedTxSignature.slice(0, 4)}…{w.lastProcessedTxSignature.slice(-4)}
                                    </span>
                                  ) : null}
                                  {w.lastProcessedTimestamp ? (
                                    <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
                                      {fmtRelativeTime(w.lastProcessedTimestamp) || new Date(Number(w.lastProcessedTimestamp) < 1e11 ? Number(w.lastProcessedTimestamp) * 1000 : Number(w.lastProcessedTimestamp)).toLocaleDateString()}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>—</span>
                              )}
                            </td>
                          </>
                        )}


                        {/* WHALE TABLE BODY */}
                        {listCategory === 'whale' && (
                          <>
                            <td>
                              <strong style={{ color: '#111827', fontSize: '0.88rem' }}>
                                {fmtCurrency(w.balanceUsd || 0)}
                              </strong>
                            </td>
                            <td>
                              <strong style={{ color: '#059669', fontSize: '0.88rem' }}>
                                {fmtCurrency(w.memeHoldingsUsd || 0)}
                              </strong>
                            </td>
                            <td>
                              <span style={{ color: earned >= 0 ? '#059669' : '#dc2626', fontWeight: 600 }}>
                                {fmtUsd(earned)}
                              </span>
                            </td>
                            <td>
                              <span style={{ 
                                fontSize: '0.72rem', 
                                padding: '2px 6px', 
                                borderRadius: '4px', 
                                background: '#fefce8', 
                                color: '#854d0e', 
                                fontWeight: 600 
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
                                  <span key={t} style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#f3f4f6', color: '#4b5563' }}>{t}</span>
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                  <span className="mono" style={{ fontSize: '0.8rem', color: '#4338ca', fontWeight: 600 }} title={w.lineageParent}>
                                    {w.lineageParent.slice(0, 6)}…{w.lineageParent.slice(-4)}
                                  </span>
                                  <button 
                                    type="button" 
                                    className="icon-button-ghost" 
                                    style={{ padding: '2px' }}
                                    onClick={() => copyToClipboard(w.lineageParent)}
                                    title="Copy parent address"
                                  >
                                    <Copy size={11} />
                                  </button>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Unknown Funder</span>
                              )}
                            </td>
                            <td>
                              <strong style={{ color: '#0f172a', fontSize: '0.84rem' }}>
                                {w.lineageAmount ? `${w.lineageAmount} ${w.chain === 'solana' ? 'SOL' : 'ETH'}` : '—'}
                              </strong>
                            </td>
                            <td>
                              {w.lineageTx ? (
                                <a 
                                  href={w.chain === 'solana' ? `https://solscan.io/tx/${w.lineageTx}` : `https://robinhoodchain.blockscout.com/tx/${w.lineageTx}`}
                                  target="_blank" 
                                  rel="noreferrer"
                                  style={{ color: '#0284c7', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                                >
                                  {w.lineageTx.slice(0, 8)}… <ExternalLink size={10} />
                                </a>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Internal / off-chain</span>
                              )}
                            </td>
                            <td>
                              <span style={{ 
                                fontSize: '0.72rem', 
                                padding: '2px 6px', 
                                borderRadius: '4px', 
                                background: '#ede9fe', 
                                color: '#5b21b6', 
                                fontWeight: 600 
                              }}>
                                {w.status || 'Active Child'}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                                {Array.isArray(w.tags) && w.tags.map(t => (
                                  <span key={t} style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', background: '#f3f4f6', color: '#4b5563' }}>{t}</span>
                                ))}
                              </div>
                            </td>
                          </>
                        )}

                        {/* Actions Column */}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                            {listCategory === 'whale' && (
                              <button
                                type="button"
                                className="btn-outline btn-sm"
                                onClick={() => openLineageWithParent(w)}
                                title="Link a child wallet funded by this whale"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                              >
                                <GitFork size={12} /> Connect Child
                              </button>
                            )}
                            {(listCategory === 'tracked' || listCategory === 'lineage') && (
                              <button
                                type="button"
                                className="btn-primary btn-sm"
                                onClick={() => handlePromote(w)}
                                title="Promote to Smart Wallet"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#059669', borderColor: '#059669' }}
                              >
                                <UserCheck size={12} /> Promote
                              </button>
                            )}
                            <a
                              href={gmgnUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn-outline btn-sm"
                              style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', textDecoration: 'none' }}
                              title="Inspect on GMGN.ai"
                            >
                              GMGN
                            </a>

                            <button
                              type="button"
                              className="icon-button-ghost"
                              onClick={() => handleDelete(w)}
                              title="Delete wallet"
                              style={{ color: '#9ca3af' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CONNECT LINEAGE WALLET MODAL */}
      {showLineageModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '10px',
            width: '100%',
            maxWidth: '480px',
            padding: '1.5rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <GitFork size={18} color="#8b5cf6" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827', margin: 0 }}>
                  Connect Lineage Wallet
                </h3>
              </div>
              <button
                type="button"
                className="icon-button-ghost"
                onClick={() => setShowLineageModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1.2rem' }}>
              Link a new child wallet funded by a known whale or smart wallet. Added to the <strong>Lineage Wallets</strong> table.
            </p>

            <form onSubmit={handleLineageSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Chain
                </label>
                <select
                  value={lineageForm.chain}
                  onChange={e => setLineageForm({ ...lineageForm, chain: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                >
                  <option value="solana">Solana (Base58)</option>
                  <option value="robinhood">Robinhood / EVM (0x)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Parent Wallet (Whale / Smart Wallet Funder) *
                </label>
                <input
                  type="text"
                  required
                  placeholder={lineageForm.chain === 'solana' ? 'e.g. 6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX' : 'e.g. 0x742d35cc6634c0532925a3b844bc9e7595f0beb0'}
                  value={lineageForm.parentAddress}
                  onChange={e => setLineageForm({ ...lineageForm, parentAddress: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Child Wallet (Newly Funded) *
                </label>
                <input
                  type="text"
                  required
                  placeholder={lineageForm.chain === 'solana' ? 'e.g. 71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t' : 'e.g. 0x9999b0cdd35d7f3b281ba02efc0d228486940515'}
                  value={lineageForm.childAddress}
                  onChange={e => setLineageForm({ ...lineageForm, childAddress: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                    Transfer Amount ({lineageForm.chain === 'solana' ? 'SOL' : 'ETH'})
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 10.5"
                    value={lineageForm.amount}
                    onChange={e => setLineageForm({ ...lineageForm, amount: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                    Funding TX Hash (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Funding tx hash..."
                    value={lineageForm.txHash}
                    onChange={e => setLineageForm({ ...lineageForm, txHash: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => setShowLineageModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary btn-sm"
                  disabled={submittingLineage}
                >
                  {submittingLineage ? 'Saving…' : 'Connect Lineage Wallet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REGISTER WHALE WALLET MODAL */}
      {showWhaleModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '10px',
            width: '100%',
            maxWidth: '480px',
            padding: '1.5rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Crown size={18} color="#eab308" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827', margin: 0 }}>
                  Add Whale Wallet (&gt;$5,000)
                </h3>
              </div>
              <button
                type="button"
                className="icon-button-ghost"
                onClick={() => setShowWhaleModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1.2rem' }}>
              Register a high-capital wallet holding &gt;$5,000 in meme tokens or total balance &gt;$5,000 on Solana or Robinhood.
            </p>

            <form onSubmit={handleWhaleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Chain
                </label>
                <select
                  value={whaleForm.chain}
                  onChange={e => setWhaleForm({ ...whaleForm, chain: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                >
                  <option value="solana">Solana (Base58)</option>
                  <option value="robinhood">Robinhood / EVM (0x)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Whale Wallet Address *
                </label>
                <input
                  type="text"
                  required
                  placeholder={whaleForm.chain === 'solana' ? 'e.g. 71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t' : 'e.g. 0x742d35cc6634c0532925a3b844bc9e7595f0beb0'}
                  value={whaleForm.address}
                  onChange={e => setWhaleForm({ ...whaleForm, address: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                    Total Wallet Balance (USD)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 15000"
                    value={whaleForm.balanceUsd}
                    onChange={e => setWhaleForm({ ...whaleForm, balanceUsd: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                    Meme Coin Holdings (USD)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 8500"
                    value={whaleForm.memeHoldingsUsd}
                    onChange={e => setWhaleForm({ ...whaleForm, memeHoldingsUsd: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. whale, top_holder, liquidity_provider"
                  value={whaleForm.tagInput}
                  onChange={e => setWhaleForm({ ...whaleForm, tagInput: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => setShowWhaleModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary btn-sm"
                  disabled={submittingWhale}
                >
                  {submittingWhale ? 'Saving…' : 'Register Whale Wallet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
