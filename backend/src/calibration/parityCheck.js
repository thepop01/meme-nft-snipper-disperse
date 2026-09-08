// Operational replay/live parity (§22 invariant, §19.5 condition 5).
//
// The unit test in features/__tests__/parity.test.js proves live and replay are the SAME
// function. This check proves the tape ROUND-TRIP does not change the answer: JSONB coerces
// numbers to strings, drops precision, and reorders keys. Comparing extractAllFeatures against
// causalFeatures on the same in-memory array — as this module previously did — compares a
// value with itself and can never fail.
import { extractAllFeatures, causalFeatures } from '../features/extract.js';

const EPS = 1e-9;

export function compareFeatures(live, replay, path = '') {
  const diffs = [];

  // Arrays are compared element-wise; reference equality would flag identical
  // arrays as diffs and permanently fail the parity gate.
  if (Array.isArray(live) || Array.isArray(replay)) {
    if (!Array.isArray(live) || !Array.isArray(replay) || live.length !== replay.length) {
      return [{ path: path || '<root>', live: Array.isArray(live) ? `array(${live.length})` : live,
        replay: Array.isArray(replay) ? `array(${replay.length})` : replay }];
    }
    for (let i = 0; i < live.length; i++) {
      diffs.push(...compareFeatures(live[i], replay[i], `${path}[${i}]`));
    }
    return diffs;
  }

  if (live && replay && typeof live === 'object' && typeof replay === 'object') {
    const keys = new Set([...Object.keys(live), ...Object.keys(replay)]);
    for (const key of keys) {
      const at = path ? `${path}.${key}` : key;
      diffs.push(...compareFeatures(live[key], replay[key], at));
    }
    return diffs;
  }

  const bothNumbers = typeof live === 'number' && typeof replay === 'number';
  if (!bothNumbers && (typeof live === 'bigint' || typeof replay === 'bigint')) {
    // Strict: bigint vs number/string is a difference even when values look equal.
    if (live !== replay) diffs.push({ path: path || '<root>', live: String(live), replay: String(replay) });
    return diffs;
  }
  if (bothNumbers) {
    if (Math.abs(live - replay) > EPS) diffs.push({ path: path || '<root>', live, replay });
    return diffs;
  }
  // Strict elsewhere: null vs 0, and 1000 vs '1000', ARE differences.
  if (live !== replay) diffs.push({ path: path || '<root>', live, replay });
  return diffs;
}

export async function checkParity(tape, assetKey, asOf, opts = {}) {
  const { liveEvents, extract = extractAllFeatures, replay = causalFeatures, ...rest } = opts;

  // Without an independently-captured live event array there is nothing to compare against.
  // Returning ok:true here is how the GO gate was being satisfied vacuously.
  if (!liveEvents) return { ok: false, reason: 'no_live_events', diffs: [] };

  try {
    const liveFeatures = extract(liveEvents, { ...rest, nowTs: asOf });
    const replayFeatures = await replay(tape, assetKey, asOf, rest);
    const diffs = compareFeatures(liveFeatures, replayFeatures);
    return { ok: diffs.length === 0, diffs, live: liveFeatures, replay: replayFeatures };
  } catch (error) {
    // A throw is a failure. Swallowing it would turn an outage into a green check.
    return { ok: false, error: String(error.message ?? error), diffs: [] };
  }
}
