// Shared formatting utilities — consolidate duplicated helpers from views.

/** Relative time string: "3s", "5m", "2h" */
export function ago(ts) {
  if (!ts) return '--';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * USD format — compact (MemeFinder / dashboard cards).
 * $1.2M, $5.3k, $0.001234
 */
export function fmtUsd(n) {
  if (n == null) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

/**
 * USD format — precise (sniper positions table).
 * $0.00001234, $1.2345
 */
export function fmtUsdPrecise(n) {
  if (n == null) return '--';
  if (n < 0.01) return `$${n.toFixed(8)}`;
  return `$${n.toFixed(4)}`;
}

/**
 * SOL format.
 * Default: "0.1234" (no unit — use in tables).
 * With unit: "0.123 SOL" (dashboard stat).
 */
export function fmtSol(n, { unit = false } = {}) {
  if (n == null) return '--';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const formatted = abs.toFixed(unit ? 3 : 4);
  return unit ? `${sign}${formatted} SOL` : `${sign}${formatted}`;
}

/**
 * Shorten a Solana/EVM address: "7xKX...3fGh"
 */
export function shortAddr(addr, { prefix = 4, suffix = 4 } = {}) {
  if (!addr) return '--';
  if (addr.length <= prefix + suffix + 3) return addr;
  return `${addr.slice(0, prefix)}...${addr.slice(-suffix)}`;
}
