import React from 'react';
import { GitFork, Crown, X } from 'lucide-react';

export function LineageModal({
  show,
  onClose,
  form,
  setForm,
  onSubmit,
  submitting,
}) {
  if (!show) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '10px',
        width: '100%',
        maxWidth: '480px',
        padding: '1.5rem',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        position: 'relative',
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
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1.2rem' }}>
          Link a new child wallet funded by a known whale or smart wallet. Added to the <strong>Lineage Wallets</strong> table.
        </p>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
              Chain
            </label>
            <select
              value={form.chain}
              onChange={e => setForm({ ...form, chain: e.target.value })}
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
              placeholder={form.chain === 'solana' ? 'e.g. 6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX' : 'e.g. 0x742d35cc6634c0532925a3b844bc9e7595f0beb0'}
              value={form.parentAddress}
              onChange={e => setForm({ ...form, parentAddress: e.target.value })}
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
              placeholder={form.chain === 'solana' ? 'e.g. 71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t' : 'e.g. 0x9999b0cdd35d7f3b281ba02efc0d228486940515'}
              value={form.childAddress}
              onChange={e => setForm({ ...form, childAddress: e.target.value })}
              style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'monospace' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                Transfer Amount ({form.chain === 'solana' ? 'SOL' : 'ETH'})
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 10.5"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
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
                value={form.txHash}
                onChange={e => setForm({ ...form, txHash: e.target.value })}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.82rem', fontFamily: 'monospace' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary btn-sm"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Connect Lineage Wallet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WhaleModal({
  show,
  onClose,
  form,
  setForm,
  onSubmit,
  submitting,
}) {
  if (!show) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '10px',
        width: '100%',
        maxWidth: '480px',
        padding: '1.5rem',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        position: 'relative',
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
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1.2rem' }}>
          Register a high-capital wallet holding &gt;$5,000 in meme tokens or total balance &gt;$5,000 on Solana or Robinhood.
        </p>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
              Chain
            </label>
            <select
              value={form.chain}
              onChange={e => setForm({ ...form, chain: e.target.value })}
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
              placeholder={form.chain === 'solana' ? 'e.g. 71i5cxJ7yWWCQeoHpnr68yh65MGg66uutGdiVs6EGE7t' : 'e.g. 0x742d35cc6634c0532925a3b844bc9e7595f0beb0'}
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
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
                value={form.balanceUsd}
                onChange={e => setForm({ ...form, balanceUsd: e.target.value })}
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
                value={form.memeHoldingsUsd}
                onChange={e => setForm({ ...form, memeHoldingsUsd: e.target.value })}
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
              value={form.tagInput}
              onChange={e => setForm({ ...form, tagInput: e.target.value })}
              style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary btn-sm"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Register Whale Wallet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
