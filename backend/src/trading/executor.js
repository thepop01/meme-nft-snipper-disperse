// Trade execution. In DRY_RUN mode (the default) trades are simulated
// against live prices and never touch the chain. Live mode swaps through
// Jupiter (graduated tokens) or the pump.fun bonding curve via PumpPortal.
import { Connection, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config.js';
import { getKeypair } from '../wallet.js';
import { log } from '../bus.js';
import { fetchPriceUsd } from '../discovery/enrich.js';
import { deriveWalletDeltas } from './externalTrading.js';
import {
  PreSubmitError,
  UnknownSubmissionError,
  OnChainFailureError,
  beginSubmission,
  fingerprintTransaction,
  getSubmission,
  isKnownPreSubmitError,
  markConfirmed,
  markOnChainFailed,
  markPreSubmitFailed,
  markSubmitted,
  markUnknown,
  newIdempotencyKey,
  reconcileSubmission,
  replaceFailedSubmission,
} from './transactionSafety.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const connection = new Connection(config.rpcUrl, 'confirmed');
// Prevent two in-process callers sharing an idempotency key from racing
// between intent persistence and sendRawTransaction. A prepared record left
// after a process restart is treated as unknown below, never auto-rebroadcast.
const activeSubmissions = new Map();

let cachedSolPrice = { value: null, ts: 0 };
export async function getSolPriceUsd() {
  if (cachedSolPrice.value && Date.now() - cachedSolPrice.ts < 60_000) return cachedSolPrice.value;
  const p = await fetchPriceUsd(WSOL);
  if (p) cachedSolPrice = { value: p, ts: Date.now() };
  if (!cachedSolPrice.value) throw new Error('SOL/USD price unavailable — refusing to price a trade with a guess');
  return cachedSolPrice.value;
}

function preSubmit(message, cause, idempotencyKey) {
  if (cause instanceof PreSubmitError) return cause;
  return new PreSubmitError(message, { cause, idempotencyKey });
}

function unknown(message, { cause = null, txSignature = null, idempotencyKey = null } = {}) {
  if (cause instanceof UnknownSubmissionError) return cause;
  return new UnknownSubmissionError(message, { cause, txSignature, idempotencyKey });
}

async function receiptFor(signature, idempotencyKey) {
  try {
    const receipt = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed', maxSupportedTransactionVersion: 0,
    });
    if (!receipt) {
      throw unknown(`No confirmed receipt for tx ${signature}; verify it before retrying`, {
        txSignature: signature, idempotencyKey,
      });
    }
    if (receipt.meta?.err) {
      try {
        markOnChainFailed(idempotencyKey, signature, receipt.meta.err);
      } catch (persistError) {
        throw unknown(`Transaction ${signature} failed on-chain but its outcome could not be persisted; verify before retrying`, {
          txSignature: signature, idempotencyKey, cause: persistError,
        });
      }
      throw new OnChainFailureError(`Transaction ${signature} failed on-chain: ${JSON.stringify(receipt.meta.err)}`, {
        txSignature: signature, idempotencyKey, cause: receipt.meta.err,
      });
    }
    try {
      markConfirmed(idempotencyKey, signature);
    } catch (persistError) {
      throw unknown(`Transaction ${signature} is confirmed but its outcome could not be persisted; verify before retrying`, {
        txSignature: signature, idempotencyKey, cause: persistError,
      });
    }
    return receipt;
  } catch (error) {
    if (error instanceof UnknownSubmissionError || error instanceof OnChainFailureError) throw error;
    throw unknown(`Unable to read receipt for tx ${signature}; verify it before retrying`, {
      cause: error, txSignature: signature, idempotencyKey,
    });
  }
}

/**
 * Resolve an earlier attempt before constructing or broadcasting another one.
 * A missing/pending signature is not evidence of failure; it is deliberately
 * surfaced as an unknown outcome so bot and order retry paths cannot double
 * submit an already accepted transaction.
 */
