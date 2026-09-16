// TradeForge sniper backend: REST API + WebSocket event stream.
// Run with: node server.js   (copy .env.example to .env first)
// Loaded with local dev CORS enabled
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './src/config.js';
import { getWalletAddress } from './src/wallet.js';
import { onEvent, log, getLogs } from './src/bus.js';
import { startPumpFeed } from './src/discovery/pumpfun.js';
import { createPool, migrate } from './src/tape/db.js';
import { initSmartWalletsTable } from './src/smartwallets/db.js';
import { initMemeTokensTable } from './src/discovery/db.js';
import { Tape } from './src/tape/tape.js';
import { systemClock } from './src/discovery/clock.js';
import { BaselineController } from './src/discovery/baselineController.js';
import { MonitorBudget } from './src/discovery/monitorBudget.js';
import { IngestionStats } from './src/discovery/ingestionStats.js';
import { StructuralEvidenceCollector } from './src/discovery/structuralEvidence.js';
import { SolanaStructuralRpc, solanaResolvers } from './src/discovery/solanaStructuralRpc.js';
import { startRaydiumFeed } from './src/discovery/raydium.js';
import { getTokens, getToken, setTokenDb } from './src/discovery/registry.js';
import {
  getBots, createBot, updateBot, deleteBot, startBot, stopBot, getWatchlist, PRESETS,
} from './src/engine/botManager.js';
import {
  getPositions, getTrades, openPosition, closePosition, startPolling,
} from './src/engine/positions.js';
import { executeBuy } from './src/trading/executor.js';
import {
  getLimitOrders, createLimitOrder, cancelLimitOrder, startLimitOrderLoop,
} from './src/engine/limitOrders.js';
import { createDisperseRouter } from './src/disperse/routes.js';
import { listAlerts, markAllRead } from './src/alerts.js';
import { createNftRouter } from './src/nft/routes.js';
import { refreshCache as refreshNftDrops } from './src/nft/drops.js';
import { restoreJobs as restoreNftJobs } from './src/nft/mintRunner.js';
import { createListRouter, curatedStats } from './src/analysis/listRoutes.js';
import { createMemeFinderRouter } from './src/memefinder/routes.js';
import { startRefreshLoop } from './src/discovery/refreshLoop.js';
import {
  getTracked, getTrackedByMint, manualTrack, untrack, promoteToTracked,
} from './src/analysis/tracked.js';
import { startEvmFeeds } from './src/discovery/evm.js';
import { startGmgnFeeds } from './src/discovery/gmgn.js';
import { startAttentionPoll } from './src/analysis/attention.js';
import { startMoversFeed } from './src/discovery/movers.js';
import { createWalletRouter } from './src/wallets/routes.js';
import { createSmartWalletsRouter } from './src/smartwallets/routes.js';
import { startSmartWalletFinder } from './src/smartwallets/finder.js';
import { startAllWorkers, stopAllWorkers, getWorkerStatus } from './src/workers/workerManager.js';
import { getTrackedMemes } from './src/workers/memeRegistry.js';
import { getFills, pnlSummary } from './src/engine/accounting.js';
import { resolveWallets } from './src/wallets/repository.js';
import { prepareExternalTrade, reconcileExternalTrade } from './src/trading/externalTrading.js';
import { executionAdapter, marketDataAdapter, portfolioAdapter } from './src/adapters/localAdapters.js';
import { listActivity } from './src/operations/activity.js';
import { getProviderHealth } from './src/operations/providerHealth.js';
import {
  createAuthMiddleware,
  createCorsOptions,
  maskRpcUrl,
  requestHasValidWebSocketToken,
} from './src/security.js';

const app = express();
app.use(cors(createCorsOptions({ corsOrigins: config.corsOrigins })));
app.use(express.json());

// Every API request requires an Authorization Bearer token unless the process
// is explicitly running in local development/test mode. Tokens in URLs are
// intentionally not accepted because URLs are routinely logged and retained.
app.use('/api', createAuthMiddleware({
  apiToken: config.apiToken,
  allowUnauthenticated: config.allowUnauthenticated,
}));
const ingestionClock = systemClock;
const ingestionStats = new IngestionStats();
const monitorBudget = new MonitorBudget({ cfg: config.collection, rng: Math.random });
const baselineController = new BaselineController({
  cfg: config.collection, clock: ingestionClock, onClose: () => {},
});
const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch(err => res.status(err.status || 400).json({ error: err.message }));

