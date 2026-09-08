// Bot manager: named strategies with entry filters and exit rules.
//
// Bots only ever react to CURATED tokens (the registry's quality gate), never
// the raw launch firehose. Two modes:
//   sniper — buy as soon as a token is curated and passes the bot's filters
//   agent  — stage the token on a watchlist first, then buy only after
//            traction confirms real buyers (watch → confirm → enter)
// Every decision (watch, skip, confirm, expire) is logged for auditability.
import { load, save } from '../store.js';
import { emit, log, onEvent } from '../bus.js';
import { executeBuy } from '../trading/executor.js';
import { openPosition, getPositions } from './positions.js';
import { config } from '../config.js';

export const PRESETS = {
  conservative: {
    mode: 'agent',
    buyAmountSol: 0.05, minSafetyScore: 75, minLiquidityUsd: 20000, maxTokenAgeMin: 45,
    slippagePct: 5, maxConcurrentPositions: 2,
    minTractionScore: 60, maxEntryPumpPct: 80, watchWindowMin: 30,
    takeProfitPct: 50, stopLossPct: 20, trailingStopPct: 15, maxHoldMin: 120,
  },
  standard: {
    mode: 'agent',
    buyAmountSol: 0.1, minSafetyScore: 60, minLiquidityUsd: 8000, maxTokenAgeMin: 40,
    slippagePct: 10, maxConcurrentPositions: 4,
    minTractionScore: 50, maxEntryPumpPct: 150, watchWindowMin: 20,
    takeProfitPct: 100, stopLossPct: 30, trailingStopPct: 20, maxHoldMin: 60,
  },
  degen: {
    mode: 'sniper',
    buyAmountSol: 0.2, minSafetyScore: 45, minLiquidityUsd: 4000, maxTokenAgeMin: 30,
    slippagePct: 20, maxConcurrentPositions: 8,
    minTractionScore: 30, maxEntryPumpPct: 300, watchWindowMin: 10,
    takeProfitPct: 300, stopLossPct: 50, trailingStopPct: 30, maxHoldMin: 30,
  },
};

const DEFAULT_BOT = {
  name: 'New bot',
  preset: 'standard',
  autoBuy: true,
  sources: ['pumpfun', 'raydium'],
  keywordBlacklist: [],
  creatorBlacklist: [],
  running: false,
  ...PRESETS.standard,
};

let bots = load('bots', []).map(b => ({
  mode: 'agent', minTractionScore: 50, maxEntryPumpPct: 150, watchWindowMin: 20, // defaults for pre-v2 bots
  ...b,
  running: false, // never auto-start on boot
}));
let listenerInstalled = false;

// watchlists: botId -> Map(mint -> {mint, symbol, addedAt, priceAtWatch, lastReason})
const watchlists = new Map();
// per-bot dedup of skip logging + buy attempts (mint-level, capped).
// Persisted so a restart can't re-buy a token a bot already decided on.
const decided = new Map(); // botId -> Map(mint -> 'skipped'|'bought'|'expired'|'failed')
const DECISION_TTL_MS = 7 * 24 * 3600_000;

(function loadDecisions() {
  const flat = load('bot-decisions', {});
  const now = Date.now();
  for (const [key, value] of Object.entries(flat)) {
    if (!value?.action || now - (value.at || 0) > DECISION_TTL_MS) continue;
    const sep = key.indexOf(':');
    if (sep < 1) continue;
    const botId = key.slice(0, sep);
    if (!decided.has(botId)) decided.set(botId, new Map());
    decided.get(botId).set(key.slice(sep + 1), value.action);
  }
})();

let decisionSaveTimer = null;
function persistDecisions() {
  if (decisionSaveTimer) return;
  decisionSaveTimer = setTimeout(() => {
    decisionSaveTimer = null;
    const flat = {};
    const now = Date.now();
    for (const [botId, map] of decided) {
      for (const [mint, action] of map) flat[`${botId}:${mint}`] = { action, at: now };
    }
    save('bot-decisions', flat);
  }, 1000);
}

