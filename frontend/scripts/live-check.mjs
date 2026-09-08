import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => {
  localStorage.setItem('activeTab', 'memefinder');
  localStorage.setItem('memeActiveFeed', 'strategy:all-discovered');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const result = {
  heading: await page.locator('h2').first().textContent(),
  matches: await page.locator('.strategy-match-count').textContent(),
  rows: await page.locator('.scanner-table tbody tr').count(),
  empty: await page.locator('.scanner-empty').count(),
  offline: await page.locator('.conn-banner.offline').count(),
  errors,
};
await page.screenshot({ path: 'C:\\tmp\\meme-live.png' });
console.log(JSON.stringify(result));
await browser.close();