const dbPool = createPool();

app.use('/api/disperse', createDisperseRouter());
app.use('/api/wallets', createWalletRouter());
app.use('/api/smart-wallets', createSmartWalletsRouter({ getTokens: () => getTokens({ view: 'all' }), db: dbPool }));

// --- Worker Manager & Meme Registry ---
app.get('/api/workers/status', (req, res) => res.json(getWorkerStatus()));
app.get('/api/memes/registry', (req, res) => {
  const list = getTrackedMemes(req.query).map(m => ({
    ...m,
    contractAddress: m.ca,
    volume24h: m.volume24hUsd,
  }));
  res.json({ memes: list });
});

// --- Alerts ---
app.get('/api/alerts', (req, res) => res.json({ alerts: listAlerts() }));
app.post('/api/alerts/read', (req, res) => res.json({ alerts: markAllRead() }));
app.get('/api/activity', (req, res) => res.json({
  activity: listActivity({ type: req.query.type || undefined, limit: req.query.limit }),
}));
app.get('/api/providers/health', asyncRoute(async (req, res) => res.json(
  await getProviderHealth({ force: req.query.force === 'true' }))));

// --- NFT Mint v2 ---
app.use('/api/nft', createNftRouter());

// --- Custom Lists + Curated Stats ---
app.use('/api/lists', createListRouter());
app.get('/api/tokens/curated-stats', (req, res) => res.json(curatedStats()));

app.use('/api/memefinder', createMemeFinderRouter({
  // The backend is the sole qualification authority (§18.1); the router only shapes
  // what the scorer already decided.
  getTokens: () => getTokens({ view: 'all' }),
}));

// --- Versioned normalized provider seams ---
app.get('/api/v2/market/tokens', asyncRoute(async (req, res) => res.json({ tokens: await marketDataAdapter.searchTokens(req.query) })));
app.get('/api/v2/market/tokens/:chainId/:tokenAddress', asyncRoute(async (req, res) => {
  const token = await marketDataAdapter.getTokenOverview(req.params);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  res.json({ token });
}));
app.get('/api/v2/market/tokens/:chainId/:tokenAddress/chart', asyncRoute(async (req, res) => res.json({ candles: await marketDataAdapter.getChart(req.params, req.query.range) })));
app.get('/api/v2/market/tokens/:chainId/:tokenAddress/pools', asyncRoute(async (req, res) => res.json({ pools: await marketDataAdapter.getPools(req.params) })));
app.get('/api/v2/execution/capabilities/:chainId', (req, res) => res.json({ capabilities: executionAdapter.capabilities(req.params.chainId) }));
app.get('/api/v2/portfolio/:walletAddress', asyncRoute(async (req, res) => res.json({ snapshot: await portfolioAdapter.syncWallet({ address: req.params.walletAddress }) })));

// --- Tracked tier (Phase 2) ---
app.get('/api/tracked', (req, res) => {
  let tracked = getTracked();
  const { chain } = req.query;
  if (chain) tracked = tracked.filter(t => (t.chain || 'solana') === chain);
  res.json({ tracked });
});
app.post('/api/tracked', asyncRoute((req, res) => {
  const { mint, reason } = req.body;
  if (!mint) throw new Error('mint is required');
  const token = getToken(mint);
  if (!token) throw new Error('Token not in registry');
  const entry = promoteToTracked(token, reason || 'manual');
  if (!entry) throw new Error('Already tracked or at capacity');
  res.json({ tracked: entry });
}));
app.post('/api/tracked/pin', asyncRoute((req, res) => {
  const { mint } = req.body;
  if (!mint) throw new Error('mint is required');
  const token = getToken(mint);
  if (!token) throw new Error('Token not in registry');
  const entry = manualTrack(token);
  res.json({ tracked: entry });
}));
app.delete('/api/tracked/:mint', asyncRoute((req, res) => {
  untrack(req.params.mint);
  res.json({ ok: true });
}));