function setDecision(botId, mint, action) {
  decisionsFor(botId).set(mint, action);
  persistDecisions();
}
// Track in-flight buys to prevent position cap overshoot
const inFlightBuys = new Set(); // Set of mint addresses currently being bought

function decisionsFor(botId) {
  if (!decided.has(botId)) decided.set(botId, new Map());
  const map = decided.get(botId);
  if (map.size > 2000) {
    // drop oldest half to bound memory
    const keys = [...map.keys()].slice(0, 1000);
    keys.forEach(k => map.delete(k));
  }
  return map;
}

function watchlistFor(botId) {
  if (!watchlists.has(botId)) watchlists.set(botId, new Map());
  return watchlists.get(botId);
}

export function getBots() {
  return bots.map(b => ({ ...b, watching: watchlistFor(b.id).size }));
}

export function getWatchlist() {
  const entries = [];
  for (const bot of bots) {
    for (const entry of watchlistFor(bot.id).values()) {
      entries.push({ ...entry, botId: bot.id, botName: bot.name });
    }
  }
  return entries.sort((a, b) => b.addedAt - a.addedAt);
}

export function createBot(input) {
  const bot = {
    ...DEFAULT_BOT,
    ...(input.preset && PRESETS[input.preset] ? PRESETS[input.preset] : {}),
    ...input,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    running: false,
    createdAt: Date.now(),
    stats: { buys: 0, skips: 0, watched: 0, confirmed: 0, expired: 0 },
  };
  bots.push(bot);
  save('bots', bots);
  emit('bot:status', { bot });
  return bot;
}

export function updateBot(id, patch) {
  const bot = bots.find(b => b.id === id);
  if (!bot) throw new Error('Bot not found');
  delete patch.id;
  delete patch.running; // use start/stop endpoints
  delete patch.stats;
  Object.assign(bot, patch);
  save('bots', bots);
  emit('bot:status', { bot });
  return bot;
}

export function deleteBot(id) {
  const bot = bots.find(b => b.id === id);
  if (!bot) throw new Error('Bot not found');
  bots = bots.filter(b => b.id !== id);
  watchlists.delete(id);
  decided.delete(id);
  save('bots', bots);
  emit('bot:status', { bot: { ...bot, deleted: true } });
}

export function startBot(id) {
  const bot = bots.find(b => b.id === id);
  if (!bot) throw new Error('Bot not found');
  if (!config.dryRun && (!config.liveTradingEnabled || !config.allowServerSigner)) {
    throw new Error('Live bots require both the live kill switch and the separately reviewed server signer');
  }
  bot.running = true;
  if (!bot.stats) bot.stats = { buys: 0, skips: 0, watched: 0, confirmed: 0, expired: 0 };
  save('bots', bots);
  ensureListener();
  emit('bot:status', { bot });
  log('info', `Bot "${bot.name}" started in ${bot.mode || 'agent'} mode${config.dryRun ? ' (paper)' : ' (LIVE)'}`);
  return bot;
}

export function stopBot(id) {
  const bot = bots.find(b => b.id === id);
  if (!bot) throw new Error('Bot not found');
  bot.running = false;
  watchlistFor(id).clear();
  save('bots', bots);
  emit('bot:status', { bot });
  log('info', `Bot "${bot.name}" stopped`);
  return bot;
}

