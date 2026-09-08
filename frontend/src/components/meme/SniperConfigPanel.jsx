import React, { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { api } from '../../utils/sniperApi';
import { useToast } from '../ui/useToast';
import { Pill } from '../ui/Primitives';

// Filter chips map honestly onto bot thresholds + safety evidence:
// - Anti-Rug → minSafetyScore >= 60 (rug/authority/holder checks live in the score)
// - Honeypot Check → minSafetyScore >= 45 (Jupiter sell-route is inside the score)
// - LP Locked → minLiquidityUsd >= 8000 (thin pools can't be exited)
// - Mint Disabled → minSafetyScore >= 75 (mint-authority check is 20/100 of safety)
const FILTERS = [
  { id: 'antiRug', label: 'Anti-Rug', active: bot => (bot.minSafetyScore ?? 0) >= 60, apply: bot => ({ minSafetyScore: Math.max(bot.minSafetyScore ?? 0, 60) }), clear: () => ({ minSafetyScore: 45 }) },
  { id: 'honeypot', label: 'Honeypot Check', active: bot => (bot.minSafetyScore ?? 0) >= 45, apply: bot => ({ minSafetyScore: Math.max(bot.minSafetyScore ?? 0, 45) }), clear: () => ({ minSafetyScore: 0 }) },
  { id: 'lpLocked', label: 'LP Locked', active: bot => (bot.minLiquidityUsd ?? 0) >= 8000, apply: bot => ({ minLiquidityUsd: Math.max(bot.minLiquidityUsd ?? 0, 8000) }), clear: () => ({ minLiquidityUsd: 0 }) },
  { id: 'mintDisabled', label: 'Mint Disabled', active: bot => (bot.minSafetyScore ?? 0) >= 75, apply: bot => ({ minSafetyScore: Math.max(bot.minSafetyScore ?? 0, 75) }), clear: () => ({ minSafetyScore: 45 }) },
];

export default function SniperConfigPanel() {
  const toast = useToast();
  const [bots, setBots] = useState([]);
  const [botId, setBotId] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api.bots();
      const list = data.bots || [];
      setBots(list);
      const current = list.find(b => b.id === botId) || list[0] || null;
      setBotId(current?.id || '');
      setDraft(current ? { ...current } : null);
    } catch {
      setBots([]);
    }
  };

  useEffect(() => { load(); }, []);

  const bot = bots.find(b => b.id === botId) || null;
  const set = patch => setDraft(current => ({ ...current, ...patch }));

  const save = async () => {
    if (!bot || !draft) return;
    setSaving(true);
    try {
      if (draft.running !== bot.running) {
        if (draft.running) await api.startBot(bot.id);
        else await api.stopBot(bot.id);
      }
      await api.updateBot(bot.id, {
        autoBuy: draft.autoBuy,
        mode: draft.mode,
        slippagePct: Number(draft.slippagePct),
        buyAmountSol: Number(draft.buyAmountSol),
        minLiquidityUsd: Number(draft.minLiquidityUsd),
        minSafetyScore: Number(draft.minSafetyScore),
        minTractionScore: Number(draft.minTractionScore),
      });
      toast.success(`Sniper settings saved for ${bot.name}`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  if (!bot || !draft) {
    return (
      <div className="panel">
        <div className="panel-title"><span>Sniper Bot</span></div>
        <p className="text-dim" style={{ fontSize: '0.8rem' }}>No bots yet — create one in My Bots to configure auto-sniping.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>Sniper Bot <Pill color={draft.running ? 'green' : 'gray'}>{draft.running ? 'Active' : 'Paused'}</Pill></span>
        <Settings size={14} className="text-dim" />
      </div>
      <p className="text-dim" style={{ fontSize: '0.75rem' }}>Automatically snipes curated meme coins. Paper mode until you enable live trading.</p>
      <div className="form-group">
        <label className="form-label">Bot</label>
        <select className="select-field" value={botId} onChange={e => { const next = bots.find(b => b.id === e.target.value); setBotId(e.target.value); setDraft(next ? { ...next } : null); }}>
          {bots.map(b => <option key={b.id} value={b.id}>{b.name} ({b.mode})</option>)}
        </select>
      </div>
      <div className="param-grid">
        <label className="checkbox-control"><input type="checkbox" checked={Boolean(draft.running)} onChange={e => set(e.target.checked)} /><span>Auto Sniping</span></label>
        <label className="checkbox-control"><input type="checkbox" checked={draft.autoBuy !== false} onChange={e => set({ autoBuy: e.target.checked })} /><span>Auto-buy curated</span></label>
        <div className="form-group"><label className="form-label">Slippage</label>
          <select className="select-field" value={draft.slippagePct} onChange={e => set({ slippagePct: Number(e.target.value) })}>
            {[5, 10, 15, 20].map(v => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
        <div className="form-group"><label className="form-label">Max Buy (SOL)</label>
          <input className="input-field" type="number" min="0" step="0.01" value={draft.buyAmountSol} onChange={e => set({ buyAmountSol: Number(e.target.value) })} />
        </div>
        <div className="form-group"><label className="form-label">Min Liquidity (USD)</label>
          <input className="input-field" type="number" min="0" step="500" value={draft.minLiquidityUsd} onChange={e => set({ minLiquidityUsd: Number(e.target.value) })} />
        </div>
        <div className="form-group"><label className="form-label">Min Safety</label>
          <input className="input-field" type="number" min="0" max="100" step="1" value={draft.minSafetyScore} onChange={e => set({ minSafetyScore: Number(e.target.value) })} />
        </div>
      </div>
      <div className="form-group"><label className="form-label">Filters</label>
        <div className="selector-chip-list">
          {FILTERS.map(filter => (
            <button key={filter.id} type="button" className={`selector-chip ${filter.active(draft) ? 'active' : ''}`} onClick={() => set(filter.active(draft) ? filter.clear() : filter.apply(draft))}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <button className="btn-primary btn-sm" style={{ width: '100%' }} disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  );
}