// --- Status ---
app.get('/api/status', (req, res) => {
  let walletAddress = null;
  let walletError = null;
  try { walletAddress = getWalletAddress(); } catch (err) { walletError = err.message; }
  res.json({
    ok: true,
    dryRun: config.dryRun,
    liveTradingEnabled: config.liveTradingEnabled,
    executionMode: config.dryRun ? 'paper' : config.allowServerSigner ? 'server-signer' : 'connected-wallet',
    maxTradeSol: config.maxTradeSol,
    walletAddress,
    walletError,
    rpcUrl: maskRpcUrl(config.rpcUrl),
    presets: PRESETS,
  });
});

// --- Token feed (curated by default; view=all shows the raw firehose) ---
app.get('/api/tokens', (req, res) => {
  const { view, minScore, minLiquidity, source, maxAgeMin, chain } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const isAll = req.query.limit === 'all' || req.query.pageSize === 'all';
  const pageSize = isAll ? 100000 : Math.min(10000, Math.max(1, Number(req.query.pageSize ?? req.query.limit) || 100));
  const all = getTokens({
      view: view === 'discovered' ? 'discovered' : view === 'all' ? 'all' : 'curated',
      minScore: minScore ? Number(minScore) : undefined,
      minLiquidity: minLiquidity ? Number(minLiquidity) : undefined,
      source: source || undefined,
      maxAgeMin: maxAgeMin ? Number(maxAgeMin) : undefined,
      chain: chain || undefined,
    }).filter(token => ['solana', 'robinhood'].includes(token.chain || 'solana'));
  const start = (page - 1) * pageSize;
  res.json({ total: all.length, page, pageSize, tokens: all.slice(start, start + pageSize) });
});

// --- Agent watchlists (tokens being observed before entry) ---
app.get('/api/watchlist', (req, res) => res.json({ watchlist: getWatchlist() }));

// --- Bots ---
app.get('/api/bots', (req, res) => res.json({ bots: getBots() }));
app.post('/api/bots', asyncRoute((req, res) => res.json({ bot: createBot(req.body || {}) })));
app.patch('/api/bots/:id', asyncRoute((req, res) => res.json({ bot: updateBot(req.params.id, req.body || {}) })));
app.delete('/api/bots/:id', asyncRoute((req, res) => { deleteBot(req.params.id); res.json({ ok: true }); }));
app.post('/api/bots/:id/start', asyncRoute((req, res) => res.json({ bot: startBot(req.params.id) })));
app.post('/api/bots/:id/stop', asyncRoute((req, res) => res.json({ bot: stopBot(req.params.id) })));

// --- Positions & trades ---
function portfolioFilters(query) {
  const tagIds = String(query.tagIds || '').split(',').filter(Boolean);
  const resolved = tagIds.length ? resolveWallets({ tagIds }) : null;
  return {
    tagIds,
    walletAddresses: resolved?.addresses,
    walletAddress: query.walletAddress || undefined,
    tokenAddress: query.tokenAddress || undefined,
    chainId: query.chainId || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
  };
}