function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;

  onEvent((event) => {
    // Curated tokens are the ONLY entry point into bot decision-making.
    if (event.type === 'token:curated') {
      for (const bot of bots.filter(b => b.running && b.autoBuy)) {
        onCurated(bot, event.token).catch(err =>
          log('error', `bot "${bot.name}" curated-handler failed: ${err.message}`));
      }
    }
    // Updates drive agent-mode confirmation and rug-abort of watchlist entries.
    if (event.type === 'token:update') {
      for (const bot of bots.filter(b => b.running && b.autoBuy && watchlistFor(b.id).has(event.token.mint))) {
        onWatchedUpdate(bot, event.token).catch(err =>
          log('error', `bot "${bot.name}" confirm-handler failed: ${err.message}`));
      }
    }
    if (event.type === 'token:discarded') {
      for (const bot of bots) {
        if (watchlistFor(bot.id).delete(event.token.mint)) {
          log('info', `Bot "${bot.name}" dropped ${event.token.symbol || event.token.mint.slice(0, 8)} from watchlist: ${event.token.discardReason}`);
          emit('bot:watching', { botId: bot.id });
        }
      }
    }
  });

  // Expire stale watchlist entries
  setInterval(() => {
    const now = Date.now();
    for (const bot of bots) {
      const wl = watchlistFor(bot.id);
      for (const [mint, entry] of wl) {
        const windowMs = (bot.watchWindowMin || 20) * 60_000;
        if (now - entry.addedAt > windowMs) {
          wl.delete(mint);
          bot.stats.expired = (bot.stats.expired || 0) + 1;
          setDecision(bot.id, mint, 'expired');
          log('info', `Bot "${bot.name}" watch expired for ${entry.symbol || mint.slice(0, 8)} (no confirmation in ${bot.watchWindowMin}min)`);
          emit('bot:watching', { botId: bot.id });
        }
      }
    }
  }, 30_000).unref?.();
}

// Static filters shared by both modes. Returns [] when the token qualifies.
function baseFilterReasons(bot, token) {
  const reasons = [];
  if (!bot.sources.includes(token.source)) reasons.push('wrong source');
  if ((token.safety?.score ?? 0) < bot.minSafetyScore) reasons.push(`score ${token.safety?.score ?? 0} < ${bot.minSafetyScore}`);
  if (bot.minLiquidityUsd && (token.liquidityUsd ?? 0) < bot.minLiquidityUsd) {
    reasons.push(`liquidity $${Math.round(token.liquidityUsd ?? 0)} < $${bot.minLiquidityUsd}`);
  }
  const ageMin = (Date.now() - token.createdAt) / 60_000;
  if (bot.maxTokenAgeMin && ageMin > bot.maxTokenAgeMin) reasons.push(`age ${ageMin.toFixed(1)}min > ${bot.maxTokenAgeMin}min`);

  const nameText = `${token.symbol || ''} ${token.name || ''}`.toLowerCase();
  if ((bot.keywordBlacklist || []).some(k => k && nameText.includes(k.toLowerCase()))) reasons.push('keyword blacklisted');
  if (token.creator && (bot.creatorBlacklist || []).includes(token.creator)) reasons.push('creator blacklisted');

  const openForBot = getPositions().filter(p => p.status === 'open' && p.botId === bot.id);
  if (openForBot.length >= bot.maxConcurrentPositions) reasons.push('max concurrent positions reached');
  if (openForBot.some(p => p.mint === token.mint)) reasons.push('already holding');
  if (inFlightBuys.has(token.mint)) reasons.push('buy in progress');
  return reasons;
}

async function onCurated(bot, token) {
  const decisions = decisionsFor(bot.id);
  // 'failed' stays eligible for one retry; everything else is final
  const prior = decisions.get(token.mint);
  if ((prior && prior !== 'failed') || watchlistFor(bot.id).has(token.mint)) return;

  const reasons = baseFilterReasons(bot, token);
  if (reasons.length > 0) {
    setDecision(bot.id, token.mint, 'skipped');
    bot.stats.skips = (bot.stats.skips || 0) + 1;
    log('info', `Bot "${bot.name}" skipped ${token.symbol || token.mint.slice(0, 8)}: ${reasons.join('; ')}`);
    return;
  }

  if ((bot.mode || 'agent') === 'sniper') {
    return buy(bot, token, 'sniper entry on curation');
  }

  // agent mode: put it on the watchlist and wait for traction confirmation
  watchlistFor(bot.id).set(token.mint, {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    addedAt: Date.now(),
    priceAtWatch: token.priceUsd,
    lastReason: 'waiting for traction confirmation',
  });
  bot.stats.watched = (bot.stats.watched || 0) + 1;
  log('info', `Bot "${bot.name}" watching ${token.symbol || token.mint.slice(0, 8)} (traction ${token.traction?.tractionScore ?? '?'}/${bot.minTractionScore} needed)`);
  emit('bot:watching', { botId: bot.id });
  save('bots', bots);

  // The token may already satisfy confirmation at curation time
  await onWatchedUpdate(bot, token);
}

