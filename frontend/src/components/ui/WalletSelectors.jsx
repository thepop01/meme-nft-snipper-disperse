import React from 'react';
import { Check, Tags, WalletCards, X } from 'lucide-react';

export function WalletTagSelector({ tags = [], selectedIds = [], onChange, label = 'Wallet tags' }) {
  const toggle = id => onChange(selectedIds.includes(id)
    ? selectedIds.filter(value => value !== id)
    : [...selectedIds, id]);
  return (
    <div className="shared-wallet-selector">
      <label className="form-label"><Tags size={13} /> {label}</label>
      <div className="selector-chip-list">
        {tags.map(tag => (
          <button
            type="button"
            key={tag.id}
            className={`selector-chip ${selectedIds.includes(tag.id) ? 'active' : ''}`}
            onClick={() => toggle(tag.id)}
            aria-pressed={selectedIds.includes(tag.id)}
          >
            <span className="wallet-tag-dot" style={{ background: tag.color }} />
            {tag.name}
            {selectedIds.includes(tag.id) && <Check size={11} />}
          </button>
        ))}
        {tags.length === 0 && <span className="text-dim">No reusable tags yet</span>}
      </div>
    </div>
  );
}

export function WalletSelector({ wallets = [], selectedIds = [], onChange, label = 'Individual wallets' }) {
  const toggle = id => onChange(selectedIds.includes(id)
    ? selectedIds.filter(value => value !== id)
    : [...selectedIds, id]);
  return (
    <details className="shared-wallet-selector wallet-selector-details">
      <summary className="form-label"><WalletCards size={13} /> {label} ({selectedIds.length})</summary>
      <div className="selector-wallet-grid">
        {wallets.map(wallet => (
          <label key={wallet.id} className="tag-check-row">
            <input type="checkbox" checked={selectedIds.includes(wallet.id)} onChange={() => toggle(wallet.id)} />
            <span>{wallet.name}</span>
            <small className="mono">{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</small>
          </label>
        ))}
      </div>
    </details>
  );
}

export function ResolvedWalletPreview({ wallets = [], tags = [], onExclude, title = 'Resolved wallets' }) {
  const tagsById = new Map(tags.map(tag => [tag.id, tag]));
  return (
    <div className="resolved-wallet-preview">
      <div className="resolved-wallet-heading"><strong>{title}</strong><span>{wallets.length} unique</span></div>
      {wallets.map(wallet => (
        <div key={wallet.id || wallet.address} className="resolved-wallet-row">
          <span className="mono">{wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</span>
          <span className="resolved-wallet-sources">
            {(wallet.sourceTagIds || wallet.tagIds || []).map(id => tagsById.get(id)).filter(Boolean)
              .map(tag => <span key={tag.id} className="wallet-tag" style={{ '--tag-color': tag.color }}>{tag.name}</span>)}
          </span>
          {onExclude && <button type="button" className="icon-button-ghost" onClick={() => onExclude(wallet.address)} title="Exclude recipient"><X size={12} /></button>}
        </div>
      ))}
      {wallets.length === 0 && <span className="text-dim">Select tags or wallets to preview the exact set.</span>}
    </div>
  );
}