async function reconcileExistingSubmission(idempotencyKey) {
  const existing = getSubmission(idempotencyKey);
  if (!existing) return null;
  if (existing.status === 'confirmed') {
    if (!existing.txSignature) {
      throw unknown(`Submission ${idempotencyKey} is confirmed without a transaction hash`, { idempotencyKey });
    }
    return { signature: existing.txSignature, receipt: await receiptFor(existing.txSignature, idempotencyKey) };
  }
  if (existing.status === 'prepared') {
    // A prepared record from an earlier attempt has no proof that the RPC did
    // not receive the send. Fail closed instead of treating it as retryable.
    throw unknown(`Submission ${idempotencyKey} has no recorded hash; verify the wallet before retrying`, {
      idempotencyKey,
    });
  }
  if (['submitted', 'unknown'].includes(existing.status)) {
    if (!existing.txSignature) {
      throw unknown(`Submission ${idempotencyKey} has an unknown outcome; verify the wallet before retrying`, { idempotencyKey });
    }
    let result;
    try {
      result = await reconcileSubmission(connection, existing);
    } catch (error) {
      // Reconciliation can itself fail while updating the durable record. The
      // original hash is still known, so never turn that persistence/RPC error
      // into a fresh broadcast attempt.
      throw unknown(`Unable to reconcile tx ${existing.txSignature}; verify it before retrying`, {
        txSignature: existing.txSignature, idempotencyKey, cause: error,
      });
    }
    if (result.status === 'confirmed') {
      return { signature: existing.txSignature, receipt: await receiptFor(existing.txSignature, idempotencyKey) };
    }
    if (result.status === 'failed') return null;
    throw unknown(`Submission ${idempotencyKey} is still pending; verify tx ${existing.txSignature} before retrying`, {
      txSignature: existing.txSignature, idempotencyKey, cause: result.error,
    });
  }
  // prepared, failed, and pre-submit-failed records have not been accepted by
  // the chain and may be replaced by a newly signed transaction.
  return null;
}

/**
 * Send one signed transaction with a durable intent and explicit outcome
 * classification. The idempotency record is written before waiting for
 * confirmation, and the returned signature is written before that wait too.
 */
export async function submitSolanaTransaction(serialized, {
  idempotencyKey = newIdempotencyKey('trade'), metadata = {}, sendOptions = {},
} = {}) {
  const key = String(idempotencyKey || newIdempotencyKey('trade'));
  const requestFingerprint = fingerprintTransaction(serialized);
  const priorActive = activeSubmissions.get(key);
  if (priorActive) return priorActive;

  const task = (async () => {
    const existing = await reconcileExistingSubmission(key);
    if (existing) return existing;

    let record;
    try {
      const prior = getSubmission(key);
      record = prior && ['failed', 'pre-submit-failed'].includes(prior.status)
        ? replaceFailedSubmission({ idempotencyKey: key, txSignature: null, requestFingerprint, metadata })
        : beginSubmission({ idempotencyKey: key, txSignature: null, requestFingerprint, metadata });
    } catch (error) {
      // No chain call has happened yet, so a persistence failure is safe to
      // retry as a pre-submit error.
      throw preSubmit(`Unable to persist transaction intent ${key}: ${error.message}`, error, key);
    }
    if (!record) throw preSubmit(`Unable to persist transaction intent ${key}`, null, key);

    let signature;
    try {
      signature = await connection.sendRawTransaction(serialized, { skipPreflight: false, maxRetries: 3, ...sendOptions });
    } catch (error) {
      if (isKnownPreSubmitError(error)) {
        try { markPreSubmitFailed(key, error); } catch { /* preserve safe pre-submit classification */ }
        throw preSubmit(`Transaction was rejected before submission: ${error.message}`, error, key);
      }
      try { markUnknown(key, null, error); } catch { /* hash-less unknown remains non-retryable */ }
      throw unknown(`Transaction submission outcome is unknown; verify the wallet before retrying (${key})`, {
        cause: error, idempotencyKey: key,
      });
    }

    // Persist the hash before confirmTransaction: a timeout after this point
    // must reconcile this exact transaction rather than broadcast another one.
    try {
      markSubmitted(key, signature);
    } catch (error) {
      // The RPC accepted the send, but the durable hash could not be written;
      // retrying could duplicate the trade, so fail closed as unknown.
      throw unknown(`Transaction ${signature} was submitted but its hash could not be persisted; verify it before retrying`, {
        cause: error, txSignature: signature, idempotencyKey: key,
      });
    }

    let confirmation;
    try {
      confirmation = await connection.confirmTransaction(signature, 'confirmed');
    } catch (error) {
      let reconciliation;
      try {
        reconciliation = await reconcileSubmission(connection, getSubmission(key));
      } catch (reconcileError) {
        try { markUnknown(key, signature, reconcileError); } catch { /* preserve hash in the thrown error */ }
        throw unknown(`Unable to reconcile tx ${signature}; verify it before retrying`, {
          cause: reconcileError, txSignature: signature, idempotencyKey: key,
        });
      }
      if (reconciliation.status === 'failed') {
        throw new OnChainFailureError(`Transaction ${signature} failed on-chain`, {
          cause: error, txSignature: signature, idempotencyKey: key,
        });
      }
      if (reconciliation.status === 'confirmed') {
        return { signature, receipt: await receiptFor(signature, key) };
      }
      try { markUnknown(key, signature, error); } catch { /* preserve hash in the thrown error */ }
      throw unknown(`No confirmation for tx ${signature}; verify it before retrying`, {
        cause: error, txSignature: signature, idempotencyKey: key,
      });
    }

    if (confirmation?.value?.err) {
      markOnChainFailed(key, signature, confirmation.value.err);
      throw new OnChainFailureError(`Transaction ${signature} failed on-chain`, {
        txSignature: signature, idempotencyKey: key, cause: confirmation.value.err,
      });
    }
    return { signature, receipt: await receiptFor(signature, key) };
  })();
  activeSubmissions.set(key, task);
  try {
    return await task;
  } finally {
    if (activeSubmissions.get(key) === task) activeSubmissions.delete(key);
  }
}

