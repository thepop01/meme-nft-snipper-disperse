// Standalone runner for Smart Wallet Finder (Solana + Robinhood)
// Run with: node backend/scripts/find-smart-wallets.js [--chain=solana|robinhood|all]
import 'dotenv/config';
import { scanChainSmartWallets } from '../src/smartwallets/finder.js';
import { loadWallets, saveWallets, upsertWallets } from '../src/smartwallets/tracker.js';

const args = process.argv.slice(2);
const chainArg = args.find(a => a.startsWith('--chain='))?.split('=')[1] || 'all';
const daysArg = Number(args.find(a => a.startsWith('--days='))?.split('=')[1] || 120);

async function main() {
  console.log(`[smart-wallets] Starting ${daysArg}-day (4-month) Smart Wallet Finder (scope: ${chainArg})...`);

  const chains = chainArg === 'all' ? ['solana', 'robinhood'] : [chainArg];
  const allFound = [];

  for (const c of chains) {
    console.log(`[smart-wallets] Scanning ${c.toUpperCase()} meme traders across past ${daysArg} days...`);
    const found = await scanChainSmartWallets(c, 25, { lookbackDays: daysArg });
    console.log(`[smart-wallets] Discovered & analyzed ${found.length} wallets on ${c}.`);
    for (const w of found) {
      console.log(`  -> ${w.address} | 30d PnL: +$${w.realizedProfitUsd.toFixed(2)} | WinRate: ${w.winRatePct}% | Profitable: ${w.profitableTrades}/${w.totalTrades} | <$1M: ${w.buysUnder1M} (${w.buysUnder1MProfitable} won) | <$2M: ${w.buysUnder2M} | <$5M: ${w.buysUnder5M} | <$10M: ${w.buysUnder10M}`);
    }
    allFound.push(...found);
  }

  if (allFound.length > 0) {
    const doc = loadWallets();
    const updated = upsertWallets(doc.wallets || [], allFound);
    saveWallets({ ...doc, wallets: updated });
    console.log(`[smart-wallets] Successfully saved ${updated.length} total smart wallets to store.`);
  } else {
    console.log('[smart-wallets] No new wallets found.');
  }
}

main().catch(err => {
  console.error('[smart-wallets] Fatal error:', err);
  process.exit(1);
});
