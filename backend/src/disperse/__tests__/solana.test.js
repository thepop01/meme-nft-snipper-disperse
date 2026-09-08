import { describe, it, expect } from 'vitest';
import { keypairFromBase58, baseUnits } from '../solana.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

describe('solana adapter helpers', () => {
  it('loads a keypair from a base58 secret key', () => {
    const kp = nacl.sign.keyPair();
    const loaded = keypairFromBase58(bs58.encode(kp.secretKey));
    expect(loaded.publicKey.toBase58()).toBe(bs58.encode(kp.publicKey));
  });

  it('throws on an invalid secret key', () => {
    expect(() => keypairFromBase58('nope')).toThrow();
  });

  it('converts human amounts to base units', () => {
    expect(baseUnits('1.5', 6)).toBe(1500000n);
    expect(baseUnits('0.000000001', 9)).toBe(1n);
  });
});
