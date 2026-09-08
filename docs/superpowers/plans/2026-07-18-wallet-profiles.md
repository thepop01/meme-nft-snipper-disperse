# Wallet Profiles (Disperse v2 — Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-protected sender-wallet management (EVM + Solana private keys) to the frontend: encrypted vault, import/generate/export wallets, Sender Wallets tab in WalletsView, Dashboard summary.

**Architecture:** All key material lives browser-side, AES-256-GCM-encrypted in `localStorage` under a profile password (PBKDF2). A small set of pure modules (`vault.js`, `keys.js`, `senderWalletStore.js`, `balances.js`) hold every piece of logic and are unit-tested with vitest; React components stay thin. Nothing backend changes in this plan.

**Tech Stack:** React 19 + Vite (existing), ethers v6 (existing), tweetnacl + bs58 (new, for Solana keypairs), vitest (new, test runner). WebCrypto (`crypto.subtle`) for PBKDF2/AES-GCM — available in browsers and Node ≥ 19, no dependency.

**Spec:** `docs/superpowers/specs/2026-07-18-disperse-v2-design.md` § 1 (Wallet Management). Plans 2 (disperse engine) and 3 (LI.FI bridge) follow after this ships.

**Working conventions for this repo:**
- Windows + Git Bash. Heredocs (`<< 'EOF'`) do NOT work — create files with the Write/Edit tools, never shell heredocs.
- Frontend dir: `C:\Users\shubh\Downloads\project\bot\frontend`. Run commands from there.
- Plain CSS design system in `frontend/src/index.css` — reuse existing classes (`panel`, `form-group`, `input-field`, `btn-primary`, `btn-outline`, `icon-btn-danger`, `badge`, `empty-state`); do not add a CSS framework.

---

### Task 1: Add vitest to the frontend

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.js`
- Create: `frontend/src/utils/__tests__/smoke.test.js`

- [ ] **Step 1: Install vitest**

Run (in `frontend/`): `npm install -D vitest`

- [ ] **Step 2: Add test script**

In `frontend/package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

Create `frontend/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `frontend/src/utils/__tests__/smoke.test.js`:

```js
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs and has WebCrypto available', () => {
    expect(typeof globalThis.crypto.subtle.deriveKey).toBe('function');
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/utils/__tests__/smoke.test.js
git commit -m "test: add vitest to frontend"
```

---

### Task 2: Vault module (PBKDF2 + AES-256-GCM)

**Files:**
- Create: `frontend/src/utils/vault.js`
- Test: `frontend/src/utils/__tests__/vault.test.js`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/utils/__tests__/vault.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  createVaultMeta, unlockVault, encryptString, decryptString,
} from '../vault.js';

// Low iteration count so the suite stays fast; production default is 300k.
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
    const metaB = await createVaultMeta('pw', ITER); // different salt
    const keyA = await unlockVault('pw', metaA);
    const keyB = await unlockVault('pw', metaB);
    const blob = await encryptString(keyA, 'secret');
    await expect(decryptString(keyB, blob)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../vault.js`.

- [ ] **Step 3: Implement the vault**

Create `frontend/src/utils/vault.js`:

```js
// Password vault: PBKDF2-SHA256 -> AES-256-GCM via WebCrypto.
// All binary values are stored as base64 strings so the vault meta and
// ciphertexts can live directly in localStorage JSON.

export const DEFAULT_ITERATIONS = 300_000;
const VERIFY_PLAINTEXT = 'tradeforge-vault-v1';

const te = new TextEncoder();
const td = new TextDecoder();

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function deriveKey(password, saltBytes, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', te.encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptString(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptString(key, blob) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct),
  );
  return td.decode(plain);
}

// Creates the persistent vault metadata for a new profile password.
export async function createVaultMeta(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, iterations);
  const verify = await encryptString(key, VERIFY_PLAINTEXT);
  return { salt: toB64(salt), iterations, verify };
}

// Returns the derived AES key, or throws 'Wrong password'.
export async function unlockVault(password, meta) {
  const key = await deriveKey(password, fromB64(meta.salt), meta.iterations);
  try {
    const check = await decryptString(key, meta.verify);
    if (check !== VERIFY_PLAINTEXT) throw new Error('bad');
  } catch {
    throw new Error('Wrong password');
  }
  return key;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all vault tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/vault.js src/utils/__tests__/vault.test.js
git commit -m "feat: password vault (PBKDF2 + AES-256-GCM)"
```

