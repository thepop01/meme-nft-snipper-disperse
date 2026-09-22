import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { executeWithThrottle } from '../workers/rateLimiter.js';
import { fetchMadeOnSolAlphaLeaderboard } from './adapters/madeonsol.js';
import { fetchHeliusTrades, fetchGeckoTerminalRobinhoodTrades } from '../workers/worker3EarlyBuyers.js';
import { getTrackedMemes } from '../workers/memeRegistry.js';
import { loadWallets } from './tracker.js';
import { persistWallets } from './persist.js';
import { log } from '../bus.js';
import { isEvmAddress, isSolAddress } from './addresses.js';

/**
 * Execute GMGN CLI via local node entrypoint or system binary.
 */
export async function runGmgnCli(args = []) {
  return new Promise((resolve, reject) => {
    let cliJs = null;
    if (process.env.APPDATA) {
      const p = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js');
      if (fs.existsSync(p)) cliJs = p;
    }

    if (cliJs) {
      execFile(process.execPath, [cliJs, ...args], { timeout: 20000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        return resolve(stdout);
      });
    } else {
      const cmd = process.platform === 'win32' ? 'gmgn-cli.cmd' : 'gmgn-cli';
      execFile(cmd, args, { timeout: 20000, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
        if (err) return reject(err);
        return resolve(stdout);
      });
    }
  });
}

/**
 * Normalizes GMGN token sniper response payload into standard sniper records.
 */
