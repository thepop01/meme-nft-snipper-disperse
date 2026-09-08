import crypto from 'node:crypto';
import { Connection, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config.js';
import { load, save } from '../store.js';
import { getToken } from '../discovery/registry.js';
import { getPositions, openPosition, closePosition } from '../engine/positions.js';
import { getSolPriceUsd } from './executor.js';
import { log } from '../bus.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const STORE = 'trade-intents';
const QUOTE_TTL_MS = 30_000;
const preparedTransactions = new Map(); // intentId -> { tx, expiresAt }
const connection = new Connection(config.rpcUrl, 'confirmed');

// Prepared transactions are only valid while their quote is; sweep expired
// entries so the map can't grow unbounded when intents are never reconciled.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of preparedTransactions) {
    if (now > entry.expiresAt) preparedTransactions.delete(id);
  }
}, 60_000).unref?.();

function intents() { return load(STORE, []); }
function persistIntents(records) { save(STORE, records.slice(0, 2000)); }

function assertLive() {
  if (config.dryRun) throw new Error('Connected-wallet preparation is only used in live mode');
  if (!config.liveTradingEnabled) throw new Error('Live trading kill switch is disabled');
}

function assertWallet(value) {
  try { return new PublicKey(value).toBase58(); } catch { throw new Error('A valid Solana execution wallet is required'); }
}

async function jupiterTransaction({ inputMint, outputMint, amount, slippagePct, walletAddress }) {
  const quoteResponse = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${Math.round(slippagePct * 100)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!quoteResponse.ok) throw new Error(`Jupiter quote failed: ${await quoteResponse.text()}`);
  const quote = await quoteResponse.json();
  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote, userPublicKey: walletAddress,
      wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: 'high' } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!swapResponse.ok) throw new Error(`Jupiter swap build failed: ${await swapResponse.text()}`);
  const swap = await swapResponse.json();
  return {
    transactionBase64: swap.swapTransaction,
    route: 'Jupiter',
    expectedInputAmount: quote.inAmount,
    expectedOutputAmount: quote.outAmount,
    minimumOutputAmount: quote.otherAmountThreshold,
    priceImpactPct: Number(quote.priceImpactPct || 0),
  };
}

async function pumpTransaction({ side, mint, amount, slippagePct, walletAddress, denominatedInSol }) {
  const response = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: walletAddress, action: side, mint, amount,
      denominatedInSol: denominatedInSol ? 'true' : 'false',
      slippage: slippagePct, priorityFee: config.priorityFeeMicrolamports / 1e9, pool: 'auto',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`PumpPortal transaction build failed: ${await response.text()}`);
  return {
    transactionBase64: Buffer.from(await response.arrayBuffer()).toString('base64'),
    route: 'PumpPortal', expectedInputAmount: String(amount),
    expectedOutputAmount: null, minimumOutputAmount: null, priceImpactPct: null,
  };
}

async function simulate(transactionBase64) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
  });
  if (simulation.value.err) throw new Error(`Trade simulation failed: ${JSON.stringify(simulation.value.err)}`);
  return { unitsConsumed: simulation.value.unitsConsumed || null, logs: (simulation.value.logs || []).slice(-8) };
}

export async function prepareExternalTrade(input) {
  assertLive();
  const side = input.side === 'sell' ? 'sell' : 'buy';
  const walletAddress = assertWallet(input.walletAddress);
  const slippagePct = Math.min(50, Math.max(0.01, Number(input.slippagePct) || 5));
  let token;
  let position = null;
  let amount;
  let build;

  if (side === 'buy') {
    token = getToken(input.mint);
    if (!token) throw new Error('Token is no longer available in the registry');
    const solAmount = Number(input.solAmount);
    if (!(solAmount > 0)) throw new Error('solAmount must be positive');
    if (solAmount > config.maxTradeSol) throw new Error(`Trade exceeds the ${config.maxTradeSol} SOL live limit`);
    amount = solAmount;
    build = token.onCurve
      ? await pumpTransaction({ side, mint: token.mint, amount, slippagePct, walletAddress, denominatedInSol: true })
      : await jupiterTransaction({ inputMint: WSOL, outputMint: token.mint, amount: Math.round(solAmount * LAMPORTS_PER_SOL), slippagePct, walletAddress });
  } else {
    position = getPositions().find(item => item.id === input.positionId && item.status === 'open');
    if (!position) throw new Error('Open position not found');
    if (position.walletAddress && position.walletAddress !== 'paper'
        && position.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error('The connected wallet does not own this position');
    }
    const fraction = Number(input.fraction) || 1;
    if (!(fraction > 0 && fraction <= 1)) throw new Error('fraction must be between 0 and 1');
    token = getToken(position.mint) || position;
    amount = position.tokenAmount * fraction;
    build = position.onCurve
      ? await pumpTransaction({ side, mint: position.mint, amount, slippagePct, walletAddress, denominatedInSol: false })
      : await jupiterTransaction({
        inputMint: position.mint, outputMint: WSOL,
        amount: String(BigInt(Math.floor(amount * 10 ** (position.decimals ?? 6)))), slippagePct, walletAddress,
      });
  }

  const simulation = await simulate(build.transactionBase64);
  const id = `intent_${crypto.randomUUID()}`;
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const intent = {
    id, createdAt: Date.now(), expiresAt, status: 'prepared', side,
    walletAddress, mint: token.mint, symbol: token.symbol || null,
    positionId: position?.id || null, amount, solAmount: side === 'buy' ? amount : null,
    fraction: side === 'sell' ? Number(input.fraction) || 1 : null,
    slippagePct, exitRules: input.exitRules || null,
    route: build.route, priceImpactPct: build.priceImpactPct,
    expectedInputAmount: build.expectedInputAmount,
    expectedOutputAmount: build.expectedOutputAmount,
    minimumOutputAmount: build.minimumOutputAmount,
  };
  const records = intents();
  records.unshift(intent);
  persistIntents(records);
  preparedTransactions.set(id, { tx: build.transactionBase64, expiresAt });
  log('info', `Prepared connected-wallet ${side} ${token.symbol || token.mint.slice(0, 8)}`, { intentId: id });
  return { intent, transactionBase64: build.transactionBase64, simulation };
}

