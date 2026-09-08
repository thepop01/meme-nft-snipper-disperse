// Private-key parsing, validation, and wallet generation for EVM + Solana.
import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const EVM_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

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
  } catch { /* fall through */ }
  throw new Error('Unrecognized private key (expected EVM hex or Solana base58)');
}

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
      if (seen.has(parsed.address)) return;
      seen.add(parsed.address);
      wallets.push(parsed);
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  });
  return { wallets, errors };
}

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
