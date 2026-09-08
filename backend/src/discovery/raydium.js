// New Raydium AMM v4 pool detection via onLogs subscription.
// Catches tokens at the moment they get a tradable pool (including pump.fun graduations).
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { log } from '../bus.js';
import { registerToken } from './registry.js';

const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const WSOL = 'So11111111111111111111111111111111111111112';
// Well-known quote mints: a new pool's "new token" is never one of these
const QUOTE_MINTS = new Set([
  WSOL,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

let connection = null;
let subId = null;

// FIFO queue of pool-creation signatures, drained at a fixed rate so bursts
// don't get silently dropped and public RPC doesn't get hammered.
const pending = [];
const MAX_PENDING = 20;
const DRAIN_INTERVAL_MS = 3000;
let drainTimer = null;

export function startRaydiumFeed() {
  connection = new Connection(config.rpcUrl, {
    wsEndpoint: config.wssUrl,
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });
  try {
    subId = connection.onLogs(RAYDIUM_AMM_V4, handleLogs, 'confirmed');
    log('info', 'Raydium pool feed subscribed');
  } catch (err) {
    log('error', 'Raydium feed failed to subscribe: ' + err.message);
  }
  drainTimer = setInterval(drainQueue, DRAIN_INTERVAL_MS);
  drainTimer.unref?.();
}

export function stopRaydiumFeed() {
  if (connection && subId != null) connection.removeOnLogsListener(subId).catch(() => {});
  subId = null;
  if (drainTimer) clearInterval(drainTimer);
  drainTimer = null;
}

function handleLogs({ logs, signature, err }) {
  if (err) return;
  // 'initialize2' marks new pool creation on AMM v4
  if (!logs.some(l => l.includes('initialize2'))) return;

  pending.push(signature);
  if (pending.length > MAX_PENDING) {
    const dropped = pending.shift();
    log('warn', `Raydium queue full — dropped oldest pool tx ${dropped.slice(0, 12)}…`);
  }
}

async function drainQueue() {
  const signature = pending.shift();
  if (!signature) return;

  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx) return;

    // The new token is the non-quote mint among post token balances
    const balances = tx.meta?.postTokenBalances || [];
    const mints = [...new Set(balances.map(b => b.mint))].filter(m => !QUOTE_MINTS.has(m));
    if (mints.length === 0) return;
    const mint = mints[0];

    registerToken({
      mint,
      symbol: null,
      name: null,
      imageUrl: null,
      source: 'raydium',
      creator: tx.transaction.message.accountKeys?.[0]?.pubkey?.toBase58?.() || null,
      createdAt: Date.now(),
      poolSignature: signature,
      onCurve: false,
    });
  } catch (e) {
    log('warn', 'Raydium tx parse failed: ' + e.message);
  }
}
