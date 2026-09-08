// GMGN discovery via the official gmgn-cli (Agent API path).
// Covers Solana + Robinhood with trending rank + trenches early discovery.
// Server-side only: GMGN_API_KEY comes from process.env (backend/.env).
// This adapter only discovers + registers; it never buys (see engine/botManager.js).
import { execFile } from 'node:child_process';
import { emit, log } from '../bus.js';
import { getTokenByKey, getTokenByMint, registerToken } from './registry.js';

export const GMGN_CHAINS = {
  solana: { cliChain: 'sol', chainId: null, minLiquidityUsd: 5000 },
  robinhood: { cliChain: 'robinhood', chainId: 4663, minLiquidityUsd: 5000 },
};

const TRENDING_INTERVALS = ['5m', '1h'];
const TRENCH_TYPES = ['new_creation', 'near_completion', 'completed'];
const POLL_INTERVAL_MS = 60_000;
const CLI_TIMEOUT_MS = 30_000;

// GMGN platform names → internal launchpad vocabulary (scope/chainScope.js).
// Solana pump.fun tokens must map to 'pumpfun' to receive full RPC analysis;
// unknown platforms pass through untouched (treated as unscored, never zero).
const LAUNCHPAD_ALIAS = {
  'pump.fun': 'pumpfun',
  pump: 'pumpfun',
  pump_amm: 'pumpfun',
  pump_mayhem: 'pumpfun',
  letsbonk: 'letsbonk',
  bonk: 'letsbonk',
};

export function aliasLaunchpad(value) {
  if (value == null) return null;
  const key = String(value).trim();
  return LAUNCHPAD_ALIAS[key] ?? LAUNCHPAD_ALIAS[key.toLowerCase()] ?? key;
}

let timers = [];
let missingKeyWarned = false;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct2(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100 * 100) / 100;
}

function toMs(ts) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

function baseToken(item, chain, source, { enforceLiquidityFloor = true } = {}) {
  const address = String(item?.address || '');
  if (!address) return null;
  const mint = chain === 'solana' ? address : address.toLowerCase();
  const liquidityUsd = num(item?.liquidity);
  const floor = GMGN_CHAINS[chain]?.minLiquidityUsd ?? 5000;
  // Trenches carry brand-new launches with ~0 liquidity; they enter as raw
  // `watching` observations and must pass the registry curation gate later.
  if (enforceLiquidityFloor && liquidityUsd != null && liquidityUsd < floor) return null;
  const createdAt = toMs(item?.creation_timestamp)
    ?? toMs(item?.created_timestamp)
    ?? toMs(item?.open_timestamp)
    ?? toMs(item?.complete_timestamp)
    ?? Date.now();
  const buys = num(item?.buys);
  const sells = num(item?.sells);
  return {
    mint,
    chain,
    symbol: item?.symbol || '?',
    name: item?.name || item?.symbol || 'Unknown',
    imageUrl: item?.logo || null,
    source,
    createdAt,
    priceUsd: num(item?.price),
    liquidityUsd,
    marketCapUsd: num(item?.market_cap),
    volume24hUsd: num(item?.volume),
    volume1hUsd: null,
    volume5mUsd: null,
    txns: buys != null || sells != null ? { h24: { buys: buys ?? 0, sells: sells ?? 0 } } : {},
    priceChange: {
      m1: num(item?.price_change_percent1m),
      m5: num(item?.price_change_percent5m),
      h1: num(item?.price_change_percent1h),
      h24: num(item?.price_change_percent),
    },
    holderCount: num(item?.holder_count),
    top10HolderPct: pct2(item?.top_10_holder_rate),
    smartWallets: num(item?.smart_degen_count),
    renownedCount: num(item?.renowned_count),
    snipers: num(item?.sniper_count),
    bundlerPct: pct2(item?.bundler_rate),
    rugRatio: num(item?.rug_ratio),
    bluechipPct: item?.bluechip_owner_percentage != null ? pct2(item.bluechip_owner_percentage / 100) : null,
    ratTraderRate: num(item?.rat_trader_amount_rate),
    botDegenRate: num(item?.bot_degen_rate),
    renouncedMint: item?.renounced_mint === 1,
    renouncedFreeze: item?.renounced_freeze_account === 1,
    burnStatus: item?.burn_status ?? null,
    honeypot: item?.is_honeypot === 1,
    washTrading: Boolean(item?.is_wash_trading),
    buyTax: item?.buy_tax ?? null,
    sellTax: item?.sell_tax ?? null,
    lockPercent: num(item?.lock_percent),
    launchpad: aliasLaunchpad(item?.launchpad_platform) ?? aliasLaunchpad(item?.launchpad),
    dexId: item?.exchange || item?.migrated_pool_exchange || null,
    creator: item?.creator || null,
    creatorStatus: item?.creator_token_status ?? null,
    socials: {
      twitter: item?.twitter_username || null,
      website: item?.website || null,
      telegram: item?.telegram || null,
    },
  };
}

/**
 * Normalize one `market trending --raw` rank item. Pure; exported for tests.
 * Returns null when the item has no address or is below the liquidity floor.
 */
export function normalizeGmgnRankItem(item, chain) {
  if (!GMGN_CHAINS[chain]) return null;
  return baseToken(item, chain, 'gmgn-trending');
}

