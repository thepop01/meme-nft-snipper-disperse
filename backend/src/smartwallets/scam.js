// Scam Meme & Dev Selling Detection System.
// When a meme token's deployer / dev wallet starts selling:
// 1. Bearish event notification is pushed to alert center and WS clients.
// 2. Token is marked as 'scam_meme' and removed from active tracking.
// 3. Dev wallet is marked as 'scam_wallet'.
// 4. Lineage of the dev wallet (up to 3 hops) is traced and marked as 'scammer_lineage_wallet'.
// 5. Early buyers:
//    - Lost money (no profit) -> +1 retard_point
//    - Made profit -> +1 sus_wallet_point (possible insider)
import { load, save } from '../store.js';
import { emit, log } from '../bus.js';
import { pushAlert } from '../alerts.js';
import { loadWallets, saveWallets, upsertWallets } from './tracker.js';
import { persistWallets } from './persist.js';
import {
  upsertScamMemeDb,
  fetchScamMemesDb,
  markWalletScamDb,
  penalizeEarlyWalletDb,
} from './db.js';

const SCAM_MEMES_STORE = 'scam-memes';

/**
 * Traces lineage graph up to maxHops from a starting wallet.
 * Searches across known wallets in the store or database.
 */
export function traceLineage(startAddress, wallets = [], maxHops = 3) {
  const normStart = String(startAddress || '').toLowerCase();
  if (!normStart) return [];

  const visited = new Set([normStart]);
  const lineageWallets = [];
  let currentHopAddresses = new Set([normStart]);

  for (let hop = 1; hop <= maxHops; hop++) {
    const nextHopAddresses = new Set();

    for (const w of wallets) {
      const wAddr = String(w.address || '').toLowerCase();
      const parentAddr = String(w.lineageParent || w.evidence?.parentAddress || w.evidence?.fund_from_address || '').toLowerCase();

      // Check if w is child of an address in currentHop
      if (currentHopAddresses.has(parentAddr) && !visited.has(wAddr)) {
        visited.add(wAddr);
        nextHopAddresses.add(wAddr);
        lineageWallets.push({
          address: w.address,
          chain: w.chain || 'solana',
          hop,
          relationship: 'child',
          relativeTo: parentAddr,
        });
      }

      // Check if w is parent of an address in currentHop
      if (currentHopAddresses.has(wAddr) && parentAddr && !visited.has(parentAddr)) {
        visited.add(parentAddr);
        nextHopAddresses.add(parentAddr);
        const rawParent = w.lineageParent || w.evidence?.parentAddress || w.evidence?.fund_from_address || parentAddr;
        lineageWallets.push({
          address: w.chain === 'robinhood' ? parentAddr : rawParent,
          chain: w.chain || 'solana',
          hop,
          relationship: 'parent',
          relativeTo: w.address || wAddr,
        });
      }
    }

    if (nextHopAddresses.size === 0) break;
    currentHopAddresses = nextHopAddresses;
  }

  return lineageWallets;
}

/**
 * Records a scam meme when the dev sells, notifies users, evicts the coin,
 * marks the dev and lineage wallets, and assigns retard/sus points to early buyers.
 */
