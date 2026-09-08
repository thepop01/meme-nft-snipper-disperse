export class IngestionStats {
  constructor() {
    this.byType = {};
    this.reconnects = 0;
    this.parseFailures = 0;
    this.duplicates = 0;
    this.maxLagMs = 0;
  }
  received(type) { this.byType[type] = (this.byType[type] ?? 0) + 1; }
  reconnect() { this.reconnects += 1; }
  parseFailure() { this.parseFailures += 1; }
  duplicate() { this.duplicates += 1; }
  lag(ms) { this.maxLagMs = Math.max(this.maxLagMs, Math.max(0, ms)); }
  snapshot() {
    return { byType: { ...this.byType }, reconnects: this.reconnects,
      parseFailures: this.parseFailures, duplicates: this.duplicates, maxLagMs: this.maxLagMs };
  }
}
