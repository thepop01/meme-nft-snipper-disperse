import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config.js';

let keypair = null;

export function getKeypair() {
  if (keypair) return keypair;
  if (!config.walletSecretKey) return null;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(config.walletSecretKey.trim()));
    return keypair;
  } catch (err) {
    throw new Error('WALLET_SECRET_KEY is not a valid base58 secret key: ' + err.message);
  }
}

export function getWalletAddress() {
  const kp = getKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}
