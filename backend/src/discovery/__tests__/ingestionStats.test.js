import { describe, expect, it } from 'vitest';
import { IngestionStats } from '../ingestionStats.js';
describe('IngestionStats', () => it('reports received types, faults, and maximum lag', () => {
  const stats = new IngestionStats(); stats.received('trade_observed'); stats.received('trade_observed'); stats.reconnect(); stats.parseFailure(); stats.duplicate(); stats.lag(40); stats.lag(20);
  expect(stats.snapshot()).toEqual({ byType: { trade_observed: 2 }, reconnects: 1, parseFailures: 1, duplicates: 1, maxLagMs: 40 });
}));
