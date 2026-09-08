import { expect, test } from 'playwright/test';

const address = `0x${'1'.repeat(40)}`;
const directory = {
  wallets: [{ id: 'wallet-1', name: 'Ops One', address, chainIds: ['base'], signerType: 'watch-only', status: 'active', tagIds: ['tag-team'] }],
  tags: [{ id: 'tag-team', name: 'Team', normalizedName: 'team', color: '#7c5cff' }],
};

const token = {
  key: 'solana:Mint111', mint: 'Mint111', chain: 'solana', symbol: 'TEST', name: 'Test Meme',
  source: 'pumpfun', priceUsd: 0.001, liquidityUsd: 25_000, marketCapUsd: 100_000,
  volume5mUsd: 12_000, volume24hUsd: 90_000, createdAt: Date.now() - 60_000,
  enrichedAt: Date.now(), analyzedAt: Date.now(), txns: { m5: { buys: 20, sells: 10 } },
  priceChange: { h1: 12 }, safety: { score: 75, checks: [] }, traction: { tractionScore: 60 },
};

async function fulfill(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  return true;
}

async function mockSharedBackend(page, handler) {
  await page.route('http://localhost:4517/**', async route => {
    const url = new URL(route.request().url());
    if (handler && await handler(route, url)) return;
    if (url.pathname === '/api/status') return fulfill(route, { ok: true, dryRun: true, executionMode: 'paper', liveTradingEnabled: false });
    if (url.pathname === '/api/wallets/directory' && route.request().method() === 'GET') return fulfill(route, { directory });
    if (url.pathname === '/api/wallets/directory' && route.request().method() === 'PUT') return fulfill(route, { directory });
    if (url.pathname === '/api/wallets/resolve') return fulfill(route, { wallets: [{ ...directory.wallets[0], sourceTagIds: ['tag-team'] }], addresses: [address] });
    return fulfill(route, {});
  });
}

test('one reusable wallet tag resolves in Disperse and Mint Bot', async ({ page }) => {
  await mockSharedBackend(page, async (route, url) => {
    if (url.pathname === '/api/disperse/config') return fulfill(route, {
      dryRun: true,
      chains: [{ id: 'base', name: 'Base', family: 'evm', symbol: 'ETH', chainId: 8453, explorer: 'https://basescan.org', tokens: ['USDC'] }],
    });
    if (url.pathname === '/api/disperse/jobs') return fulfill(route, { jobs: [] });
    if (url.pathname === '/api/nft/drops') return fulfill(route, { chains: ['base'], drops: [{
      chain: 'base', slug: 'test-drop', name: 'Test Drop', status: 'live', contract: address,
      mintPageUrl: 'https://example.test', stages: [{ label: 'Public', priceWei: '0' }],
    }] });
    if (url.pathname === '/api/nft/jobs') return fulfill(route, { jobs: [] });
    if (url.pathname === '/api/nft/gas') return fulfill(route, { baseFeeGwei: 1, priorityFeeGwei: 1 });
    return false;
  });

  await page.goto('/disperse');
  await page.getByRole('button', { name: /Team/ }).click();
  await expect(page.getByText('1 unique')).toBeVisible();
  await expect(page.getByText(/0x111111…111111/)).toBeVisible();

  await page.getByRole('link', { name: 'Mint Bot' }).click();
  await page.getByText('Test Drop').click();
  await page.getByRole('button', { name: /Team/ }).click();
  await expect(page.getByText('Mint wallet preview')).toBeVisible();
  await expect(page.getByText('1 unique')).toBeVisible();
});

test('paper buy, sell, portfolio PnL, and limit cancellation stay connected', async ({ page }) => {
  let bought = false;
  let buyRequests = 0;
  let sellRequests = 0;
  let cancelled = false;
  const position = {
    id: 'position-1', mint: token.mint, symbol: token.symbol, status: 'open', openedAt: Date.now(),
    entryPriceUsd: 0.001, currentPriceUsd: 0.0012, tokenAmount: 1000, solSpent: 0.1,
    pnlSol: 0.02, pnlPct: 20, walletAddress: 'paper',
  };
  const order = {
    id: 'order-1', side: 'buy', mint: token.mint, symbol: token.symbol, status: 'open',
    triggerPriceUsd: 0.0008, solAmount: 0.1, originalAmount: 0.1, remainingAmount: 0.1,
    direction: 'below', type: 'server-trigger', createdAt: Date.now(),
  };
  await mockSharedBackend(page, async (route, url) => {
    const method = route.request().method();
    if (url.pathname === '/api/lists') return fulfill(route, { lists: [], ruleFields: [] });
    if (url.pathname === '/api/tokens') return fulfill(route, { tokens: [token] });
    if (url.pathname === '/api/positions') return fulfill(route, { positions: bought ? [position] : [] });
    if (url.pathname === '/api/trades') return fulfill(route, { trades: [] });
    if (url.pathname === '/api/fills') return fulfill(route, { fills: bought ? [{ id: 'fill-1', side: 'buy', mint: token.mint, quoteQuantitySol: 0.1, filledAt: Date.now() }] : [] });
    if (url.pathname === '/api/pnl') return fulfill(route, { summary: { realizedPnlSol: 0.01, unrealizedPnlSol: bought ? 0.02 : 0, totalPnlSol: bought ? 0.03 : 0.01, feesSol: 0.001, winRate: 1, averageWinSol: 0.01, averageLossSol: 0, equityCurve: [] } });
    if (url.pathname === '/api/limit-orders' && method === 'GET') return fulfill(route, { orders: cancelled ? [] : [order] });
    if (url.pathname === '/api/trade/buy' && method === 'POST') { bought = true; buyRequests++; return fulfill(route, { position }); }
    if (url.pathname === '/api/trade/sell' && method === 'POST') { sellRequests++; return fulfill(route, { position: { ...position, status: 'closed' } }); }
    if (url.pathname === '/api/limit-orders/order-1' && method === 'DELETE') { cancelled = true; return fulfill(route, { order: { ...order, status: 'cancelled' } }); }
    return false;
  });

  await page.goto('/memefinder');
  await expect(page.getByText('Test Meme').first()).toBeVisible();
  await page.getByRole('button', { name: /Quick Buy 0.1 SOL/ }).click();
  await expect.poll(() => buyRequests).toBe(1);
  await page.locator('button[title="Prepare Quick Sell"]').click();
  await page.getByRole('button', { name: /Quick Sell 100%/ }).click();
  await expect.poll(() => sellRequests).toBe(1);
  await page.getByRole('button', { name: /Orders/ }).click();
  await page.getByRole('button', { name: /Cancel/ }).click();
  await expect.poll(() => cancelled).toBe(true);
  await page.getByRole('button', { name: /PnL Analytics/ }).click();
  await expect(page.getByText('FIFO realized fills plus open-position mark-to-market')).toBeVisible();
});
