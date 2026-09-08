import React, { useEffect, useMemo, useRef, useState } from 'react';

const RANGES = [
  ['15m', 15 * 60_000], ['1h', 60 * 60_000], ['4h', 4 * 60 * 60_000],
  ['1d', 24 * 60 * 60_000], ['All', Infinity],
];

export default function TokenChart({ token }) {
  const host = useRef(null);
  const [range, setRange] = useState('1h');
  const points = useMemo(() => {
    const duration = RANGES.find(([label]) => label === range)?.[1] || Infinity;
    const cutoff = duration === Infinity ? 0 : Date.now() - duration;
    const deduped = new Map();
    for (const point of token?.history || []) {
      const time = Math.floor(Number(point.ts) / 1000);
      const value = Number(point.priceUsd);
      if (Number(point.ts) >= cutoff && time > 0 && value > 0) deduped.set(time, { time, value });
    }
    if (token?.priceUsd && token?.enrichedAt) {
      const time = Math.floor(Number(token.enrichedAt) / 1000);
      if (Number(token.enrichedAt) >= cutoff) deduped.set(time, { time, value: Number(token.priceUsd) });
    }
    return [...deduped.values()].sort((a, b) => a.time - b.time);
  }, [range, token]);

  useEffect(() => {
    if (!host.current || points.length < 2) return undefined;
    let chart;
    let observer;
    let disposed = false;
    import('lightweight-charts').then(({ createChart, LineSeries, ColorType }) => {
      if (disposed || !host.current) return;
      chart = createChart(host.current, {
        width: host.current.clientWidth, height: 240,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8f98aa' },
        grid: { vertLines: { color: 'rgba(130,140,160,.10)' }, horzLines: { color: 'rgba(130,140,160,.10)' } },
        rightPriceScale: { borderColor: 'rgba(130,140,160,.20)' },
        timeScale: { borderColor: 'rgba(130,140,160,.20)', timeVisible: true, secondsVisible: false },
        crosshair: { vertLine: { labelBackgroundColor: '#7c5cfc' }, horzLine: { labelBackgroundColor: '#7c5cfc' } },
      });
      const series = chart.addSeries(LineSeries, { color: '#8b6dff', lineWidth: 2, priceFormat: { type: 'price', precision: 10, minMove: 0.0000000001 } });
      series.setData(points);
      chart.timeScale().fitContent();
      observer = new ResizeObserver(() => chart?.applyOptions({ width: host.current?.clientWidth || 320 }));
      observer.observe(host.current);
    });
    return () => { disposed = true; observer?.disconnect(); chart?.remove(); };
  }, [points]);

  return (
    <div className="token-chart-panel">
      <div className="token-chart-toolbar"><strong>Price history</strong><div>{RANGES.map(([label]) => <button key={label} className={range === label ? 'active' : ''} onClick={() => setRange(label)}>{label}</button>)}</div></div>
      {points.length < 2 ? <div className="token-chart-empty">Collecting enough observations to draw this range.</div> : <div ref={host} className="token-chart-host" />}
    </div>
  );
}
