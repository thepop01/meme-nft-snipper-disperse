import React, { useCallback, useState } from 'react';
import { Wallet, Clock, Bot, TrendingUp, Crosshair, Radar, ArrowRight, KeyRound } from 'lucide-react';
import { StatCard, Pill, StatusDot } from './ui/Primitives';
import { nftApi } from '../utils/nftApi.js';
import { api } from '../utils/sniperApi';
import { useBackend } from '../utils/useBackend';
import { fmtSol, shortAddr } from '../utils/format';
import { listWallets } from '../utils/senderWalletStore';

const DashboardView = ({ walletGroups, setActiveTab }) => {
  const [mintJobs, setMintJobs] = useState([]);
  const [positions, setPositions] = useState([]);
  const [bots, setBots] = useState([]);
  const [trades, setTrades] = useState([]);

  const fetchData = useCallback(async () => {
    try {
      const [pos, botList, tradeList, mintData] = await Promise.all([
        api.positions(), api.bots(), api.trades(),
        nftApi.jobs().catch(() => ({ jobs: [] })),
      ]);
      setPositions(pos.positions || []);
      setBots(botList.bots || []);
      setTrades(tradeList.trades || []);
      setMintJobs(mintData.jobs || []);
    } catch { /* handled by useBackend */ }
  }, []);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'position:update' || msg.type === 'trade:executed' || msg.type === 'bot:status') {
      fetchData();
    }
  }, [fetchData]);

  const { backend, wsOn } = useBackend({ onMessage: handleWsMessage });

  // Ensure data is fetched on first connect
  React.useEffect(() => {
    if (backend) fetchData();
  }, [backend, fetchData]);

  const totalWallets = walletGroups.reduce((n, g) => n + (g.addresses?.length || 0), 0);
  const senderWallets = listWallets();
  const evmCount = senderWallets.filter(w => w.chainFamily === 'evm').length;
  const solCount = senderWallets.filter(w => w.chainFamily === 'sol').length;
  const scheduledMints = mintJobs.filter(m => m.status === 'scheduled').length;
  const runningBots = bots.filter(b => b.running).length;
  const openPositions = positions.filter(p => p.status === 'open');
  const openPnl = openPositions.reduce((n, p) => n + (p.pnlSol || 0), 0);
  const realizedPnl = trades.filter(t => t.side === 'sell').reduce((n, t) => n + (t.pnlSol || 0), 0);

  const recentSniperEvents = trades.slice(0, 6).map(t => ({
    time: t.timestamp,
    text: `${t.side.toUpperCase()} ${t.symbol || t.mint?.slice(0, 6)} — ${fmtSol(t.solAmount)}${t.dryRun ? ' (paper)' : ''}`,
    tone: t.side === 'buy' ? 'blue' : (t.pnlSol || 0) >= 0 ? 'green' : 'red',
  }));

  const recentMintEvents = mintJobs.slice(0, 6).map(e => ({
    time: e.timestamp,
    text: `${e.type} ${e.collection || e.slug || ''}`,
    tone: e.type === 'error' ? 'red' : 'violet',
  }));

  const activity = [...recentSniperEvents, ...recentMintEvents]
    .sort((a, b) => b.time - a.time)
    .slice(0, 10);

  return (
    <div className="dashboard-container">
      <div className="page-header" style={{ marginBottom: '0.65rem' }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
      </div>

      {backend === null && (
        <div className="conn-banner offline">
          <StatusDot on={false} />
          <span>
            Trading backend offline — start it with <span className="mono">node backend/server.js</span> to enable Meme Finder and bots.
          </span>
        </div>
      )}
      {backend?.dryRun && (
        <div className="conn-banner dryrun">
          <span>🧪</span>
          <span><b>Paper trading mode</b> — bots simulate trades with real market data. Set <span className="mono">DRY_RUN=false</span> in backend/.env to go live.</span>
        </div>
      )}

      <div className="stats-grid">
        <StatCard label="Wallets" value={totalWallets} sub={`${walletGroups.length} groups`} icon={Wallet} />
        <StatCard
          label="Sender Wallets"
          value={senderWallets.length}
          sub={`${evmCount} EVM · ${solCount} SOL`}
          icon={KeyRound}
          onClick={() => setActiveTab('wallets')}
        />
        <StatCard label="Scheduled Mints" value={scheduledMints} sub={`${mintJobs.length} total`} icon={Clock} />
        <StatCard label="Active Bots" value={runningBots} sub={`${bots.length} configured`} icon={Bot} />
        <StatCard
          label="Open PnL"
          value={fmtSol(openPnl, { unit: true })}
          sub={`${openPositions.length} open positions`}
          icon={TrendingUp}
          tone={openPnl > 0 ? 'positive' : openPnl < 0 ? 'negative' : undefined}
        />
        <StatCard
          label="Realized PnL"
          value={fmtSol(realizedPnl, { unit: true })}
          sub={backend?.dryRun ? 'paper' : 'live'}
          icon={Crosshair}
          tone={realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : undefined}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="panel">
          <div className="panel-title">
            <span>Quick Actions</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button className="btn-outline" onClick={() => setActiveTab('memefinder')} style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Radar size={15} /> Scan new meme coins</span>
              <ArrowRight size={14} />
            </button>
            <button className="btn-outline" onClick={() => setActiveTab('bots')} style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Bot size={15} /> Configure a sniper bot</span>
              <ArrowRight size={14} />
            </button>
            <button className="btn-outline" onClick={() => setActiveTab('mintbot')} style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={15} /> Schedule an NFT mint</span>
              <ArrowRight size={14} />
            </button>
          </div>
          {backend && (
            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <StatusDot on={wsOn} pulse />
              <span>Backend {wsOn ? 'connected' : 'reconnecting'} · wallet {backend.walletAddress ? shortAddr(backend.walletAddress) : 'not set'}</span>
              {backend.dryRun && <Pill color="yellow">Paper</Pill>}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title"><span>Recent Activity</span></div>
          {activity.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>No activity yet. Trades and mint events will appear here.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem' }}>
                  <span className="mono text-dim" style={{ fontSize: '0.7rem', width: 62, flexShrink: 0 }}>
                    {new Date(a.time).toLocaleTimeString()}
                  </span>
                  <Pill color={a.tone}>{a.tone === 'violet' ? 'mint' : 'trade'}</Pill>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
