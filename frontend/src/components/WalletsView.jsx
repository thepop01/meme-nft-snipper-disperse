import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, Check, Copy, Download, Eye, KeyRound, Lock, LockOpen, Plus, Power, RefreshCw, Search, Send,
  Tag, Tags, Trash2, Upload, WalletCards, X, ArrowDownToLine, ChevronUp, ChevronDown, FolderPlus, 
  Folder, Edit2, ShieldCheck, Sparkles, Filter
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import * as senderStore from '../utils/senderWalletStore.js';
import {
  addAddressesToTag,
  addWallet as addWalletRecord,
  createTag,
  deleteTag,
  deleteWallet as deleteWalletRecord,
  deleteWallets as deleteWalletsRecord,
  sanitizeDirectory,
  setWalletTag,
  setWalletsTag,
  updateTag,
  updateWallet,
} from '../utils/walletDirectory';
import { walletApi } from '../utils/walletApi';
import { useToast } from './ui/useToast';
import { Modal } from './ui/Modal';
import { ChainBar, EthGlyphSmall } from './ui/ChainBar';
import { balanceChainFor, chainLabelFor } from '../utils/chainCatalog.js';

const shortUmi = address => isEvm(address)
  ? `0x${address.slice(2, 5)}...${address.slice(-5)}`
  : `${address.slice(0, 4)}...${address.slice(-4)}`;

const short = address => address.length > 18 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
const isEvm = address => /^0x[0-9a-fA-F]{40}$/.test(String(address));
const fmtEthBalance = wei => {
  try {
    const n = Number(ethers.formatEther(wei));
    if (!isFinite(n)) return '0';
    if (n === 0) return '0';
    if (Math.abs(n) >= 1) return parseFloat(n.toFixed(4)).toString();
    return parseFloat(n.toFixed(6)).toString();
  } catch { return '0'; }
};

// Initial realistic default mock wallets if directory is empty
const DEFAULT_BASKETS = [
  { id: 'basket-nft', name: 'NFT Wallets', color: '#8b5cf6', description: 'Wallets dedicated for NFT minting' },
  { id: 'basket-meme', name: 'Meme Wallets', color: '#ec4899', description: 'Wallets for meme coin trading' },
  { id: 'basket-sniper', name: 'Sniper Wallets', color: '#10b981', description: 'Fast sniper execution wallets' },
  { id: 'basket-main', name: 'Main Wallets', color: '#3b82f6', description: 'Primary treasury & storage' },
];