---

### Task 3: Key parsing & wallet generation (EVM + Solana)

**Files:**
- Create: `frontend/src/utils/keys.js`
- Test: `frontend/src/utils/__tests__/keys.test.js`

- [ ] **Step 1: Install Solana deps**

Run (in `frontend/`): `npm install tweetnacl bs58`

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/utils/__tests__/keys.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../keys.js`.

- [ ] **Step 4: Implement**

Create `frontend/src/utils/keys.js`:

```js
// Private-key parsing, validation, and wallet generation for EVM + Solana.
// EVM keys: 64 hex chars (0x optional). Solana keys: base58 of the 64-byte
// secret key (the standard Phantom/solana-keygen export format).
import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const EVM_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

// Returns { chainFamily: 'evm'|'sol', address, privateKey } or throws.
export function parsePrivateKey(raw) {
  const key = String(raw || '').trim();
  if (EVM_KEY_RE.test(key)) {
    const hex = key.startsWith('0x') ? key : `0x${key}`;
    const wallet = new ethers.Wallet(hex);
    return { chainFamily: 'evm', address: wallet.address, privateKey: hex.toLowerCase() };
  }
  try {
    const bytes = bs58.decode(key);
    if (bytes.length === 64) {
      const kp = nacl.sign.keyPair.fromSecretKey(bytes);
      return { chainFamily: 'sol', address: bs58.encode(kp.publicKey), privateKey: key };
    }
  } catch { /* fall through to the error below */ }
  throw new Error('Unrecognized private key (expected EVM hex or Solana base58)');
}

// Parses a pasted multi-line key list. Dedups by derived address.
// Returns { wallets: [{chainFamily, address, privateKey}], errors: [{line, message}] }.
export function parseKeyList(text) {
  const wallets = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = parsePrivateKey(trimmed);
      if (seen.has(parsed.address)) return; // silent dedup
      seen.add(parsed.address);
      wallets.push(parsed);
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  });
  return { wallets, errors };
}

