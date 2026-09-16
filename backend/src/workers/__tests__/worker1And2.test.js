import { describe, it, expect, beforeEach, vi } from 'vitest';

const throttleCalls = vi.hoisted(() => []);

vi.mock('../rateLimiter.js', () => ({
  executeWithThrottle: vi.fn(async (sourceName, asyncFn) => {
    throttleCalls.push(sourceName);
    return asyncFn();
  }),
}));

import {
  fetchCurrentMcapGt2m,
  runWorker1Pass,
} from '../worker1CurrentMcap.js';
import {
  fetchAthMcapGt4m,
  runWorker2Pass,
} from '../worker2AthMcap.js';
import { getTrackedMemes, resetMemeRegistry } from '../memeRegistry.js';

describe('Worker 1 and Worker 2 discovery', () => {
  beforeEach(() => {
    resetMemeRegistry();
    throttleCalls.length = 0;
    vi.restoreAllMocks();
  });

  it('Worker 1 upserts only current market caps at or above $2M', async () => {
    const count = await runWorker1Pass(async () => [
      {
        ca: 'TokenA1111111111111111111111111111111111111',
        name: 'HighCurrent',
        symbol: 'HIGH',
        chain: 'solana',
        currentMcap: 2_000_000,
        volume24hUsd: 100_000,
      },
      {
        ca: 'TokenB1111111111111111111111111111111111111',
        name: 'LowCurrent',
        currentMcap: 1_999_999,
        volume24hUsd: 50_000,
      },
    ]);

    expect(count).toBe(1);
    const [token] = getTrackedMemes({ ca: 'TokenA1111111111111111111111111111111111111' });
    expect(token).toEqual(expect.objectContaining({
      ca: 'TokenA1111111111111111111111111111111111111',
      name: 'HighCurrent',
      symbol: 'HIGH',
      currentMcap: 2_000_000,
      athMcap: 0,
      athTimestamp: 0,
      sourceFlags: ['current_gt_2m'],
    }));
  });

  it('Worker 2 upserts only ATH market caps at or above $4M with its timestamp', async () => {
    const athTimestamp = 1_700_000_000_000;
    const count = await runWorker2Pass(async () => [
      {
        ca: 'TokenC1111111111111111111111111111111111111',
        name: 'HighAth',
        symbol: 'ATH',
        chain: 'solana',
        athMcap: 4_000_000,
        athTimestamp,
        currentMcap: 1_500_000,
      },
      {
        ca: 'TokenD1111111111111111111111111111111111111',
        name: 'LowAth',
        athMcap: 3_999_999,
      },
    ]);

    expect(count).toBe(1);
    expect(getTrackedMemes()).toEqual([
      expect.objectContaining({
        ca: 'TokenC1111111111111111111111111111111111111',
        athMcap: 4_000_000,
        athTimestamp,
        currentMcap: 1_500_000,
        sourceFlags: ['ath_gt_4m'],
      }),
    ]);
  });

  it('merges Worker 1 and Worker 2 flags once for the same contract address', async () => {
    const ca = 'Overlap111111111111111111111111111111111111';

    expect(await runWorker1Pass(async () => [
      { ca, name: 'Overlap', currentMcap: 2_500_000 },
    ])).toBe(1);
    expect(await runWorker2Pass(async () => [
      { ca, name: 'Overlap', athMcap: 5_000_000, athTimestamp: 1_700_000_000_000 },
    ])).toBe(1);
    expect(await runWorker1Pass(async () => [
      { ca, currentMcap: 2_600_000 },
    ])).toBe(1);

    const memes = getTrackedMemes();
    expect(memes).toHaveLength(1);
    expect(memes[0].sourceFlags).toEqual(['current_gt_2m', 'ath_gt_4m']);
    expect(memes[0].athMcap).toBe(5_000_000);
    expect(memes[0].athTimestamp).toBe(1_700_000_000_000);
  });

  it('returns the number processed before a fetch rejection without throwing', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network unavailable');
    });

    await expect(runWorker1Pass(fetcher)).resolves.toBe(0);
    await expect(runWorker2Pass(fetcher)).resolves.toBe(0);
  });

  it('wraps the default Worker 1 and Worker 2 fetches in their required throttles', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          tokenAddress: 'DefaultOne1111111111111111111111111111111111',
          chainId: 'solana',
          totalAmount: 2_000,
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{
          id: 'solana_DefaultTwo1111111111111111111111111111111111',
          attributes: {
            base_token_address: 'DefaultTwo1111111111111111111111111111111111',
            name: 'Default Two / SOL',
            fdv_usd: '4000000',
            market_cap_usd: '2500000',
          },
        }] }),
      }));

    const current = await fetchCurrentMcapGt2m();
    const ath = await fetchAthMcapGt4m();

    expect(current).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ca: 'DefaultOne1111111111111111111111111111111111',
        currentMcap: 2_000_000,
      }),
    ]));
    expect(ath).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ca: 'DefaultTwo1111111111111111111111111111111111',
        athMcap: 4_000_000,
      }),
    ]));
    expect(throttleCalls).toEqual(['dexscreener', 'geckoterminal']);
  });
});
