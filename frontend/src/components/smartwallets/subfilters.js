import React from 'react';

export const SUBFILTERS = {
  tracked: [
    { id: 'all', label: 'All' },
    { id: 'early_buyer', label: '🚀 Early Buyers', title: 'Qualified Pre-ATH Early Buyers' },
    { id: 'top_runners', label: '💎 >$10M Runners', title: 'Tokens that peaked > $10M Market Cap' },
    { id: 'snipers_alpha', label: '⚡ Snipers & Alpha', title: 'Fast Block Snipers & Alpha Callers' },
    { id: 'profitable', label: '💰 Profitable', title: 'Net positive realized PnL' },
    { id: 'kol', label: '📢 KOL / Callers', title: 'Key Opinion Leaders and Callers' },
  ],
  smart: [
    { id: 'all', label: 'All' },
    { id: 'profitable', label: '💰 Profitable', title: 'Net positive realized PnL' },
    { id: 'high_winrate', label: '🎯 Win Rate ≥60%', title: 'Win rate ≥ 60%' },
    { id: 'active', label: '⚡ Active (≥5)', title: 'Active traders with at least 5 trades' },
    { id: 'sub1m', label: '🪙 Sub-$1M', title: 'Traders specializing in sub-$1M Market Cap tokens' },
  ],
  sniper: [
    { id: 'all', label: 'All' },
    { id: 'rank_1', label: '🎯 Rank 1' },
    { id: 'alpha_buyer', label: '⚡ Alpha Buyer' },
    { id: 'kol', label: '📢 KOL Callers' },
  ],
};

export function SubfilterBar({ filters, value, onChange }) {
  if (!filters || filters.length === 0) return null;
  return React.createElement(
    'div',
    { style: { display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' } },
    React.createElement('span', { style: { fontSize: '0.68rem', color: '#6b7280', fontWeight: 500 } }, 'Filter:'),
    filters.map(f =>
      React.createElement(
        'button',
        {
          key: f.id,
          type: 'button',
          className: `btn-sm ${value === f.id ? 'btn-primary' : 'btn-outline'}`,
          onClick: () => onChange(f.id),
          style: { fontSize: '0.68rem', padding: '0.15rem 0.4rem', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' },
          title: f.title || f.label,
        },
        f.label
      )
    )
  );
}
