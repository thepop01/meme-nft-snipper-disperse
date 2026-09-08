// Sender-wallet profile: encrypted private keys in localStorage, unlocked
// AES key held only in module memory. UI components subscribe via onChange.
import {
  createVaultMeta, unlockVault, encryptString, decryptString, DEFAULT_ITERATIONS,
} from './vault.js';

const STORAGE_KEY = 'senderProfile';
const AUTO_LOCK_MS = 30 * 60 * 1000;

let sessionKey = null;
let lockTimer = null;
const listeners = new Set();

function notify() { for (const fn of listeners) fn(); }

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function hasProfile() {
  return loadProfile() !== null;
}

export function isUnlocked() {
  return sessionKey !== null;
}

export function touchSession() {
  if (lockTimer) clearTimeout(lockTimer);
  if (!sessionKey) return;
  lockTimer = setTimeout(() => lock(), AUTO_LOCK_MS);
}

export function lock() {
  sessionKey = null;
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  notify();
}

export async function createProfile(password, iterations = DEFAULT_ITERATIONS) {
  if (hasProfile()) throw new Error('Profile already exists');
  const vault = await createVaultMeta(password, iterations);
  saveProfile({ version: 1, vault, wallets: [] });
  sessionKey = await unlockVault(password, vault);
  touchSession();
  notify();
}

export async function unlock(password) {
  const profile = loadProfile();
  if (!profile) throw new Error('No profile');
  sessionKey = await unlockVault(password, profile.vault);
  touchSession();
  notify();
}

export function listWallets() {
  const profile = loadProfile();
  if (!profile) return [];
  return profile.wallets.map(({ id, label, chainFamily, address, createdAt }) => ({
    id, label, chainFamily, address, createdAt,
  }));
}

export async function addWallets(entries) {
  if (!sessionKey) throw new Error('Profile is locked');
  const profile = loadProfile();
  if (!profile) throw new Error('No profile');
  const existing = new Set(profile.wallets.map(w => w.address));
  let counter = profile.wallets.length;
  const added = [];
  for (const entry of entries) {
    if (existing.has(entry.address)) continue;
    existing.add(entry.address);
    counter += 1;
    const encKey = await encryptString(sessionKey, entry.privateKey);
    const wallet = {
      id: `w_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`,
      label: entry.label || `Wallet ${counter}`,
      chainFamily: entry.chainFamily,
      address: entry.address,
      encKey,
      createdAt: Date.now(),
    };
    profile.wallets.push(wallet);
    added.push({
      id: wallet.id, label: wallet.label, chainFamily: wallet.chainFamily,
      address: wallet.address, createdAt: wallet.createdAt,
    });
  }
  saveProfile(profile);
  notify();
  return added;
}

export function removeWallet(id) {
  const profile = loadProfile();
  if (!profile) return;
  profile.wallets = profile.wallets.filter(w => w.id !== id);
  saveProfile(profile);
  notify();
}

export function renameWallet(id, label) {
  const profile = loadProfile();
  if (!profile) return;
  const wallet = profile.wallets.find(w => w.id === id);
  if (wallet) { wallet.label = label; saveProfile(profile); notify(); }
}

export async function decryptWalletKey(id) {
  if (!sessionKey) throw new Error('Profile is locked');
  const profile = loadProfile();
  const wallet = profile?.wallets.find(w => w.id === id);
  if (!wallet) throw new Error('Wallet not found');
  touchSession();
  return decryptString(sessionKey, wallet.encKey);
}

export function makeBackupText(walletsWithKeys) {
  const lines = ['label,chainFamily,address,privateKey'];
  for (const w of walletsWithKeys) {
    lines.push(`${w.label || ''},${w.chainFamily},${w.address},${w.privateKey}`);
  }
  return lines.join('\n');
}
