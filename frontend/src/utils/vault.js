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
