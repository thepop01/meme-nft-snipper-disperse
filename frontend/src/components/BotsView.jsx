import React, { useEffect, useState } from 'react';
import { Bot, Plus, Trash2, Pencil, Play, Square, Copy } from 'lucide-react';
import { api, subscribeWs } from '../utils/sniperApi';
import { Pill, StatusDot, Switch } from './ui/Primitives';
import { Modal, ConfirmModal } from './ui/Modal';
import { useToast } from './ui/useToast';

const PRESET_LABELS = { conservative: 'Conservative', standard: 'Standard', degen: 'Degen' };

const EMPTY_FORM = {
  name: '',
  preset: 'standard',
  mode: 'agent',
  autoBuy: true,
  sources: ['pumpfun', 'raydium'],
  buyAmountSol: 0.1,
  minSafetyScore: 60,
  minLiquidityUsd: 8000,
  maxTokenAgeMin: 40,
  slippagePct: 10,
  maxConcurrentPositions: 4,
  minTractionScore: 50,
  maxEntryPumpPct: 150,
  watchWindowMin: 20,
  takeProfitPct: 100,
  stopLossPct: 30,
  trailingStopPct: 20,
  maxHoldMin: 60,
  keywordBlacklist: [],
  creatorBlacklist: [],
};

function BotForm({ initial, presets, onSave, onClose, open }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(initial || EMPTY_FORM);
  }, [initial, open]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const setNum = (key) => (e) => set(key, e.target.value === '' ? '' : Number(e.target.value));

  const applyPreset = (presetKey) => {
    const preset = presets?.[presetKey];
    if (preset) setForm(f => ({ ...f, ...preset, preset: presetKey }));
  };

  const toggleSource = (src) => {
    setForm(f => ({
      ...f,
      sources: f.sources.includes(src) ? f.sources.filter(s => s !== src) : [...f.sources, src],
    }));
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        ...form,
        keywordBlacklist: Array.isArray(form.keywordBlacklist)
          ? form.keywordBlacklist
          : String(form.keywordBlacklist).split(',').map(s => s.trim()).filter(Boolean),
        creatorBlacklist: Array.isArray(form.creatorBlacklist)
          ? form.creatorBlacklist
          : String(form.creatorBlacklist).split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={initial?.id ? `Edit "${initial.name}"` : 'New Sniper Bot'}
      actions={
        <>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? 'Saving…' : 'Save Bot'}
          </button>
        </>
      }
    >
      <div className="param-grid" style={{ marginTop: '0.5rem' }}>
        <div className="form-group full">
          <label className="form-label">Bot name</label>
          <input className="input-field" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fresh pump.fun scalper" />
        </div>

        <div className="form-group full">
          <label className="form-label">Preset</label>
          <div className="preset-row">
            {Object.keys(PRESET_LABELS).map(k => (
              <button key={k} className={`preset-btn ${form.preset === k ? 'active' : ''}`} onClick={() => applyPreset(k)}>
                {PRESET_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group full">
          <label className="form-label">Mode</label>
          <div className="preset-row">
            <button className={`preset-btn ${form.mode === 'agent' ? 'active' : ''}`} onClick={() => set('mode', 'agent')}
              title="Watches curated tokens and only buys after traction confirms real buyers">
              🤖 Agent — watch &amp; confirm
            </button>
            <button className={`preset-btn ${form.mode === 'sniper' ? 'active' : ''}`} onClick={() => set('mode', 'sniper')}
              title="Buys immediately when a token passes curation and your filters">
              🎯 Sniper — instant entry
            </button>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
            Both modes only ever see <b>curated</b> tokens (survived repeated safety re-checks) — never the raw launch firehose.
          </p>
        </div>

        <div className="form-section-label">Entry</div>

        <div className="form-group full" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="form-label" style={{ margin: 0 }}>Auto-buy qualifying tokens</label>
          <Switch checked={form.autoBuy} onChange={v => set('autoBuy', v)} />
        </div>

        <div className="form-group full" style={{ flexDirection: 'row', gap: '1.5rem' }}>
          {['pumpfun', 'raydium'].map(src => (
            <label key={src} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.sources.includes(src)} onChange={() => toggleSource(src)} />
              {src === 'pumpfun' ? 'pump.fun launches' : 'Raydium pools'}
            </label>
          ))}
        </div>

        <div className="form-group">
          <label className="form-label">Buy amount (SOL)</label>
          <input className="input-field" type="number" step="0.01" min="0" value={form.buyAmountSol} onChange={setNum('buyAmountSol')} />
        </div>
        <div className="form-group">
          <label className="form-label">Min safety score (0-100)</label>
          <input className="input-field" type="number" min="0" max="100" value={form.minSafetyScore} onChange={setNum('minSafetyScore')} />
        </div>
        <div className="form-group">
          <label className="form-label">Min liquidity (USD)</label>
          <input className="input-field" type="number" min="0" step="1000" value={form.minLiquidityUsd} onChange={setNum('minLiquidityUsd')} />
        </div>
        <div className="form-group">
          <label className="form-label">Max token age (min)</label>
          <input className="input-field" type="number" min="1" value={form.maxTokenAgeMin} onChange={setNum('maxTokenAgeMin')} />
        </div>
        <div className="form-group">
          <label className="form-label">Slippage %</label>
          <input className="input-field" type="number" min="0" value={form.slippagePct} onChange={setNum('slippagePct')} />
        </div>
        <div className="form-group">
          <label className="form-label">Max concurrent positions</label>
          <input className="input-field" type="number" min="1" value={form.maxConcurrentPositions} onChange={setNum('maxConcurrentPositions')} />
        </div>
        <div className="form-group full">
          <label className="form-label">Keyword blacklist (comma-separated)</label>
          <input
            className="input-field"
            value={Array.isArray(form.keywordBlacklist) ? form.keywordBlacklist.join(', ') : form.keywordBlacklist}
            onChange={e => set('keywordBlacklist', e.target.value)}
            placeholder="e.g. elon, trump, test"
          />
        </div>

        {form.mode === 'agent' && (
          <>
            <div className="form-section-label">Agent confirmation</div>
            <div className="form-group">
              <label className="form-label">Min traction score (0-100)</label>
              <input className="input-field" type="number" min="0" max="100" value={form.minTractionScore} onChange={setNum('minTractionScore')} />
            </div>
            <div className="form-group">
              <label className="form-label">Max entry pump % (don't chase)</label>
              <input className="input-field" type="number" min="0" value={form.maxEntryPumpPct} onChange={setNum('maxEntryPumpPct')} />
            </div>
            <div className="form-group">
              <label className="form-label">Watch window (min)</label>
              <input className="input-field" type="number" min="1" value={form.watchWindowMin} onChange={setNum('watchWindowMin')} />
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                The agent watches each curated token and buys only when traction ≥ threshold, buys outpace sells, and price hasn't already run away. Unconfirmed tokens expire from the watchlist.
              </p>
            </div>
          </>
        )}

        <div className="form-section-label">Exit</div>

        <div className="form-group">
          <label className="form-label">Take profit % (0 = off)</label>
          <input className="input-field" type="number" min="0" value={form.takeProfitPct} onChange={setNum('takeProfitPct')} />
        </div>
        <div className="form-group">
          <label className="form-label">Stop loss % (0 = off)</label>
          <input className="input-field" type="number" min="0" value={form.stopLossPct} onChange={setNum('stopLossPct')} />
        </div>
        <div className="form-group">
          <label className="form-label">Trailing stop % from peak (0 = off)</label>
          <input className="input-field" type="number" min="0" value={form.trailingStopPct} onChange={setNum('trailingStopPct')} />
        </div>
        <div className="form-group">
          <label className="form-label">Max hold time (min, 0 = off)</label>
          <input className="input-field" type="number" min="0" value={form.maxHoldMin} onChange={setNum('maxHoldMin')} />
        </div>
      </div>
    </Modal>
  );
}

const BotsView = () => {
  const toast = useToast();
  const [backend, setBackend] = useState(undefined);
  const [bots, setBots] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | bot object
  const [deleting, setDeleting] = useState(null);

  const refresh = async () => {
    try {
      const [status, data] = await Promise.all([api.status(), api.bots()]);
      setBackend(status);
      setBots(data.bots || []);
    } catch {
      setBackend(null);
    }
  };

  useEffect(() => {
    refresh();
    const unsub = subscribeWs((msg) => {
      if (msg.type === 'ws:status' && msg.connected) refresh();
      if (msg.type === 'bot:status') refresh();
    });
    return unsub;
  }, []);

  const saveBot = async (form) => {
    try {
      if (editing?.id) {
        await api.updateBot(editing.id, form);
        toast.success('Bot updated');
      } else {
        await api.createBot(form);
        toast.success('Bot created');
      }
      refresh();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const toggleBot = async (bot) => {
    try {
      if (bot.running) {
        await api.stopBot(bot.id);
        toast.info(`"${bot.name}" stopped`);
      } else {
        await api.startBot(bot.id);
        toast.success(`"${bot.name}" started${backend?.dryRun ? ' (paper mode)' : ''}`);
      }
      refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cloneBot = async (bot) => {
    const rest = { ...bot };
    delete rest.id;
    delete rest.running;
    delete rest.stats;
    delete rest.createdAt;
    try {
      await api.createBot({ ...rest, name: `${bot.name} (copy)` });
      toast.success('Bot cloned');
      refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeBot = async (bot) => {
    try {
      await api.deleteBot(bot.id);
      toast.info(`"${bot.name}" deleted`);
      refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="solana-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
        <h2 style={{ margin: 0 }}>My Bots</h2>
        {backend && (
          <button className="btn-primary btn-xs" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem' }}>
            <Plus size={14} /> New Bot
          </button>
        )}
      </div>

      {backend === null && (
        <div className="conn-banner offline">
          <StatusDot on={false} />
          <span>Backend offline — start it with <span className="mono">cd backend && npm start</span></span>
        </div>
      )}
      {backend?.dryRun && (
        <div className="conn-banner dryrun">
          <span>🧪</span>
          <span><b>Paper trading</b> — bots simulate trades. Test your parameters safely here first.</span>
        </div>
      )}

      {backend && bots.length === 0 && (
        <div className="empty-state" style={{ padding: '3.5rem', background: 'var(--card-bg)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <Bot size={44} color="var(--text-dim)" />
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No bots yet. Create one and pick a preset to get sensible defaults.
          </p>
          <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={() => setEditing('new')}>
            <Plus size={16} /> Create your first bot
          </button>
        </div>
      )}

      {backend && bots.length > 0 && (
        <div className="bots-grid">
          {bots.map(bot => (
            <div key={bot.id} className={`bot-card ${bot.running ? 'running' : ''}`}>
              <div className="bot-card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <StatusDot on={bot.running} pulse />
                  <span className="bot-name">{bot.name}</span>
                  <Pill color={bot.mode === 'sniper' ? 'yellow' : 'violet'}>{bot.mode === 'sniper' ? '🎯 sniper' : '🤖 agent'}</Pill>
                </div>
                <Pill color={bot.running ? 'green' : 'gray'}>{bot.running ? 'Running' : 'Stopped'}</Pill>
              </div>

              <div className="bot-params">
                <div className="bot-param"><span className="k">Buy size</span><span className="v">{bot.buyAmountSol} ◎</span></div>
                <div className="bot-param"><span className="k">Min score</span><span className="v">{bot.minSafetyScore}</span></div>
                <div className="bot-param"><span className="k">Min liq</span><span className="v">${(bot.minLiquidityUsd || 0).toLocaleString()}</span></div>
                <div className="bot-param"><span className="k">Max age</span><span className="v">{bot.maxTokenAgeMin}m</span></div>
                {bot.mode !== 'sniper' && (
                  <>
                    <div className="bot-param"><span className="k">Min traction</span><span className="v">{bot.minTractionScore ?? 50}</span></div>
                    <div className="bot-param"><span className="k">Watch window</span><span className="v">{bot.watchWindowMin ?? 20}m</span></div>
                  </>
                )}
                <div className="bot-param"><span className="k">TP / SL</span><span className="v">+{bot.takeProfitPct}% / -{bot.stopLossPct}%</span></div>
                <div className="bot-param"><span className="k">Trail / Hold</span><span className="v">{bot.trailingStopPct}% / {bot.maxHoldMin}m</span></div>
                <div className="bot-param"><span className="k">Sources</span><span className="v">{(bot.sources || []).join(', ') || 'none'}</span></div>
                <div className="bot-param">
                  <span className="k">Activity</span>
                  <span className="v" title="watching now / confirmed entries / buys / expired unconfirmed">
                    {bot.mode !== 'sniper' ? `👁 ${bot.watching ?? 0} · ✓ ${bot.stats?.confirmed ?? 0} · ` : ''}{bot.stats?.buys ?? 0} buys
                  </span>
                </div>
              </div>

              <div className="bot-card-actions">
                <button
                  className={bot.running ? 'btn-outline' : 'btn-primary'}
                  style={{ flex: 1, fontSize: '0.8rem', padding: '0.45rem' }}
                  onClick={() => toggleBot(bot)}
                >
                  {bot.running ? <><Square size={13} /> Stop</> : <><Play size={13} /> Start</>}
                </button>
                <button className="btn-outline btn-sm" onClick={() => setEditing(bot)} title="Edit" disabled={bot.running}>
                  <Pencil size={13} />
                </button>
                <button className="btn-outline btn-sm" onClick={() => cloneBot(bot)} title="Clone">
                  <Copy size={13} />
                </button>
                <button className="icon-btn-danger" onClick={() => setDeleting(bot)} title="Delete" disabled={bot.running}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <BotForm
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        presets={backend?.presets}
        onSave={saveBot}
        onClose={() => setEditing(null)}
      />

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => removeBot(deleting)}
        title="Delete bot?"
        message={`"${deleting?.name}" and its configuration will be permanently removed. Open positions are not affected.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
};

export default BotsView;
