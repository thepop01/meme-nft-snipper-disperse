import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map();
vi.mock('../../store.js', () => ({
  load: (key, fallback) => mem.get(key) ?? fallback,
  save: (key, value) => mem.set(key, value),
}));

const upsertWalletsDb = vi.fn();
vi.mock('../db.js', () => ({
  upsertWalletsDb: (...args) => upsertWalletsDb(...args),
}));

import { persistWallets, removeWallet } from '../persist.js';
import { clearWalletsCache, loadWallets } from '../tracker.js';

const wallet = { address: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP', chain: 'solana' };

describe('persistWallets', () => {
  beforeEach(() => {
    mem.clear();
    clearWalletsCache();
    upsertWalletsDb.mockReset();
  });

  it('rejects when the database write fails and still saves when db is null', async () => {
    upsertWalletsDb.mockRejectedValue(new Error('db down'));
    await expect(persistWallets({}, [wallet])).rejects.toThrow('db down');

    await persistWallets(null, [wallet]);
    expect(loadWallets().wallets.map(item => item.address)).toContain(wallet.address);

    const remaining = await removeWallet(null, 'solana', wallet.address);
    expect(remaining.map(item => item.address)).not.toContain(wallet.address);
  });
});
