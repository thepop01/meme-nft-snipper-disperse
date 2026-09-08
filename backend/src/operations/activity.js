import { listAlerts } from '../alerts.js';
import { getLogs } from '../bus.js';
import { listJobs as listDisperseJobs } from '../disperse/jobRunner.js';
import { getFills } from '../engine/accounting.js';
import { listJobs as listMintJobs } from '../nft/mintRunner.js';
import { listAudit as listWalletAudit } from '../wallets/repository.js';

function add(target, event) {
  if (!event.ts || !Number.isFinite(Number(event.ts))) return;
  target.push({ severity: 'info', ...event, ts: Number(event.ts) });
}

export function listActivity({ type, limit = 200 } = {}) {
  const events = [];
  for (const alert of listAlerts()) add(events, {
    id: `alert:${alert.id}`, type: 'alert', subsystem: alert.type,
    title: alert.title, detail: alert.body, severity: alert.severity,
    ts: alert.ts, link: alert.link || null,
  });
  for (const fill of getFills()) add(events, {
    id: `fill:${fill.id}`, type: 'trade', subsystem: 'meme-trading',
    title: `${String(fill.side || 'fill').toUpperCase()} ${fill.symbol || fill.tokenAddress || 'token'}`,
    detail: `${fill.walletAddress || 'paper wallet'} · ${fill.quoteQuantitySol ?? 0} SOL`,
    severity: fill.side === 'sell' && Number(fill.realizedPnlSol) < 0 ? 'high' : 'info',
    ts: fill.filledAt || fill.timestamp, txHash: fill.txSignature || null, chainId: fill.chainId || 'solana',
  });
  for (const audit of listWalletAudit()) add(events, {
    id: `wallet:${audit.id}`, type: 'wallet', subsystem: 'wallet-directory',
    title: audit.action, detail: audit.address || audit.name || (audit.walletIds ? `${audit.walletIds.length} wallet(s)` : ''),
    ts: Date.parse(audit.at),
  });
  for (const job of listDisperseJobs()) {
    for (const [index, audit] of (job.audit || []).entries()) add(events, {
      id: `disperse:${job.id}:${index}`, type: 'disperse', subsystem: 'disperse',
      title: `Disperse ${audit.event}`, detail: `${job.id} · ${job.recipients?.length || 0} recipients`,
      severity: String(audit.event).includes('failed') ? 'high' : 'info', ts: audit.ts,
    });
  }
  for (const job of listMintJobs()) {
    for (const [index, audit] of (job.audit || []).entries()) add(events, {
      id: `mint:${job.id}:${index}`, type: 'mint', subsystem: 'mint-bot',
      title: `Mint ${audit.event}`, detail: `${job.collection?.name || job.collection?.slug || job.id}`,
      severity: String(audit.event).includes('failed') ? 'high' : 'info', ts: audit.ts,
    });
  }
  for (const [index, entry] of getLogs().entries()) add(events, {
    id: `log:${entry.ts}:${index}`, type: 'system', subsystem: 'backend',
    title: entry.message, detail: entry.error || '', severity: entry.level === 'error' ? 'high' : entry.level,
    ts: entry.ts,
  });
  return events
    .filter(event => !type || event.type === type)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.min(500, Math.max(1, Number(limit) || 200)));
}