app.get('/api/positions', (req, res) => {
  const filters = portfolioFilters(req.query);
  const allowed = filters.walletAddresses ? new Set(filters.walletAddresses.map(address => address.toLowerCase())) : null;
  const positions = getPositions().filter(position => {
    if (allowed && !allowed.has(String(position.walletAddress || '').toLowerCase())) return false;
    if (filters.walletAddress && String(position.walletAddress || '').toLowerCase() !== filters.walletAddress.toLowerCase()) return false;
    if (filters.tokenAddress && position.mint.toLowerCase() !== filters.tokenAddress.toLowerCase()) return false;
    return true;
  });
  res.json({ positions });
});
app.get('/api/trades', (req, res) => {
  const filters = portfolioFilters(req.query);
  const allowed = filters.walletAddresses ? new Set(filters.walletAddresses.map(address => address.toLowerCase())) : null;
  const trades = getTrades().filter(trade => !allowed || allowed.has(String(trade.walletAddress || '').toLowerCase()));
  res.json({ trades });
});
app.get('/api/fills', (req, res) => res.json({ fills: getFills(portfolioFilters(req.query)) }));
app.get('/api/pnl', (req, res) => {
  const filters = portfolioFilters(req.query);
  const summary = pnlSummary(filters);
  const openPositions = getPositions().filter(position => position.status === 'open')
    .filter(position => !filters.walletAddresses
      || filters.walletAddresses.some(address => address.toLowerCase() === String(position.walletAddress || '').toLowerCase()));
  const unrealizedPnlSol = openPositions.reduce((sum, position) => sum + Number(position.pnlSol || 0), 0);
  const byTag = filters.tagIds.map(tagId => {
    const addresses = resolveWallets({ tagIds: [tagId] }).addresses;
    return { tagId, ...pnlSummary({ ...filters, tagIds: undefined, walletAddresses: addresses }) };
  });
  const days = [...summary.byDay].sort((a, b) => a.key.localeCompare(b.key));
  let cumulative = 0;
  const equityCurve = days.map(day => ({ date: day.key, realizedPnlSol: day.realizedPnlSol, totalPnlSol: (cumulative += day.realizedPnlSol) }));
  res.json({ summary: { ...summary, unrealizedPnlSol, totalPnlSol: summary.realizedPnlSol + unrealizedPnlSol, byTag, equityCurve } });
});

// --- Manual trading ---
app.post('/api/trade/buy', asyncRoute(async (req, res) => {
  if (!config.dryRun && !config.allowServerSigner) throw new Error('Use connected-wallet preparation for live trading');
  const { mint, solAmount, slippagePct, takeProfitPct, stopLossPct, trailingStopPct, maxHoldMin, idempotencyKey } = req.body;
  if (!mint || !solAmount) throw new Error('mint and solAmount are required');
  const numSol = Number(solAmount);
  if (!isFinite(numSol) || numSol <= 0) throw new Error('solAmount must be a positive number');
  const token = getToken(mint);
  if (!token) throw new Error('Token not in registry — it may have expired from the feed');

  const buyResult = await executeBuy(token, {
    solAmount: numSol,
    slippagePct: Number(slippagePct) || 10,
    idempotencyKey: idempotencyKey || `manual:buy:${mint}:${numSol}`,
  });
  buyResult.solSpent = numSol;
  if (req.body.walletAddress) buyResult.walletAddress = req.body.walletAddress;
  const position = await openPosition(token, buyResult, {
    takeProfitPct: takeProfitPct ? Number(takeProfitPct) : null,
    stopLossPct: stopLossPct ? Number(stopLossPct) : null,
    trailingStopPct: trailingStopPct ? Number(trailingStopPct) : null,
    maxHoldMin: maxHoldMin ? Number(maxHoldMin) : null,
    slippagePct: Number(slippagePct) || 10,
  });
  res.json({ position });
}));

app.post('/api/trade/sell', asyncRoute(async (req, res) => {
  if (!config.dryRun && !config.allowServerSigner) throw new Error('Use connected-wallet preparation for live trading');
  const { positionId, fraction, idempotencyKey } = req.body;
  if (!positionId) throw new Error('positionId is required');
  const numFrac = Number(fraction) || 1;
  if (!isFinite(numFrac) || numFrac <= 0 || numFrac > 1) throw new Error('fraction must be between 0 and 1');
  const position = await closePosition(positionId, numFrac, 'manual', null, {
    idempotencyKey: idempotencyKey || `manual:sell:${positionId}:${numFrac}`,
  });
  res.json({ position });
}));

app.post('/api/trade/external/prepare', asyncRoute(async (req, res) => {
  res.json(await prepareExternalTrade(req.body || {}));
}));
app.post('/api/trade/external/reconcile', asyncRoute(async (req, res) => {
  res.json(await reconcileExternalTrade(req.body?.intentId, req.body?.signature));
}));

