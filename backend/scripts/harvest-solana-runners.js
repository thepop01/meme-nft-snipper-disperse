import '../src/config.js';
import { runHistoricalSolanaHarvest } from '../src/workers/historicalDiscovery.js';
import { getTrackedMemes } from '../src/workers/memeRegistry.js';

async function main() {
  console.log('=== STARTING 6-MONTH HISTORICAL SOLANA MEME HARVEST ===\n');

  const beforeMemes = getTrackedMemes();
  const beforeSolana = beforeMemes.filter(m => m.chain === 'solana');
  const beforeRobinhood = beforeMemes.filter(m => m.chain === 'robinhood' || m.ca.startsWith('0x'));

  console.log(`Initial registry state:`);
  console.log(`- Total memes: ${beforeMemes.length}`);
  console.log(`- Solana memes: ${beforeSolana.length}`);
  console.log(`- Robinhood / EVM memes: ${beforeRobinhood.length}\n`);

  const results = await runHistoricalSolanaHarvest({
    maxAgeMonths: 6,
    maxOffset: 600,
  });

  console.log('\n=== HARVEST COMPLETE ===');
  console.log(`Total candidates processed: ${results.totalIngested}`);
  console.log(`New memes added: ${results.newMemes}`);
  console.log(`Existing memes updated: ${results.updatedMemes}`);
  console.log(`Pump.fun discovered: ${results.pumpDiscovered}`);
  console.log(`GeckoTerminal discovered: ${results.geckoDiscovered}`);

  const afterMemes = getTrackedMemes();
  const afterSolana = afterMemes.filter(m => m.chain === 'solana');
  const afterBackfilled = afterSolana.filter(m => m.backfilled);
  const afterPending = afterSolana.filter(m => !m.backfilled);

  console.log(`\nUpdated Solana Registry Status:`);
  console.log(`- Total Solana memes: ${afterSolana.length} (was ${beforeSolana.length}, +${afterSolana.length - beforeSolana.length})`);
  console.log(`- Backfilled: ${afterBackfilled.length}`);
  console.log(`- Pending Worker 3 backfill: ${afterPending.length}`);

  // Top 10 Solana runner memes by ATH
  const topAth = [...afterSolana]
    .sort((a, b) => (b.athMcap || 0) - (a.athMcap || 0))
    .slice(0, 10);

  console.log('\nTop 10 Solana Runner Memes by ATH Mcap:');
  console.table(
    topAth.map(m => ({
      Symbol: m.symbol || '?',
      Contract: m.ca.slice(0, 8) + '...' + m.ca.slice(-4),
      'Current Mcap': m.currentMcap ? '$' + (m.currentMcap / 1e6).toFixed(2) + 'M' : '—',
      'ATH Mcap': m.athMcap ? '$' + (m.athMcap / 1e6).toFixed(2) + 'M' : '—',
      Sources: (m.sourceFlags || []).join(', '),
      Status: m.backfilled ? 'Backfilled' : 'Pending',
    }))
  );
}

main().catch(err => {
  console.error('Harvest script failed:', err);
  process.exit(1);
});
