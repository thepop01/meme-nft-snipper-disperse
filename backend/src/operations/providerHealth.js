import { config } from '../config.js';

let cached = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

async function probe({ id, name, url, method = 'GET', body, fetchImpl }) {
  if (!url) return { id, name, status: 'misconfigured', error: 'Provider URL is not configured', checkedAt: Date.now() };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetchImpl(url, {
      method, signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (body) {
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.message || 'RPC error');
    }
    return { id, name, status: 'healthy', latencyMs: Date.now() - startedAt, checkedAt: Date.now() };
  } catch (error) {
    return {
      id, name, status: 'degraded', latencyMs: Date.now() - startedAt,
      error: error.name === 'AbortError' ? 'Timed out after 4 seconds' : error.message,
      checkedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getProviderHealth({ fetchImpl = fetch, force = false } = {}) {
  if (!force && fetchImpl === fetch && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const providers = await Promise.all([
    probe({
      id: 'solana-rpc', name: 'Solana RPC', url: config.rpcUrl, method: 'POST', fetchImpl,
      body: { jsonrpc: '2.0', id: 1, method: 'getHealth' },
    }),
    probe({
      id: 'dexscreener', name: 'DexScreener market data',
      url: 'https://api.dexscreener.com/latest/dex/search?q=SOL', fetchImpl,
    }),
  ]);
  const result = {
    ok: providers.every(provider => provider.status === 'healthy'),
    providers,
    checkedAt: Date.now(),
  };
  if (fetchImpl === fetch) { cached = result; cachedAt = result.checkedAt; }
  return result;
}
