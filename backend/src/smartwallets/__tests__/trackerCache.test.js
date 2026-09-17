import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../../store.js';
import { loadWallets, saveWallets, clearWalletsCache } from '../tracker.js';

describe('tracker in-memory cache', () => {
  beforeEach(() => {
    clearWalletsCache();
    vi.restoreAllMocks();
  });

  it('loads from store on first call, then returns cached instance on subsequent calls', () => {
    const mockDoc = { updatedAt: '2026-09-18T00:00:00Z', wallets: [{ address: 'test1', chain: 'solana' }], runners: [] };
    const loadSpy = vi.spyOn(store, 'load').mockReturnValue(mockDoc);

    const doc1 = loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(doc1.wallets).toHaveLength(1);

    const doc2 = loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(1); // Not called again from disk
    expect(doc2).toBe(doc1);
  });

  it('saveWallets updates the cache and calls store.save', () => {
    const saveSpy = vi.spyOn(store, 'save').mockImplementation(() => {});
    const newDoc = { updatedAt: null, wallets: [{ address: 'test2', chain: 'solana' }], runners: [] };

    saveWallets(newDoc);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    const cached = loadWallets();
    expect(cached.wallets[0].address).toBe('test2');
  });

  it('clearWalletsCache forces next loadWallets to re-read from store', () => {
    const mockDoc = { updatedAt: null, wallets: [{ address: 'test3', chain: 'solana' }], runners: [] };
    const loadSpy = vi.spyOn(store, 'load').mockReturnValue(mockDoc);

    loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(1);

    clearWalletsCache();
    loadWallets();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
