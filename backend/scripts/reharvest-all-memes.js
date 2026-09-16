import '../src/config.js';
import { getTrackedMemes, SYSTEM_MINTS } from '../src/workers/memeRegistry.js';
import { processMemeToken } from '../src/workers/worker3EarlyBuyers.js';
import { loadWallets } from '../src/smartwallets/tracker.js';

async function run() {
  console.log('=== STARTING RE-HARVEST FOR ALL RUNNER MEME TOKENS ===\n');

  const { wallets: initialWallets = [] } = loadWallets();
  const initialMintCounts = new Map();
  for (const w of initialWallets) {
    if (w.earlyBuyerInfo?.mint) {
      initialMintCounts.set(w.earlyBuyerInfo.mint, (initialMintCounts.get(w.earlyBuyerInfo.mint) || 0) + 1);
    }
  }

  const allMemes = getTrackedMemes();
  const targets = allMemes.filter(m =>
    m.chain === 'solana' &&
    !m.ca.startsWith('0x') &&
    !SYSTEM_MINTS.has(m.ca) &&
    m.athMcap >= 2_000_000 &&
    m.athTimestamp > 0
  ).sort((a, b) => (b.athMcap || 0) - (a.athMcap || 0));

  console.log(`Found ${targets.length} Solana runner tokens with ATH >= $2M and valid ATH timestamps.\n`);

  const results = [];
  let processed = 0;

  for (const meme of targets) {
    processed++;
    const prevCount = initialMintCounts.get(meme.ca) || 0;
    console.log(`[${processed}/${targets.length}] Processing ${meme.symbol || '?'} (${meme.ca.slice(0, 8)}...) | ATH: $${(meme.athMcap / 1e6).toFixed(2)}M | Previous wallets: ${prevCount}`);

    try {
      const res = await processMemeToken(meme);
      const newCount = res?.buyersCount || 0;
      results.push({
        symbol: meme.symbol || '?',
        ca: meme.ca,
        athMcap: meme.athMcap,
        prevWallets: prevCount,
        harvestedWallets: newCount,
        gain: newCount - prevCount,
      });
    } catch (err) {
      console.error(`Failed ${meme.symbol}:`, err.message);
    }
  }

  console.log('\n=== RE-HARVEST COMPLETE ===\n');

  const { wallets: finalWallets = [] } = loadWallets();
  const finalEarlyBuyers = finalWallets.filter(w => w.source === 'worker3-early-buyer');

  console.log(`Total smart wallets: ${finalWallets.length}`);
  console.log(`Total worker3 early buyer wallets: ${finalEarlyBuyers.length}`);

  // Summary table of tokens that gained wallets
  const gained = results.filter(r => r.harvestedWallets > r.prevWallets);
  console.log(`\nTokens with increased wallet counts (${gained.length}):`);
  console.table(
    gained.map(r => ({
      Symbol: r.symbol,
      ATH: '$' + (r.athMcap / 1e6).toFixed(2) + 'M',
      'Before': r.prevWallets,
      'After': r.harvestedWallets,
      'Increase': '+' + (r.harvestedWallets - r.prevWallets),
    }))
  );
}

run().catch(console.error);