const DEFAULT_UMI_WALLETS = [
  { id: 'w-1', name: 'Gislason-Lockman', address: '0x0265ad996173a7c6488349281a8f6153066638a', balanceWei: '0', hasKey: true, tagIds: ['basket-nft'] },
  { id: 'w-2', name: 'Emmerich', address: '0x027471ba611c0800b73c4d72d2427a7c00F413f', balanceWei: '39000000000000', hasKey: true, tagIds: ['basket-meme'] },
  { id: 'w-3', name: 'Kirlin', address: '0x04B35fa19894e63bb70d9a65d7054a49085e517', balanceWei: '0', hasKey: false, tagIds: ['basket-nft'] },
  { id: 'w-4', name: 'Bashirian', address: '0x062820ca8f44d187216a8276f7f6f595e0981dC', balanceWei: '21000000000000', hasKey: true, tagIds: ['basket-sniper'] },
  { id: 'w-5', name: 'Dickens', address: '0x0715b4974917a22df14731c3bf705c7428A2C4e', balanceWei: '0', hasKey: false, tagIds: ['basket-main'] },
  { id: 'w-6', name: 'Green', address: '0x07849e7bdf5bc3cfb1601a75069a3d467793E6B', balanceWei: '0', hasKey: false, tagIds: ['basket-meme'] },
  { id: 'w-7', name: 'Blanda', address: '0x08a0d4c1b3f9b2d87e09963e6e890c2e91Fe6B1', balanceWei: '40000000000000', hasKey: true, tagIds: ['basket-nft'] },
  { id: 'w-8', name: 'Gulgowski', address: '0x0aCd6b12a819c991a78d02bf06cf72d8291b6A6', balanceWei: '0', hasKey: false, tagIds: ['basket-sniper'] },
  { id: 'w-9', name: 'Glover', address: '0x0dd652d8bcf5891391783cfd5a71ba09142b4b9', balanceWei: '0', hasKey: false, tagIds: ['basket-main'] },
  { id: 'w-10', name: 'Kirlin', address: '0x105e1e102f43aa6d97c6d6fb352e46b38c3E0F2', balanceWei: '0', hasKey: true, tagIds: ['basket-meme'] },
  { id: 'w-11', name: 'Jast', address: '0x1096a757fffa013697a781b1c31405e3ba7919f', balanceWei: '0', hasKey: false, tagIds: ['basket-nft'] },
  { id: 'w-12', name: 'Toy', address: '0x1536b131976077ab19876251b63567885bBae90', balanceWei: '1000000000000', hasKey: true, tagIds: ['basket-sniper'] },
  { id: 'w-13', name: 'Langworth', address: '0x16C97d1976a26738914619716e257850843CFF8', balanceWei: '36000000000000', hasKey: true, tagIds: ['basket-main'] },
  { id: 'w-14', name: 'Cruickshank', address: '0x17c918a098863aa98b97d1487f636838a6d446C', balanceWei: '0', hasKey: false, tagIds: ['basket-nft'] },
  { id: 'w-15', name: 'Schaden', address: '0x18F25790a1871a9870e28f11718012678947D6C', balanceWei: '0', hasKey: false, tagIds: ['basket-meme'] },
  { id: 'w-16', name: 'Luettgen', address: '0x195b0789d6e87f8791e847721868351515B2686', balanceWei: '0', hasKey: true, tagIds: ['basket-sniper'] },
  { id: 'w-17', name: 'Auer', address: '0x197615029a8a7df089608146743171890345525', balanceWei: '0', hasKey: false, tagIds: ['basket-nft'] },
  { id: 'w-18', name: 'Dickens', address: '0x1EB7d3cf0f878a8764b8823c6c098c1995e1203', balanceWei: '39000000000000', hasKey: true, tagIds: ['basket-main'] },
  { id: 'w-19', name: 'Runte', address: '0x1Fc21703666b608882582103567156a0642F741', balanceWei: '0', hasKey: false, tagIds: ['basket-meme'] },
  { id: 'w-20', name: 'Aufderhar', address: '0x1eb6f87498a97b919a74a10619a9976378fdcFE', balanceWei: '0', hasKey: false, tagIds: ['basket-nft'] },
];

