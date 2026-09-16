const DEFAULT_CONFIGS = {
  dexscreener: { baseDelayMs: 1000, maxDelayMs: 10000 },
  geckoterminal: { baseDelayMs: 1500, maxDelayMs: 15000 },
  gmgn: { baseDelayMs: 1500, maxDelayMs: 20000 },
  birdeye: { baseDelayMs: 1500, maxDelayMs: 8000 },
  pumpfun: { baseDelayMs: 1000, maxDelayMs: 10000 },
  helius: { baseDelayMs: 250, maxDelayMs: 5000 },
  solscan: { baseDelayMs: 1000, maxDelayMs: 10000 },
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
      queue: Promise.resolve(),
    };
  }
  return state[source];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isRateLimitError(err) {
  if (!err) return false;

  const candidates = [
    err.status,
    err.statusCode,
    err.status_code,
    err.response?.status,
    err.response?.statusCode,
    err.response?.status_code,
    err.code,
  ];

  for (const val of candidates) {
    if (val === 429 || val === 403 || val === '429' || val === '403') {
      return true;
    }
  }

  const msg = String(err.message || err || '');
  if (msg.includes('429') || msg.includes('403')) {
    return true;
  }

  return false;
}

export async function executeWithThrottle(sourceName, asyncFn) {
  const s = getSourceState(sourceName);

  // Serialize per-source execution using a promise chain mutex queue
  const prev = s.queue || Promise.resolve();
  let release;
  s.queue = new Promise(resolve => {
    release = resolve;
  });

  await prev.catch(() => {});

  try {
    const now = Date.now();
    if (s.coolingUntil > 0 && now >= s.coolingUntil && s.status === 'cooling_down') {
      s.status = 'degraded';
    }

    if (s.coolingUntil > now) {
      s.failureCount++;
      throw new Error(`Endpoint ${sourceName} is cooling down until ${new Date(s.coolingUntil).toISOString()}`);
    }

    const elapsed = now - s.lastCallTs;
    if (elapsed < s.currentDelayMs) {
      await sleep(s.currentDelayMs - elapsed);
    }

    // Re-check cooldown after waiting (in case a concurrent call tripped the circuit breaker)
    const postWaitNow = Date.now();
    if (s.coolingUntil > postWaitNow) {
      s.failureCount++;
      throw new Error(`Endpoint ${sourceName} is cooling down until ${new Date(s.coolingUntil).toISOString()}`);
    }

    s.lastCallTs = Date.now();

    const res = await asyncFn();
    s.successCount++;
    s.consecutiveErrors = 0;
    s.status = 'healthy';
    s.coolingUntil = 0;
    s.currentDelayMs = Math.max(s.baseDelayMs, s.currentDelayMs - 100);
    return res;
  } catch (err) {
    if (s.coolingUntil <= Date.now()) {
      s.failureCount++;
      s.consecutiveErrors++;
      s.lastError = err?.message || String(err);
      s.currentDelayMs = Math.min(s.maxDelayMs, s.currentDelayMs * 2);

      const isRateLimit = isRateLimitError(err);
      if (s.consecutiveErrors >= 3 || isRateLimit) {
        s.status = 'cooling_down';
        s.coolingUntil = Date.now() + 60_000;
      } else {
        s.status = 'degraded';
      }
    }
    throw err;
  } finally {
    release();
  }
}

export function getEndpointHealth() {
  const now = Date.now();
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (v.coolingUntil > 0 && now >= v.coolingUntil && v.status === 'cooling_down') {
      v.status = 'degraded';
    }
    const { queue, ...rest } = v;
    out[k] = { ...rest };
  }
  return out;
}

export function resetRateLimiter() {
  for (const k of Object.keys(state)) {
    delete state[k];
  }
}
