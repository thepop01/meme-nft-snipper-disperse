import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Lock, Unlock, KeyRound, Download, RefreshCw } from 'lucide-react';
import * as store from '../utils/senderWalletStore.js';
import { parseKeyList, generateWallets } from '../utils/keys.js';
import { CHAINS } from '../utils/chains.js';
import { fetchNativeBalances } from '../utils/balances.js';

const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const SenderWalletsTab = () => {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [keysText, setKeysText] = useState('');
  const [importErrors, setImportErrors] = useState([]);
  const [genCount, setGenCount] = useState(3);
  const [genFamily, setGenFamily] = useState('evm');
  const [busy, setBusy] = useState(false);
  const [balanceChain, setBalanceChain] = useState('eth');
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  useEffect(() => store.onChange(rerender), [rerender]);

  const wallets = store.listWallets();
  const hasProfile = store.hasProfile();
  const unlocked = store.isUnlocked();

  const handleCreateProfile = async () => {
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await store.createProfile(password);
      setPassword(''); setConfirm('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleUnlock = async () => {
    setError(''); setBusy(true);
    try {
      await store.unlock(password);
      setPassword('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleImport = async () => {
    setError(''); setImportErrors([]);
    const { wallets: parsed, errors } = parseKeyList(keysText);
    setImportErrors(errors);
    if (parsed.length === 0) return;
    setBusy(true);
    try {
      await store.addWallets(parsed);
      setKeysText('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleGenerate = async () => {
    setError(''); setBusy(true);
    try {
      const fresh = generateWallets(genFamily, Math.max(1, Math.min(50, Number(genCount) || 1)));
      const added = await store.addWallets(fresh);
      const byAddress = new Map(fresh.map(w => [w.address, w]));
      const rows = added.map(a => ({ ...byAddress.get(a.address), label: a.label }));
      const text = store.makeBackupText(rows);
      const blob = new Blob([text], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `tradeforge-wallets-${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleRefreshBalances = async () => {
    const family = CHAINS.find(c => c.id === balanceChain)?.family;
    const addrs = wallets.filter(w => w.chainFamily === family).map(w => w.address);
    setLoadingBalances(true);
    setBalances(await fetchNativeBalances(balanceChain, addrs));
    setLoadingBalances(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('Remove this wallet? Its key cannot be recovered without your backup.')) {
      store.removeWallet(id);
    }
  };

  if (!hasProfile) {
    return (
      <div className="empty-state" style={{ maxWidth: 420, margin: '3rem auto', textAlign: 'left' }}>
        <KeyRound size={40} color="var(--primary)" />
        <h3 style={{ margin: '1rem 0 0.25rem' }}>Create your wallet profile</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Private keys are encrypted with this password and stored only in this browser.
          There is no recovery — if you forget it, you must re-import your keys.
        </p>
        <div className="form-group">
          <input type="password" className="input-field" placeholder="Profile password (min 8 chars)"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="form-group">
          <input type="password" className="input-field" placeholder="Confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateProfile()} />
        </div>
        {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}
        <button className="btn-primary" onClick={handleCreateProfile} disabled={busy}>
          <KeyRound size={15} /> Create Profile
        </button>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="empty-state" style={{ maxWidth: 420, margin: '3rem auto', textAlign: 'left' }}>
        <Lock size={40} color="var(--text-dim)" />
        <h3 style={{ margin: '1rem 0 0.5rem' }}>Profile locked</h3>
        <div className="form-group">
          <input type="password" className="input-field" placeholder="Profile password"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()} />
        </div>
        {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}
        <button className="btn-primary" onClick={handleUnlock} disabled={busy}>
          <Unlock size={15} /> Unlock
        </button>
      </div>
    );
  }

  const family = CHAINS.find(c => c.id === balanceChain)?.family;
  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.2rem' }}>Sender Wallets</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {wallets.length} wallet{wallets.length !== 1 ? 's' : ''} · keys encrypted in this browser
          </p>
        </div>
        <button className="btn-outline" onClick={() => store.lock()}>
          <Lock size={14} /> Lock
        </button>
      </div>

      <div className="form-group" style={{ marginBottom: '1.5rem' }}>
        <label className="form-label">Import Private Keys (one per line — EVM hex or Solana base58)</label>
        <textarea className="textarea-field" style={{ minHeight: 90 }}
          placeholder={'0xabc123…\n5Kbase58…'}
          value={keysText} onChange={e => setKeysText(e.target.value)} />
        {importErrors.length > 0 && (
          <div style={{ color: 'var(--danger, #f87171)', fontSize: '0.8rem', marginTop: '0.4rem' }}>
            {importErrors.map(e => <div key={e.line}>Line {e.line}: {e.message}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-outline" onClick={handleImport} disabled={busy || !keysText.trim()}>
            <Plus size={14} /> Import
          </button>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="number" className="input-field" style={{ width: 70 }} min="1" max="50"
              value={genCount} onChange={e => setGenCount(e.target.value)} />
            <select className="select-field" style={{ width: 110 }}
              value={genFamily} onChange={e => setGenFamily(e.target.value)}>
              <option value="evm">EVM</option>
              <option value="sol">Solana</option>
            </select>
            <button className="btn-outline" onClick={handleGenerate} disabled={busy}>
              <Download size={14} /> Generate + Backup
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <label className="form-label" style={{ margin: 0 }}>Balances:</label>
        <select className="select-field" style={{ width: 140 }}
          value={balanceChain} onChange={e => setBalanceChain(e.target.value)}>
          {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn-outline" onClick={handleRefreshBalances} disabled={loadingBalances}>
          <RefreshCw size={14} className={loadingBalances ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}

      <div className="addresses-list">
        {wallets.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            No sender wallets yet. Import keys or generate fresh wallets above.
          </p>
        ) : wallets.map(w => (
          <div key={w.id} className="address-item">
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', minWidth: 0 }}>
              <span className="badge">{w.chainFamily === 'sol' ? 'SOL' : 'EVM'}</span>
              <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>{w.label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}
                title={w.address}>{short(w.address)}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              {w.chainFamily === family && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {balances[w.address] == null ? '—' : Number(balances[w.address]).toFixed(4)}
                </span>
              )}
              <button className="icon-btn-danger" onClick={() => handleDelete(w.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SenderWalletsTab;
