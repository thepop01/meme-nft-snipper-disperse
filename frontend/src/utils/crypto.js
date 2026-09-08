const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100000;

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPrivateKey(privateKey, password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(privateKey)
  );

  return {
    salt: arrayBufferToHex(salt),
    iv: arrayBufferToHex(iv),
    data: arrayBufferToHex(encrypted),
  };
}

export async function decryptPrivateKey(encryptedObj, password) {
  const salt = hexToArrayBuffer(encryptedObj.salt);
  const iv = hexToArrayBuffer(encryptedObj.iv);
  const data = hexToArrayBuffer(encryptedObj.data);
  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return new TextDecoder().decode(decrypted);
}

export function saveEncryptedKey(encryptedObj) {
  localStorage.setItem('encryptedPrivateKey', JSON.stringify(encryptedObj));
}

export function getEncryptedKey() {
  const raw = localStorage.getItem('encryptedPrivateKey');
  return raw ? JSON.parse(raw) : null;
}

export function removeEncryptedKey() {
  localStorage.removeItem('encryptedPrivateKey');
}

export function hasStoredKey() {
  return !!localStorage.getItem('encryptedPrivateKey');
}