// Generates N fresh wallets. chainFamily: 'evm' | 'sol'.
export function generateWallets(chainFamily, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    if (chainFamily === 'evm') {
      const w = ethers.Wallet.createRandom();
      out.push({ chainFamily: 'evm', address: w.address, privateKey: w.privateKey.toLowerCase() });
    } else if (chainFamily === 'sol') {
      const kp = nacl.sign.keyPair();
      out.push({
        chainFamily: 'sol',
        address: bs58.encode(kp.publicKey),
        privateKey: bs58.encode(kp.secretKey),
      });
    } else {
      throw new Error(`Unknown chain family: ${chainFamily}`);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all keys tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/keys.js src/utils/__tests__/keys.test.js
git commit -m "feat: EVM/Solana key parsing and wallet generation"
```

---

### Task 4: Sender-wallet store (profile, session lock, CRUD)

**Files:**
- Create: `frontend/src/utils/senderWalletStore.js`
- Test: `frontend/src/utils/__tests__/senderWalletStore.test.js`

The store keeps the profile in `localStorage` key `senderProfile`:

```json
{
  "version": 1,
  "vault": { "salt": "...", "iterations": 300000, "verify": { "iv": "...", "ct": "..." } },
  "wallets": [
    { "id": "w_...", "label": "Wallet 1", "chainFamily": "evm",
      "address": "0x...", "encKey": { "iv": "...", "ct": "..." }, "createdAt": 0 }
  ]
}
```

The derived AES key lives only in a module-level variable while unlocked. Auto-lock re-arms a timer on every `touchSession()`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/utils/__tests__/senderWalletStore.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';

// In-memory localStorage stub (vitest runs in node env).
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
    expect(listed[0].privateKey).toBeUndefined(); // never exposed by list
    expect(JSON.stringify(localStorage.getItem('senderProfile'))).not.toContain(
      w.privateKey.slice(4),
    ); // key not stored in plaintext
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
      { chainFamily: 'evm', address: a.address, privateKey: a.privateKey }, // dup
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../senderWalletStore.js`.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/senderWalletStore.js`:

```js
// Sender-wallet profile: encrypted private keys in localStorage, unlocked
// AES key held only in module memory. UI components subscribe via onChange.
import {
  createVaultMeta, unlockVault, encryptString, decryptString, DEFAULT_ITERATIONS,
} from './vault.js';

const STORAGE_KEY = 'senderProfile';
const AUTO_LOCK_MS = 30 * 60 * 1000;

let sessionKey = null;   // CryptoKey while unlocked, else null
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

// Re-arms the auto-lock timer. Call on user activity and after unlock.
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
  sessionKey = await unlockVault(password, profile.vault); // throws 'Wrong password'
  touchSession();
  notify();
}

// Public wallet list — never includes key material.
export function listWallets() {
  const profile = loadProfile();
  if (!profile) return [];
  return profile.wallets.map(({ id, label, chainFamily, address, createdAt }) => ({
    id, label, chainFamily, address, createdAt,
  }));
}

// entries: [{ chainFamily, address, privateKey }] from keys.js.
// Skips addresses already stored. Returns the added public entries.
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

// Decrypts one wallet's private key. Only callable while unlocked.
export async function decryptWalletKey(id) {
  if (!sessionKey) throw new Error('Profile is locked');
  const profile = loadProfile();
  const wallet = profile?.wallets.find(w => w.id === id);
  if (!wallet) throw new Error('Wallet not found');
  touchSession();
  return decryptString(sessionKey, wallet.encKey);
}

// Backup file content for freshly generated wallets (one-time export).
export function makeBackupText(walletsWithKeys) {
  const lines = ['label,chainFamily,address,privateKey'];
  for (const w of walletsWithKeys) {
    lines.push(`${w.label || ''},${w.chainFamily},${w.address},${w.privateKey}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all senderWalletStore tests PASS.

- [ ] **Step 5: Add a makeBackupText test**

Append to `frontend/src/utils/__tests__/senderWalletStore.test.js` inside the describe block:

```js
  it('makes a CSV backup', () => {
    const text = s.makeBackupText([
      { label: 'A', chainFamily: 'evm', address: '0xabc', privateKey: '0xkey' },
    ]);
    expect(text).toBe('label,chainFamily,address,privateKey\nA,evm,0xabc,0xkey');
  });
```

Run: `npm test` — expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/senderWalletStore.js src/utils/__tests__/senderWalletStore.test.js
git commit -m "feat: encrypted sender-wallet store with session lock"
```

---

### Task 5: Chain config + native balance fetching

**Files:**
- Create: `frontend/src/utils/chains.js`
- Create: `frontend/src/utils/balances.js`
- Test: `frontend/src/utils/__tests__/balances.test.js`

Read-only public RPCs; native balances only in this plan (token balances arrive with Plan 2's backend config endpoint).

- [ ] **Step 1: Create the chain config**

Create `frontend/src/utils/chains.js`:

```js
// Chain metadata for sender-wallet balance display. RPCs are public,
// read-only endpoints; Plan 2 moves authoritative config to the backend.
export const CHAINS = [
  { id: 'eth',     name: 'Ethereum',  family: 'evm', symbol: 'ETH',
    rpc: 'https://eth.llamarpc.com',            explorer: 'https://etherscan.io' },
  { id: 'base',    name: 'Base',      family: 'evm', symbol: 'ETH',
    rpc: 'https://mainnet.base.org',            explorer: 'https://basescan.org' },
  { id: 'arb',     name: 'Arbitrum',  family: 'evm', symbol: 'ETH',
    rpc: 'https://arb1.arbitrum.io/rpc',        explorer: 'https://arbiscan.io' },
  { id: 'op',      name: 'Optimism',  family: 'evm', symbol: 'ETH',
    rpc: 'https://mainnet.optimism.io',         explorer: 'https://optimistic.etherscan.io' },
  { id: 'polygon', name: 'Polygon',   family: 'evm', symbol: 'POL',
    rpc: 'https://polygon-rpc.com',             explorer: 'https://polygonscan.com' },
  { id: 'bsc',     name: 'BSC',       family: 'evm', symbol: 'BNB',
    rpc: 'https://bsc-dataseed.binance.org',    explorer: 'https://bscscan.com' },
  { id: 'avax',    name: 'Avalanche', family: 'evm', symbol: 'AVAX',
    rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' },
  { id: 'sol',     name: 'Solana',    family: 'sol', symbol: 'SOL',
    rpc: 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io' },
];

export function getChain(id) {
  return CHAINS.find(c => c.id === id) || null;
}
```

- [ ] **Step 2: Write the failing balance tests**

Create `frontend/src/utils/__tests__/balances.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchNativeBalances } from '../balances.js';

describe('fetchNativeBalances', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches EVM balances via eth_getBalance batch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 0, result: '0xde0b6b3a7640000' }, // 1 ETH
        { id: 1, result: '0x0' },
      ]),
    });
    const out = await fetchNativeBalances('eth', ['0xA', '0xB']);
    expect(out).toEqual({ '0xA': '1.0', '0xB': '0.0' });
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toHaveLength(2);
    expect(body[0].method).toBe('eth_getBalance');
  });

  it('fetches Solana balances via getBalance', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 0, result: { value: 2500000000 } }, // 2.5 SOL
      ]),
    });
    const out = await fetchNativeBalances('sol', ['So1Addr']);
    expect(out).toEqual({ So1Addr: '2.5' });
  });

  it('returns null balances on RPC failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down'));
    const out = await fetchNativeBalances('eth', ['0xA']);
    expect(out).toEqual({ '0xA': null });
  });

  it('throws on unknown chain', async () => {
    await expect(fetchNativeBalances('nope', ['x'])).rejects.toThrow(/Unknown chain/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../balances.js`.

- [ ] **Step 4: Implement**

Create `frontend/src/utils/balances.js`:

```js
// Read-only native-balance fetching over JSON-RPC batches.
// Returns { [address]: '1.23' } with null for addresses that failed.
import { ethers } from 'ethers';
import { getChain } from './chains.js';

export async function fetchNativeBalances(chainId, addresses) {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);
  const out = {};
  if (addresses.length === 0) return out;

  const batch = addresses.map((addr, i) => (
    chain.family === 'sol'
      ? { jsonrpc: '2.0', id: i, method: 'getBalance', params: [addr] }
      : { jsonrpc: '2.0', id: i, method: 'eth_getBalance', params: [addr, 'latest'] }
  ));

  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    const results = await res.json();
    const byId = new Map(
      (Array.isArray(results) ? results : [results]).map(r => [r.id, r]),
    );
    addresses.forEach((addr, i) => {
      const r = byId.get(i);
      if (!r || r.error) { out[addr] = null; return; }
      out[addr] = chain.family === 'sol'
        ? String((r.result?.value ?? 0) / 1e9)
        : ethers.formatEther(r.result || '0x0');
    });
  } catch {
    addresses.forEach(addr => { out[addr] = null; });
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all balances tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/chains.js src/utils/balances.js src/utils/__tests__/balances.test.js
git commit -m "feat: chain config and native balance fetching"
```

---

### Task 6: SenderWalletsTab component

**Files:**
- Create: `frontend/src/components/SenderWalletsTab.jsx`

This is UI over the tested modules — logic stays in the utils. States: no profile → create-password form; locked → unlock form; unlocked → wallet list + import + generate.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/SenderWalletsTab.jsx`:

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Lock, Unlock, KeyRound, Download, RefreshCw } from 'lucide-react';
import * as store from '../utils/senderWalletStore.js';
import { parseKeyList, generateWallets } from '../utils/keys.js';
import { CHAINS } from '../utils/chains.js';
import { fetchNativeBalances } from '../utils/balances.js';

const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const SenderWalletsTab = () => {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [keysText, setKeysText] = useState('');
  const [importErrors, setImportErrors] = useState([]);
  const [genCount, setGenCount] = useState(3);
  const [genFamily, setGenFamily] = useState('evm');
  const [busy, setBusy] = useState(false);
  const [balanceChain, setBalanceChain] = useState('eth');
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  useEffect(() => store.onChange(rerender), [rerender]);

  const wallets = store.listWallets();
  const hasProfile = store.hasProfile();
  const unlocked = store.isUnlocked();

  const handleCreateProfile = async () => {
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await store.createProfile(password);
      setPassword(''); setConfirm('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleUnlock = async () => {
    setError(''); setBusy(true);
    try {
      await store.unlock(password);
      setPassword('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleImport = async () => {
    setError(''); setImportErrors([]);
    const { wallets: parsed, errors } = parseKeyList(keysText);
    setImportErrors(errors);
    if (parsed.length === 0) return;
    setBusy(true);
    try {
      await store.addWallets(parsed);
      setKeysText('');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleGenerate = async () => {
    setError(''); setBusy(true);
    try {
      const fresh = generateWallets(genFamily, Math.max(1, Math.min(50, Number(genCount) || 1)));
      const added = await store.addWallets(fresh);
      // One-time backup download of the newly generated keys.
      const byAddress = new Map(fresh.map(w => [w.address, w]));
      const rows = added.map(a => ({ ...byAddress.get(a.address), label: a.label }));
      const text = store.makeBackupText(rows);
      const blob = new Blob([text], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `tradeforge-wallets-${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const handleRefreshBalances = async () => {
    const family = CHAINS.find(c => c.id === balanceChain)?.family;
    const addrs = wallets.filter(w => w.chainFamily === family).map(w => w.address);
    setLoadingBalances(true);
    setBalances(await fetchNativeBalances(balanceChain, addrs));
    setLoadingBalances(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('Remove this wallet? Its key cannot be recovered without your backup.')) {
      store.removeWallet(id);
    }
  };

  // --- No profile yet: create password ---
  if (!hasProfile) {
    return (
      <div className="empty-state" style={{ maxWidth: 420, margin: '3rem auto', textAlign: 'left' }}>
        <KeyRound size={40} color="var(--primary)" />
        <h3 style={{ margin: '1rem 0 0.25rem' }}>Create your wallet profile</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Private keys are encrypted with this password and stored only in this browser.
          There is no recovery — if you forget it, you must re-import your keys.
        </p>
        <div className="form-group">
          <input type="password" className="input-field" placeholder="Profile password (min 8 chars)"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="form-group">
          <input type="password" className="input-field" placeholder="Confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateProfile()} />
        </div>
        {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}
        <button className="btn-primary" onClick={handleCreateProfile} disabled={busy}>
          <KeyRound size={15} /> Create Profile
        </button>
      </div>
    );
  }

  // --- Locked: unlock form ---
  if (!unlocked) {
    return (
      <div className="empty-state" style={{ maxWidth: 420, margin: '3rem auto', textAlign: 'left' }}>
        <Lock size={40} color="var(--text-dim)" />
        <h3 style={{ margin: '1rem 0 0.5rem' }}>Profile locked</h3>
        <div className="form-group">
          <input type="password" className="input-field" placeholder="Profile password"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()} />
        </div>
        {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}
        <button className="btn-primary" onClick={handleUnlock} disabled={busy}>
          <Unlock size={15} /> Unlock
        </button>
      </div>
    );
  }

  // --- Unlocked: full management UI ---
  const family = CHAINS.find(c => c.id === balanceChain)?.family;
  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.2rem' }}>Sender Wallets</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {wallets.length} wallet{wallets.length !== 1 ? 's' : ''} · keys encrypted in this browser
          </p>
        </div>
        <button className="btn-outline" onClick={() => store.lock()}>
          <Lock size={14} /> Lock
        </button>
      </div>

      <div className="form-group" style={{ marginBottom: '1.5rem' }}>
        <label className="form-label">Import Private Keys (one per line — EVM hex or Solana base58)</label>
        <textarea className="textarea-field" style={{ minHeight: 90 }}
          placeholder={'0xabc123…\n5Kbase58…'}
          value={keysText} onChange={e => setKeysText(e.target.value)} />
        {importErrors.length > 0 && (
          <div style={{ color: 'var(--danger, #f87171)', fontSize: '0.8rem', marginTop: '0.4rem' }}>
            {importErrors.map(e => <div key={e.line}>Line {e.line}: {e.message}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-outline" onClick={handleImport} disabled={busy || !keysText.trim()}>
            <Plus size={14} /> Import
          </button>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="number" className="input-field" style={{ width: 70 }} min="1" max="50"
              value={genCount} onChange={e => setGenCount(e.target.value)} />
            <select className="select-field" style={{ width: 110 }}
              value={genFamily} onChange={e => setGenFamily(e.target.value)}>
              <option value="evm">EVM</option>
              <option value="sol">Solana</option>
            </select>
            <button className="btn-outline" onClick={handleGenerate} disabled={busy}>
              <Download size={14} /> Generate + Backup
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <label className="form-label" style={{ margin: 0 }}>Balances:</label>
        <select className="select-field" style={{ width: 140 }}
          value={balanceChain} onChange={e => setBalanceChain(e.target.value)}>
          {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn-outline" onClick={handleRefreshBalances} disabled={loadingBalances}>
          <RefreshCw size={14} className={loadingBalances ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}

      <div className="addresses-list">
        {wallets.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            No sender wallets yet. Import keys or generate fresh wallets above.
          </p>
        ) : wallets.map(w => (
          <div key={w.id} className="address-item">
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', minWidth: 0 }}>
              <span className="badge">{w.chainFamily === 'sol' ? 'SOL' : 'EVM'}</span>
              <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>{w.label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}
                title={w.address}>{short(w.address)}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              {w.chainFamily === family && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {balances[w.address] == null ? '—' : Number(balances[w.address]).toFixed(4)}
                </span>
              )}
              <button className="icon-btn-danger" onClick={() => handleDelete(w.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SenderWalletsTab;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (component not yet routed, but must compile).

- [ ] **Step 3: Commit**

```bash
git add src/components/SenderWalletsTab.jsx
git commit -m "feat: sender wallets tab UI (create/unlock/import/generate)"
```

---

### Task 7: Wire tabs into WalletsView

**Files:**
- Modify: `frontend/src/components/WalletsView.jsx`

Add a two-tab header: **Recipient Groups** (the existing UI, untouched) and **Sender Wallets** (new component).

- [ ] **Step 1: Add tab state and header**

In `frontend/src/components/WalletsView.jsx`:

Replace the imports block at the top:

```jsx
import React, { useState } from 'react';
import { Plus, Trash2, Users, KeyRound } from 'lucide-react';
import SenderWalletsTab from './SenderWalletsTab';
```

Replace the component's opening (the lines from `const WalletsView = ...` through the `page-header` div, currently:

```jsx
const WalletsView = ({ walletGroups, setWalletGroups }) => {
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [newAddresses, setNewAddresses] = useState('');
```

) with:

```jsx
const WalletsView = ({ walletGroups, setWalletGroups }) => {
  const [activeTab, setActiveTab] = useState('groups');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [newAddresses, setNewAddresses] = useState('');
```

Then replace the JSX between `<div className="page-header">…</div>` and the existing `<div className="panel" …>` so the header shows tabs, and the panel renders per-tab. The full return becomes:

```jsx
  return (
    <div className="solana-container">
      <div className="page-header">
        <h2>Wallets</h2>
        <p>Recipient groups for dispersal · sender wallets with encrypted keys</p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={activeTab === 'groups' ? 'btn-primary' : 'btn-outline'}
          onClick={() => setActiveTab('groups')}
        >
          <Users size={15} /> Recipient Groups
        </button>
        <button
          className={activeTab === 'senders' ? 'btn-primary' : 'btn-outline'}
          onClick={() => setActiveTab('senders')}
        >
          <KeyRound size={15} /> Sender Wallets
        </button>
      </div>

      {activeTab === 'senders' ? (
        <div className="panel" style={{ display: 'flex', minHeight: '620px', padding: 0 }}>
          <SenderWalletsTab />
        </div>
      ) : (
        <div className="panel" style={{ display: 'flex', overflow: 'hidden', minHeight: '620px', padding: 0 }}>
          {/* ...existing groups-sidebar and group-details JSX, unchanged... */}
        </div>
      )}
    </div>
  );
```

Keep the entire existing groups sidebar + details JSX exactly as it is inside the `groups` branch — only the wrapper changes.

- [ ] **Step 2: Verify build + existing behavior**

Run: `npm run build`
Expected: success.

Run: `npm run dev` and open the Wallets view — Recipient Groups tab must behave exactly as before; Sender Wallets tab shows the create-profile screen.

- [ ] **Step 3: Commit**

```bash
git add src/components/WalletsView.jsx
git commit -m "feat: tabbed WalletsView with sender wallets"
```

---

### Task 8: Dashboard summary card

**Files:**
- Modify: `frontend/src/components/DashboardView.jsx`

- [ ] **Step 1: Read the current DashboardView**

Open `frontend/src/components/DashboardView.jsx` and find where its stat/summary cards render (it receives `walletGroups` and `setActiveTab` — follow the existing card markup/classes).

- [ ] **Step 2: Add a Sender Wallets card**

Add imports:

```jsx
import { listWallets } from '../utils/senderWalletStore.js';
import { KeyRound } from 'lucide-react';
```

(Merge the `KeyRound` import into the existing `lucide-react` import line.)

Inside the component, before the return:

```jsx
  const senderWallets = listWallets();
  const evmCount = senderWallets.filter(w => w.chainFamily === 'evm').length;
  const solCount = senderWallets.filter(w => w.chainFamily === 'sol').length;
```

Add a card next to the existing wallet-groups card, following the same card classes already used in the file:

```jsx
  <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('wallets')}>
    <KeyRound size={20} style={{ color: 'var(--primary)' }} />
    <div>
      <div className="stat-value">{senderWallets.length}</div>
      <div className="stat-label">Sender Wallets ({evmCount} EVM · {solCount} SOL)</div>
    </div>
  </div>
```

If `DashboardView` uses different card class names, match those instead of `stat-card`/`stat-value`/`stat-label` — mirror an existing card verbatim.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/DashboardView.jsx
git commit -m "feat: sender wallets summary card on dashboard"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the whole test suite**

Run (in `frontend/`): `npm test`
Expected: all tests pass (vault, keys, senderWalletStore, balances, smoke).

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual acceptance checklist (npm run dev)**

1. Wallets → Sender Wallets → create profile (password `testtest1`). Reload page → tab shows **Profile locked**; wrong password rejected; right password unlocks.
2. Import: paste one EVM key + one Solana key + one garbage line → 2 wallets appear, garbage line flagged with its line number. `localStorage.senderProfile` in devtools contains no plaintext key material.
3. Generate 3 EVM wallets → CSV backup downloads; 3 wallets listed.
4. Balances: select Ethereum → Refresh → EVM rows show numbers (or — on RPC failure), Solana rows show no balance cell.
5. Delete a wallet → confirm dialog → gone after reload.
6. Recipient Groups tab: create/delete groups and addresses — identical to pre-change behavior.
7. Dashboard shows the Sender Wallets card with correct counts; clicking it opens the Wallets view.

- [ ] **Step 4: Final commit if anything was touched during verification**

```bash
git add -A && git commit -m "chore: wallet profiles verification fixes"
```

---

## Self-Review Notes

- **Spec coverage (§1):** password vault ✓ (Task 2), localStorage wallet shape ✓ (Task 4), verification blob ✓ (Task 2), session unlock + auto-lock 30 min + Lock button ✓ (Tasks 4, 6), paste-many import with auto-detect ✓ (Tasks 3, 6), generate N + one-time backup ✓ (Tasks 3, 6), balances column via read-only RPCs ✓ (Tasks 5, 6 — native only; token balances deliberately deferred to Plan 2 which owns the token config), no plaintext keys at rest ✓ (Task 4 test asserts it), Dashboard summary ✓ (Task 8).
- **Deferred to Plan 2:** token balances per chain, backend involvement, use of these wallets as disperse senders.
- **Type consistency:** `{ chainFamily, address, privateKey }` from `keys.js` is exactly what `addWallets()` consumes; `listWallets()` public shape `{ id, label, chainFamily, address, createdAt }` is what the UI renders.
