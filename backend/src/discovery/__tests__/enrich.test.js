import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

import { emit } from '../../bus.js';
import { enrichToken } from '../enrich.js';
import { resolveImageUrl, toGatewayUrl } from '../tokenMedia.js';

const DEX_URL = 'https://api.dexscreener.com/latest/dex/tokens/';
const META_URI = 'https://meta.example/token-abc.json';
const NULL_META_URI = 'https://meta.example/token-empty.json';

// Canned DexScreener pairs for the current test; the fetch stub serves them
// for any api.dexscreener.com request and metadata JSON otherwise.
let dexPairs = [];
const realFetch = globalThis.fetch;

function pairFixture(overrides = {}) {
  return {
    chainId: 'robinhood',
    dexId: 'uniswap-v4-robinhood',
    pairAddress: '0xpair',
    priceUsd: '0.001',
    liquidity: { usd: 50000 },
    volume: { h24: 100000, m5: 1000, h1: 5000 },
    marketCap: 250000,
    priceChange: { h24: 5 },
    txns: { m5: { buys: 10, sells: 2 } },
    baseToken: { address: '0xbase', symbol: 'MEME', name: 'Meme Coin' },
    info: {
      imageUrl: 'https://dex.example/meme.png',
      websites: [{ url: 'https://meme.example' }],
      socials: [
        { type: 'twitter', url: 'https://x.com/meme' },
        { type: 'telegram', url: 'https://t.me/meme' },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  dexPairs = [];
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith(DEX_URL)) {
      return { ok: true, json: async () => ({ pairs: dexPairs }) };
    }
    if (url === META_URI) {
      return { ok: true, json: async () => ({ image: 'ipfs://QmABC/1.png' }) };
    }
    if (url === NULL_META_URI) {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: false, json: async () => null };
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const flushBackfill = () => new Promise(r => setTimeout(r, 25));

describe('enrichToken identity gating', () => {
  it('adopts image/socials from a same-chain pair', async () => {
    dexPairs = [pairFixture()];
    const token = { mint: '0xbase', chain: 'robinhood', imageUrl: 'https://discovery.example/meme.png' };
    await enrichToken(token);
    expect(token.imageUrl).toBe('https://dex.example/meme.png');
    expect(token.socials).toMatchObject({ website: 'https://meme.example', twitter: 'https://x.com/meme' });
    expect(token.priceUsd).toBe(0.001);
  });

  it('ignores identity from a cross-chain pair but still updates price', async () => {
    dexPairs = [pairFixture({ chainId: 'ethereum', priceUsd: '0.42', info: { imageUrl: 'https://evil.example/wrong.png' } })];
    const token = { mint: '0xbase', chain: 'robinhood', imageUrl: 'https://discovery.example/keep.png' };
    await enrichToken(token);
    expect(token.imageUrl).toBe('https://discovery.example/keep.png');
    expect(token.socials).toBeUndefined();
    expect(token.priceUsd).toBe(0.42);
  });

  it('rewrites an ipfs metadata image to a gateway and emits token:update', async () => {
    dexPairs = [pairFixture({ chainId: 'solana', priceUsd: '0.002', info: undefined })];
    const token = { mint: 'SOLMINT', chain: 'solana', imageUrl: META_URI };
    await enrichToken(token);
    await flushBackfill();
    expect(token.imageUrl).toBe('https://ipfs.io/ipfs/QmABC/1.png');
    expect(emit).toHaveBeenCalledWith('token:update', expect.objectContaining({ token }));
  });
});

describe('toGatewayUrl / resolveImageUrl ipfs handling', () => {
  it('rewrites ipfs:// to the ipfs.io gateway', () => {
    expect(toGatewayUrl('ipfs://QmABC/1.png')).toBe('https://ipfs.io/ipfs/QmABC/1.png');
  });

  it('leaves https URLs and null untouched', () => {
    expect(toGatewayUrl('https://example.com/i.png')).toBe('https://example.com/i.png');
    expect(toGatewayUrl(null)).toBeNull();
  });

  it('passes non-metadata ipfs URIs straight to the gateway without fetching', async () => {
    expect(await resolveImageUrl('ipfs://QmXYZ/direct.png')).toBe('https://ipfs.io/ipfs/QmXYZ/direct.png');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps null when metadata has no image', async () => {
    expect(await resolveImageUrl(NULL_META_URI)).toBeNull();
  });

  it('returns null for missing input', async () => {
    expect(await resolveImageUrl(null)).toBeNull();
  });
});