async function onWatchedUpdate(bot, token) {
  const wl = watchlistFor(bot.id);
  const entry = wl.get(token.mint);
  if (!entry) return;

  // Re-run all base filters (blacklist, age, source, holdings, position cap)
  const baseReasons = baseFilterReasons(bot, token);
  if (baseReasons.length > 0) {
    entry.lastReason = baseReasons.join('; ');
    return;
  }

  const blockers = [];
  const traction = token.traction || {};
  if ((traction.tractionScore ?? 0) < bot.minTractionScore) {
    blockers.push(`traction ${traction.tractionScore ?? 0} < ${bot.minTractionScore}`);
  }
  if (traction.buySellRatio != null && traction.buySellRatio < 1.2) {
    blockers.push(`buy/sell ratio ${traction.buySellRatio.toFixed(2)} < 1.2`);
  }
  if (bot.minLiquidityUsd && (token.liquidityUsd ?? 0) < bot.minLiquidityUsd) {
    blockers.push('liquidity fell below threshold');
  }
  if (entry.priceAtWatch > 0 && token.priceUsd != null) {
    const pumpPct = ((token.priceUsd - entry.priceAtWatch) / entry.priceAtWatch) * 100;
    if (pumpPct > (bot.maxEntryPumpPct || 150)) {
      blockers.push(`already pumped +${pumpPct.toFixed(0)}% since watch (max ${bot.maxEntryPumpPct}%) — not chasing`);
    }
  }

  if (blockers.length > 0) {
    entry.lastReason = blockers.join('; ');
    return; // stay on watchlist until confirmation or expiry
  }

  wl.delete(token.mint);
  bot.stats.confirmed = (bot.stats.confirmed || 0) + 1;
  emit('bot:watching', { botId: bot.id });
  await buy(bot, token, `agent entry: traction ${traction.tractionScore}, b/s ${traction.buySellRatio?.toFixed(2) ?? 'n/a'}`);
}

async function buy(bot, token, reason) {
  const decisions = decisionsFor(bot.id);
  const prior = decisions.get(token.mint);
  if (prior === 'bought' || prior === 'failed-final') return;
  const isRetry = prior === 'failed';
  setDecision(bot.id, token.mint, 'bought'); // claim before async work to prevent double-buy
  persistDecisions();
  inFlightBuys.add(token.mint);

  log('info', `Bot "${bot.name}" BUYING ${token.symbol || token.mint.slice(0, 8)} — ${reason}`);
  try {
    const buyResult = await executeBuy(token, {
      solAmount: bot.buyAmountSol,
      slippagePct: bot.slippagePct,
    });
    buyResult.solSpent = bot.buyAmountSol;

    try {
      await openPosition(token, buyResult, {
        takeProfitPct: bot.takeProfitPct,
        stopLossPct: bot.stopLossPct,
        trailingStopPct: bot.trailingStopPct,
        maxHoldMin: bot.maxHoldMin,
        slippagePct: bot.slippagePct,
      }, bot.id);
      bot.stats.buys = (bot.stats.buys || 0) + 1;
    } catch (bookErr) {
      // Execution SUCCEEDED (SOL spent) but bookkeeping failed — a retry here
      // would double-buy on-chain. Mark final; the fill is reconciled manually.
      setDecision(bot.id, token.mint, 'failed-final');
      log('error', `Bot "${bot.name}" booked position failed AFTER buy of ${token.symbol || token.mint.slice(0, 8)} — NOT retrying (reconcile manually): ${bookErr.message}`);
    }
  } catch (err) {
    // one retry allowed: first failure stays eligible, second is final
    setDecision(bot.id, token.mint, isRetry ? 'failed-final' : 'failed');
    log('error', `Bot "${bot.name}" buy failed for ${token.symbol || token.mint.slice(0, 8)}: ${err.message}`);
  } finally {
    inFlightBuys.delete(token.mint);
  }
  save('bots', bots);
  emit('bot:status', { bot });
}
