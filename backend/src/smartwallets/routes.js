import { Router } from 'express';
import { SMART_WALLET_SOURCES } from './sources.js';
import {
  EARLY_BUY_TIERS,
  EARLY_BUYER_RULES,
  LOOKBACK_MS,
  earlyBuyerLimitForAth,
  SMART_WALLET_MIN_OPEN_TRADES,
  SMART_WALLET_MIN_PNL_USD,
  WHALE_WALLET_MIN_USD,
  classifyWalletCategory,
} from './tiers.js';
import {
  findRunners,
  loadWallets,
  saveWallets,
  upsertWallets,
  connectLineageWallet,
  connectWhaleWallet,
  selectAthEarlyBuyers,
  selectEarlyBuyersByMcap,
  selectEarlyBuyersDual,
} from './tracker.js';
import { scanSmartWallets, scanFomoSmartMoney, scanKolscanSmartMoney, scanNockSmartMoney, scanMadeOnSolSmartMoney } from './finder.js';
import { fetchWalletsFromDb, upsertWalletsDb } from './db.js';
import { queryWallets } from './query.js';
import { persistWallets, removeWallet } from './persist.js';
import { recordScamMeme, getScamMemes, traceLineage } from './scam.js';
import { untrack } from '../analysis/tracked.js';
import { backfillWalletMetrics } from './backfill.js';
import { fetchFomoAllLeaderboards } from './adapters/fomo.js';
import { isAddressForChain, normalizeAddress } from './addresses.js';

