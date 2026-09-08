import { describe, it, expect } from 'vitest';
import { normalizeDrop, classifyStatus, mintPageUrl } from '../normalize.js';

const NOW = new Date('2026-07-18T12:00:00Z').getTime();

describe('classifyStatus', () => {
  it('is_minting=true → live', () => {
    expect(classifyStatus({ isMinting: true }, NOW)).toBe('live');
  });

  it('is_minting=false → ended', () => {
    expect(classifyStatus({ isMinting: false }, NOW)).toBe('ended');
  });

  it('is_minting=false + upcoming startTime → upcoming', () => {
    expect(classifyStatus({ isMinting: false, startTime: NOW + 3600_000 }, NOW)).toBe('upcoming');
  });

  it('classifies upcoming/live/ended by stage times (no is_minting)', () => {
    expect(classifyStatus({ startTime: NOW + 3600_000, endTime: null }, NOW)).toBe('upcoming');
    expect(classifyStatus({ startTime: NOW - 60_000, endTime: NOW + 3600_000 }, NOW)).toBe('live');
    expect(classifyStatus({ startTime: NOW - 7200_000, endTime: NOW - 3600_000 }, NOW)).toBe('ended');
  });

  it('returns unknown with no times and no is_minting', () => {
    expect(classifyStatus({ startTime: null, endTime: null }, NOW)).toBe('unknown');
  });
});

describe('normalizeDrop', () => {
  const raw = {
    collection_slug: 'cool-cats',
    collection_name: 'Cool Cats',
    contract_address: '0xABC000000000000000000000000000000000abc',
    image_url: 'https://img',
    chain: 'base',
    is_minting: true,
    active_stage: {
      uuid: 's1', label: 'Public', stage_type: 'public', price: '1000000000000000',
      start_time: new Date(NOW - 60_000).toISOString(),
      end_time: new Date(NOW + 3600_000).toISOString(), max_per_wallet: 2,
    },
  };

  it('produces the normalized shape with computed status', () => {
    const d = normalizeDrop(raw, NOW);
    expect(d).toMatchObject({
      slug: 'cool-cats', name: 'Cool Cats', chain: 'base',
      contract: '0xABC000000000000000000000000000000000abc',
      image: 'https://img', status: 'live', isMinting: true,
    });
    expect(d.stages[0]).toMatchObject({ label: 'Public', priceWei: '1000000000000000', maxPerWallet: 2 });
    expect(d.startTime).toBe(NOW - 60_000);
    expect(d.openseaUrl).toContain('cool-cats');
  });

  it('returns null without a slug', () => {
    expect(normalizeDrop({ stages: [] }, NOW)).toBeNull();
  });

  it('returns null without a chain', () => {
    expect(normalizeDrop({ collection_slug: 'no-chain' }, NOW)).toBeNull();
  });

  it('handles active_stage + next_stage from recently_minted endpoint', () => {
    const rawActive = {
      collection_slug: 'test-drop',
      collection_name: 'Test Drop',
      contract_address: '0xDEF',
      image_url: 'https://img2',
      chain: 'ethereum',
      is_minting: true,
      active_stage: {
        uuid: 'a1', stage_type: 'public_sale', label: 'Public stage',
        price: '2000000000000000',
        start_time: new Date(NOW - 120_000).toISOString(),
        end_time: new Date(NOW + 7200_000).toISOString(),
        max_per_wallet: 10,
      },
      next_stage: {
        uuid: 'a2', stage_type: 'allowlist', label: 'Allowlist',
        price: '1000000000000000',
        start_time: new Date(NOW + 7200_000).toISOString(),
        end_time: new Date(NOW + 14400_000).toISOString(),
      },
    };
    const d = normalizeDrop(rawActive, NOW);
    expect(d.chain).toBe('ethereum');
    expect(d.status).toBe('live');
    expect(d.stages).toHaveLength(2);
    expect(d.stages[0].stageType).toBe('public_sale');
    expect(d.stages[1].stageType).toBe('allowlist');
    expect(d.stages[1].isActive).toBe(false);
    expect(d.nextStageStart).toBe(NOW + 7200_000);
  });

  it('uses is_minting=false as ended even when times suggest live', () => {
    const rawEnded = {
      collection_slug: 'ended-drop',
      chain: 'base',
      is_minting: false,
      active_stage: {
        start_time: new Date(NOW - 3600_000).toISOString(),
        end_time: new Date(NOW + 3600_000).toISOString(),
      },
    };
    const d = normalizeDrop(rawEnded, NOW);
    expect(d.status).toBe('ended');
  });

  it('back-compat: handles stages[] array', () => {
    const rawStages = {
      collection_slug: 'legacy-drop',
      chain: 'ethereum',
      stages: [
        { uuid: 's1', stage_type: 'public', price: '500',
          start_time: new Date(NOW - 60_000).toISOString(),
          end_time: new Date(NOW + 3600_000).toISOString() },
      ],
    };
    const d = normalizeDrop(rawStages, NOW);
    expect(d.status).toBe('live');
    expect(d.stages).toHaveLength(1);
  });
});

describe('mintPageUrl', () => {
  it('builds the OpenSea drop URL', () => {
    expect(mintPageUrl('cool-cats')).toBe('https://opensea.io/collection/cool-cats/overview');
  });
});
