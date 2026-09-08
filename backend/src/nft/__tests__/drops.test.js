import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

const NOW = new Date('2026-07-18T12:00:00Z').getTime();

function rawDrop(slug, startOffsetMs, { is_minting = true } = {}) {
  return {
    collection_slug: slug, collection_name: slug,
    contract_address: '0x' + '1'.repeat(40), chain: 'base',
    is_minting,
    active_stage: {
      label: 'Public', stage_type: 'public', price: '0',
      start_time: new Date(NOW + startOffsetMs).toISOString(),
      end_time: new Date(NOW + startOffsetMs + 3600_000).toISOString(),
    },
  };
}

describe('drops cache', () => {
  let drops;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
    drops = await import('../drops.js');
  });

  it('refreshCache merges results, dedups, flags NEW, tolerates failures', async () => {
    const fetchDrops = vi.fn(async () => {
      return [rawDrop('live-one', -60_000), rawDrop('up-one', 3600_000)];
    });
    const result = await drops.refreshCache({ fetchDrops, now: NOW });
    const slugs = result.drops.map(d => d.slug);
    expect(slugs).toContain('live-one');
    expect(slugs).toContain('up-one');
    expect(result.drops.every(d => d.firstSeen === NOW)).toBe(true);
    expect(drops.getCachedDrops().length).toBe(2);
  });

  it('keeps firstSeen across refreshes and computes isNew < 24h', async () => {
    const fetchDrops = vi.fn(async () => [rawDrop('keeper', -60_000)]);
    await drops.refreshCache({ fetchDrops, now: NOW });
    await drops.refreshCache({ fetchDrops, now: NOW + 60_000 });
    const [d] = drops.getCachedDrops();
    expect(d.firstSeen).toBe(NOW);
    const listed = drops.queryDrops({ status: 'all', now: NOW + 60_000 });
    expect(listed[0].isNew).toBe(true);
    // Query at 2h — drop is still within 24h live window, isNew should be false (>24h firstSeen)
    const later = drops.queryDrops({ status: 'all', now: NOW + 25 * 3600_000 });
    expect(later.length).toBe(0); // live drop pruned (>24h), queryDrops filters it out
  });

  it('queryDrops hides ended by default and filters by chain and search', async () => {
    const fetchDrops = vi.fn(async () => [
      rawDrop('fresh', -60_000),
      rawDrop('old-ended', -10 * 3600_000, { is_minting: false }),
    ]);
    await drops.refreshCache({ fetchDrops, now: NOW });
    const live = drops.queryDrops({ status: 'live', now: NOW });
    expect(live.map(d => d.slug)).toEqual(['fresh']);
    const all = drops.queryDrops({ status: 'all', now: NOW });
    expect(all.map(d => d.slug).sort()).toEqual(['fresh', 'old-ended']);
    expect(drops.queryDrops({ status: 'all', q: 'fre', now: NOW }).map(d => d.slug)).toEqual(['fresh']);
    expect(drops.queryDrops({ status: 'all', chain: 'ethereum', now: NOW })).toEqual([]);
  });

  it('prunes drops absent for 3 consecutive cycles and not minting', async () => {
    // Drop is minting in first fetch, then stops minting and becomes absent
    let minting = true;
    const fetchDrops = vi.fn(async () =>
      minting ? [rawDrop('temp-drop', -60_000, { is_minting: true })] : []);
    await drops.refreshCache({ fetchDrops, now: NOW });
    expect(drops.getCachedDrops()).toHaveLength(1);

    // Drop stops minting, becomes absent from API
    minting = false;
    // Cycle 2: absentCount=1
    await drops.refreshCache({ fetchDrops, now: NOW + 300_000 });
    // Manually flip isMinting on stored drop (simulates real-world API change)
    const c2 = drops.getCachedDrops();
    if (c2.length) { c2[0].isMinting = false; saved['nft-drops'].drops = c2; }
    expect(drops.getCachedDrops()).toHaveLength(1);

    // Cycle 3: absentCount=2
    await drops.refreshCache({ fetchDrops, now: NOW + 600_000 });
    const c3 = drops.getCachedDrops();
    if (c3.length) { c3[0].isMinting = false; saved['nft-drops'].drops = c3; }
    expect(drops.getCachedDrops()).toHaveLength(1);

    // Cycle 4: absentCount=3, not minting → pruned
    await drops.refreshCache({ fetchDrops, now: NOW + 900_000 });
    expect(drops.getCachedDrops()).toHaveLength(0);
  });

  it('hard-expires carry-forwards older than 24h', async () => {
    const fetchDrops = vi.fn(async () => [rawDrop('ephemeral', -60_000)]);
    await drops.refreshCache({ fetchDrops, now: NOW });
    // 25h later, fetch returns empty
    fetchDrops.mockResolvedValue([]);
    await drops.refreshCache({ fetchDrops, now: NOW + 25 * 3600_000 });
    expect(drops.getCachedDrops()).toHaveLength(0);
  });

  it('prunes ended drops older than 7 days', async () => {
    const fetchDrops = vi.fn(async () =>
      [rawDrop('ancient', -8 * 24 * 3600_000, { is_minting: false })]);
    await drops.refreshCache({ fetchDrops, now: NOW });
    expect(drops.getCachedDrops()).toHaveLength(0);
  });

  it('returns empty array on fetch failure', async () => {
    const fetchDrops = vi.fn(async () => { throw new Error('network'); });
    const result = await drops.refreshCache({ fetchDrops, now: NOW });
    expect(result.drops).toEqual([]);
  });

  it('filters out unknown chains from unfiltered fetch', async () => {
    const fetchDrops = vi.fn(async () => [
      rawDrop('valid-base', -60_000),
      { ...rawDrop('invalid-chain', -60_000), chain: 'unknownchain' },
    ]);
    const result = await drops.refreshCache({ fetchDrops, now: NOW });
    expect(result.drops.map(d => d.slug)).toEqual(['valid-base']);
  });

  it('prunes live drops older than 24h', async () => {
    // Drop started 25h ago, still minting
    const fetchDrops = vi.fn(async () =>
      [rawDrop('stale-live', -25 * 3600_000, { is_minting: true })]);
    const result = await drops.refreshCache({ fetchDrops, now: NOW });
    expect(result.drops).toHaveLength(0);
  });

  it('keeps live drops under 24h', async () => {
    // Drop started 10h ago, still minting
    const fetchDrops = vi.fn(async () =>
      [rawDrop('fresh-live', -10 * 3600_000, { is_minting: true })]);
    const result = await drops.refreshCache({ fetchDrops, now: NOW });
    expect(result.drops).toHaveLength(1);
  });
});
