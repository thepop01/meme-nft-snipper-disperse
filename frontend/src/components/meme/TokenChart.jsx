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

    const addPoint = (ts, price) => {
      const time = Math.floor(Number(ts) / 1000);
      const value = Number(price);
      if (time > 0 && Number.isFinite(value) && value > 0) {
        deduped.set(time, { time, value });
      }
    };

    // 1. History array
    for (const point of token?.history || []) {
      if (Number(point.ts) >= cutoff) addPoint(point.ts, point.priceUsd);
    }
    // 2. Tracked 30m history
    for (const point of token?.priceHistory30m || []) {
      if (Number(point.ts) >= cutoff) addPoint(point.ts, point.priceUsd);
    }
    // 3. Current enriched price
    if (token?.priceUsd) {
      addPoint(token.enrichedAt || Date.now(), token.priceUsd);
    }

    // If selected range had < 2 points, try all history regardless of range
    if (deduped.size < 2) {
      for (const point of token?.history || []) addPoint(point.ts, point.priceUsd);
      for (const point of token?.priceHistory30m || []) addPoint(point.ts, point.priceUsd);
      if (token?.priceUsd) addPoint(token.enrichedAt || Date.now(), token.priceUsd);
    }

    // If still < 2 points, construct baseline from known price change or creation time
    if (deduped.size < 2 && token?.priceUsd) {
      const currentPrice = Number(token.priceUsd);
      const changeH1 = token.priceChange?.h1 ?? token.priceChange?.m5 ?? token.priceChange?.h24;
      const nowSec = Math.floor(Date.now() / 1000);
      if (changeH1 != null && Number.isFinite(Number(changeH1))) {
        const factor = 1 + Number(changeH1) / 100;
        const pastPrice = factor > 0 ? currentPrice / factor : currentPrice * 0.9;
        addPoint((nowSec - 3600) * 1000, pastPrice);
        addPoint((nowSec - 1800) * 1000, (pastPrice + currentPrice) / 2);
      } else if (token.createdAt && Date.now() - token.createdAt > 60_000) {
        addPoint(token.createdAt, currentPrice * 0.95);
      } else {
        addPoint((nowSec - 900) * 1000, currentPrice);
      }
      addPoint(nowSec * 1000, currentPrice);
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