/**
 * Buy `solAmount` SOL worth of `token`. Returns
 * { txSignature, tokenAmount, priceUsd, dryRun }.
 */
export async function executeBuy(token, { solAmount, slippagePct = 5, idempotencyKey = null } = {}) {
  const solPrice = await getSolPriceUsd();
  let priceUsd = token.priceUsd ?? await fetchPriceUsd(token.mint);

  // Fresh bonding-curve tokens aren't indexed by DexScreener yet — derive
  // price from the curve market cap reported by the pump.fun feed.
  if (!priceUsd && token.onCurve && token.marketCapSol && token.supply) {
    const supplyTokens = Number(token.supply) / 10 ** (token.decimals ?? 6);
    if (supplyTokens > 0) priceUsd = (token.marketCapSol * solPrice) / supplyTokens;
  }

  if (config.dryRun) {
    if (!priceUsd) throw new Error('No price available to simulate buy');
    const tokenAmount = (solAmount * solPrice) / priceUsd;
    log('info', `[PAPER] BUY ${token.symbol || token.mint.slice(0, 6)} — ${solAmount} SOL @ $${priceUsd}`);
    return {
      txSignature: `paper-${Date.now().toString(36)}`, tokenAmount, priceUsd,
      solSpent: solAmount, grossSolDebited: solAmount, networkFeeSol: 0,
      walletAddress: 'paper', chainId: 'solana', dryRun: true,
    };
  }

  if (!config.liveTradingEnabled) throw new Error('Live trading kill switch is disabled');
  if (!config.allowServerSigner) throw new Error('Server-side signing is disabled; use a connected wallet');
  if (solAmount > config.maxTradeSol) throw new Error(`Trade exceeds the ${config.maxTradeSol} SOL live limit`);

  const keypair = getKeypair();
  if (!keypair) throw new Error('Live trading requires WALLET_SECRET_KEY in backend/.env');

  if (!priceUsd) throw new Error('No price available for live buy — token may not be indexed yet');
  const key = idempotencyKey || newIdempotencyKey('buy');
  const execution = token.onCurve
    ? await pumpPortalTrade('buy', token.mint, solAmount, slippagePct, keypair, false, key)
    : await jupiterSwap(WSOL, token.mint, Math.round(solAmount * LAMPORTS_PER_SOL), slippagePct, keypair, key);
  // Reconcile from the confirmed receipt's pre/post balances so concurrent
  // wallet activity can't skew the measured fill.
  const deltas = deriveWalletDeltas(execution.receipt, keypair.publicKey.toBase58(), token.mint);
  const tokenAmount = deltas.tokenDelta;
  if (!(tokenAmount > 0)) {
    throw unknown(`Confirmed buy tx ${execution.signature} did not increase the token balance; reconcile manually`, {
      txSignature: execution.signature, idempotencyKey: key,
    });
  }
  const grossSolDebited = Math.max(0, -deltas.lamportDelta) / LAMPORTS_PER_SOL;
  const networkFeeSol = deltas.networkFeeSol;
  const effectivePriceUsd = (solAmount * solPrice) / tokenAmount;
  log('info', `LIVE BUY ${token.symbol || token.mint.slice(0, 6)} — ${solAmount} SOL, tx ${execution.signature}`);
  return {
    txSignature: execution.signature, tokenAmount, priceUsd: effectivePriceUsd,
    solSpent: solAmount, grossSolDebited, networkFeeSol,
    walletAddress: keypair.publicKey.toBase58(), chainId: 'solana', dryRun: false,
  };
}

/**
 * Sell `tokenAmount` of `mint`. Returns { txSignature, solReceived, priceUsd, dryRun }.
 */