export function tokenBalance(metaBalances, mint, owner) {
  return (metaBalances || []).filter(balance => balance.mint === mint && balance.owner === owner)
    .reduce((sum, balance) => sum + Number(balance.uiTokenAmount?.uiAmountString || 0), 0);
}

export function deriveWalletDeltas(receipt, walletAddress, mint) {
  const keys = receipt?.transaction?.message?.staticAccountKeys || [];
  const walletIndex = keys.findIndex(key => (key.toBase58 ? key.toBase58() : String(key)) === walletAddress);
  if (walletIndex < 0) throw new Error('Confirmed transaction was not signed by the prepared wallet');
  const preLamports = Number(receipt.meta?.preBalances?.[walletIndex] || 0);
  const postLamports = Number(receipt.meta?.postBalances?.[walletIndex] || 0);
  const beforeTokens = tokenBalance(receipt.meta?.preTokenBalances, mint, walletAddress);
  const afterTokens = tokenBalance(receipt.meta?.postTokenBalances, mint, walletAddress);
  return {
    walletIndex, beforeTokens, afterTokens,
    tokenDelta: afterTokens - beforeTokens,
    lamportDelta: postLamports - preLamports,
    networkFeeSol: Number(receipt.meta?.fee || 0) / LAMPORTS_PER_SOL,
  };
}

// Reconciliation must be single-flight per intent: two concurrent calls would
// both pass the status check and double-count the fill into one position.
const reconciling = new Set();

export async function reconcileExternalTrade(intentId, signature) {
  if (reconciling.has(intentId)) throw new Error('Reconciliation already in progress for this intent');
  reconciling.add(intentId);
  try {
    return await reconcileExternalTradeInner(intentId, signature);
  } finally {
    reconciling.delete(intentId);
  }
}

async function reconcileExternalTradeInner(intentId, signature) {
  const records = intents();
  const intent = records.find(record => record.id === intentId);
  if (!intent) throw new Error('Trade intent not found');
  if (intent.status === 'confirmed') return intent.result;
  if (!signature) throw new Error('Transaction signature is required');
  const receipt = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!receipt) throw new Error('Transaction is not confirmed yet');
  if (receipt.meta?.err) throw new Error(`Transaction failed: ${JSON.stringify(receipt.meta.err)}`);

  const { tokenDelta, lamportDelta, networkFeeSol } = deriveWalletDeltas(
    receipt, intent.walletAddress, intent.mint);
  const solPrice = await getSolPriceUsd();
  let result;

  if (intent.side === 'buy') {
    const tokenAmount = tokenDelta;
    if (!(tokenAmount > 0)) throw new Error('Confirmed transaction did not increase the token balance');
    const grossSolDebited = Math.max(0, -lamportDelta) / LAMPORTS_PER_SOL;
    const quoteSpent = intent.solAmount;
    const position = await openPosition(getToken(intent.mint) || { mint: intent.mint, symbol: intent.symbol }, {
      txSignature: signature, tokenAmount, solSpent: quoteSpent,
      grossSolDebited, networkFeeSol: Math.max(networkFeeSol, grossSolDebited - quoteSpent),
      priceUsd: (quoteSpent * solPrice) / tokenAmount,
      walletAddress: intent.walletAddress, chainId: 'solana', dryRun: false,
    }, intent.exitRules || {});
    result = { position };
  } else {
    const soldTokens = -tokenDelta;
    if (!(soldTokens > 0)) throw new Error('Confirmed transaction did not reduce the token balance');
    const solReceived = Math.max(0, lamportDelta) / LAMPORTS_PER_SOL;
    // closePosition normally submits the transaction itself. For an external
    // receipt we inject the already-confirmed result through its reconciliation seam.
    const position = await closePosition(intent.positionId, intent.fraction, 'connected-wallet', {
      txSignature: signature, soldTokens, solReceived,
      grossSolReceived: solReceived + networkFeeSol, networkFeeSol,
      priceUsd: ((solReceived + networkFeeSol) * solPrice) / soldTokens,
      walletAddress: intent.walletAddress, chainId: 'solana', dryRun: false,
    });
    result = { position };
  }
  intent.status = 'confirmed';
  intent.confirmedAt = Date.now();
  intent.signature = signature;
  intent.result = result;
  persistIntents(records);
  preparedTransactions.delete(intentId);
  return result;
}

export function getPreparedTransaction(intentId) {
  const entry = preparedTransactions.get(intentId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    preparedTransactions.delete(intentId);
    return null;
  }
  return entry.tx;
}
