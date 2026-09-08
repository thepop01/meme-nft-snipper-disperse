import { expect, test } from 'playwright/test';

async function json(route, body) {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
}

test('Activity remains keyboard-usable without horizontal page overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('http://localhost:4517/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/wallets/directory') return json(route, { directory: { wallets: [], tags: [] } });
    if (path === '/api/status') return json(route, { ok: true, dryRun: true });
    if (path === '/api/activity') return json(route, { activity: [{ id: 'event-1', type: 'system', subsystem: 'backend', title: 'Backend ready', detail: 'Paper mode', severity: 'info', ts: Date.now() }] });
    if (path === '/api/providers/health') return json(route, { ok: true, providers: [{ id: 'rpc', name: 'Solana RPC', status: 'healthy', latencyMs: 25, checkedAt: Date.now() }] });
    return json(route, {});
  });

  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh health' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
