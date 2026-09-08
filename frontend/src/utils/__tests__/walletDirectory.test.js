import { describe, expect, it } from 'vitest';
import {
  addAddressesToTag,
  addWallet,
  createTag,
  deleteTag,
  deriveWalletGroups,
  migrateLegacyGroups,
  normalizeAddress,
  setWalletTag,
} from '../walletDirectory';

describe('wallet directory', () => {
  it('migrates overlapping legacy groups to wallets with multiple tags', () => {
    const directory = migrateLegacyGroups([
      { id: 'alpha', name: 'Alpha', addresses: ['0xABC', '0xDEF'] },
      { id: 'team', name: 'Team', addresses: ['0xabc'] },
    ]);
    expect(directory.wallets).toHaveLength(2);
    expect(directory.wallets.find(w => normalizeAddress(w.address) === '0xabc').tagIds).toEqual(['alpha', 'team']);
  });

  it('adds a tag to an existing wallet without duplicating the wallet', () => {
    let directory = migrateLegacyGroups([{ id: 'alpha', name: 'Alpha', addresses: ['0xABC'] }]);
    directory = createTag(directory, 'Team');
    const team = directory.tags.find(tag => tag.name === 'Team');
    directory = addAddressesToTag(directory, team.id, ['0xabc']);
    expect(directory.wallets).toHaveLength(1);
    expect(directory.wallets[0].tagIds).toContain(team.id);
  });

  it('adds a wallet without requiring a tag and merges later imports', () => {
    let directory = migrateLegacyGroups([]);
    directory = addWallet(directory, { address: '0xABC', name: 'Treasury' });
    directory = addWallet(directory, { address: '0xabc', name: 'Treasury Main' });
    expect(directory.wallets).toHaveLength(1);
    expect(directory.wallets[0].name).toBe('Treasury Main');
    expect(directory.wallets[0].tagIds).toEqual([]);
  });

  it('deleting a tag preserves wallets and removes only membership', () => {
    const directory = migrateLegacyGroups([{ id: 'alpha', name: 'Alpha', addresses: ['0xABC'] }]);
    const result = deleteTag(directory, 'alpha');
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0].tagIds).toEqual([]);
  });

  it('derives compatibility groups for existing consumers', () => {
    let directory = migrateLegacyGroups([{ id: 'alpha', name: 'Alpha', addresses: ['0xABC'] }]);
    const walletId = directory.wallets[0].id;
    directory = setWalletTag(directory, walletId, 'alpha', false);
    expect(deriveWalletGroups(directory)[0].addresses).toEqual([]);
  });
});
