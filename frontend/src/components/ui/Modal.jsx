import React from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, wide = false, actions = null }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-box ${wide ? 'wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="modal-title">{title}</div>
          <button className="icon-btn-danger" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      actions={
        <>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            style={danger ? { background: 'var(--danger)', boxShadow: 'none' } : undefined}
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{message}</p>
    </Modal>
  );
}
