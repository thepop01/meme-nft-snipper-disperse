// Encrypted signer vault. Private keys are AES-256-GCM encrypted at rest with
// a key derived (scrypt) from the profile password; plaintext exists only in
// server memory while unlocked and is NEVER returned by any API.
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { load, save } from '../store.js';

const STORE = 'signer-vault';
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 32;
const MAX_UNLOCK_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60_000;

let cachedKey = null; // derived key while unlocked (memory only)
let failedAttempts = 0;
let lockedUntil = 0;

function readVault() {
  return load(STORE, null);
}

function writeVault(vault) {
  save(STORE, vault);
}

function deriveKey(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

function encrypt(keyBuffer, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), data: enc.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

function decrypt(keyBuffer, box) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer,
    Buffer.from(box.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(box.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'hex')), decipher.final()]).toString('utf8');
}

export function isInitialized() {
  return readVault() != null;
}

export function isUnlocked() {
  return cachedKey != null;
}

export function initVault(password) {
  if (isInitialized()) throw new Error('Vault already initialized — use unlock instead');
  const salt = crypto.randomBytes(16).toString('hex');
  const verifier = encrypt(deriveKey(password, salt), 'vault-ok');
  writeVault({ version: 1, salt, verifier, keys: {} });
  cachedKey = deriveKey(password, salt);
  return { initialized: true };
}

export function unlockVault(password) {
  if (lockedUntil > Date.now()) {
    throw new Error(`Too many failed attempts — vault locked for ${Math.ceil((lockedUntil - Date.now()) / 1000)}s`);
  }
  const vault = readVault();
  if (!vault) throw new Error('Vault not initialized — set a profile password first');
  const key = deriveKey(password, vault.salt);
  try {
    if (decrypt(key, vault.verifier) !== 'vault-ok') throw new Error('bad');
  } catch {
    failedAttempts += 1;
    if (failedAttempts >= MAX_UNLOCK_ATTEMPTS) {
      lockedUntil = Date.now() + LOCKOUT_MS;
      failedAttempts = 0;
      throw new Error(`Wrong vault password — too many attempts, locked for ${LOCKOUT_MS / 60_000} minutes`);
    }
    throw new Error('Wrong vault password');
  }
  failedAttempts = 0;
  cachedKey = key;
  return { unlocked: true };
}

export function lockVault() {
  cachedKey = null;
  return { locked: true };
}

function requireUnlocked() {
  if (!cachedKey) throw new Error('Vault is locked — unlock with your profile password first');
}

// Validates that the key belongs to the wallet, then stores it encrypted.
export function setWalletKey(walletId, privateKey) {
  requireUnlocked();
  let address;
  try {
    address = new ethers.Wallet(String(privateKey).trim()).address.toLowerCase();
  } catch {
    throw new Error('Invalid EVM private key');
  }
  const vault = readVault();
  if (!vault) throw new Error('Vault not initialized');
  vault.keys[String(walletId)] = { address, ...encrypt(cachedKey, String(privateKey).trim()), updatedAt: Date.now() };
  writeVault(vault);
  return { walletId, address };
}

export function removeWalletKey(walletId) {
  const vault = readVault();
  if (!vault || !vault.keys?.[String(walletId)]) return false;
  delete vault.keys[String(walletId)];
  writeVault(vault);
  return true;
}

export function hasWalletKey(walletId) {
  const vault = readVault();
  return Boolean(vault?.keys?.[String(walletId)]);
}

// Executor seam: decrypted private keys for the given addresses.
// Returns Map<lowercased address, privateKey>.
export function getDecryptedKeys(addresses) {
  requireUnlocked();
  const vault = readVault();
  const wanted = new Set((addresses || []).map(a => String(a).toLowerCase()));
  const out = new Map();
  for (const box of Object.values(vault.keys || {})) {
    if (wanted.has(box.address)) out.set(box.address, decrypt(cachedKey, box));
  }
  return out;
}
