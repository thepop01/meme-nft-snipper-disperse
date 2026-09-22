import React, { useState } from 'react';
import {
  RefreshCw, Search, Award, Target, Crown, GitFork, Zap, ShieldAlert,
} from 'lucide-react';
import { getBackendUrl, authHeaders } from '../utils/sniperApi';
import { useToast } from './ui/useToast';
import Pagination from './ui/Pagination.jsx';
import { useWalletList } from './smartwallets/useWalletList.js';
import { SUBFILTERS, SubfilterBar } from './smartwallets/subfilters.js';
import { LineageModal, WhaleModal } from './smartwallets/WalletModals.jsx';
import { WalletTable } from './smartwallets/WalletTable.jsx';
import { TiersPanel } from './smartwallets/TiersPanel.jsx';

export default function SmartWalletsView({
  initialWallets = null,
  initialCategory = 'smart',
} = {}) {
  let toast = { success: () => {}, error: () => {}, info: () => {} };
  try { toast = useToast(); } catch {}

  const {
    listCategory,
    setListCategory,
    chainTab,
    setChainTab,
    trackedSubfilter,
    setTrackedSubfilter,
    scanSource,
    search,
    setSearch,
    consistentOnly,
    setConsistentOnly,
    page,
    setPage,
    pageSize,
    setPageSize,
    loading,
    scanning,
    error,
    wallets,
    totalFilteredCount,
    totalPages,
    totalSmartCount,
    totalTrackedCount,
    totalWhaleCount,
    totalLineageCount,
    totalSniperCount,
    solanaChainCount,
    robinhoodChainCount,
    fetchWallets,
    handleScan,
    handleDelete,
    handlePromote,
  } = useWalletList({ initialWallets, initialCategory });

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

  const copyToClipboard = (text) => {
    try {
      navigator.clipboard.writeText(text);
    } catch {}
    setCopiedAddr(text);
    setTimeout(() => setCopiedAddr(null), 2000);
    toast.success('Address copied to clipboard');
  };

  const handleLineageSubmit = async (e) => {
    e.preventDefault();
    if (!lineageForm.parentAddress.trim() || !lineageForm.childAddress.trim()) {
      toast.error('Parent and child addresses are required.');
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
          amount: lineageForm.amount ? Number(lineageForm.amount) : undefined,
          txHash: lineageForm.txHash.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to connect lineage wallet');
      }
      toast.success('Successfully linked Lineage Wallet!');
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

  return (
    <div className="meme-terminal-container">
      {/* Top Header: Title, Category Navigation & Actions */}
      <div className="page-header page-header-row meme-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Tracked &amp; Smart Wallets</h2>

          {/* 5 Category Tab Switcher + Rules */}
          <div className="strategy-tab-bar" style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {[
              { id: 'smart', icon: Award, label: '1. Smart Wallets', count: totalSmartCount },
              { id: 'tracked', icon: Target, label: '2. Tracked Wallets', count: totalTrackedCount, badgeBg: '#e0f2fe', badgeColor: '#0369a1' },
              { id: 'whale', icon: Crown, label: '3. Whale Wallets (>$5k)', count: totalWhaleCount, iconColor: '#eab308', badgeBg: '#fef9c3', badgeColor: '#854d0e' },
              { id: 'lineage', icon: GitFork, label: '4. Lineage Wallets', count: totalLineageCount, iconColor: '#8b5cf6', badgeBg: '#ede9fe', badgeColor: '#5b21b6' },
              { id: 'sniper', icon: Zap, label: '5. Snipers & Bundlers', count: totalSniperCount, iconColor: '#ef4444', badgeBg: '#fee2e2', badgeColor: '#b91c1c' },
              { id: 'tiers', label: 'Tier & Classification Rules' },
            ].map(tab => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`strategy-tab ${listCategory === tab.id ? 'active' : ''}`}
                  onClick={() => {
                    setListCategory(tab.id);
                    if (tab.id !== 'tiers') {
                      setTrackedSubfilter('all');
                      setPage(1);
                    }
                  }}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                >
                  {TabIcon && <TabIcon size={13} style={{ marginRight: '0.25rem', color: tab.iconColor }} />}
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className="strategy-tab-badge"
                      style={tab.badgeBg ? { background: tab.badgeBg, color: tab.badgeColor } : undefined}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-outline btn-xs"
            onClick={() => setShowWhaleModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
          >
            <Crown size={12} color="#eab308" /> Add Whale Wallet
          </button>
          <button
            type="button"
            className="btn-outline btn-xs"
            onClick={() => setShowLineageModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
          >
            <GitFork size={12} color="#6366f1" /> Connect Lineage Wallet
          </button>
          <button
            type="button"
            className="icon-button-ghost"
            onClick={fetchWallets}
            title="Refresh wallets"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Consolidated Filter & Search Toolbar */}
      {listCategory !== 'tiers' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Chain Selector */}
            <div style={{ display: 'inline-flex', background: '#f3f4f6', padding: '2px', borderRadius: '5px' }}>
              <button
                type="button"
                onClick={() => { setChainTab('solana'); setPage(1); }}
                style={{
                  border: 'none',
                  background: chainTab === 'solana' ? '#ffffff' : 'transparent',
                  color: chainTab === 'solana' ? '#111827' : '#6b7280',
                  padding: '0.22rem 0.55rem',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: chainTab === 'solana' ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: chainTab === 'solana' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                Solana ({solanaChainCount})
              </button>
              <button
                type="button"
                onClick={() => { setChainTab('robinhood'); setPage(1); }}
                style={{
                  border: 'none',
                  background: chainTab === 'robinhood' ? '#ffffff' : 'transparent',
                  color: chainTab === 'robinhood' ? '#111827' : '#6b7280',
                  padding: '0.22rem 0.55rem',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: chainTab === 'robinhood' ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: chainTab === 'robinhood' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                Robinhood / EVM ({robinhoodChainCount})
              </button>
            </div>

            {/* Subfilters Tailored by Category */}
            <SubfilterBar
              filters={SUBFILTERS[listCategory]}
              value={trackedSubfilter}
              onChange={(val) => { setTrackedSubfilter(val); setPage(1); }}
            />

            {/* Strict Qualification Checkbox */}
            {listCategory === 'smart' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: '#374151', cursor: 'pointer', background: consistentOnly ? '#ecfdf5' : '#f9fafb', padding: '0.2rem 0.45rem', borderRadius: '4px', border: consistentOnly ? '1px solid #a7f3d0' : '1px solid #e5e7eb', userSelect: 'none' }}>
                <input type="checkbox" checked={consistentOnly} onChange={e => { setConsistentOnly(e.target.checked); setPage(1); }} style={{ accentColor: '#059669' }} />
                <ShieldAlert size={12} color={consistentOnly ? '#059669' : '#6b7280'} />
                <span>Strict (≥5 trades &amp; &gt;$100)</span>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, justifyContent: 'flex-end', minWidth: '220px' }}>
            <span style={{ fontSize: '0.72rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
              Showing {wallets.length} of {totalFilteredCount} {listCategory} wallets on {chainTab === 'solana' ? 'Solana' : 'Robinhood'}
            </span>
            <div className="search-field" style={{ minWidth: '180px', maxWidth: '280px', padding: '0.2rem 0.5rem' }}>
              <Search size={13} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${chainTab === 'solana' ? 'Solana' : 'Robinhood'} address, tag...`}
                style={{ fontSize: '0.75rem' }}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '0.55rem 0.85rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#b91c1c', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
          <strong>Backend Notice:</strong> {error}
        </div>
      )}

      {/* TAB CONTENT */}
      {listCategory === 'tiers' ? (
        <TiersPanel />
      ) : (
        <div className="panel" style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <WalletTable
            wallets={wallets}
            listCategory={listCategory}
            chainTab={chainTab}
            copiedAddr={copiedAddr}
            onCopy={copyToClipboard}
            onPromote={handlePromote}
            onDelete={handleDelete}
            onConnectChild={openLineageWithParent}
            onScan={handleScan}
            scanning={scanning}
            scanSource={scanSource}
            onOpenWhaleModal={() => setShowWhaleModal(true)}
            onOpenLineageModal={() => setShowLineageModal(true)}
          />

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalFilteredCount}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={sz => {
              setPageSize(sz);
              setPage(1);
            }}
            pageSizeOptions={[25, 50, 100]}
          />
        </div>
      )}

      {/* Lineage Modal */}
      <LineageModal
        show={showLineageModal}
        onClose={() => setShowLineageModal(false)}
        form={lineageForm}
        setForm={setLineageForm}
        onSubmit={handleLineageSubmit}
        submitting={submittingLineage}
      />

      {/* Whale Modal */}
      <WhaleModal
        show={showWhaleModal}
        onClose={() => setShowWhaleModal(false)}
        form={whaleForm}
        setForm={setWhaleForm}
        onSubmit={handleWhaleSubmit}
        submitting={submittingWhale}
      />
    </div>
  );
}
