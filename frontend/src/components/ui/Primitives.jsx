import React from 'react';

export function StatCard({ label, value, sub, icon: Icon, tone, onClick }) {
  return (
    <div className="stat-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-card-head">
        <span>{label}</span>
        {Icon && <Icon size={15} />}
      </div>
      <div className={`stat-value ${tone || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Pill({ color = 'gray', children }) {
  return <span className={`pill ${color}`}>{children}</span>;
}

export function StatusDot({ on, pulse = false }) {
  return <span className={`dot ${on ? 'green' : 'gray'} ${pulse && on ? 'pulse' : ''}`} />;
}

export function ScoreBadge({ score }) {
  const cls = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
  return <span className={`score-badge ${cls}`}>{score}</span>;
}

export function Switch({ checked, onChange, title }) {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
    </label>
  );
}