export function normalizeGmgnSniperPayload(ca, payload, defaultChain = 'solana') {
  if (!payload || typeof payload !== 'object') return [];

  const rawList = payload?.data?.snipers || payload?.snipers || payload?.list || payload?.data?.traders || payload?.data || (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(rawList)) return [];

  const isEvmToken = (typeof ca === 'string' && ca.startsWith('0x')) || defaultChain === 'robinhood';
  const chain = isEvmToken ? 'robinhood' : 'solana';

  const out = [];
  for (const s of rawList) {
    if (!s || typeof s !== 'object') continue;
    const addr = s.address || s.wallet || s.wallet_address || s.maker;
    if (!addr) continue;

    const valid = chain === 'robinhood' ? isEvmAddress(addr) : isSolAddress(addr);
    if (!valid) continue;

    const normAddr = chain === 'robinhood' ? addr.toLowerCase() : addr;
    const pnlUsd = Number(s.realized_pnl ?? s.realized_profit ?? s.profit_usd ?? s.profit ?? s.pnl_usd ?? 0);
    const snipeCost = Number(s.buy_volume_cur ?? s.cost ?? s.cost_cur ?? s.buy_volume ?? s.snipe_cost ?? s.cost_usd ?? 0);
    const holdSeconds = Number(
      s.hold_time ||
      s.holding_time_seconds ||
      (s.end_holding_at && s.start_holding_at ? (s.end_holding_at - s.start_holding_at) : 0)
    );

    out.push({
      address: normAddr,
      chain,
      category: 'tracked',
      source: 'gmgn_sniper',
      score: pnlUsd,
      hits: 1,
      realizedProfitUsd: pnlUsd,
      tags: [
        'sniper',
        'gmgn_sniper',
        'alpha_buyer',
        pnlUsd > 1000 ? 'profitable_sniper' : null,
      ].filter(Boolean),
      evidence: {
        platform: 'gmgn.ai',
        type: 'token_sniper',
        mint: ca,
        snipeCostUsd: snipeCost,
        holdingTimeSeconds: holdSeconds,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Fetch meme-wise snipers from GMGN for a specific token mint.
 */
export async function fetchGmgnTokenSnipers(ca, chain = 'solana') {
  if (!ca || typeof ca !== 'string') return [];

  const isEvmToken = ca.startsWith('0x') || chain === 'robinhood';
  const targetChain = isEvmToken ? 'robinhood' : 'solana';
  const cliChain = isEvmToken ? 'robinhood' : 'sol';

  // 1. Try official GMGN CLI gateway first
  try {
    const rawStdout = await executeWithThrottle('gmgn', async () => {
      return await runGmgnCli([
        'token',
        'traders',
        '--chain',
        cliChain,
        '--address',
        ca,
        '--tag',
        'sniper',
        '--raw',
      ]);
    });

    const parsed = JSON.parse(rawStdout);
    const snipers = normalizeGmgnSniperPayload(ca, parsed, targetChain);
    if (snipers.length > 0) return snipers;
  } catch (cliErr) {
    log('debug', `[sniperHarvester] GMGN CLI traders for ${ca} failed (${cliErr.message}), trying HTTP fallback`);
  }

  // 2. Fallback to HTTP API (primarily for Solana tokens if Cloudflare permits)
  if (!isEvmToken) {
    try {
      const data = await executeWithThrottle('gmgn', async () => {
        const url = `https://gmgn.ai/defi/quotation/v1/tokens/sol/${ca}/snipers`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!res.ok) throw new Error(`GMGN status ${res.status}`);
        return res.json();
      });

      return normalizeGmgnSniperPayload(ca, data, 'solana');
    } catch (err) {
      log('debug', `[sniperHarvester] GMGN HTTP snipers for ${ca} unavailable: ${err.message}`);
    }
  }

  return [];
}

/**
 * Harvest top snipers from MadeOnSol Alpha Leaderboard.
 */
export async function harvestMadeOnSolSnipers({
  limit = 50,
  maxPages = 3,
  customFetcher = null,
} = {}) {
  const discovered = new Map();

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    let snipers = [];

    try {
      if (customFetcher) {
        snipers = await customFetcher({ limit, offset });
      } else {
        snipers = await fetchMadeOnSolAlphaLeaderboard({ limit, offset });
      }
    } catch (err) {
      log('warn', `[sniperHarvester] MadeOnSol fetch page ${page} error: ${err.message}`);
      break;
    }

    if (!Array.isArray(snipers) || snipers.length === 0) break;

    for (const s of snipers) {
      if (s.address && isSolAddress(s.address) && !discovered.has(s.address)) {
        discovered.set(s.address, s);
      }
    }

    if (!customFetcher && snipers.length < limit) break;
  }

  return Array.from(discovered.values());
}

/**
 * Harvest slot-0 / earliest transaction bundle snipers for Pump.fun runner memes.
 */
export async function harvestPumpFunSlot0Snipers(memes = [], {
  maxMemes = 10,
  maxPerMeme = 10,
  customTradesFetcher = null,
} = {}) {
  const discovered = new Map();
  const pumpMemes = memes
    .filter(m => m.chain === 'solana' && (m.sourceFlags?.includes('pumpfun') || m.ca?.endsWith('pump')))
    .slice(0, maxMemes);

  for (const meme of pumpMemes) {
    let trades = [];
    try {
      if (customTradesFetcher) {
        trades = await customTradesFetcher(meme.ca);
      } else {
        trades = await fetchHeliusTrades(meme.ca);
      }
    } catch (err) {
      log('debug', `[sniperHarvester] Slot-0 trades lookup for ${meme.ca} failed: ${err.message}`);
      continue;
    }

    if (!Array.isArray(trades) || trades.length === 0) continue;

    // Take the earliest chronological opening trades as slot-0 / bundle snipers
    const earliestBuys = trades.slice(0, maxPerMeme);
    let rank = 1;

    for (const t of earliestBuys) {
      const addr = t.wallet || t.address;
      if (!addr || !isSolAddress(addr) || discovered.has(addr)) continue;

      discovered.set(addr, {
        address: addr,
        chain: 'solana',
        category: 'tracked',
        source: 'pumpfun_slot0',
        score: t.pnl || 1,
        hits: 1,
        tags: [
          'sniper',
          'pumpfun_sniper',
          rank <= 3 ? 'slot0_bundle_sniper' : 'early_sniper',
          meme.symbol ? `sniper_${meme.symbol}` : null,
        ].filter(Boolean),
        evidence: {
          platform: 'pump.fun',
          type: 'slot0_sniper',
          mint: meme.ca,
          symbol: meme.symbol,
          rank,
          timestamp: t.timestamp || null,
          importedAt: new Date().toISOString(),
        },
      });

      rank++;
    }
  }

  return Array.from(discovered.values());
}

/**
 * Harvest meme-wise snipers from GMGN for tracked runner memes across Solana and Robinhood.
 */
export async function harvestGmgnMemeSnipers(memes = [], {
  maxMemes = 15,
  customGmgnFetcher = null,
} = {}) {
  const discovered = new Map();
  const targetMemes = memes.slice(0, maxMemes);

  for (const meme of targetMemes) {
    let snipers = [];
    try {
      if (customGmgnFetcher) {
        snipers = await customGmgnFetcher(meme.ca);
      } else {
        snipers = await fetchGmgnTokenSnipers(meme.ca, meme.chain || 'solana');
      }
    } catch {
      continue;
    }

    for (const s of (snipers || [])) {
      const isRobinhood = s.chain === 'robinhood' || meme.chain === 'robinhood' || (typeof s.address === 'string' && s.address.startsWith('0x'));
      const valid = isRobinhood ? isEvmAddress(s.address) : isSolAddress(s.address);
      if (s.address && valid) {
        const normAddr = isRobinhood ? s.address.toLowerCase() : s.address;
        if (!discovered.has(normAddr)) {
          discovered.set(normAddr, {
            ...s,
            address: normAddr,
            chain: isRobinhood ? 'robinhood' : (s.chain || 'solana'),
          });
        }
      }
    }
  }

  return Array.from(discovered.values());
}

/**
 * Harvest earliest DEX swap snipers for Robinhood Chain runner memes.
 */
export async function harvestRobinhoodDexSnipers(memes = [], {
  maxPerMeme = 10,
  customTradesFetcher = null,
} = {}) {
  const discovered = new Map();
  const rhMemes = memes.filter(m => m.chain === 'robinhood' && m.poolAddress);

  for (const meme of rhMemes) {
    let trades = [];
    try {
      if (customTradesFetcher) {
        trades = await customTradesFetcher(meme.ca, { poolAddress: meme.poolAddress });
      } else {
        trades = await fetchGeckoTerminalRobinhoodTrades(meme.ca, { poolAddress: meme.poolAddress });
      }
    } catch (err) {
      log('debug', `[sniperHarvester] Robinhood DEX trades lookup for ${meme.ca} failed: ${err.message}`);
      continue;
    }

    if (!Array.isArray(trades) || trades.length === 0) continue;

    // Filter buy trades and sort chronologically
    const buyTrades = trades
      .filter(t => (t.kind === 'buy' || !t.kind) && t.wallet && isEvmAddress(t.wallet))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(0, maxPerMeme);

    let rank = 1;
    for (const t of buyTrades) {
      const normAddr = t.wallet.toLowerCase();
      if (discovered.has(normAddr)) continue;

      discovered.set(normAddr, {
        address: normAddr,
        chain: 'robinhood',
        category: 'tracked',
        source: 'robinhood_dex_sniper',
        score: t.volumeUsd || 1,
        hits: 1,
        tags: [
          'sniper',
          'robinhood_dex_sniper',
          rank <= 3 ? 'slot0_dex_sniper' : 'early_dex_buyer',
          meme.symbol ? `sniper_${meme.symbol}` : null,
        ].filter(Boolean),
        evidence: {
          platform: 'robinhood_dex',
          type: 'dex_pool_sniper',
          ca: meme.ca,
          poolAddress: meme.poolAddress,
          symbol: meme.symbol,
          rank,
          timestamp: t.timestamp || null,
          importedAt: new Date().toISOString(),
        },
      });

      rank++;
    }
  }

  return Array.from(discovered.values());
}

/**
 * Master Dual-Chain Sniper Harvesting Engine.
 * Ingests snipers from MadeOnSol, Pump.fun slot-0, GMGN, and Robinhood DEX.
 * STRICT ZERO RAW TRANSACTION STORAGE: only wallet metrics and tags are persisted.
 */
export async function runDualChainSniperHarvest({
  memes = null,
  maxMadeOnSolPages = 3,
  customMadeOnSolFetcher = null,
  customPumpTradesFetcher = null,
  customGmgnFetcher = null,
  customRobinhoodTradesFetcher = null,
  db = null,
} = {}) {
  log('info', '[sniperHarvester] Starting dual-chain sniper harvesting engine');

  const targetMemes = memes || getTrackedMemes();
  const initialStore = loadWallets();
  const existingWallets = initialStore.wallets || [];

  // 1. MadeOnSol Alpha Leaderboard Snipers (Solana)
  const madeOnSolSnipers = await harvestMadeOnSolSnipers({
    limit: 50,
    maxPages: maxMadeOnSolPages,
    customFetcher: customMadeOnSolFetcher,
  });
  log('info', `[sniperHarvester] Harvested ${madeOnSolSnipers.length} MadeOnSol snipers`);

  // 2. Pump.fun Slot-0 / Early Bundle Snipers (Solana)
  const pumpSlot0Snipers = await harvestPumpFunSlot0Snipers(targetMemes, {
    maxPerMeme: 5,
    customTradesFetcher: customPumpTradesFetcher,
  });
  log('info', `[sniperHarvester] Harvested ${pumpSlot0Snipers.length} Pump.fun slot-0 snipers`);

  // 3. GMGN Meme-Wise Snipers (Solana)
  const gmgnSnipers = await harvestGmgnMemeSnipers(targetMemes, {
    maxMemes: 10,
    customGmgnFetcher: customGmgnFetcher,
  });
  log('info', `[sniperHarvester] Harvested ${gmgnSnipers.length} GMGN meme snipers`);

  // 4. Robinhood DEX Pool Early Snipers (Robinhood Chain)
  const robinhoodDexSnipers = await harvestRobinhoodDexSnipers(targetMemes, {
    maxPerMeme: 10,
    customTradesFetcher: customRobinhoodTradesFetcher,
  });
  log('info', `[sniperHarvester] Harvested ${robinhoodDexSnipers.length} Robinhood DEX snipers`);

  // Combine and deduplicate across all sniper batches
  const allNewSnipers = [
    ...madeOnSolSnipers,
    ...pumpSlot0Snipers,
    ...gmgnSnipers,
    ...robinhoodDexSnipers,
  ];

  // Merge into smart wallets store and database
  const merged = await persistWallets(db, allNewSnipers);

  log('info', `[sniperHarvester] Sniper harvest complete. Ingested ${allNewSnipers.length} snipers into store. Total smart wallets: ${merged.length}`);

  return {
    totalHarvested: allNewSnipers.length,
    madeOnSolCount: madeOnSolSnipers.length,
    pumpSlot0Count: pumpSlot0Snipers.length,
    gmgnCount: gmgnSnipers.length,
    robinhoodDexCount: robinhoodDexSnipers.length,
    totalStoreWallets: merged.length,
  };
}