export async function executeSell(position, { fraction = 1, slippagePct = 5, idempotencyKey = null } = {}) {
  const sellAmount = position.tokenAmount * fraction;
  if (sellAmount <= 0) throw new Error('sellAmount must be positive');
  const solPrice = await getSolPriceUsd();

  if (config.dryRun) {
    const priceUsd = await fetchPriceUsd(position.mint) ?? position.currentPriceUsd ?? position.entryPriceUsd;
    if (!priceUsd) throw new Error('No price available to simulate sell');
    const solReceived = (sellAmount * priceUsd) / solPrice;
    log('info', `[PAPER] SELL ${position.symbol || position.mint.slice(0, 6)} — ${(fraction * 100).toFixed(0)}% @ $${priceUsd}`);
    return {
      txSignature: `paper-${Date.now().toString(36)}`, solReceived,
      grossSolReceived: solReceived, soldTokens: sellAmount, networkFeeSol: 0,
      priceUsd, walletAddress: position.walletAddress || 'paper', chainId: 'solana', dryRun: true,
    };
  }

  if (!config.liveTradingEnabled) throw new Error('Live trading kill switch is disabled');
  if (!config.allowServerSigner) throw new Error('Server-side signing is disabled; use a connected wallet');

  const keypair = getKeypair();
  if (!keypair) throw new Error('Live trading requires WALLET_SECRET_KEY in backend/.env');
  const key = idempotencyKey || newIdempotencyKey('sell');
  let execution;
  if (position.onCurve) {
    execution = await pumpPortalTrade('sell', position.mint, sellAmount, slippagePct, keypair, true, key);
  } else {
    const decimals = position.decimals ?? 6;
    const rawAmount = BigInt(Math.floor(sellAmount * 10 ** decimals));
    execution = await jupiterSwap(position.mint, WSOL, rawAmount.toString(), slippagePct, keypair, key);
  }

  // Reconcile from the confirmed receipt's pre/post balances so concurrent
  // wallet activity can't skew the measured fill.
  const deltas = deriveWalletDeltas(execution.receipt, keypair.publicKey.toBase58(), position.mint);
  const soldTokens = -deltas.tokenDelta;
  if (!(soldTokens > 0)) {
    throw unknown(`Confirmed sell tx ${execution.signature} did not reduce the token balance; reconcile manually`, {
      txSignature: execution.signature, idempotencyKey: key,
    });
  }
  const solReceived = Math.max(0, deltas.lamportDelta) / LAMPORTS_PER_SOL;
  const networkFeeSol = deltas.networkFeeSol;
  const grossSolReceived = solReceived + networkFeeSol;
  const priceUsd = (grossSolReceived * solPrice) / soldTokens;

  log('info', `LIVE SELL ${position.symbol || position.mint.slice(0, 6)} — ${(fraction * 100).toFixed(0)}%, tx ${execution.signature}`);
  return {
    txSignature: execution.signature, solReceived, grossSolReceived, soldTokens,
    networkFeeSol, priceUsd, walletAddress: keypair.publicKey.toBase58(),
    chainId: 'solana', dryRun: false,
  };
}

// --- Jupiter v6 swap (for tokens with DEX pools) ---
async function jupiterSwap(inputMint, outputMint, amount, slippagePct, keypair, idempotencyKey) {
  let quote;
  try {
    const quoteRes = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${Math.round(slippagePct * 100)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!quoteRes.ok) throw new Error('Jupiter quote failed: ' + await quoteRes.text());
    quote = await quoteRes.json();
  } catch (error) {
    throw preSubmit(`Jupiter quote failed before submission: ${error.message}`, error, idempotencyKey);
  }

  let swap;
  try {
    const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: config.priorityFeeMicrolamports, priorityLevel: 'high' } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!swapRes.ok) throw new Error('Jupiter swap build failed: ' + await swapRes.text());
    swap = await swapRes.json();
  } catch (error) {
    throw preSubmit(`Jupiter transaction build failed before submission: ${error.message}`, error, idempotencyKey);
  }

  let tx;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    tx.sign([keypair]);
  } catch (error) {
    throw preSubmit(`Jupiter transaction signing failed before submission: ${error.message}`, error, idempotencyKey);
  }
  return submitSolanaTransaction(tx.serialize(), {
    idempotencyKey,
    metadata: { route: 'Jupiter', inputMint, outputMint, amount: String(amount) },
  });
}

// --- pump.fun bonding curve trade via PumpPortal local transaction API ---
async function pumpPortalTrade(action, mint, amount, slippagePct, keypair, denominatedInTokens = false, idempotencyKey) {
  let body;
  try {
    const res = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        action,
        mint,
        amount,
        denominatedInSol: denominatedInTokens ? 'false' : 'true',
        slippage: slippagePct,
        priorityFee: config.priorityFeeMicrolamports / 1e9,
        pool: 'auto',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('PumpPortal trade build failed: ' + await res.text());
    body = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    throw preSubmit(`PumpPortal transaction build failed before submission: ${error.message}`, error, idempotencyKey);
  }

  let tx;
  try {
    tx = VersionedTransaction.deserialize(body);
    tx.sign([keypair]);
  } catch (error) {
    throw preSubmit(`PumpPortal transaction signing failed before submission: ${error.message}`, error, idempotencyKey);
  }
  return submitSolanaTransaction(tx.serialize(), {
    idempotencyKey,
    metadata: { route: 'PumpPortal', action, mint, amount: String(amount) },
  });
}