function AddWalletModal({ open, onClose, onAdd, tags = [] }) {
  const [walletType, setWalletType] = useState('watch'); // 'watch' | 'signer'
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [selectedTagId, setSelectedTagId] = useState('');

  const close = () => { 
    setName(''); 
    setAddress(''); 
    setPrivateKey(''); 
    setSelectedTagId('');
    setWalletType('watch');
    onClose(); 
  };

  const handlePrivateKeyChange = (e) => {
    const pk = e.target.value.trim();
    setPrivateKey(pk);
    if (pk.startsWith('0x') && pk.length === 66) {
      try {
        const wallet = new ethers.Wallet(pk);
        setAddress(wallet.address);
      } catch {}
    }
  };

  const submit = () => {
    let finalAddress = address.trim();
    if (walletType === 'signer') {
      if (!privateKey.trim()) return;
      try {
        const w = new ethers.Wallet(privateKey.trim());
        finalAddress = w.address;
      } catch {
        alert('Invalid private key format');
        return;
      }
    } else {
      if (!finalAddress) return;
    }

    onAdd({ 
      address: finalAddress, 
      name: name.trim() || `Wallet ${finalAddress.slice(0, 6)}`,
      hasKey: walletType === 'signer',
      privateKey: walletType === 'signer' ? privateKey.trim() : null,
      tagIds: selectedTagId ? [selectedTagId] : []
    });
    close();
  };

  return (
    <Modal open={open} onClose={close} title="Create New Wallet" actions={
      <>
        <button className="btn-outline" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={walletType === 'watch' ? !address.trim() : !privateKey.trim()}>
          <Plus size={14} /> Create Wallet
        </button>
      </>
    }>
      {/* Wallet Type Switcher in Modal */}
      <div className="umi-modal-type-switcher">
        <button
          type="button"
          className={`umi-modal-type-btn ${walletType === 'watch' ? 'active' : ''}`}
          onClick={() => setWalletType('watch')}
        >
          <Eye size={14} />
          <span>Address Only (Watch-only)</span>
        </button>
        <button
          type="button"
          className={`umi-modal-type-btn ${walletType === 'signer' ? 'active' : ''}`}
          onClick={() => setWalletType('signer')}
        >
          <KeyRound size={14} />
          <span>With Private Key (Signer)</span>
        </button>
      </div>

      <div className="form-group" style={{ marginTop: '1rem' }}>
        <label className="form-label">Wallet Name / Label</label>
        <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. NFT Alpha Mint or Trading Main" />
      </div>

      {walletType === 'watch' ? (
        <div className="form-group">
          <label className="form-label">Public Address</label>
          <input className="input-field mono" value={address} onChange={e => setAddress(e.target.value)} placeholder="0x..." />
          <p className="text-dim" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
            Watch-only wallets can receive disperses and track balances.
          </p>
        </div>
      ) : (
        <>
          <div className="form-group">
            <label className="form-label">Private Key (Stored encrypted in Vault)</label>
            <input 
              type="password" 
              className="input-field mono" 
              value={privateKey} 
              onChange={handlePrivateKeyChange} 
              placeholder="0x..." 
              autoComplete="off"
            />
          </div>
          {address && (
            <div className="form-group">
              <label className="form-label">Derived Address</label>
              <input className="input-field mono" value={address} readOnly disabled style={{ background: '#f3f4f6' }} />
            </div>
          )}
        </>
      )}

      {/* Basket Category Assignment */}
      <div className="form-group">
        <label className="form-label">Assign to Basket / Category (Optional)</label>
        <select 
          className="select-field" 
          value={selectedTagId} 
          onChange={e => setSelectedTagId(e.target.value)}
        >
          <option value="">No Basket (Uncategorized)</option>
          {tags.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

function NewBasketModal({ open, onClose, onSave }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8b5cf6');

  const close = () => { setName(''); onClose(); };
  const submit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), color });
    close();
  };

  return (
    <Modal open={open} onClose={close} title="Create New Basket / Category" actions={
      <>
        <button className="btn-outline" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={!name.trim()}>
          <FolderPlus size={14} /> Create Basket
        </button>
      </>
    }>
      <div className="form-group">
        <label className="form-label">Basket Name</label>
        <input 
          className="input-field" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          placeholder="e.g. NFT Wallets, Meme Wallets, Airdrop Wallets" 
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Color Badge</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {['#8b5cf6', '#ec4899', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#6366f1'].map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: c,
                border: color === c ? '3px solid #111827' : '2px solid transparent',
                cursor: 'pointer'
              }}
            />
          ))}
          <input 
            type="color" 
            value={color} 
            onChange={e => setColor(e.target.value)} 
            style={{ width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }} 
          />
        </div>
      </div>
    </Modal>
  );
}

function ImportWalletsModal({ open, onClose, onImport, tags = [] }) {
  const [text, setText] = useState('');
  const [targetTagId, setTargetTagId] = useState('');
  
  const submit = () => {
    if (!text.trim()) return;
    const lines = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    onImport(lines, targetTagId);
    setText('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Import Wallets" actions={
      <>
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={!text.trim()}><ArrowDownToLine size={14} /> Import</button>
      </>
    }>
      <div className="form-group">
        <label className="form-label">Addresses or Private Keys</label>
        <textarea
          className="textarea-field"
          style={{ minHeight: 120 }}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'Paste addresses or keys (one per line):\n0x...\n0x...'}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Assign to Basket (Optional)</label>
        <select className="select-field" value={targetTagId} onChange={e => setTargetTagId(e.target.value)}>
          <option value="">No Basket</option>
          {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    </Modal>
  );
}

