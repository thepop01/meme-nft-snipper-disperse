import React, { useEffect, useState } from 'react';
import { getBackendUrl, authHeaders } from '../utils/sniperApi';

// Smart wallet finder + tracker UI.
// Sources: pump.fun leaderboard, fomo.family (via fomoapi.io), GMGN smart money,
// plus researched extras (Cielo, Arkham, Birdeye). See backend/src/smartwallets.
// Tier rules (ATH -> max early-buy mcap to qualify):
// 1M->0.5M, 5M->1M, 10M->2M, 10-50M->5M, 50M+->10M. 30-day lookback.
const TIERS = [
  { ath: '≥ $50M', buyBelow: '< $10M' },
  { ath: '$10M – $50M', buyBelow: '< $5M' },
  { ath: '~$10M', buyBelow: '< $2M' },
  { ath: '~$5M', buyBelow: '< $1M' },
  { ath: '~$1M', buyBelow: '< $0.5M' },
];

export default function SmartWalletsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/smart-wallets`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`backend ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) { if (!cancelled) setError(e.message); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="meme-terminal-container">
      <div className="page-header page-header-row meme-page-header">
        <div>
          <span className="page-eyebrow">Discovery · both chains</span>
          <h2>Smart Wallets</h2>
          <p>Top wallets from pump.fun + fomo.family + GMGN smart money, plus early buyers of last-30-day runners. Solana + Robinhood.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><span>Early-buyer tiers (30-day runners)</span></div>
        <table className="data-table">
          <thead><tr><th>Token ATH mcap</th><th>Qualifying early buy</th></tr></thead>
          <tbody>{TIERS.map(t => <tr key={t.ath}><td>{t.ath}</td><td>{t.buyBelow}</td></tr>)}</tbody>
        </table>
        <p className="text-dim" style={{ fontSize: '0.8rem' }}>
          If a coin hit $1M, store wallets that bought below $500k. $5M → below $1M. $10M → below $2M.
          $10–50M → below $5M. Above $50M → below $10M.
        </p>
      </div>

      <div className="panel">
        <div className="panel-title"><span>Tracked wallets</span><span>{data ? `${data.wallets?.length || 0} wallets` : 'loading…'}</span></div>
        {error && <p className="text-red" style={{ fontSize: '0.8rem' }}>Backend unavailable ({error}) — showing tier rules only. Start the backend to load live wallets.</p>}
        {data && (data.wallets?.length || 0) === 0 && <p className="text-dim" style={{ fontSize: '0.8rem' }}>No wallets stored yet. Run a finder refresh to seed from leaderboard sources.</p>}
        {data && (data.wallets?.length || 0) > 0 && (
          <table className="data-table">
            <thead><tr><th>Wallet</th><th>Chain</th><th>Source</th><th>Score</th></tr></thead>
            <tbody>{data.wallets.slice(0, 100).map(w => (
              <tr key={`${w.chain}:${w.address}`}><td className="mono">{w.address?.slice(0, 10)}…</td><td>{w.chain}</td><td>{w.source}</td><td>{w.score ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-title"><span>Sources</span></div>
        <ul className="text-dim" style={{ fontSize: '0.8rem', paddingLeft: '1.2rem' }}>
          <li>pump.fun leaderboard (PnL window 1D/1W/1M) — Solana</li>
          <li>fomo.family via fomoapi.io /v2/leaderboard — Solana + EVM wallets</li>
          <li>GMGN smart money (smart_degen_count / gmgn-cli) — Solana + Robinhood</li>
          <li>Extras under review: Cielo, Arkham, Birdeye top-trader feeds</li>
        </ul>
      </div>
    </div>
  );
}
