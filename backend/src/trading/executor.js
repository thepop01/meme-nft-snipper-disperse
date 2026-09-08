// Trade execution. In DRY_RUN mode (the default) trades are simulated
// against live prices and never touch the chain. Live mode swaps through
// Jupiter (graduated tokens) or the pump.fun bonding curve via PumpPortal.
import { Connection, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config.js';
import { getKeypair } from '../wallet.js';
import { log } from '../bus.js';
import { fetchPriceUsd } from '../discovery/enrich.js';
import { deriveWalletDeltas } from './externalTrading.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const connection = new Connection(config.rpcUrl, 'confirmed');

let cachedSolPrice = { value: null, ts: 0 };
export async function getSolPriceUsd() {
  if (cachedSolPrice.value && Date.now() - cachedSolPrice.ts < 60_000) return cachedSolPrice.value;
  const p = await fetchPriceUsd(WSOL);
  if (p) cachedSolPrice = { value: p, ts: Date.now() };
  if (!cachedSolPrice.value) throw new Error('SOL/USD price unavailable — refusing to price a trade with a guess');
  return cachedSolPrice.value;
}

/**
 * Buy `solAmount` SOL worth of `token`. Returns
 * { txSignature, tokenAmount, priceUsd, dryRun }.
 */
export async function executeBuy(token, { solAmount, slippagePct = 5 }) {
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

  const execution = token.onCurve
    ? await pumpPortalTrade('buy', token.mint, solAmount, slippagePct, keypair)
    : await jupiterSwap(WSOL, token.mint, Math.round(solAmount * LAMPORTS_PER_SOL), slippagePct, keypair);
  // Reconcile from the confirmed receipt's pre/post balances so concurrent
  // wallet activity can't skew the measured fill.
  const deltas = deriveWalletDeltas(execution.receipt, keypair.publicKey.toBase58(), token.mint);
  const tokenAmount = deltas.tokenDelta;
  if (!(tokenAmount > 0)) throw new Error('Confirmed buy receipt did not increase the token balance');
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
export async function executeSell(position, { fraction = 1, slippagePct = 5 }) {
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

  let execution;
  if (position.onCurve) {
    execution = await pumpPortalTrade('sell', position.mint, sellAmount, slippagePct, keypair, true);
  } else {
    const decimals = position.decimals ?? 6;
    const rawAmount = BigInt(Math.floor(sellAmount * 10 ** decimals));
    execution = await jupiterSwap(position.mint, WSOL, rawAmount.toString(), slippagePct, keypair);
  }

  // Reconcile from the confirmed receipt's pre/post balances so concurrent
  // wallet activity can't skew the measured fill.
  const deltas = deriveWalletDeltas(execution.receipt, keypair.publicKey.toBase58(), position.mint);
  const soldTokens = -deltas.tokenDelta;
  if (!(soldTokens > 0)) throw new Error('Confirmed sell receipt did not reduce the token balance');
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
async function jupiterSwap(inputMint, outputMint, amount, slippagePct, keypair) {
  const slippageBps = Math.round(slippagePct * 100);
  const quoteRes = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!quoteRes.ok) throw new Error('Jupiter quote failed: ' + await quoteRes.text());
  const quote = await quoteRes.json();

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
  const { swapTransaction } = await swapRes.json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(sig, 'confirmed');
  const receipt = await connection.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  return { signature: sig, receipt };
}

// --- pump.fun bonding curve trade via PumpPortal local transaction API ---
async function pumpPortalTrade(action, mint, amount, slippagePct, keypair, denominatedInTokens = false) {
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

  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  tx.sign([keypair]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(sig, 'confirmed');
  const receipt = await connection.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  return { signature: sig, receipt };
}