/**
 * Normalize one `market trenches --raw` item, tagged with its trench type.
 * Pure; exported for tests.
 */
export function normalizeTrenchesItem(item, chain, trenchType) {
  if (!GMGN_CHAINS[chain]) return null;
  const token = baseToken(item, chain, 'gmgn-trenches', { enforceLiquidityFloor: false });
  if (!token) return null;
  return { ...token, trenchType };
}

/**
 * Run gmgn-cli with --raw and parse the JSON envelope.
 * Resolves to the parsed object ({ code, data, ... }). Rejects on
 * non-zero exit, timeout, or unparseable output.
 */
export function runGmgnCli(args, { timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gmgn-cli', [...args, '--raw'], {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env },
      // npm global bins are .cmd shims on Windows; they need a shell to spawn.
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`gmgn-cli ${args.slice(0, 2).join(' ')} failed: ${error.message}${stderr ? ` — ${String(stderr).slice(0, 200)}` : ''}`));
        return;
      }
      try {
        resolve(JSON.parse(String(stdout)));
      } catch (parseError) {
        reject(new Error(`gmgn-cli returned unparseable JSON: ${parseError.message}`));
      }
    });
  });
}

function rankList(parsed) {
  const rank = parsed?.data?.rank;
  return Array.isArray(rank) ? rank : [];
}

/** Fetch trending items for one chain+interval (raw CLI items, not normalized). */
export async function fetchTrending(chain, { interval = '1h', limit = 50, orderBy = 'volume' } = {}) {
  const cfg = GMGN_CHAINS[chain];
  if (!cfg) throw new Error(`Unsupported GMGN chain: ${chain}`);
  const parsed = await runGmgnCli([
    'market', 'trending',
    '--chain', cfg.cliChain,
    '--interval', interval,
    '--order-by', orderBy,
    '--limit', String(limit),
  ]);
  return rankList(parsed);
}

/**
 * Fetch trenches buckets for one chain.
 * Returns { new_creation: [], near_completion: [], completed: [] } of raw items.
 */
export async function fetchTrenches(chain, { types = TRENCH_TYPES, limit = 50 } = {}) {
  const cfg = GMGN_CHAINS[chain];
  if (!cfg) throw new Error(`Unsupported GMGN chain: ${chain}`);
  const args = ['market', 'trenches', '--chain', cfg.cliChain, '--limit', String(limit)];
  for (const type of types) args.push('--type', type);
  const parsed = await runGmgnCli(args);
  // `trenches --raw` returns buckets at the top level
  // ({ new_creation, near_completion, completed }); accept a data wrapper too.
  const data = parsed?.data ?? parsed ?? {};
  const out = {};
  for (const type of types) out[type] = Array.isArray(data[type]) ? data[type] : [];
  return out;
}

function isKnown(token) {
  return getTokenByKey(`${token.chain}:${token.mint}`) || getTokenByMint(token.mint) || null;
}

async function pollOnce({ intervals = TRENDING_INTERVALS, trenchTypes = TRENCH_TYPES } = {}) {
  if (!process.env.GMGN_API_KEY) {
    if (!missingKeyWarned) {
      missingKeyWarned = true;
      log('warn', 'GMGN feeds skipped — set GMGN_API_KEY in backend/.env');
    }
    return;
  }
  for (const chain of Object.keys(GMGN_CHAINS)) {
    for (const interval of intervals) {
      try {
        const items = await fetchTrending(chain, { interval });
        let added = 0;
        for (const item of items) {
          const token = normalizeGmgnRankItem(item, chain);
          if (!token || isKnown(token)) continue;
          registerToken(token);
          added++;
        }
        if (added > 0) log('info', `GMGN ${chain} ${interval}: ${added} new token(s)`);
      } catch (error) {
        log('warn', `GMGN ${chain} ${interval} poll failed: ${error.message}`);
      }
    }
    try {
      const buckets = await fetchTrenches(chain, { types: trenchTypes });
      let added = 0;
      for (const trenchType of trenchTypes) {
        for (const item of buckets[trenchType] || []) {
          const token = normalizeTrenchesItem(item, chain, trenchType);
          if (!token || isKnown(token)) continue;
          registerToken(token);
          added++;
        }
      }
      if (added > 0) log('info', `GMGN ${chain} trenches: ${added} new token(s)`);
    } catch (error) {
      log('warn', `GMGN ${chain} trenches poll failed: ${error.message}`);
    }
  }
}

/** Start polling GMGN trending + trenches for solana + robinhood. */
export function startGmgnFeeds(options = {}) {
  pollOnce(options).catch(error => log('warn', `GMGN initial poll failed: ${error.message}`));
  const timer = setInterval(() => {
    pollOnce(options).catch(error => log('warn', `GMGN poll failed: ${error.message}`));
  }, options.pollIntervalMs ?? POLL_INTERVAL_MS);
  timer.unref?.();
  timers.push(timer);
  log('info', 'GMGN feeds started (60s poll, solana + robinhood)');
  emit('gmgn:started', { chains: Object.keys(GMGN_CHAINS) });
}

/** Stop all GMGN feeds. */
export function stopGmgnFeeds() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
