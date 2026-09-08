import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { parsePrivateKey, parseKeyList, generateWallets } from '../keys.js';

describe('parsePrivateKey', () => {
  it('parses an EVM hex key with 0x prefix', () => {
    const w = ethers.Wallet.createRandom();
    const parsed = parsePrivateKey(w.privateKey);
    expect(parsed.chainFamily).toBe('evm');
    expect(parsed.address).toBe(w.address);
    expect(parsed.privateKey).toBe(w.privateKey.toLowerCase());
  });

  it('parses an EVM hex key without 0x prefix', () => {
    const w = ethers.Wallet.createRandom();
    const parsed = parsePrivateKey(w.privateKey.slice(2));
    expect(parsed.chainFamily).toBe('evm');
    expect(parsed.address).toBe(w.address);
  });

  it('parses a Solana base58 secret key (64 bytes)', () => {
    const kp = nacl.sign.keyPair();
    const secretB58 = bs58.encode(kp.secretKey);
    const parsed = parsePrivateKey(secretB58);
    expect(parsed.chainFamily).toBe('sol');
    expect(parsed.address).toBe(bs58.encode(kp.publicKey));
    expect(parsed.privateKey).toBe(secretB58);
  });

  it('rejects garbage', () => {
    expect(() => parsePrivateKey('not-a-key')).toThrow(/Unrecognized/);
    expect(() => parsePrivateKey('')).toThrow();
  });

  it('rejects a base58 string of the wrong length', () => {
    const short = bs58.encode(new Uint8Array(32).fill(7));
    expect(() => parsePrivateKey(short)).toThrow(/Unrecognized/);
  });
});

describe('parseKeyList', () => {
  it('parses one key per line, reports row errors, dedups by address', () => {
    const w = ethers.Wallet.createRandom();
    const text = `${w.privateKey}\n\nbadkey\n${w.privateKey}`;
    const { wallets, errors } = parseKeyList(text);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].address).toBe(w.address);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });
});

describe('generateWallets', () => {
  it('generates N EVM wallets with valid keys', () => {
    const out = generateWallets('evm', 3);
    expect(out).toHaveLength(3);
    for (const w of out) {
      expect(parsePrivateKey(w.privateKey).address).toBe(w.address);
    }
  });

  it('generates N Solana wallets with valid keys', () => {
    const out = generateWallets('sol', 2);
    expect(out).toHaveLength(2);
    for (const w of out) {
      const parsed = parsePrivateKey(w.privateKey);
      expect(parsed.chainFamily).toBe('sol');
      expect(parsed.address).toBe(w.address);
    }
  });
});
