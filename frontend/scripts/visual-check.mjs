import { chromium } from 'playwright';

const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.APP_URL || 'http://localhost:5173';

const now = Date.now();
const tokens = [
  {
    key: 'solana:rG2Q4Re1fSNLbbnqN63N2whNSTJ9yQaa3zsUKg6pump',
    mint: 'rG2Q4Re1fSNLbbnqN63N2whNSTJ9yQaa3zsUKg6pump', chain: 'solana',
    name: 'horse on horse', symbol: 'HOH', state: 'curated', source: 'pumpfun',
    createdAt: now - 80 * 60_000, enrichedAt: now - 20_000, passes: 4,
    priceUsd: 0.000032, liquidityUsd: 31_500, marketCapUsd: 25_400,
    volume5mUsd: 8_600, volume24hUsd: 128_000,
    txns: { m5: { buys: 127, sells: 97 } }, top10HolderPct: 27,
    safety: { score: 58, checks: [
      { id: 'liquidity', status: 'pass', detail: 'Liquidity route is active' },
      { id: 'holders', status: 'pass', detail: 'Top 10 hold 27%' },
      { id: 'developer', status: 'warn', detail: 'Developer history needs review' },
    ] },
    traction: { tractionScore: 62, buySellRatio: 1.31, signals: [] },
    history: Array.from({ length: 20 }, (_, index) => ({ ts: now - (20 - index) * 60_000, priceUsd: 0.000024 + index * 0.00000045 + Math.sin(index) * 0.0000012 })),
    attentionBoost: 'profiled', smartWallets: 0, whales: 0, snipers: 0, freshWallets: 57, bundlerPct: 35.3,
  },
  {
    key: 'solana:TrendToken111111111111111111111111111111pump', mint: 'TrendToken111111111111111111111111111111pump',
    chain: 'solana', name: 'Purple Runner', symbol: 'RUNR', state: 'curated', source: 'raydium',
    createdAt: now - 35 * 60_000, enrichedAt: now - 10_000, passes: 3, priceUsd: 0.00041,
    liquidityUsd: 88_000, marketCapUsd: 340_000, volume5mUsd: 22_000, volume24hUsd: 510_000,
    txns: { m5: { buys: 210, sells: 112 } }, top10HolderPct: 21,
    safety: { score: 79, checks: [{ id: 'holders', status: 'pass', detail: 'Holder distribution is within strategy limits' }] },
    traction: { tractionScore: 76, buySellRatio: 1.87, signals: [] }, attentionBoost: 'boosted',
  },
  {
    key: 'solana:MicroToken111111111111111111111111111111pump', mint: 'MicroToken111111111111111111111111111111pump',
    chain: 'solana', name: 'Tiny Signal', symbol: 'TINY', state: 'watching', source: 'pumpfun', onCurve: true,
    createdAt: now - 12 * 60_000, enrichedAt: now - 7_000, passes: 1, priceUsd: 0.000008,
    liquidityUsd: 12_500, marketCapUsd: 42_000, volume5mUsd: 6_800, volume24hUsd: 47_000,
    txns: { m5: { buys: 64, sells: 31 } }, top10HolderPct: 39,
    safety: { score: 52, checks: [{ id: 'age', status: 'warn', detail: 'Only one observation pass completed' }] },
    traction: { tractionScore: 49, buySellRatio: 2.06, signals: [] },
  },
];

const positions = [{
  id: 'position-1', mint: tokens[0].mint, symbol: 'HOH', name: 'horse on horse', status: 'open',
  entryPriceUsd: 0.000026, currentPriceUsd: 0.000032, tokenAmount: 9500, solSpent: 0.3,
  pnlSol: 0.0692, pnlPct: 23.1, openedAt: now - 42 * 60_000, dryRun: true,
  exitRules: { takeProfitPct: 100, stopLossPct: 30, slippagePct: 10 },
}];
const orders = [{
  id: 'order-1', side: 'buy', mint: tokens[1].mint, symbol: 'RUNR', status: 'open', direction: 'below',
  triggerPriceUsd: 0.00035, lastPriceUsd: 0.00041, solAmount: 0.2, createdAt: now - 15 * 60_000,
}];
const trades = [
  { side: 'buy', mint: tokens[0].mint, symbol: 'HOH', solAmount: 0.3, timestamp: now - 42 * 60_000, dryRun: true },
  { side: 'sell', mint: tokens[2].mint, symbol: 'TINY', solAmount: 0.14, pnlSol: 0.021, timestamp: now - 2 * 60 * 60_000, reason: 'take-profit', dryRun: true },
];

