import { executeWithThrottle } from '../workers/rateLimiter.js';
import { parseFunderFromTx } from './adapters/lineageRpc.js';
import { connectLineageWallet, loadWallets } from './tracker.js';
import { persistWallets } from './persist.js';
import { log } from '../bus.js';

/**
 * Normalizes MadeOnSol /alpha/{wallet}/linked response into parent/child relationships.
 */
export function normalizeMadeOnSolLinkedPayload(wallet, payload) {
  if (!payload || typeof payload !== 'object') return [];

  const rawList = payload.linked || payload.sub_wallets || payload.wallets || (Array.isArray(payload) ? payload : []);
  const out = [];

  for (const item of rawList) {
    if (!item) continue;
    const linkedAddr = typeof item === 'string' ? item : (item.wallet || item.address || item.linked_wallet);
    if (!linkedAddr || linkedAddr === wallet) continue;

    const relationship = item.relationship || (item.is_funder ? 'parent' : 'child');
    const amount = Number(item.funded_amount || item.amount || 0);
    const txHash = item.tx_hash || item.txHash || item.signature || null;

    if (relationship === 'parent' || item.is_funder) {
      out.push({
        parentAddress: linkedAddr,
        childAddress: wallet,
        amount,
        txHash,
        chain: 'solana',
        source: 'madeonsol_linked',
        evidence: typeof item === 'object' ? item : { linkedAddress: linkedAddr },
      });
    } else {
      out.push({
        parentAddress: wallet,
        childAddress: linkedAddr,
        amount,
        txHash,
        chain: 'solana',
        source: 'madeonsol_linked',
        evidence: typeof item === 'object' ? item : { linkedAddress: linkedAddr },
      });
    }
  }

  return out;
}

/**
 * Fetch linked wallets for a Solana address from MadeOnSol /alpha/{wallet}/linked.
 */
export async function fetchMadeOnSolLinkedWallets(wallet) {
  if (!wallet) return [];

  try {
    const res = await executeWithThrottle('madeonsol', async () => {
      const apiKey = process.env.MADEONSOL_API_KEY;
      const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['x-api-key'] = apiKey;
      }
      const r = await fetch(`https://madeonsol.com/api/v1/alpha/${encodeURIComponent(wallet)}/linked`, {
        signal: AbortSignal.timeout(8000),
        headers,
      });
      if (r.status === 403 || r.status === 404) {
        return null;
      }
      if (!r.ok) throw new Error(`MadeOnSol status ${r.status}`);
      return r.json();
    });

    return normalizeMadeOnSolLinkedPayload(wallet, res);
  } catch {
    return [];
  }
}

/**
 * Parse funding relationship from Helius enhanced transaction payload.
 */
export function parseHeliusFunder(wallet, tx) {
  if (!tx || typeof tx !== 'object') return null;

  const transfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];
  for (const tr of transfers) {
    if (tr.toUserAccount === wallet && tr.fromUserAccount && tr.fromUserAccount !== wallet) {
      const lamports = Number(tr.amount || 0);
      return {
        parentAddress: tr.fromUserAccount,
        childAddress: wallet,
        amount: lamports > 0 ? lamports / 1e9 : 0,
        txHash: tx.signature || null,
        chain: 'solana',
        source: 'helius_transfer',
        evidence: {
          feePayer: tx.feePayer,
          timestamp: tx.timestamp || null,
          type: tx.type || 'TRANSFER',
        },
      };
    }
  }

  return null;
}

/**
 * Fetch funding transaction for a Solana address via Helius Enhanced Transactions API.
 */
export async function fetchHeliusFunder(wallet) {
  if (!wallet) return null;
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return null;

  try {
    const txs = await executeWithThrottle('helius', async () => {
      const url = `https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}/transactions?api-key=${encodeURIComponent(apiKey)}&type=TRANSFER`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Helius status ${res.status}`);
      return res.json();
    });

    if (!Array.isArray(txs) || txs.length === 0) return null;

    // The earliest transfer in the batch is typically the initial funding transfer
    for (let i = txs.length - 1; i >= 0; i--) {
      const parsed = parseHeliusFunder(wallet, txs[i]);
      if (parsed) return parsed;
    }
  } catch (err) {
    log('debug', `[lineageBackfill] Helius funder lookup failed for ${wallet}: ${err.message}`);
  }

  return null;
}

/**
 * Parse funding relationship for Robinhood Chain EVM address from transaction or DEX trade.
 */
export function parseRobinhoodFunder(wallet, txOrTrade) {
  if (!txOrTrade) return null;

  // Format 1: parsed standard EVM tx
  const parsed = parseFunderFromTx(txOrTrade, 'robinhood');
  if (parsed && parsed.childAddress?.toLowerCase() === wallet?.toLowerCase() && parsed.parentAddress && parsed.parentAddress.toLowerCase() !== wallet?.toLowerCase()) {
    return {
      ...parsed,
      source: 'robinhood_funder',
    };
  }

  // Format 2: GeckoTerminal trade or transfer record
  const attrs = txOrTrade.attributes || txOrTrade;
  const fromAddr = attrs.tx_from_address || attrs.from || attrs.sender;
  const toAddr = attrs.to || attrs.recipient;

  if (toAddr && toAddr.toLowerCase() === wallet?.toLowerCase() && fromAddr && fromAddr.toLowerCase() !== wallet?.toLowerCase()) {
    return {
      parentAddress: fromAddr.toLowerCase(),
      childAddress: wallet.toLowerCase(),
      amount: Number(attrs.volume_in_usd || attrs.amount || 0),
      txHash: attrs.tx_hash || attrs.hash || null,
      chain: 'robinhood',
      source: 'robinhood_trade_funder',
    };
  }

  return null;
}

/**
 * Fetch funding relationship for a Robinhood Chain wallet.
 */
export async function fetchRobinhoodFunder(wallet, customFetcher = null) {
  if (!wallet) return null;
  const normWallet = wallet.toLowerCase();

  if (customFetcher) {
    try {
      const res = await customFetcher(normWallet);
      if (res) return parseRobinhoodFunder(normWallet, res);
    } catch {
      return null;
    }
  }

  // Fallback / DeFade public scanner attempt
  try {
    const res = await executeWithThrottle('default', async () => {
      const r = await fetch(`https://defade.io/api/v1/address/${encodeURIComponent(normWallet)}/lineage`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) return null;
      return r.json();
    });

    if (res?.parentAddress || res?.funder) {
      return {
        parentAddress: (res.parentAddress || res.funder).toLowerCase(),
        childAddress: normWallet,
        amount: Number(res.amount || 0),
        txHash: res.txHash || null,
        chain: 'robinhood',
        source: 'defade_lineage',
      };
    }
  } catch {
    // Expected if external service is offline / unkeyed
  }

  return null;
}