// --- Limit orders (trigger orders watched by the backend, market-filled) ---
app.get('/api/limit-orders', (req, res) => {
  const filters = portfolioFilters(req.query);
  const allowed = filters.walletAddresses ? new Set(filters.walletAddresses.map(address => address.toLowerCase())) : null;
  const positionWallets = new Map(getPositions().map(position => [position.id, position.walletAddress]));
  const orders = getLimitOrders().filter(order => {
    if (!allowed) return true;
    const address = order.walletAddress || positionWallets.get(order.positionId);
    return allowed.has(String(address || '').toLowerCase());
  });
  res.json({ orders });
});
app.post('/api/limit-orders', asyncRoute(async (req, res) =>
  res.json({ order: await createLimitOrder(req.body || {}) })));
app.delete('/api/limit-orders/:id', asyncRoute((req, res) =>
  res.json({ order: cancelLimitOrder(req.params.id) })));

// --- Logs ---
app.get('/api/logs', (req, res) => res.json({ logs: getLogs() }));
app.get('/api/ingestion/stats', (req, res) => res.json(ingestionStats.snapshot()));

// --- HTTP + WebSocket ---
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  // The browser sends the bearer token as a subprotocol because it cannot set
  // Authorization during the WebSocket upgrade. Echoing the selected protocol
  // keeps the browser handshake valid without putting the token in a URL.
  handleProtocols(protocols) {
    return [...protocols].find(protocol => protocol.startsWith('bearer.')) || false;
  },
});

wss.on('connection', (socket, req) => {
  if (!config.allowUnauthenticated && !requestHasValidWebSocketToken(req, config.apiToken)) {
    socket.close(4401, 'Unauthorized');
    return;
  }
  socket.send(JSON.stringify({ type: 'hello', dryRun: config.dryRun }));
});

onEvent((event) => {
  const frame = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(frame);
  }
});

server.listen(config.port, config.host, async () => {
  log('info', `Sniper backend listening on http://${config.host}:${config.port}`);
  log('info', config.dryRun
    ? 'DRY_RUN enabled — all trades are simulated (paper trading)'
    : 'LIVE TRADING enabled — trades will spend real SOL');
  let tape = null;
  try {
    await migrate(dbPool);
    await initSmartWalletsTable(dbPool);
    await initMemeTokensTable(dbPool);
    setTokenDb(dbPool);
    tape = new Tape(dbPool);
    log('info', '[tape] Postgres event tape, smart wallet store & meme tokens ready');
  } catch (error) {
    log('warn', `[tape] Postgres event tape unavailable (${error.message}); using fallback tape`);
    tape = { append: async () => true };
  }
  try {
    const structuralRpc = new SolanaStructuralRpc({ rpcUrl: config.rpcUrl, clock: ingestionClock, maxRequestsPerMinute: config.structuralEvidence.maxRequestsPerMinute });
    const structuralEvidence = new StructuralEvidenceCollector({
      tape, rpc: structuralRpc, resolvers: solanaResolvers,
      fundingSourceFor: structuralRpc.fundingSourceFor.bind(structuralRpc),
      walletAge: structuralRpc.walletAge.bind(structuralRpc),
      richProfile: async () => null, cfg: config.structuralEvidence, clock: ingestionClock,
      concurrency: config.structuralEvidence.concurrency,
    });
    startPumpFeed(tape, {
      baseline: baselineController, budget: monitorBudget, stats: ingestionStats, structuralEvidence, clock: ingestionClock,
    });
  } catch (error) {
    log('error', `[tape] PumpPortal start failed: ${error.message}`);
  }
  startRaydiumFeed();
  startEvmFeeds(); // Robinhood discovery (EVM terminal is Robinhood-only)
  startGmgnFeeds(); // GMGN trending + trenches for solana + robinhood (official CLI path)
  startPolling();
  startLimitOrderLoop();
  restoreNftJobs();
  refreshNftDrops().catch(() => {});
  setInterval(() => refreshNftDrops().catch(() => {}), 5 * 60 * 1000);
  startRefreshLoop();
  startAttentionPoll(); // Phase 4: DexScreener boosts + socials attention signals
  startMoversFeed(); // Movers & Revivals: catch aged tokens waking up (e.g. Udin)
  startSmartWalletFinder({ db: dbPool }); // Phase 5: Automatic smart wallet discovery for Solana + Robinhood
  startAllWorkers({ autoRun: true }); // Task 7: Start distributed 5-worker pipeline
});