const walletDirectory = {
  version: 1,
  tags: [
    { id: 'alpha', name: 'Alpha', normalizedName: 'alpha', color: '#7c5cfc', description: '' },
    { id: 'team', name: 'Team', normalizedName: 'team', color: '#14b8a6', description: '' },
    { id: 'wave', name: 'Mint Wave 1', normalizedName: 'mint wave 1', color: '#f59e0b', description: '' },
  ],
  wallets: Array.from({ length: 9 }, (_, index) => ({
    id: `wallet-${index}`, name: ['Treasury', 'Research 01', 'Research 02', 'Minter A', 'Minter B', 'Airdrop 01', 'Airdrop 02', 'Team Ops', 'Reserve'][index],
    address: `0x${String(index + 1).padStart(40, String((index + 2) % 10))}`,
    tagIds: index < 3 ? ['alpha'] : index < 6 ? ['wave'] : index === 7 ? ['team', 'alpha'] : ['team'], status: 'active',
  })),
};

async function mockApi(page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body = {};
    if (path === '/api/status') body = { ok: true, dryRun: true, walletAddress: 'PaperWallet1111111111111111111111111111111' };
    else if (path === '/api/tokens') body = { tokens };
    else if (path === '/api/positions') body = { positions };
    else if (path === '/api/trades') body = { trades };
    else if (path === '/api/limit-orders') body = { orders };
    else if (path === '/api/watchlist') body = { watchlist: [] };
    else if (path === '/api/alerts') body = { alerts: [] };
    else if (path === '/api/lists') body = { lists: [{ id: 'my-list', name: 'Morning Scan', color: 'blue', enabled: true, rules: {}, matched: [{ mint: tokens[0].mint }] }], ruleFields: [] };
    else body = { ok: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function capture(browser, name, activeTab, viewport, { scrollBottom = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(({ activeTab, walletDirectory }) => {
    localStorage.setItem('activeTab', activeTab);
    localStorage.setItem('walletDirectory', JSON.stringify(walletDirectory));
    localStorage.setItem('memeActiveFeed', 'strategy:all-discovered');
  }, { activeTab, walletDirectory });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mockApi(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (scrollBottom) {
    await page.evaluate(() => {
      const main = document.querySelector('.main-content');
      if (main) main.scrollTop = main.scrollHeight;
    });
    await page.waitForTimeout(250);
  }
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth > document.body.clientWidth,
    main: document.querySelector('.main-content')?.scrollWidth > document.querySelector('.main-content')?.clientWidth,
  }));
  await page.screenshot({ path: `C:\\tmp\\${name}.png`, fullPage: true });
  await context.close();
  return { name, errors, overflow };
}

const browser = await chromium.launch({ headless: true, executablePath });
const results = [];
results.push(await capture(browser, 'wallet-desktop', 'wallets', { width: 1440, height: 900 }));
results.push(await capture(browser, 'wallet-mobile', 'wallets', { width: 390, height: 844 }));
results.push(await capture(browser, 'meme-desktop', 'memefinder', { width: 1600, height: 1000 }));
results.push(await capture(browser, 'meme-portfolio-desktop', 'memefinder', { width: 1600, height: 1000 }, { scrollBottom: true }));
results.push(await capture(browser, 'meme-mobile', 'memefinder', { width: 390, height: 844 }));
await browser.close();

for (const result of results) console.log(JSON.stringify(result));
if (results.some(result => result.errors.length || result.overflow.body)) process.exitCode = 1;
