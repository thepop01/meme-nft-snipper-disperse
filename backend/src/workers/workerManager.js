import '../config.js';
import { runWorker1Pass } from './worker1CurrentMcap.js';
import { runWorker2Pass, backfillPendingMemesAth } from './worker2AthMcap.js';
import { runHistoricalSolanaHarvest, runHistoricalRobinhoodHarvest } from './historicalDiscovery.js';
import { processNextUnbackfilledMeme, processUnbackfilledMemesBatch } from './worker3EarlyBuyers.js';
import { processWalletMetricsPass } from './worker4WalletMetrics.js';
import { runWorker5Pass } from './worker5TokenDistribution.js';
import { getEndpointHealth } from './rateLimiter.js';
import { log } from '../bus.js';

let isRunning = false;
let timers = [];

export function startAllWorkers({ autoRun = true } = {}) {
  if (isRunning) return;
  isRunning = true;
  log('info', '[workerManager] Starting distributed 5-worker background pipeline');

  if (autoRun) {
    // Worker 1 & 2: Periodic discovery (every 10min and 15min)
    timers.push(setInterval(() => runWorker1Pass().catch(() => {}), 10 * 60_000));
    timers.push(setInterval(() => {
      runWorker2Pass().catch(() => {});
      backfillPendingMemesAth().catch(() => {});
    }, 15 * 60_000));

    // Deep 6-month historical runner harvest (Solana and Robinhood every 2 hours)
    timers.push(setInterval(() => runHistoricalSolanaHarvest().catch(() => {}), 2 * 3600_000));
    timers.push(setInterval(() => runHistoricalRobinhoodHarvest().catch(() => {}), 2 * 3600_000));

    // Worker 3 & 4: Queue processing (every 3min and 5min)
    timers.push(setInterval(() => {
      processUnbackfilledMemesBatch(3, undefined, 'solana').catch(() => {});
      processUnbackfilledMemesBatch(2, undefined, 'robinhood').catch(() => {});
    }, 3 * 60_000));
    timers.push(setInterval(() => processWalletMetricsPass().catch(() => {}), 5 * 60_000));

    // Worker 5: Hit-rate classifier (every 10min)
    timers.push(setInterval(() => runWorker5Pass().catch(() => {}), 10 * 60_000));

    // Trigger immediate initial pass on Workers 1 & 2 & Historical Discoveries
    runWorker1Pass().catch(() => {});
    runWorker2Pass().catch(() => {});
    backfillPendingMemesAth().catch(() => {});
    runHistoricalSolanaHarvest().catch(() => {});
    runHistoricalRobinhoodHarvest().catch(() => {});
  }
}

export function stopAllWorkers() {
  for (const t of timers) clearInterval(t);
  timers = [];
  isRunning = false;
}

export function getWorkerStatus() {
  return {
    running: isRunning,
    endpoints: getEndpointHealth(),
    workers: {
      worker1: { name: 'Current Mcap > $2M', interval: '10m' },
      worker2: { name: 'ATH Mcap > $4M', interval: '15m' },
      worker3: { name: 'Pre-ATH Early Buyers', interval: '3m' },
      worker4: { name: 'In-Memory Wallet Metrics', interval: '5m' },
      worker5: { name: 'Token ATH & Hit Rate', interval: '10m' },
      historicalSolanaDiscovery: { name: 'Solana 6-Month Harvest (Pump.fun + Gecko)', interval: '2h' },
      historicalRobinhoodDiscovery: { name: 'Robinhood 6-Month Harvest (GeckoTerminal + DexScreener)', interval: '2h' },
    },
  };
}