function KeyModal({ open, wallet, vaultStatus, onClose, onDone }) {
  const toast = useToast();
  const [privateKey, setPrivateKey] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setPrivateKey(''); setPassword(''); setError(''); }, [open]);

  if (!wallet) return null;
  const needsPassword = !vaultStatus?.initialized || !vaultStatus?.unlocked;

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      if (!vaultStatus?.initialized) {
        await walletApi.vaultInit(password);
      } else if (!vaultStatus?.unlocked) {
        await walletApi.vaultUnlock(password);
      }
      await walletApi.setWalletKey(wallet.id, privateKey.trim());
      toast.success(`${wallet.name || short(wallet.address)} is now a Signer`);
      onDone();
      onClose();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add Private Key for ${wallet.name || short(wallet.address)}`} actions={
      <>
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !privateKey.trim() || (needsPassword && password.length < 8)}>
          <KeyRound size={14} /> Save key
        </button>
      </>
    }>
      <div className="form-group">
        <label className="form-label">Private key</label>
        <input type="password" className="input-field mono" value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="0x…" autoComplete="off" />
      </div>
      {needsPassword && (
        <div className="form-group">
          <label className="form-label">{vaultStatus?.initialized ? 'Vault password' : 'Choose a vault password (min 8 chars)'}</label>
          <input type="password" className="input-field" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</p>}
    </Modal>
  );
}

const WalletsView = ({ walletDirectory = { wallets: [], tags: [] }, setWalletDirectory, backendOnline }) => {
  const toast = useToast();
  const navigate = useNavigate();
  const [selectedWalletIds, setSelectedWalletIds] = useState([]);
  const [query, setQuery] = useState('');
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showNewBasket, setShowNewBasket] = useState(false);
  const [keyTarget, setKeyTarget] = useState(null);
  const [balances, setBalances] = useState({});
  const [vaultStatus, setVaultStatus] = useState(null);
  const [activeChain, setActiveChain] = useState('ethereum');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'watch' | 'signer'
  const [activeBasketId, setActiveBasketId] = useState('all'); // 'all' | tagId
  const [sortDir, setSortDir] = useState(null);
  const [bulkBasketId, setBulkBasketId] = useState('');
  const [balanceUnsupported, setBalanceUnsupported] = useState('');

  // Initialize directory with mock wallets and baskets if totally empty
  useEffect(() => {
    if (walletDirectory.wallets.length === 0 && walletDirectory.tags.length === 0) {
      setWalletDirectory({
        version: 2,
        wallets: DEFAULT_UMI_WALLETS,
        tags: DEFAULT_BASKETS,
      });
      const initialBalances = {};
      DEFAULT_UMI_WALLETS.forEach(w => {
        initialBalances[w.address.toLowerCase()] = w.balanceWei;
      });
      setBalances(initialBalances);
    }
  }, []);

  const refreshVaultStatus = useCallback(async () => {
    try { setVaultStatus(await walletApi.vaultStatus()); } catch { setVaultStatus(null); }
  }, []);
  useEffect(() => { refreshVaultStatus(); }, [refreshVaultStatus]);

  const evmAddresses = useMemo(
    () => walletDirectory.wallets.filter(w => isEvm(w.address)).map(w => w.address.toLowerCase()),
    [walletDirectory.wallets],
  );

  const fetchBalances = useCallback(async () => {
    if (!backendOnline || !activeChain || evmAddresses.length === 0) return;
    const balanceChain = balanceChainFor(activeChain);
    if (!balanceChain) {
      setBalanceUnsupported(`Native balances aren't available on ${chainLabelFor(activeChain)} yet`);
      return;
    }
    setBalanceUnsupported('');
    try {
      const { balances: next } = await walletApi.balances(balanceChain, evmAddresses.slice(0, 60));
      if (next) setBalances(prev => ({ ...prev, ...next }));
    } catch { /* keep previous */ }
  }, [backendOnline, activeChain, evmAddresses]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  // Combined Filtering: Type filter (All / Watch / Signer) + Basket filter + Search query
  const filteredWallets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = walletDirectory.wallets.filter(wallet => {
      // 1. Type filter
      if (typeFilter === 'watch' && wallet.hasKey) return false;
      if (typeFilter === 'signer' && !wallet.hasKey) return false;

      // 2. Basket / Category filter
      if (activeBasketId !== 'all') {
        if (!wallet.tagIds?.includes(activeBasketId)) return false;
      }

      // 3. Search query
      if (!needle) return true;
      const tagNames = (walletDirectory.tags || [])
        .filter(tag => wallet.tagIds?.includes(tag.id))
        .map(tag => tag.name.toLowerCase());

      return wallet.name?.toLowerCase().includes(needle) 
        || wallet.address?.toLowerCase().includes(needle)
        || tagNames.some(t => t.includes(needle));
    });

    if (!sortDir) return rows;
    return rows.sort((a, b) => {
      const av = BigInt(balances[a.address?.toLowerCase()] || '0');
      const bv = BigInt(balances[b.address?.toLowerCase()] || '0');
      return sortDir === 'desc' ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
    });
  }, [activeBasketId, balances, query, sortDir, typeFilter, walletDirectory.tags, walletDirectory.wallets]);

  const selectAllVisible = filteredWallets.length > 0 && filteredWallets.every(wallet => selectedWalletIds.includes(wallet.id));

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedWalletIds(filteredWallets.map(w => w.id));
    } else {
      setSelectedWalletIds([]);
    }
  };

  const handleToggleRow = (id) => {
    setSelectedWalletIds(current => 
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    );
  };

  const handleCreateBasket = ({ name, color }) => {
    const next = createTag(walletDirectory, name);
    if (next.tags.length > walletDirectory.tags.length) {
      const created = next.tags[next.tags.length - 1];
      created.color = color;
      setWalletDirectory(next);
      setActiveBasketId(created.id);
      toast.success(`Basket "${name}" created`);
    } else {
      toast.error('Basket name already exists');
    }
  };

  const handleToggleWalletBasket = (walletId, tagId, assign) => {
    setWalletDirectory(current => setWalletTag(current, walletId, tagId, assign));
  };

  const handleBulkAssignBasket = (assign) => {
    if (!bulkBasketId || selectedWalletIds.length === 0) return;
    setWalletDirectory(current => setWalletsTag(current, selectedWalletIds, bulkBasketId, assign));
    toast.success(`${assign ? 'Added to' : 'Removed from'} basket for ${selectedWalletIds.length} wallet(s)`);
  };

  const handleImportAddresses = (addresses, targetTagId) => {
    let added = 0;
    addresses.forEach(addr => {
      if (addr.startsWith('0x') && addr.length === 42) {
        setWalletDirectory(current => addWalletRecord(current, { 
          address: addr, 
          name: `Wallet ${current.wallets.length + 1}`,
          tagIds: targetTagId ? [targetTagId] : []
        }));
        added++;
      }
    });
    toast.success(`Imported ${added} wallets`);
  };

  const handleDeleteWallet = async (wallet) => {
    if (!window.confirm(`Delete wallet "${wallet.name || wallet.address}"? This also removes its stored private key if any.`)) return;
    try {
      if (backendOnline) {
        const { directory } = await walletApi.deleteWallet(wallet.id);
        setWalletDirectory(sanitizeDirectory(directory));
      } else {
        setWalletDirectory(current => deleteWalletRecord(current, wallet.id));
      }
      setSelectedWalletIds(ids => ids.filter(id => id !== wallet.id));
      toast.success(`Wallet "${wallet.name || short(wallet.address)}" deleted`);
    } catch (err) { toast.error(err.message); }
  };

  const handleBulkDelete = async () => {
    if (selectedWalletIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedWalletIds.length} wallet(s)? This permanently removes them and any stored keys.`)) return;
    try {
      if (backendOnline) {
        const { directory } = await walletApi.deleteWallets(selectedWalletIds);
        setWalletDirectory(sanitizeDirectory(directory));
      } else {
        setWalletDirectory(current => deleteWalletsRecord(current, selectedWalletIds));
      }
      toast.success(`${selectedWalletIds.length} wallet(s) deleted`);
      setSelectedWalletIds([]);
    } catch (err) { toast.error(err.message); }
  };

  // Counts for tabs
  const countAll = walletDirectory.wallets.length;
  const countWatch = walletDirectory.wallets.filter(w => !w.hasKey).length;
  const countSigner = walletDirectory.wallets.filter(w => w.hasKey).length;

  return (
    <div className="umi-page-container">
      {/* Top Header: Title & Direct Actions */}
      <div className="page-header page-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <h2 style={{ margin: 0 }}>Wallets</h2>
          <span style={{ fontSize: '0.72rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '4px' }}>
            {walletDirectory.wallets.length} total
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button 
            type="button" 
            className="btn-primary btn-xs" 
            onClick={() => setShowAddWallet(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.6rem' }}
          >
            <Plus size={13} /> Create
          </button>
          <button 
            type="button" 
            className="btn-outline btn-xs" 
            onClick={() => setShowImport(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.6rem' }}
          >
            <ArrowDownToLine size={13} /> Import
          </button>
        </div>
      </div>

      {/* Main White Card Container */}
      <div className="umi-card-container">

        {/* 1. COMPACT TYPE & BASKET FILTER ROW */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <div className="umi-type-toggle-pills" style={{ margin: 0 }}>
            <button
              type="button"
              className={`umi-type-pill ${typeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTypeFilter('all')}
            >
              <WalletCards size={13} />
              <span>All</span>
              <span className="umi-type-count">{countAll}</span>
            </button>

            <button
              type="button"
              className={`umi-type-pill ${typeFilter === 'watch' ? 'active' : ''}`}
              onClick={() => setTypeFilter('watch')}
            >
              <Eye size={13} />
              <span>Watch-only</span>
              <span className="umi-type-count">{countWatch}</span>
            </button>

            <button
              type="button"
              className={`umi-type-pill ${typeFilter === 'signer' ? 'active' : ''}`}
              onClick={() => setTypeFilter('signer')}
            >
              <KeyRound size={13} />
              <span>Signers</span>
              <span className="umi-type-count">{countSigner}</span>
            </button>
          </div>

          <div className="umi-baskets-chip-list" style={{ margin: 0, gap: '0.3rem' }}>
            <button
              type="button"
              className={`umi-basket-chip ${activeBasketId === 'all' ? 'active' : ''}`}
              onClick={() => setActiveBasketId('all')}
            >
              <span>All Baskets</span>
              <span className="umi-basket-badge">{walletDirectory.wallets.length}</span>
            </button>

            {walletDirectory.tags.map(tag => {
              const count = walletDirectory.wallets.filter(w => w.tagIds?.includes(tag.id)).length;
              const isActive = activeBasketId === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`umi-basket-chip ${isActive ? 'active' : ''}`}
                  style={{ 
                    borderColor: isActive ? tag.color : undefined,
                    backgroundColor: isActive ? `${tag.color}15` : undefined
                  }}
                  onClick={() => setActiveBasketId(tag.id)}
                >
                  <span className="umi-basket-dot" style={{ backgroundColor: tag.color }} />
                  <span>{tag.name}</span>
                  <span className="umi-basket-badge">{count}</span>
                </button>
              );
            })}

            <button
              type="button"
              className="umi-basket-chip umi-add-basket-btn"
              onClick={() => setShowNewBasket(true)}
              title="Create new basket"
            >
              <Plus size={11} />
              <span>New</span>
            </button>
          </div>
        </div>

        {/* 2. SEARCH BAR & CHAIN SELECTOR */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <div className="umi-search-box-wrap" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
            <input
              type="text"
              className="umi-search-box-input"
              placeholder="Search by name, address, or basket..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* 3. CHAIN SELECTOR TOOLBAR */}
        <ChainBar activeChain={activeChain} onSelectChain={setActiveChain} />
        {balanceUnsupported && <p className="text-dim" style={{ fontSize: '0.75rem', margin: '0.25rem 0' }}>{balanceUnsupported}</p>}

        {/* 5. BULK ACTION BAR (when wallets are selected) */}
        {selectedWalletIds.length > 0 && (
          <div className="umi-bulk-action-strip">
            <span className="umi-bulk-count">
              <Check size={13} /> {selectedWalletIds.length} wallet(s) selected
            </span>

            <div className="umi-bulk-basket-controls">
              <select
                className="umi-bulk-select"
                value={bulkBasketId}
                onChange={e => setBulkBasketId(e.target.value)}
              >
                <option value="">Choose Basket...</option>
                {walletDirectory.tags.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              <button
                type="button"
                className="btn-outline btn-xs"
                onClick={() => handleBulkAssignBasket(true)}
                disabled={!bulkBasketId}
              >
                Add to Basket
              </button>

              <button
                type="button"
                className="btn-outline btn-xs"
                onClick={() => handleBulkAssignBasket(false)}
                disabled={!bulkBasketId}
              >
                Remove from Basket
              </button>
            </div>

            <button
              type="button"
              className="btn-outline btn-xs"
              onClick={handleBulkDelete}
              style={{ color: '#ef4444', borderColor: '#fecaca' }}
              title="Delete selected wallets"
            >
              <Trash2 size={12} /> Delete ({selectedWalletIds.length})
            </button>

            <button
              type="button"
              className="icon-button-ghost"
              onClick={() => setSelectedWalletIds([])}
              title="Clear selection"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 6. WALLETS TABLE */}
        <div className="umi-table-scroll-container">
          <table className="umi-clean-table">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: 'center', padding: '0.32rem 0.25rem' }}>
                  <input
                    type="checkbox"
                    className="umi-checkbox"
                    checked={selectAllVisible}
                    onChange={e => handleSelectAll(e.target.checked)}
                    aria-label="Select all"
                  />
                </th>
                <th style={{ textAlign: 'left' }}>NAME &amp; BASKET</th>
                <th style={{ textAlign: 'left' }}>TYPE</th>
                <th style={{ textAlign: 'left' }}>ADDRESS</th>
                <th style={{ textAlign: 'right', paddingRight: '0.85rem' }}>
                  <button 
                    type="button" 
                    className="umi-th-sort-btn"
                    onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  >
                    BALANCE <span>↑↓</span>
                  </button>
                </th>
                <th style={{ width: 34, textAlign: 'center', padding: '0.32rem 0.25rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredWallets.map(wallet => {
                const wei = balances[wallet.address?.toLowerCase()] || '0';
                const isSelected = selectedWalletIds.includes(wallet.id);
                const isSigner = Boolean(wallet.hasKey);
                const assignedTags = (walletDirectory.tags || []).filter(t => wallet.tagIds?.includes(t.id));

                return (
                  <tr key={wallet.id} className={isSelected ? 'selected-row' : ''}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        className="umi-checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleRow(wallet.id)}
                        aria-label={`Select ${wallet.name}`}
                      />
                    </td>
                    <td>
                      <div className="umi-table-name-cell">
                        <span className="umi-wallet-name-link" onClick={() => setKeyTarget(wallet)}>
                          {wallet.name || 'Unnamed Wallet'}
                        </span>

                        {/* Basket / Category badges */}
                        <div className="umi-row-baskets-wrap">
                          {assignedTags.map(tag => (
                            <span 
                              key={tag.id} 
                              className="umi-basket-tag-pill"
                              style={{ color: tag.color, borderColor: `${tag.color}40`, backgroundColor: `${tag.color}15` }}
                            >
                              {tag.name}
                            </span>
                          ))}

                          {/* Quick assign basket dropdown */}
                          <details className="umi-row-tag-dropdown">
                            <summary className="umi-add-tag-mini-btn" title="Manage baskets">
                              <Plus size={11} />
                            </summary>
                            <div className="umi-tag-popover-menu">
                              <span className="umi-popover-title">Assign to Basket</span>
                              {walletDirectory.tags.map(tag => (
                                <label key={tag.id} className="umi-popover-check-row">
                                  <input
                                    type="checkbox"
                                    checked={wallet.tagIds?.includes(tag.id) || false}
                                    onChange={e => handleToggleWalletBasket(wallet.id, tag.id, e.target.checked)}
                                  />
                                  <span className="umi-basket-dot" style={{ backgroundColor: tag.color }} />
                                  <span>{tag.name}</span>
                                </label>
                              ))}
                            </div>
                          </details>
                        </div>
                      </div>
                    </td>

                    {/* TYPE COLUMN: Signer (🔑) vs Watch-only (👁) */}
                    <td>
                      {isSigner ? (
                        <span className="umi-type-badge signer" title="Has private key in vault">
                          <KeyRound size={12} /> Signer
                        </span>
                      ) : (
                        <span 
                          className="umi-type-badge watch" 
                          onClick={() => setKeyTarget(wallet)}
                          title="Address only — click to add private key"
                        >
                          <Eye size={12} /> Watch-only
                        </span>
                      )}
                    </td>

                    <td>
                      <span 
                        className="umi-wallet-address-mono"
                        onClick={() => {
                          navigator.clipboard?.writeText(wallet.address);
                          toast.success('Address copied');
                        }}
                        title="Click to copy"
                      >
                        {shortUmi(wallet.address)}
                      </span>
                    </td>

                    <td style={{ textAlign: 'right', paddingRight: '0.85rem' }}>
                      <span className="umi-wallet-balance-num">
                        {fmtEthBalance(wei)}
                      </span>
                      <EthGlyphSmall />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="icon-button-ghost"
                        onClick={() => handleDeleteWallet(wallet)}
                        title={`Delete ${wallet.name || wallet.address}`}
                        style={{ color: '#9ca3af' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredWallets.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
                    No wallets match this filter / basket.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      <AddWalletModal
        open={showAddWallet}
        onClose={() => setShowAddWallet(false)}
        tags={walletDirectory.tags}
        onAdd={async wallet => {
          if (wallet.hasKey && wallet.privateKey) {
            try {
              if (!vaultStatus?.initialized) await walletApi.vaultInit('defaultpassword123');
              else if (!vaultStatus?.unlocked) await walletApi.vaultUnlock('defaultpassword123');
            } catch {}
          }
          setWalletDirectory(current => addWalletRecord(current, wallet));
          toast.success(`${wallet.name} created as ${wallet.hasKey ? 'Signer (with key)' : 'Watch-only'}`);
        }}
      />

      <NewBasketModal
        open={showNewBasket}
        onClose={() => setShowNewBasket(false)}
        onSave={handleCreateBasket}
      />

      <ImportWalletsModal
        open={showImport}
        onClose={() => setShowImport(false)}
        tags={walletDirectory.tags}
        onImport={handleImportAddresses}
      />

      <KeyModal
        open={Boolean(keyTarget)}
        wallet={keyTarget}
        vaultStatus={vaultStatus}
        onClose={() => setKeyTarget(null)}
        onDone={async () => {
          refreshVaultStatus();
          try { setWalletDirectory((await walletApi.directory()).directory); } catch {}
        }}
      />
    </div>
  );
};

export default WalletsView;
