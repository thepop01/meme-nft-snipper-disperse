import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
const emitted = [];
vi.mock('../../bus.js', () => ({
  emit: (type, payload) => emitted.push({ type, ...payload }),
  log: vi.fn(),
}));

describe('alerts', () => {
  let alerts;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    emitted.length = 0;
    vi.resetModules();
    alerts = await import('../../alerts.js');
  });

  it('pushes an alert, persists it, and emits alert:new', () => {
    const a = alerts.pushAlert({ type: 'mint', title: 'Job fired', body: 'x', severity: 'info' });
    expect(a.id).toBeTruthy();
    expect(a.ts).toBeTruthy();
    expect(alerts.listAlerts()).toHaveLength(1);
    expect(emitted[0].type).toBe('alert:new');
    expect(emitted[0].alert.title).toBe('Job fired');
  });

  it('caps stored alerts at 200 newest-first', () => {
    for (let i = 0; i < 210; i++) alerts.pushAlert({ type: 't', title: `a${i}`, body: '' });
    const list = alerts.listAlerts();
    expect(list).toHaveLength(200);
    expect(list[0].title).toBe('a209');
  });

  it('marks all read', () => {
    alerts.pushAlert({ type: 't', title: 'x', body: '' });
    expect(alerts.listAlerts()[0].read).toBe(false);
    alerts.markAllRead();
    expect(alerts.listAlerts()[0].read).toBe(true);
  });
});