/**
 * Backfill linked / lineage wallets for a batch of tracked wallets.
 * Zero raw transaction storage: only parent/child links, addresses, and tags are persisted.
 */
export async function backfillLinkedWallets({
  batchSize = 25,
  chain = null,
  customSolanaFetcher = null,
  customRobinhoodFetcher = null,
  db = null,
} = {}) {
  const storeData = loadWallets();
  const allWallets = storeData.wallets || [];

  // Filter unlinked wallets (those that do not yet have a lineageParent or lineage linked records)
  const candidateWallets = allWallets.filter(w => {
    if (chain && w.chain !== chain) return false;
    // Skip if already linked as child
    if (w.lineageParent) return false;
    return true;
  }).slice(0, batchSize);

  if (candidateWallets.length === 0) {
    return { backfilledCount: 0, newLinkedWalletsCount: 0, totalWallets: allWallets.length };
  }

  log('info', `[lineageBackfill] Processing ${candidateWallets.length} candidate wallets for lineage backfill`);

  const newLinkedRecords = [];
  const updatedParentLinks = [];

  for (const target of candidateWallets) {
    const isSolana = target.chain === 'solana';

    if (isSolana) {
      let links = [];

      // 1. Try custom fetcher if provided
      if (customSolanaFetcher) {
        try {
          const res = await customSolanaFetcher(target.address);
          if (Array.isArray(res)) links = res;
          else if (res) links = [res];
        } catch {}
      }

      // 2. Try MadeOnSol linked clustering
      if (links.length === 0) {
        links = await fetchMadeOnSolLinkedWallets(target.address);
      }

      // 3. Fall back to Helius on-chain funder transfer
      if (links.length === 0) {
        const heliusFunder = await fetchHeliusFunder(target.address);
        if (heliusFunder) links = [heliusFunder];
      }

      for (const link of links) {
        if (!link.parentAddress || !link.childAddress) continue;
        if (link.childAddress === target.address) {
          updatedParentLinks.push({
            address: target.address,
            chain: 'solana',
            lineageParent: link.parentAddress,
            lineageTx: link.txHash,
            lineageAmount: link.amount,
          });
        }
        // Register the linked wallet as a lineage record
        newLinkedRecords.push(
          connectLineageWallet({
            parentAddress: link.parentAddress,
            childAddress: link.childAddress,
            chain: 'solana',
            amount: link.amount,
            txHash: link.txHash,
            tags: ['lineage', link.source || 'funder_cluster'],
          })
        );
      }
    } else {
      // Robinhood Chain
      let funder = null;
      if (customRobinhoodFetcher) {
        funder = await customRobinhoodFetcher(target.address);
      } else {
        funder = await fetchRobinhoodFunder(target.address);
      }

      if (funder && funder.parentAddress) {
        updatedParentLinks.push({
          address: target.address,
          chain: 'robinhood',
          lineageParent: funder.parentAddress,
          lineageTx: funder.txHash,
          lineageAmount: funder.amount,
        });

        newLinkedRecords.push(
          connectLineageWallet({
            parentAddress: funder.parentAddress,
            childAddress: target.address,
            chain: 'robinhood',
            amount: funder.amount,
            txHash: funder.txHash,
            tags: ['lineage', funder.source || 'evm_funder'],
          })
        );
      }
    }
  }

  // Merge updates and new linked records into store and database
  const merged = await persistWallets(db, [...updatedParentLinks, ...newLinkedRecords]);

  log('info', `[lineageBackfill] Backfill complete. Updated ${updatedParentLinks.length} parents, added ${newLinkedRecords.length} linked records. Total wallets in store: ${merged.length}`);

  return {
    backfilledCount: updatedParentLinks.length,
    newLinkedWalletsCount: newLinkedRecords.length,
    totalWallets: merged.length,
  };
}
