import { backfillWalletMetrics } from '../src/smartwallets/backfill.js';

async function main() {
  console.log('Starting execution metrics backfill for smart-wallets...');
  const result = await backfillWalletMetrics({ maxLiveQueries: 5 });
  console.log('Backfill completed successfully:', result);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
