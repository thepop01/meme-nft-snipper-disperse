import { Router } from 'express';
import { SMART_WALLET_SOURCES } from './sources.js';
import {
  EARLY_BUY_TIERS,
  LOOKBACK_MS,
  MIN_RUNNER_ATH,
  earlyBuyerLimitForAth,
  isSmartWallet,
  SMART_WALLET_MIN_OPEN_TRADES,
  SMART_WALLET_MIN_PNL_USD,
  WHALE_WALLET_MIN_USD,
  isWhaleWallet,
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
import { fetchWalletsFromDb, countWalletsInDb, upsertWalletsDb } from './db.js';
import { recordScamMeme, getScamMemes, traceLineage } from './scam.js';
import { untrack } from '../analysis/tracked.js';
import { backfillWalletMetrics } from './backfill.js';
import { fetchFomoAllLeaderboards } from './adapters/fomo.js';

export function createSmartWalletsRouter({ getTokens = () => [], db = null } = {}) {
  const toScore = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const isEvmAddr = v => /^0x[0-9a-fA-F]{40}$/.test(String(v || ''));
  const isSolAddr = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));
  const router = Router();

  // Helper predicates for wallet categories
  const isLineageWallet = w => w.category === 'lineage' || Boolean(w.lineageParent) || w.source === 'lineage';
  const isSniperWallet = w => (
    w.category === 'sniper' ||
    (Array.isArray(w.tags) && w.tags.some(t => typeof t === 'string' && (
      t.includes('sniper') || t.includes('bundler') || t === 'alpha_buyer' ||
      t === 'rank_1_buyer' || t === 'madeonsol_sniper' || t === 'high_profit_sniper' || t === 'early_sniper'
    ))) ||
    Boolean(w.flags?.is_sniper) ||
    Boolean(w.flags?.is_bundler)
  );
  const isWhaleCat = w => !isLineageWallet(w) && (w.category === 'whale' || isWhaleWallet(w));
  const isTrackedCat = w => !isLineageWallet(w) && !isWhaleCat(w) && w.category === 'tracked';
  const isSmartCat = w => !isLineageWallet(w) && !isWhaleCat(w) && !isTrackedCat(w) && (!w.category || w.category === 'smart');

  // GET /api/smart-wallets: returns wallets filtered by chain and category ('smart' | 'tracked' | 'whale' | 'lineage' | 'sniper' | 'all')
  router.get('/', async (req, res) => {
    const chain = (req.query.chain && req.query.chain !== 'all') ? req.query.chain : null;
    const category = req.query.category || 'all';
    const subfilter = req.query.subfilter || req.query.trackedSubfilter || 'all';
    const search = (req.query.search || req.query.q || '').trim().toLowerCase();
    const consistentOnly = req.query.consistentOnly === 'true' || req.query.consistentOnly === true;
    const walletType = req.query.walletType || null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const isAll = req.query.limit === 'all' || req.query.pageSize === 'all';
    const pageSize = isAll ? 1000000 : Math.min(500, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 50));
    const offset = req.query.offset != null && req.query.page == null ? Number(req.query.offset) : (page - 1) * pageSize;

    if (db) {
      try {
        let wallets = await fetchWalletsFromDb(db, { chain, category, limit: pageSize, offset });
        if (walletType) wallets = wallets.filter(w => w.walletType === walletType);
        const total = await countWalletsInDb(db, chain, category);
        const smartCount = await countWalletsInDb(db, chain, 'smart');
        const trackedCount = await countWalletsInDb(db, chain, 'tracked');
        const whaleCount = await countWalletsInDb(db, chain, 'whale');
        const lineageCount = await countWalletsInDb(db, chain, 'lineage');
        const sniperCount = 0;
        const totalPages = Math.ceil(total / pageSize) || 1;
        return res.json({
          page,
          pageSize,
          total,
          totalPages,
          count: total,
          smartCount,
          trackedCount,
          whaleCount,
          lineageCount,
          sniperCount,
          wallets,
          tiers: EARLY_BUY_TIERS,
          earlyBuyerRules: { minAth: 400000, baseQuota: 100, perMillionBonus: 20 },
          qualificationRules: {
            minOpenTrades: SMART_WALLET_MIN_OPEN_TRADES,
            minPnlUsd: SMART_WALLET_MIN_PNL_USD,
            lookbackDays: 30,
          },
          whaleRules: { minUsd: WHALE_WALLET_MIN_USD },
          lookbackMs: LOOKBACK_MS,
          sources: SMART_WALLET_SOURCES,
          storage: 'postgres',
        });
      } catch {
        // fall back to json file
      }
    }

    const doc = loadWallets();
    const all = doc.wallets || [];
    let chainFiltered = chain ? all.filter(w => w.chain === chain) : all;
    if (walletType) {
      chainFiltered = chainFiltered.filter(w => (w.walletType || 'normal') === walletType);
    }

    const smartCount = chainFiltered.filter(w => isSmartCat(w)).length;
    const trackedCount = chainFiltered.filter(w => isTrackedCat(w)).length;
    const whaleCount = chainFiltered.filter(w => isWhaleCat(w)).length;
    const lineageCount = chainFiltered.filter(w => isLineageWallet(w)).length;
    const sniperCount = chainFiltered.filter(w => isSniperWallet(w)).length;
    const scamCount = chainFiltered.filter(w => w.walletType === 'scam_wallet').length;

    let filtered = chainFiltered;

    if (category && category !== 'all') {
      if (category === 'lineage') {
        filtered = filtered.filter(w => isLineageWallet(w));
      } else if (category === 'whale') {
        filtered = filtered.filter(w => isWhaleCat(w));
      } else if (category === 'sniper') {
        filtered = filtered.filter(w => isSniperWallet(w));
      } else if (category === 'tracked') {
        filtered = filtered.filter(w => isTrackedCat(w));
      } else if (category === 'smart') {
        filtered = filtered.filter(w => isSmartCat(w));
      } else {
        filtered = filtered.filter(w => (w.category || 'smart') === category);
      }
    }

    if (subfilter && subfilter !== 'all') {
      if (subfilter === 'buying_mcap') {
        filtered = filtered.filter(w => w.qualificationMethod === 'buying_mcap' || (Array.isArray(w.methods) && w.methods.includes('buying_mcap')));
      } else if (subfilter === 'first_n_buyers') {
        filtered = filtered.filter(w => w.qualificationMethod === 'first_n_buyers' || (Array.isArray(w.methods) && w.methods.includes('first_n_buyers')));
      } else if (subfilter === 'both') {
        filtered = filtered.filter(w => w.qualificationMethod === 'both' || (Array.isArray(w.methods) && w.methods.includes('buying_mcap') && w.methods.includes('first_n_buyers')));
      } else if (subfilter === 'early_buyer') {
        filtered = filtered.filter(w => Boolean(w.qualificationMethod) || w.category === 'tracked');
      }
    }

    if (consistentOnly) {
      filtered = filtered.filter(w => {
        const trades = Number(w.openTradesCount ?? w.tradesCount ?? 0);
        const pnl = Number(w.realizedPnlUsd ?? w.pnlUsd ?? 0);
        return trades >= 5 && pnl > 100;
      });
    }

    if (search) {
      filtered = filtered.filter(w => (
        (w.address && w.address.toLowerCase().includes(search)) ||
        (w.twitterUsername && w.twitterUsername.toLowerCase().includes(search)) ||
        (w.lineageParent && w.lineageParent.toLowerCase().includes(search)) ||
        (w.symbol && w.symbol.toLowerCase().includes(search)) ||
        (Array.isArray(w.tags) && w.tags.some(t => String(t).toLowerCase().includes(search)))
      ));
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const wallets = isAll ? filtered : filtered.slice(offset, offset + pageSize);

    res.json({
      page,
      pageSize,
      total,
      totalPages,
      count: total,
      smartCount,
      trackedCount,
      whaleCount,
      lineageCount,
      sniperCount,
      scamCount,
      wallets,
      tiers: EARLY_BUY_TIERS,
      earlyBuyerRules: { minAth: 1000000, baseQuota: 100, perMillionBonus: 20, athPct: 25, methods: ['buying_mcap', 'first_n_buyers'] },
      qualificationRules: {
        minOpenTrades: SMART_WALLET_MIN_OPEN_TRADES,
        minPnlUsd: SMART_WALLET_MIN_PNL_USD,
        lookbackDays: 30,
      },
      whaleRules: { minUsd: WHALE_WALLET_MIN_USD },
      lookbackMs: LOOKBACK_MS,
      sources: SMART_WALLET_SOURCES,
      storage: 'json',
    });
  });

  router.post('/scan', async (req, res) => {
    try {
      const chain = req.body?.chain || req.query?.chain || 'all';
      const limit = Number(req.body?.limit || 20);
      const found = await scanSmartWallets({ chain, limit, db });
      const doc = loadWallets();
      res.json({ success: true, count: found.length, wallets: doc.wallets || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/scan/fomo', async (req, res) => {
    try {
      const chain = req.body?.chain || req.query?.chain || 'all';
      const limit = Number(req.body?.limit || 50);
      const found = await scanFomoSmartMoney({ chain, limit, db });
      const doc = loadWallets();
      res.json({ success: true, count: found.length, wallets: doc.wallets || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/scan/kolscan', async (req, res) => {
    try {
      const limit = Number(req.body?.limit || 50);
      const found = await scanKolscanSmartMoney({ limit, db });
      const doc = loadWallets();
      res.json({ success: true, count: found.length, wallets: doc.wallets || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/scan/nock', async (req, res) => {
    try {
      const limit = Number(req.body?.limit || 50);
      const found = await scanNockSmartMoney({ limit, db });
      const doc = loadWallets();
      res.json({ success: true, count: found.length, wallets: doc.wallets || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/scan/madeonsol', async (req, res) => {
    try {
      const limit = Number(req.body?.limit || 50);
      const found = await scanMadeOnSolSmartMoney({ limit, db });
      const doc = loadWallets();
      res.json({ success: true, count: found.length, wallets: doc.wallets || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sources', (req, res) => res.json({ sources: SMART_WALLET_SOURCES }));

  router.get('/tiers', (req, res) => res.json({
    tiers: EARLY_BUY_TIERS,
    earlyBuyerRules: { minAth: 1000000, baseQuota: 100, perMillionBonus: 20, athPct: 25, methods: ['buying_mcap', 'first_n_buyers'] },
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

    const validParent = c === 'robinhood' ? isEvmAddr(parentAddress) : isSolAddr(parentAddress);
    const validChild = c === 'robinhood' ? isEvmAddr(childAddress) : isSolAddr(childAddress);

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

    if (db) {
      await upsertWalletsDb(db, [lineageWallet]).catch(() => {});
    }

    const doc = loadWallets();
    const wallets = upsertWallets(doc.wallets || [], [lineageWallet]);
    saveWallets({ ...doc, wallets });

    res.status(201).json({ success: true, wallet: lineageWallet });
  });

  // POST /api/smart-wallets/whale: Record / upsert a whale wallet
  router.post('/whale', async (req, res) => {
    const { address, chain = 'solana', balanceUsd = 0, memeHoldingsUsd = 0, tags = [], evidence = null } = req.body || {};
    const c = chain === 'robinhood' ? 'robinhood' : 'solana';

    const validAddr = c === 'robinhood' ? isEvmAddr(address) : isSolAddr(address);
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

    if (db) {
      await upsertWalletsDb(db, [whaleWallet]).catch(() => {});
    }

    const doc = loadWallets();
    const wallets = upsertWallets(doc.wallets || [], [whaleWallet]);
    saveWallets({ ...doc, wallets });

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
      if (db) {
        await upsertWalletsDb(db, buyersToSave).catch(() => {});
      }
      const doc = loadWallets();
      const wallets = upsertWallets(doc.wallets || [], buyersToSave);
      saveWallets({ ...doc, wallets });
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
    const norm = chain === 'robinhood' ? String(address || '').toLowerCase() : String(address || '');

    if (db) {
      await db.query(
        `UPDATE smart_wallets SET category = 'smart', status = 'promoted', updated_at = NOW() WHERE chain = $1 AND address = $2`,
        [chain, norm]
      ).catch(() => {});
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

    if (!found) {
      return res.status(404).json({ error: `Wallet ${address} on ${chain} not found` });
    }

    saveWallets({ ...doc, wallets });
    res.json({ success: true, chain, address: norm, category: 'smart' });
  });

  // POST /api/smart-wallets/scan/fomo: Scan live FOMO leaderboard
  router.post('/scan/fomo', async (req, res) => {
    try {
      const chain = req.body?.chain || 'all';
      const limit = Number(req.body?.limit) || 150;
      const window = req.body?.window || '30d';
      const wallets = await scanFomoSmartMoney({ chain, limit, db });
      res.json({ success: true, count: wallets.length, wallets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/smart-wallets/backfill/fomo: Multi-window FOMO backfill (24h, 7d, 30d, all)
  router.post('/backfill/fomo', async (req, res) => {
    try {
      const chain = req.body?.chain || 'all';
      const { wallets, handles } = await fetchFomoAllLeaderboards({ chain });
      if (wallets.length) {
        if (db) await upsertWalletsDb(db, wallets).catch(() => {});
        const doc = loadWallets();
        const updated = upsertWallets(doc.wallets || [], wallets);
        saveWallets({ ...doc, wallets: updated });
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
      .filter(w => typeof w?.address === 'string' && (w.chain === 'robinhood' ? isEvmAddr(w.address) : isSolAddr(w.address)))
      .map(w => ({
        address: w.chain === 'robinhood' ? w.address.toLowerCase() : w.address,
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

    // 1. Sync to Postgres if connected
    if (db) {
      await upsertWalletsDb(db, clean).catch(() => {});
    }

    // 2. Sync to JSON store as durable fallback
    const doc = loadWallets();
    const wallets = upsertWallets(doc.wallets || [], clean);
    saveWallets({ ...doc, wallets });

    res.status(201).json({ count: wallets.length, wallets });
  });

  // Delete / untrack wallet
  router.delete('/:chain/:address', async (req, res) => {
    const { chain, address } = req.params;
    const norm = chain === 'robinhood' ? String(address || '').toLowerCase() : String(address || '');

    if (db) {
      await db.query('DELETE FROM smart_wallets WHERE chain = $1 AND address = $2', [chain, norm]).catch(() => {});
    }

    const doc = loadWallets();
    const remaining = (doc.wallets || []).filter(w => !(w.chain === chain && (w.chain === 'robinhood' ? String(w.address).toLowerCase() : String(w.address)) === norm));
    saveWallets({ ...doc, wallets: remaining });
    res.json({ success: true, count: remaining.length });
  });

  return router;
}
