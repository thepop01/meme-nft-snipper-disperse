import { describe, it, expect } from 'vitest';
import {
  createVaultMeta, unlockVault, encryptString, decryptString,
} from '../vault.js';

const ITER = 1000;

describe('vault', () => {
  it('creates meta and unlocks with the right password', async () => {
    const meta = await createVaultMeta('hunter2', ITER);
    expect(meta.iterations).toBe(ITER);
    expect(typeof meta.salt).toBe('string');
    expect(meta.verify.iv).toBeTruthy();
    expect(meta.verify.ct).toBeTruthy();
    const key = await unlockVault('hunter2', meta);
    expect(key).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const meta = await createVaultMeta('hunter2', ITER);
    await expect(unlockVault('wrong', meta)).rejects.toThrow('Wrong password');
  });

  it('round-trips an encrypted string', async () => {
    const meta = await createVaultMeta('pw', ITER);
    const key = await unlockVault('pw', meta);
    const blob = await encryptString(key, '0xdeadbeef');
    expect(blob.iv).toBeTruthy();
    expect(blob.ct).toBeTruthy();
    expect(blob.ct).not.toContain('deadbeef');
    const plain = await decryptString(key, blob);
    expect(plain).toBe('0xdeadbeef');
  });

  it('uses a fresh IV per encryption', async () => {
    const meta = await createVaultMeta('pw', ITER);
    const key = await unlockVault('pw', meta);
    const a = await encryptString(key, 'same');
    const b = await encryptString(key, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('fails to decrypt with a key from a different vault', async () => {
    const metaA = await createVaultMeta('pw', ITER);
    const metaB = await createVaultMeta('pw', ITER);
    const keyA = await unlockVault('pw', metaA);
    const keyB = await unlockVault('pw', metaB);
    const blob = await encryptString(keyA, 'secret');
    await expect(decryptString(keyB, blob)).rejects.toThrow();
  });
});
