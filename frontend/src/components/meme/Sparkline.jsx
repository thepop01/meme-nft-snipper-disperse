import React from 'react';

// Tiny inline SVG sparkline from a series of {priceUsd} or numeric points.
// No dependency — draws a normalized polyline for the tracked-token history.
export default function Sparkline({ points, width = 96, height = 24, tone }) {
  const values = (points || [])
    .map(p => (typeof p === 'number' ? p : p?.priceUsd ?? p?.value))
    .filter(v => typeof v === 'number' && Number.isFinite(v));
  if (values.length < 2) return <span className="sparkline-empty">—</span>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');
  const rising = values[values.length - 1] >= values[0];
  const stroke = tone || (rising ? 'var(--success, #34d399)' : 'var(--danger, #fb4c6a)');

  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
