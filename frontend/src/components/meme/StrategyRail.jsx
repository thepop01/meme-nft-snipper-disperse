import React from 'react';
import { Activity, ChevronRight, Inbox, ListFilter, Plus, Settings2, Star } from 'lucide-react';



export default function StrategyRail({ activeId, onSelect, lists, onManage }) {
  return (
    <aside className="strategy-rail">
      <div className="strategy-rail-head">
        <div>
          <span className="section-kicker">Discovery</span>
          <h3>Strategies</h3>
        </div>
        <button className="icon-button-ghost" onClick={onManage} title="Manage custom strategies">
          <Settings2 size={15} />
        </button>
      </div>
      <p className="strategy-rail-copy">Start with a transparent preset, then duplicate it into a custom strategy.</p>

      <div className="strategy-section-label">Signals</div>
      <div className="strategy-list">
        <button
          className={`strategy-item ${activeId === 'view:tracked' ? 'active' : ''}`}
          onClick={() => onSelect('view:tracked')}
        >
          <span className="strategy-icon green"><Activity size={15} /></span>
          <span className="strategy-item-copy">
            <strong>Tracked &amp; Sleepers</strong>
            <small>Long-horizon watchlist — wakes, climbers, revivals.</small>
          </span>
          <ChevronRight size={13} className="strategy-chevron" />
        </button>
      </div>

      <div className="strategy-section-label">Built-in</div>
      <div className="strategy-list">
        <button
          className={`strategy-item ${activeId === 'curated' ? 'active' : ''}`}
          onClick={() => onSelect('curated')}
        >
          <span className="strategy-icon violet"><Star size={15} /></span>
          <span className="strategy-item-copy">
            <strong>Curated Tokens</strong>
            <small>Backend-qualified momentum & safety feed.</small>
          </span>
          <ChevronRight size={13} className="strategy-chevron" />
        </button>
      </div>

      <div className="strategy-section-label strategy-custom-label">
        <span>Custom strategies</span>
        <button className="icon-button-ghost" onClick={onManage} title="Create custom strategy"><Plus size={13} /></button>
      </div>
      <div className="strategy-list custom-strategy-list">
        {lists.filter(list => list.enabled).map(list => (
          <button
            key={list.id}
            className={`strategy-item custom ${activeId === `list:${list.id}` ? 'active' : ''}`}
            onClick={() => onSelect(`list:${list.id}`)}
          >
            <span className={`strategy-icon ${list.color || 'violet'}`}><ListFilter size={15} /></span>
            <span className="strategy-item-copy">
              <strong>{list.name}</strong>
              <small>{list.matched?.length || 0} current matches</small>
            </span>
            <ChevronRight size={13} className="strategy-chevron" />
          </button>
        ))}
        {lists.filter(list => list.enabled).length === 0 && (
          <button className="strategy-empty" onClick={onManage}>Create your first custom strategy <Plus size={13} /></button>
        )}
      </div>

    </aside>
  );
}