export async function recordScamMeme({
  mint,
  chain = 'solana',
  symbol = 'MEME',
  name = null,
  devWallet,
  sellTx = null,
  sellAmount = 0,
  sellPriceUsd = 0,
  athMcap = null,
  earlyBuys = [],
  untrackFn = null,
  discardTokenFn = null,
  metadata = {},
  db = null,
} = {}) {
  if (!mint || !devWallet) {
    throw new Error('mint and devWallet are required to record a scam meme');
  }

  const normDev = chain === 'robinhood' ? String(devWallet).toLowerCase() : String(devWallet);

  log('warn', `[scam-meme] 🚨 BEARISH EVENT: Dev ${normDev} sold on ${symbol} (${mint}). Registering scam meme.`);

  // 1. Push notification alert & broadcast to event bus
  pushAlert({
    type: 'scam:dev-sell',
    title: `🚨 BEARISH EVENT: Dev Sold ${symbol}`,
    body: `The deployer/dev wallet (${normDev.slice(0, 8)}...${normDev.slice(-6)}) started selling ${symbol}. Marked as scam meme and evicted from tracking.`,
    severity: 'critical',
    link: `/tokens/${mint}`,
  });

  emit('scam:meme-detected', {
    mint,
    chain,
    symbol,
    devWallet: normDev,
    sellTx,
    sellAmount,
    sellPriceUsd,
    athMcap,
    ts: Date.now(),
  });

  // 2. Remove coin from active tracking & discard in registry if callbacks provided
  if (typeof untrackFn === 'function') {
    try { untrackFn(mint); } catch { /* ignore */ }
  }
  if (typeof discardTokenFn === 'function') {
    try { discardTokenFn(mint, `scam meme: dev wallet ${normDev} dumped`); } catch { /* ignore */ }
  }

  // 3. Load wallets store to find lineage and early buyers
  const doc = loadWallets();
  const allWallets = doc.wallets || [];

  // Trace dev's lineage up to 3 hops
  const lineageFound = traceLineage(normDev, allWallets, 3);
  const lineageAddressSet = new Set(lineageFound.map(l => String(l.address).toLowerCase()));

  // 4. Process early buyers
  // Each early wallet:
  // - didn't make a profit -> +1 retard_point
  // - made a profit -> +1 sus_wallet_point (potential insider)
  let earlyPenalizedCount = 0;
  let earlySusCount = 0;

  const earlyUpdates = [];
  for (const b of earlyBuys) {
    const bAddr = b.address || b.wallet || b.maker;
    if (!bAddr) continue;
    const normBAddr = chain === 'robinhood' ? String(bAddr).toLowerCase() : String(bAddr);
    if (normBAddr === normDev || lineageAddressSet.has(normBAddr.toLowerCase())) continue; // dev & lineage handled separately

    const isProfitable = Boolean(
      b.isProfitable === true ||
      (Number(b.pnlUsd ?? b.realizedProfitUsd ?? b.profit ?? 0) > 0) ||
      (b.sellTotalUsd && b.buyTotalUsd && Number(b.sellTotalUsd) > Number(b.buyTotalUsd))
    );

    if (isProfitable) {
      earlySusCount++;
      earlyUpdates.push({
        address: normBAddr,
        chain,
        susWalletPoints: 1,
        retardPoints: 0,
        scamMemesInvolved: [mint],
        tags: ['sus_insider'],
      });
    } else {
      earlyPenalizedCount++;
      earlyUpdates.push({
        address: normBAddr,
        chain,
        susWalletPoints: 0,
        retardPoints: 1,
        scamMemesInvolved: [mint],
        tags: ['scam_victim'],
      });
    }
  }

  // 5. Construct updates for dev wallet and lineage wallets
  const devUpdate = {
    address: normDev,
    chain,
    category: 'tracked',
    walletType: 'scam_wallet',
    status: 'flagged',
    scamMemesInvolved: [mint],
    tags: ['scam_wallet', 'dev_dump'],
  };

  const lineageUpdates = lineageFound.map(l => ({
    address: l.address,
    chain: l.chain,
    category: 'tracked',
    walletType: 'scammer_lineage_wallet',
    status: 'flagged',
    scamMemesInvolved: [mint],
    tags: ['scammer_lineage_wallet', `lineage_hop_${l.hop}`],
  }));

  const allUpdates = [devUpdate, ...lineageUpdates, ...earlyUpdates];

  // 6. Save scam meme record
  const scamMemeRecord = {
    mint,
    chain,
    symbol,
    name,
    devWallet: normDev,
    sellTx,
    sellAmount: Number(sellAmount) || 0,
    sellPriceUsd: Number(sellPriceUsd) || 0,
    athMcap: Number(athMcap) || null,
    earlyWalletsPenalized: earlyPenalizedCount,
    earlyWalletsSus: earlySusCount,
    detectedAt: new Date().toISOString(),
    scammerLineageWallets: lineageFound,
    metadata,
  };

  // Durable store fallback
  const scamList = load(SCAM_MEMES_STORE, []);
  const existingIdx = scamList.findIndex(m => m.mint === mint);
  if (existingIdx >= 0) {
    scamList[existingIdx] = { ...scamList[existingIdx], ...scamMemeRecord };
  } else {
    scamList.unshift(scamMemeRecord);
  }
  save(SCAM_MEMES_STORE, scamList.slice(0, 1000));

  // 7. Persist to PostgreSQL if connected
  if (db) {
    await upsertScamMemeDb(db, scamMemeRecord).catch(err => {
      log('warn', `[scam-meme] DB upsert failed for scam meme: ${err.message}`);
    });

    await markWalletScamDb(db, { chain, address: normDev, walletType: 'scam_wallet' }).catch(() => {});
    for (const l of lineageFound) {
      await markWalletScamDb(db, { chain: l.chain, address: l.address, walletType: 'scammer_lineage_wallet' }).catch(() => {});
    }
    for (const b of earlyUpdates) {
      await penalizeEarlyWalletDb(db, {
        chain: b.chain,
        address: b.address,
        isProfitable: b.susWalletPoints > 0,
        scamMint: mint,
      }).catch(() => {});
    }
  }

  // Update wallets in DB and JSON store
  await persistWallets(db, allUpdates);

  log('info', `[scam-meme] ${symbol} marked as scam meme. Dev: ${normDev}, Lineage wallets: ${lineageFound.length}, Retard points: +${earlyPenalizedCount}, Sus points: +${earlySusCount}`);

  return {
    success: true,
    scamMeme: scamMemeRecord,
    devWallet: normDev,
    lineageWallets: lineageFound,
    earlyPenalizedCount,
    earlySusCount,
  };
}

/**
 * Detects whether a trade event represents a dev wallet selling tokens.
 */
export function isDevSellEvent(trade, token) {
  if (!trade || !token) return false;
  const isSell = trade.event_type === 'sell' || trade.type === 'sell' || trade.side === 'sell' || trade.is_buy === false;
  if (!isSell) return false;

  const seller = String(trade.wallet || trade.maker || trade.address || trade.from || '').toLowerCase();
  if (!seller) return false;

  const devCandidates = [
    token.devWallet,
    token.dev_wallet,
    token.deployer,
    token.creator,
    token.owner,
    token.author,
    token.authority,
  ].filter(Boolean).map(a => String(a).toLowerCase());

  return devCandidates.includes(seller);
}

/**
 * Returns recorded scam memes.
 */
export async function getScamMemes({ db = null, limit = 50, offset = 0 } = {}) {
  if (db) {
    try {
      return await fetchScamMemesDb(db, { limit, offset });
    } catch {
      // fallback to store
    }
  }
  const list = load(SCAM_MEMES_STORE, []);
  return list.slice(offset, offset + limit);
}
