import { ethers } from 'ethers';
import { buildMintTransaction, CHAIN_IDS } from './opensea.js';
import { decryptPrivateKey } from './crypto.js';

const STORAGE_KEY = 'scheduledMints';
const LOG_KEY = 'mintActivityLog';

let timers = {};
let listeners = [];
const minting = new Set(); // reentrancy guard

function notify() {
  const mints = loadMints();
  listeners.forEach(fn => fn(mints));
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export function loadMints() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMints(mints) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mints));
}

export function loadLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLog(log) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-200)));
}

function addLog(entry) {
  const log = loadLog();
  log.unshift({ ...entry, timestamp: Date.now() });
  saveLog(log);
}

export function clearLog() {
  localStorage.removeItem(LOG_KEY);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function scheduleMint({ slug, collectionName, imageUrl, chain, stages, selectedStage, wallets, quantity }) {
  const stage = stages[selectedStage];
  if (!stage || !stage.start_time) return null;

  const startTime = new Date(stage.start_time).getTime();
  const now = Date.now();
  const delay = startTime - now;

  const mint = {
    id: generateId(),
    slug,
    collectionName,
    imageUrl,
    chain,
    stages,
    selectedStage,
    stageLabel: stage.label || stage.stage_type,
    stagePrice: stage.price,
    stageCurrency: stage.price_currency_address,
    wallets,
    quantity,
    status: delay > 0 ? 'scheduled' : 'ready',
    scheduledTime: startTime,
    createdAt: Date.now(),
    mintedAt: null,
    txHashes: [],
    errors: [],
  };

  const mints = loadMints();
  mints.push(mint);
  saveMints(mints);

  if (delay > 0) {
    timers[mint.id] = setTimeout(() => executeMint(mint.id), delay);
  } else {
    executeMint(mint.id);
  }

  notify();
  return mint;
}

export function scheduleMintAtTime(mintId, targetTime) {
  const mints = loadMints();
  const mint = mints.find(m => m.id === mintId);
  if (!mint) return;

  const delay = targetTime - Date.now();
  mint.scheduledTime = targetTime;
  mint.status = delay > 0 ? 'scheduled' : 'ready';
  saveMints(mints);

  if (timers[mint.id]) clearTimeout(timers[mint.id]);
  if (delay > 0) {
    timers[mint.id] = setTimeout(() => executeMint(mint.id), delay);
  } else {
    executeMint(mint.id);
  }
  notify();
}

export function cancelMint(mintId) {
  if (timers[mintId]) {
    clearTimeout(timers[mintId]);
    delete timers[mintId];
  }
  const mints = loadMints();
  const mint = mints.find(m => m.id === mintId);
  if (mint) {
    mint.status = 'cancelled';
    saveMints(mints);
    addLog({ type: 'cancel', collection: mint.collectionName, slug: mint.slug });
  }
  notify();
}

export function removeMint(mintId) {
  if (timers[mintId]) {
    clearTimeout(timers[mintId]);
    delete timers[mintId];
  }
  const mints = loadMints().filter(m => m.id !== mintId);
  saveMints(mints);
  notify();
}

export async function executeMint(mintId) {
  if (minting.has(mintId)) return; // prevent duplicate execution
  minting.add(mintId);

  try {
    // Always work with a fresh copy of the mints array
    let mints = loadMints();
    const mint = mints.find(m => m.id === mintId);
    if (!mint || mint.status === 'minted' || mint.status === 'cancelled' || mint.status === 'minting') {
      return;
    }

    mint.status = 'minting';
    saveMints(mints);
    notify();

    const encryptedKey = JSON.parse(localStorage.getItem('encryptedPrivateKey') || 'null');
    if (!encryptedKey) {
      mint.status = 'failed';
      mint.errors.push('No private key stored. Please set up your key in Settings.');
      saveMints(mints);
      addLog({ type: 'error', collection: mint.collectionName, message: 'No private key stored' });
      notify();
      return;
    }

    const chainId = CHAIN_IDS[mint.chain] || 1;
    const customRpcs = JSON.parse(localStorage.getItem('customRpcs') || '{}');
    const rpcUrl = customRpcs[mint.chain] || getDefaultRpc(mint.chain);

    // Determine which wallets we can actually sign for
    const password = sessionStorage.getItem('keyPassword');
    if (!password) {
      // Reload mints fresh to get current state
      mints = loadMints();
      const freshMint = mints.find(m => m.id === mintId);
      if (freshMint) {
        freshMint.status = 'failed';
        freshMint.errors.push('Session expired. Please re-enter your password.');
        saveMints(mints);
        notify();
      }
      addLog({ type: 'error', collection: mint.collectionName, message: 'Session expired' });
      return;
    }

    // Decrypt key once and verify which wallet it controls
    const privateKey = await decryptPrivateKey(encryptedKey, password);
    const testWallet = new ethers.Wallet(privateKey);
    const myAddress = testWallet.address.toLowerCase();

    // Only mint from wallets we actually control
    const validWallets = mint.wallets.filter(w => w.toLowerCase() === myAddress);
    if (validWallets.length === 0) {
      mints = loadMints();
      const freshMint = mints.find(m => m.id === mintId);
      if (freshMint) {
        freshMint.status = 'failed';
        freshMint.errors.push(`Private key does not match any selected wallet. Key controls ${testWallet.address.slice(0, 6)}...${testWallet.address.slice(-4)}`);
        saveMints(mints);
        notify();
      }
      addLog({ type: 'error', collection: mint.collectionName, message: 'Key does not match selected wallets' });
      return;
    }

    for (const walletAddress of validWallets) {
      try {
        // Direct browser-side transaction signing and broadcasting is deprecated and disabled for safety.
        // All mint scheduling and execution must be routed through the backend NFT engine with proper simulation,
        // gas caps, and reviewed OpenSea REST sale adapters.
        throw new Error('Direct browser minting has been disabled for safety. Please schedule mints via the backend NFT Mint Bot engine.');
      } catch (err) {
          wallet: walletAddress,
          txHash: tx.hash,
          chain: mint.chain,
          blockNumber: receipt.blockNumber,
        });
      } catch (err) {
        mints = loadMints();
        const freshMint = mints.find(m => m.id === mintId);
        if (freshMint) {
          freshMint.errors.push(`${walletAddress}: ${err.message || err}`);
          saveMints(mints);
        }
        addLog({
          type: 'error',
          collection: mint.collectionName,
          slug: mint.slug,
          wallet: walletAddress,
          message: err.message || String(err),
        });
      }
    }

    // Final status update
    mints = loadMints();
    const freshMint = mints.find(m => m.id === mintId);
    if (freshMint) {
      freshMint.status = freshMint.errors.length > 0 && freshMint.txHashes.length === 0 ? 'failed' : 'minted';
      freshMint.mintedAt = Date.now();
      saveMints(mints);
    }
    notify();
  } finally {
    minting.delete(mintId);
  }
}

export function restoreTimers() {
  // Clear all existing timers first to prevent duplicate execution
  for (const id of Object.keys(timers)) {
    clearTimeout(timers[id]);
    delete timers[id];
  }
  const mints = loadMints();
  const now = Date.now();
  for (const mint of mints) {
    if (mint.status === 'scheduled' && mint.scheduledTime > now) {
      const delay = mint.scheduledTime - now;
      timers[mint.id] = setTimeout(() => executeMint(mint.id), delay);
    } else if (mint.status === 'ready' || (mint.status === 'scheduled' && mint.scheduledTime <= now)) {
      executeMint(mint.id);
    }
  }
}

export function getCountdown(targetTime) {
  const diff = targetTime - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    expired: false,
  };
}

function getDefaultRpc(chain) {
  const rpcs = {
    ethereum: 'https://eth.llamarpc.com',
    base: 'https://mainnet.base.org',
    polygon: 'https://polygon-rpc.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    optimism: 'https://mainnet.optimism.io',
    bnb: 'https://bsc-dataseed.binance.org',
    avalanche: 'https://api.avax.network/ext/bc/C/rpc',
    zora: 'https://rpc.zora.energy',
  };
  return rpcs[chain] || rpcs.ethereum;
}
