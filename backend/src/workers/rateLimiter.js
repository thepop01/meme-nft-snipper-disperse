const DEFAULT_CONFIGS = {
  dexscreener: { baseDelayMs: 1000, maxDelayMs: 10000 },
  geckoterminal: { baseDelayMs: 1500, maxDelayMs: 15000 },
  gmgn: { baseDelayMs: 1500, maxDelayMs: 20000 },
  default: { baseDelayMs: 1500, maxDelayMs: 15000 },
};

const state = {};

function getSourceState(source) {
  if (!state[source]) {
    const conf = DEFAULT_CONFIGS[source] || DEFAULT_CONFIGS.default;
    state[source] = {
      source,
      status: 'healthy',
      currentDelayMs: conf.baseDelayMs,
      baseDelayMs: conf.baseDelayMs,
      maxDelayMs: conf.maxDelayMs,
      consecutiveErrors: 0,
      successCount: 0,
      failureCount: 0,
      lastError: null,
      coolingUntil: 0,
      lastCallTs: 0,
    };
  }
  return state[source];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function executeWithThrottle(sourceName, asyncFn) {
  const s = getSourceState(sourceName);
  const now = Date.now();

  if (s.coolingUntil > now) {
    s.failureCount++;
    throw new Error(`Endpoint ${sourceName} is cooling down until ${new Date(s.coolingUntil).toISOString()}`);
  }

  const elapsed = now - s.lastCallTs;
  if (elapsed < s.currentDelayMs) {
    await sleep(s.currentDelayMs - elapsed);
  }

  s.lastCallTs = Date.now();

  try {
    const res = await asyncFn();
    s.successCount++;
    s.consecutiveErrors = 0;
    s.status = 'healthy';
    s.currentDelayMs = Math.max(s.baseDelayMs, s.currentDelayMs - 100);
    return res;
  } catch (err) {
    s.failureCount++;
    s.consecutiveErrors++;
    s.lastError = err?.message || String(err);
    s.currentDelayMs = Math.min(s.maxDelayMs, s.currentDelayMs * 2);

    const isRateLimit =
      err?.status === 429 ||
      err?.status === 403 ||
      String(err?.message || '').includes('429') ||
      String(err?.message || '').includes('403');

    if (s.consecutiveErrors >= 3 || isRateLimit) {
      s.status = 'cooling_down';
      s.coolingUntil = Date.now() + 60_000;
    } else {
      s.status = 'degraded';
    }
    throw err;
  }
}

export function getEndpointHealth() {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    out[k] = { ...v };
  }
  return out;
}

export function resetRateLimiter() {
  for (const k of Object.keys(state)) {
    delete state[k];
  }
}
