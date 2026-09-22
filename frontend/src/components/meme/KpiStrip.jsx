import React from 'react';

export function computeKpis(tokens) {
  const hourAgo = Date.now() - 60 * 60_000;
  return {
    newLaunches1h: tokens.filter(t => t.createdAt && t.createdAt > hourAgo).length,
    active5m: tokens.filter(t => (t.volume5mUsd ?? 0) > 0).length,
    curated: tokens.filter(t => t.state === 'curated').length,
    total: tokens.length,
  };
}

export function computeTradeStats(positions = [], trades = []) {
  const open = positions.filter(p => p.status === 'open');
  const unrealized = open.reduce((sum, p) => sum + Number(p.pnlSol || 0), 0);
  const closed = trades.filter(t => t.pnlSol != null);
  const realized = closed.reduce((sum, t) => sum + Number(t.pnlSol || 0), 0);
  const wins = closed.filter(t => Number(t.pnlSol) > 0).length;
  return {
    openCount: open.length,
    totalPnlSol: unrealized + realized,
    winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0,
    wins,
    closedCount: closed.length,
  };
}

export default function KpiStrip({ tokens = [], positions = [], trades = [] }) {
  const kpis = computeKpis(tokens);
  const stats = computeTradeStats(positions, trades);
  return (
    <div className="kpi-strip" data-testid="kpi-strip">
      <div className="kpi-card">
        <span>Total P&amp;L</span>
        <strong className={stats.totalPnlSol >= 0 ? 'text-green' : 'text-red'}>
          {stats.totalPnlSol >= 0 ? '+' : ''}{stats.totalPnlSol.toFixed(3)} SOL
        </strong>
        <small>paper + live fills</small>
      </div>
      <div className="kpi-card">
        <span>Win Rate</span>
        <strong>{stats.winRate}%</strong>
        <small>{stats.wins} / {stats.closedCount} closed</small>
      </div>
      <div className="kpi-card">
        <span>Active Positions</span>
        <strong>{stats.openCount}</strong>
        <small>open now</small>
      </div>
      <div className="kpi-card">
        <span>Live Scanning</span>
        <strong>{kpis.total}</strong>
        <small>{kpis.newLaunches1h} new / 1h · {kpis.active5m} active 5m</small>
      </div>
    </div>
  );
}
