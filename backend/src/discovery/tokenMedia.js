// Resolves pump.fun-style metadata URIs (…/*.json) into the real image URL.
// Metadata hosts rate-limit hard, so lookups are cached and concurrency-capped.
const cache = new Map();   // uri -> imageUrl | null (null = resolved, no image)
let active = 0;
const queue = [];
const MAX_CONCURRENT = 4;
const TIMEOUT_MS = 8_000;

export function isMetadataUri(url) {
  return typeof url === 'string' && /\.json($|\?)/i.test(url);
}

// Browsers can't load ipfs:// URIs — rewrite them to an https gateway.
// Non-ipfs input (including null) passes through untouched.
export function toGatewayUrl(url) {
  const m = /^ipfs:\/\/([^/][\s\S]*)$/.exec(String(url || '').trim());
  return m ? 'https://ipfs.io/ipfs/' + m[1] : url;
}

function next() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  active++;
  const job = queue.shift();
  job().finally(() => { active--; next(); });
}

function withSlot(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    next();
  });
}

export async function resolveImageUrl(uri) {
  if (!isMetadataUri(uri)) return toGatewayUrl(uri) || null;
  if (cache.has(uri)) return cache.get(uri);
  try {
    const meta = await withSlot(() => fetch(uri, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(res => (res.ok ? res.json() : null)));
    const image = typeof meta?.image === 'string' && meta.image ? meta.image : null;
    const gateway = toGatewayUrl(image);
    cache.set(uri, gateway);
    return gateway;
  } catch {
    // Negative cache with a shorter TTL so transient failures retry later.
    cache.set(uri, null);
    setTimeout(() => cache.delete(uri), 5 * 60_000).unref?.();
    return null;
  }
}
