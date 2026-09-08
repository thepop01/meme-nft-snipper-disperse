import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = structuredClone(value); },
}));

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

describe('wallet repository', () => {
  let repo;
  beforeEach(async () => {
    for (const key of Object.keys(saved)) delete saved[key];
    vi.resetModules();
    repo = await import('../repository.js');
  });

  it('stores case-safe tags and many-to-many memberships', () => {
    const alpha = repo.createTag({ name: ' Alpha ' });
    expect(() => repo.createTag({ name: 'ALPHA' })).toThrow(/already exists/i);
    const first = repo.addWallet({ address: A, name: 'One' });
    const second = repo.addWallet({ address: B, name: 'Two' });
    repo.setWalletTags([first.id, second.id], [alpha.id], true);
    expect(repo.getDirectory().wallets.every(wallet => wallet.tagIds.includes(alpha.id))).toBe(true);
  });

  it('archives a tag without deleting wallets', () => {
    const tag = repo.createTag({ name: 'Team' });
    const wallet = repo.addWallet({ address: A, tagIds: [tag.id] });
    repo.archiveTag(tag.id);
    expect(repo.getDirectory().wallets.find(item => item.id === wallet.id)).toBeTruthy();
    expect(repo.getDirectory().tags).toHaveLength(0);
  });

  it('resolves overlapping tags to a deduplicated wallet preview with sources', () => {
    const alpha = repo.createTag({ name: 'Alpha' });
    const beta = repo.createTag({ name: 'Beta' });
    const wallet = repo.addWallet({ address: A });
    repo.setWalletTags([wallet.id], [alpha.id, beta.id], true);
    const result = repo.resolveWallets({ tagIds: [alpha.id, beta.id] });
    expect(result.addresses).toEqual([A]);
    expect(result.wallets[0].sourceTagIds.sort()).toEqual([alpha.id, beta.id].sort());
  });

  it('merges duplicate tags without losing memberships', () => {
    const alpha = repo.createTag({ name: 'Alpha' });
    const beta = repo.createTag({ name: 'Beta' });
    const wallet = repo.addWallet({ address: A, tagIds: [beta.id] });
    repo.mergeTags(alpha.id, [beta.id]);
    const directory = repo.getDirectory();
    expect(directory.tags.map(tag => tag.id)).toEqual([alpha.id]);
    expect(directory.wallets.find(item => item.id === wallet.id).tagIds).toContain(alpha.id);
  });
});
