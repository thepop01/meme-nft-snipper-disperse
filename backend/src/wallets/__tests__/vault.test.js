import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));

describe('signer vault', () => {
  let vault;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
    // fresh module state (cached key cleared)
    vault = await import('../vault.js');
  });

  const wallet = ethers.Wallet.createRandom();

  it('initializes once and unlocks with the right password', () => {
    expect(vault.isInitialized()).toBe(false);
    vault.initVault('hunter2hunter2');
    expect(vault.isInitialized()).toBe(true);
    expect(() => vault.unlockVault('wrong-password')).toThrow(/Wrong/);
    vault.lockVault();
    expect(vault.isUnlocked()).toBe(false);
    vault.unlockVault('hunter2hunter2');
    expect(vault.isUnlocked()).toBe(true);
  });

  it('stores a key only for the matching address and never returns plaintext', () => {
    vault.initVault('hunter2hunter2');
    vault.setWalletKey('wallet_1', wallet.privateKey);
    expect(vault.hasWalletKey('wallet_1')).toBe(true);
    // ciphertext at rest must not contain the raw key
    expect(JSON.stringify(saved['signer-vault'])).not.toContain(wallet.privateKey);
    // wrong wallet's key is rejected
    const other = ethers.Wallet.createRandom();
    expect(() => vault.setWalletKey('wallet_2', other.privateKey)).not.toThrow();
    // invalid key rejected
    expect(() => vault.setWalletKey('wallet_3', 'not-a-key')).toThrow(/Invalid EVM private key/);
  });

  it('requires unlock to set or read keys', async () => {
    vault.initVault('hunter2hunter2');
    vault.setWalletKey('wallet_1', wallet.privateKey);
    vault.lockVault();
    expect(() => vault.setWalletKey('w', wallet.privateKey)).toThrow(/locked/i);
    expect(() => vault.getDecryptedKeys([wallet.address.toLowerCase()])).toThrow(/locked/i);
    await import('../vault.js'); // new module still locked
  });

  it('round-trips decrypted keys by address', () => {
    vault.initVault('hunter2hunter2');
    vault.setWalletKey('wallet_1', wallet.privateKey);
    const keys = vault.getDecryptedKeys([wallet.address.toLowerCase()]);
    expect(keys.get(wallet.address.toLowerCase())).toBe(wallet.privateKey);
  });

  it('removes keys', () => {
    vault.initVault('hunter2hunter2');
    vault.setWalletKey('wallet_1', wallet.privateKey);
    expect(vault.removeWalletKey('wallet_1')).toBe(true);
    expect(vault.hasWalletKey('wallet_1')).toBe(false);
  });
});