export function createSmartWalletsRouter({ getTokens = () => [], db = null } = {}) {
  const toScore = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const router = Router();

  const rulesPayload = {
    tiers: EARLY_BUY_TIERS,
    earlyBuyerRules: EARLY_BUYER_RULES,
    qualificationRules: {
      minOpenTrades: SMART_WALLET_MIN_OPEN_TRADES,
      minPnlUsd: SMART_WALLET_MIN_PNL_USD,
      lookbackDays: EARLY_BUYER_RULES.lookbackDays,
    },
    whaleRules: { minUsd: WHALE_WALLET_MIN_USD },
    lookbackMs: LOOKBACK_MS,
    sources: SMART_WALLET_SOURCES,
  };

  // GET /api/smart-wallets: same filters for Postgres and the JSON file.
  router.get('/', async (req, res) => {
    const chain = (req.query.chain && req.query.chain !== 'all') ? req.query.chain : null;
    const isAll = req.query.limit === 'all' || req.query.pageSize === 'all';
    const pageSize = isAll ? 1_000_000 : Math.min(500, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 50));
    const page = req.query.page == null && req.query.offset != null
      ? Math.floor(Number(req.query.offset) / pageSize) + 1
      : Math.max(1, Number(req.query.page) || 1);
    const filters = {
      chain,
      walletType: req.query.walletType || null,
      category: req.query.category || 'all',
      subfilter: req.query.subfilter || req.query.trackedSubfilter || 'all',
      search: String(req.query.search || req.query.q || '').trim().toLowerCase(),
      consistentOnly: req.query.consistentOnly === 'true' || req.query.consistentOnly === true,
      page,
      pageSize,
    };

    let sourceRows = [];
    let storage = 'json';
    if (db) {
      try {
        sourceRows = await fetchWalletsFromDb(db, { walletType: filters.walletType, limit: null, offset: 0 });
        storage = 'postgres';
      } catch {
        sourceRows = loadWallets().wallets || [];
      }
    } else {
      sourceRows = loadWallets().wallets || [];
    }

    res.json({
      ...queryWallets(sourceRows, filters),
      ...rulesPayload,
      storage,
    });
  });

  const SCANNERS = {
    gmgn: ({ chain, limit, db }) => scanSmartWallets({ chain, limit, db }),
    fomo: ({ chain, limit, db }) => scanFomoSmartMoney({ chain, limit, db }),
    kolscan: ({ limit, db }) => scanKolscanSmartMoney({ limit, db }),
    nock: ({ limit, db }) => scanNockSmartMoney({ limit, db }),
    madeonsol: ({ limit, db }) => scanMadeOnSolSmartMoney({ limit, db }),
  };

  async function runScan(req, res, source) {
    const scanner = SCANNERS[source];
    if (!scanner) return res.status(404).json({ error: `Unknown scan source ${source}` });
    try {
      const chain = req.body?.chain || req.query?.chain || 'all';
      const limit = Number(req.body?.limit || (source === 'gmgn' ? 20 : 50));
      const wallets = await scanner({ chain, limit, db });
      res.json({ success: true, count: wallets.length, wallets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  router.post('/scan', (req, res) => runScan(req, res, 'gmgn'));
  router.post('/scan/:source', (req, res) => runScan(req, res, req.params.source));

  router.get('/sources', (req, res) => res.json({ sources: SMART_WALLET_SOURCES }));

  router.get('/tiers', (req, res) => res.json({
    tiers: EARLY_BUY_TIERS,
    earlyBuyerRules: EARLY_BUYER_RULES,
    lookbackMs: LOOKBACK_MS,
  }));

  // 30-day runners currently in the registry (ATH >= $1M).
  router.get('/runners', (req, res) => {
    const runners = findRunners(getTokens());
    res.json({ count: runners.length, runners: runners.slice(0, 200) });
  });

  // POST /api/smart-wallets/lineage: Record whale/DB funder transfer to a new child wallet
  router.post('/lineage', async (req, res) => {
    const { parentAddress, childAddress, chain = 'solana', amount = 0, txHash = null, tags = [], evidence = null } = req.body || {};
    const c = chain === 'robinhood' ? 'robinhood' : 'solana';

    const validParent = isAddressForChain(c, parentAddress);
    const validChild = isAddressForChain(c, childAddress);

    if (!validParent || !validChild) {
      return res.status(400).json({
        error: 'Invalid addresses: both parent and child address must be valid for the specified chain (0x for robinhood, base58 for solana)',
      });
    }

    const lineageWallet = connectLineageWallet({
      parentAddress,
      childAddress,
      chain: c,
      amount,
      txHash,
      tags,
      evidence,
    });

    await persistWallets(db, [lineageWallet]);

    res.status(201).json({ success: true, wallet: lineageWallet });
  });

  // POST /api/smart-wallets/whale: Record / upsert a whale wallet
  router.post('/whale', async (req, res) => {
    const { address, chain = 'solana', balanceUsd = 0, memeHoldingsUsd = 0, tags = [], evidence = null } = req.body || {};
    const c = chain === 'robinhood' ? 'robinhood' : 'solana';

    const validAddr = isAddressForChain(c, address);
    if (!validAddr) {
      return res.status(400).json({
        error: 'Invalid address: must be valid for the specified chain (0x for robinhood, base58 for solana)',
      });
    }

    const whaleWallet = connectWhaleWallet({
      address,
      chain: c,
      balanceUsd,
      memeHoldingsUsd,
      tags,
      evidence,
    });

    await persistWallets(db, [whaleWallet]);

    res.status(201).json({ success: true, wallet: whaleWallet });
  });

  // POST /api/smart-wallets/early-buyers: Ingest early buyer wallets for a coin hitting ATH >= $1M
  router.post('/early-buyers', async (req, res) => {
    const { token = {}, buys = [], athMcap = null, method = 'both', requireProfitable = true } = req.body || {};
    let result;
    if (method === 'mcap') {
      result = selectEarlyBuyersByMcap({ token, buys, athMcap, requireProfitable });
    } else if (method === 'first_n') {
      result = selectAthEarlyBuyers({ token, buys, athMcap, requireProfitable });
    } else {
      result = selectEarlyBuyersDual({ token, buys, athMcap, requireProfitable });
    }

    const buyersToSave = result.allBuyers || result.buyers || [];
    if (buyersToSave.length > 0) {
      await persistWallets(db, buyersToSave);
    }

    res.json({
      success: true,
      quota: result.quota ?? earlyBuyerLimitForAth(result.athMcap),
      count: result.count ?? buyersToSave.length,
      buyers: buyersToSave,
      ...result,
    });
  });

  // POST /api/smart-wallets/backfill: Populate avg buy, avg sell, and avg holding time metrics
  router.post('/backfill', async (req, res) => {
    try {
      const maxLiveQueries = Number(req.body?.maxLiveQueries ?? 5);
      const result = await backfillWalletMetrics({ maxLiveQueries, db });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/smart-wallets/promote/:chain/:address: Promote a tracked wallet to a smart wallet
  router.post('/promote/:chain/:address', async (req, res) => {
    const { chain, address } = req.params;
    const norm = normalizeAddress(chain, address);
    let dbUpdated = false;

    if (db) {
      const dbRes = await db.query(
        `UPDATE smart_wallets SET category = 'smart', status = 'promoted', updated_at = NOW() WHERE chain = $1 AND address = $2`,
        [chain, norm]
      );
      if (dbRes?.rowCount > 0) {
        dbUpdated = true;
      }
    }

    const doc = loadWallets();
    let found = false;
    const wallets = (doc.wallets || []).map(w => {
      const match = w.chain === chain && (w.chain === 'robinhood' ? String(w.address).toLowerCase() : String(w.address)) === norm;
      if (match) {
        found = true;
        return { ...w, category: 'smart', status: 'promoted', lastSeenAt: new Date().toISOString() };
      }
      return w;
    });

    if (!found && (!db || !dbUpdated)) {
      return res.status(404).json({ error: `Wallet ${address} on ${chain} not found` });
    }

    if (found) {
      saveWallets({ ...doc, wallets });
    }
    res.json({ success: true, chain, address: norm, category: 'smart' });
  });

  // POST /api/smart-wallets/backfill/fomo: Multi-window FOMO backfill (24h, 7d, 30d, all)
  router.post('/backfill/fomo', async (req, res) => {
    try {
      const chain = req.body?.chain || 'all';
      const { wallets, handles } = await fetchFomoAllLeaderboards({ chain });
      if (wallets.length) {
        await persistWallets(db, wallets);
      }
      res.json({ success: true, count: wallets.length, uniqueHandles: handles.length, wallets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/smart-wallets/scam/detect: Record dev sell / scam meme
  router.post('/scam/detect', async (req, res) => {
    try {
      const {
        mint,
        chain = 'solana',
        symbol,
        name,
        devWallet,
        sellTx,
        sellAmount,
        sellPriceUsd,
        athMcap,
        earlyBuys = [],
        metadata = {},
      } = req.body || {};

      if (!mint || !devWallet) {
        return res.status(400).json({ error: 'mint and devWallet are required' });
      }

      const result = await recordScamMeme({
        mint,
        chain,
        symbol,
        name,
        devWallet,
        sellTx,
        sellAmount,
        sellPriceUsd,
        athMcap,
        earlyBuys,
        untrackFn: untrack,
        metadata,
        db,
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/smart-wallets/scam/memes: List recorded scam memes
  router.get('/scam/memes', async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const memes = await getScamMemes({ db, limit, offset });
      res.json({ count: memes.length, memes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/smart-wallets/scam/wallets: List scam & scammer lineage wallets
  router.get('/scam/wallets', async (req, res) => {
    try {
      const doc = loadWallets();
      const all = doc.wallets || [];
      const scamWallets = all.filter(w =>
        w.walletType === 'scam_wallet' ||
        w.walletType === 'scammer_lineage_wallet' ||
        (w.retardPoints || 0) > 0 ||
        (w.susWalletPoints || 0) > 0
      );
      res.json({
        count: scamWallets.length,
        wallets: scamWallets,
        summary: {
          devScammers: all.filter(w => w.walletType === 'scam_wallet').length,
          lineageScammers: all.filter(w => w.walletType === 'scammer_lineage_wallet').length,
          retardPointsTotal: all.reduce((sum, w) => sum + (w.retardPoints || 0), 0),
          susPointsTotal: all.reduce((sum, w) => sum + (w.susWalletPoints || 0), 0),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/smart-wallets/scam/lineage/:address: Trace lineage for an address
  router.get('/scam/lineage/:address', (req, res) => {
    const doc = loadWallets();
    const lineage = traceLineage(req.params.address, doc.wallets || [], 3);
    res.json({ address: req.params.address, count: lineage.length, lineage });
  });

  // Manual upsert (finder jobs + UI). Body: { wallets: [{ address, chain, source, score, evidence }] }
  router.post('/', async (req, res) => {
    const incoming = (Array.isArray(req.body?.wallets) ? req.body.wallets : []).filter(w => w && typeof w === 'object');
    const clean = incoming
      .map(w => ({ ...w, chain: w?.chain === 'robinhood' ? 'robinhood' : 'solana' }))
      .filter(w => typeof w?.address === 'string' && isAddressForChain(w.chain, w.address))
      .map(w => ({
        address: normalizeAddress(w.chain, w.address),
        chain: w.chain,
        category: w.category || 'smart',
        source: String(w.source || 'manual').slice(0, 64),
        score: toScore(w.score),
        hits: (() => { const h = toScore(w.hits); return h == null ? 1 : h; })(),
        evidence: w.evidence || null,
        lineageParent: w.lineageParent || null,
        lineageTx: w.lineageTx || null,
        lineageAmount: w.lineageAmount != null ? Number(w.lineageAmount) : null,
        earlyBuyerInfo: w.earlyBuyerInfo || null,
        status: w.status || 'active',
        realizedProfitUsd: Number(w.realizedProfitUsd || 0),
        winRatePct: Number(w.winRatePct || 0),
        profitableTrades: Number(w.profitableTrades || 0),
        totalTrades: Number(w.totalTrades || 0),
        tokenNum: Number(w.tokenNum || 0),
        openTrades: Number(w.openTrades || 0),
        balanceUsd: Number(w.balanceUsd || 0),
        memeHoldingsUsd: Number(w.memeHoldingsUsd || 0),
        walletType: w.walletType || 'normal',
        retardPoints: Number(w.retardPoints || 0),
        susWalletPoints: Number(w.susWalletPoints || 0),
        scamMemesInvolved: Array.isArray(w.scamMemesInvolved) ? w.scamMemesInvolved : [],
        buys0to1M: Number(w.buys0to1M || w.buysUnder1M || 0),
        buys0to1MWon: Number(w.buys0to1MWon || w.buysUnder1MProfitable || 0),
        buys1to2M: Number(w.buys1to2M || 0),
        buys1to2MWon: Number(w.buys1to2MWon || 0),
        buys2to5M: Number(w.buys2to5M || 0),
        buys2to5MWon: Number(w.buys2to5MWon || 0),
        buys5to10M: Number(w.buys5to10M || 0),
        buys5to10MWon: Number(w.buys5to10MWon || 0),
        avgBuyPrice: w.avgBuyPrice != null ? Number(w.avgBuyPrice) : null,
        avgBuyMcap: w.avgBuyMcap != null ? Number(w.avgBuyMcap) : null,
        avgSellPrice: w.avgSellPrice != null ? Number(w.avgSellPrice) : null,
        avgHoldingTimeSec: w.avgHoldingTimeSec != null ? Number(w.avgHoldingTimeSec) : null,
        qualificationMethod: w.qualificationMethod || null,
        methods: Array.isArray(w.methods) ? w.methods : (w.qualificationMethod ? [w.qualificationMethod] : []),
        tags: Array.isArray(w.tags) ? w.tags : (w.category === 'tracked' ? ['tracked_candidate'] : (w.category === 'whale' ? ['whale'] : (w.category === 'lineage' ? ['lineage'] : ['smart_degen']))),
        twitterUsername: w.twitterUsername || null,
        avatar: w.avatar || null,
      }))
      .slice(0, 500);

    if (!clean.length) return res.status(400).json({ error: 'no valid wallets: address must be 0x-40hex (robinhood) or base58 32-44 (solana)' });

    const wallets = await persistWallets(db, clean);

    res.status(201).json({ count: wallets.length, wallets });
  });

  // Delete / untrack wallet
  router.delete('/:chain/:address', async (req, res) => {
    const { chain, address } = req.params;
    try {
      const remaining = await removeWallet(db, chain, address);
      res.json({ success: true, count: remaining.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
