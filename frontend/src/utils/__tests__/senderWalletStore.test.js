import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';

function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

const ITER = 1000;

describe('senderWalletStore', () => {
  let s;

  beforeEach(async () => {
    stubLocalStorage();
    vi.resetModules();
    s = await import('../senderWalletStore.js');
  });

  it('has no profile initially', () => {
    expect(s.hasProfile()).toBe(false);
    expect(s.isUnlocked()).toBe(false);
    expect(s.listWallets()).toEqual([]);
  });

  it('creates a profile and adds wallets', async () => {
    await s.createProfile('pw', ITER);
    expect(s.hasProfile()).toBe(true);
    expect(s.isUnlocked()).toBe(true);

    const w = ethers.Wallet.createRandom();
    const added = await s.addWallets([
      { chainFamily: 'evm', address: w.address, privateKey: w.privateKey },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0].label).toBe('Wallet 1');

    const listed = s.listWallets();
    expect(listed).toHaveLength(1);
    expect(listed[0].address).toBe(w.address);
    expect(listed[0].privateKey).toBeUndefined();
    expect(JSON.stringify(localStorage.getItem('senderProfile'))).not.toContain(
      w.privateKey.slice(4),
    );
  });

  it('decrypts a wallet key while unlocked', async () => {
    await s.createProfile('pw', ITER);
    const w = ethers.Wallet.createRandom();
    const [added] = await s.addWallets([
      { chainFamily: 'evm', address: w.address, privateKey: w.privateKey },
    ]);
    const pk = await s.decryptWalletKey(added.id);
    expect(pk).toBe(w.privateKey.toLowerCase());
  });

  it('locks and refuses decryption until unlocked again', async () => {
    await s.createProfile('pw', ITER);
    const w = ethers.Wallet.createRandom();
    const [added] = await s.addWallets([
      { chainFamily: 'evm', address: w.address, privateKey: w.privateKey },
    ]);
    s.lock();
    expect(s.isUnlocked()).toBe(false);
    await expect(s.decryptWalletKey(added.id)).rejects.toThrow(/locked/i);
    await s.unlock('pw');
    expect(s.isUnlocked()).toBe(true);
    expect(await s.decryptWalletKey(added.id)).toBe(w.privateKey.toLowerCase());
  });

  it('rejects a wrong password on unlock', async () => {
    await s.createProfile('pw', ITER);
    s.lock();
    await expect(s.unlock('nope')).rejects.toThrow('Wrong password');
  });

  it('removes a wallet', async () => {
    await s.createProfile('pw', ITER);
    const w = ethers.Wallet.createRandom();
    const [added] = await s.addWallets([
      { chainFamily: 'evm', address: w.address, privateKey: w.privateKey },
    ]);
    s.removeWallet(added.id);
    expect(s.listWallets()).toEqual([]);
  });

  it('auto-labels sequentially and skips duplicate addresses', async () => {
    await s.createProfile('pw', ITER);
    const a = ethers.Wallet.createRandom();
    const b = ethers.Wallet.createRandom();
    await s.addWallets([{ chainFamily: 'evm', address: a.address, privateKey: a.privateKey }]);
    const second = await s.addWallets([
      { chainFamily: 'evm', address: a.address, privateKey: a.privateKey },
      { chainFamily: 'evm', address: b.address, privateKey: b.privateKey },
    ]);
    expect(second).toHaveLength(1);
    expect(second[0].label).toBe('Wallet 2');
    expect(s.listWallets()).toHaveLength(2);
  });

  it('auto-locks after the idle timeout', async () => {
    vi.useFakeTimers();
    await s.createProfile('pw', ITER);
    s.touchSession();
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(s.isUnlocked()).toBe(false);
    vi.useRealTimers();
  });

  it('makes a CSV backup', () => {
    const text = s.makeBackupText([
      { label: 'A', chainFamily: 'evm', address: '0xabc', privateKey: '0xkey' },
    ]);
    expect(text).toBe('label,chainFamily,address,privateKey\nA,evm,0xabc,0xkey');
  });
});
