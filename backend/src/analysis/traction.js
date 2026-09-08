// Traction scoring: is anyone actually buying this thing?
// Works on the token's history array (appended at each analysis pass by the
// registry) plus the short-window DexScreener activity captured in enrich.js.
// Returns { tractionScore: 0-100, signals: [...] } — the signals explain the
// score so every automated decision stays auditable.
//
// Phase 2 additions:
// - Breadth signal: avg trade size (volume/txns; small = organic crowd)
// - Slow-climber badge: higher-low streak + positive slope over 6h
import { isPresent } from './missingData.js';

const WEIGHTS = {
  liquidityGrowth: 20,
  buyPressure: 20,
  volumeAcceleration: 12,
  marketCapGrowth: 12,
  breadth: 10,         // organic crowd detection
  climberBonus: 8,     // slow-climber pattern
  attention: 18,       // NEW: boosted/profiled/socials attention signals
};

// Volume and the denominator must describe the exact same observation window.
export function breadthFromWindow(windowVolume, windowTrades) {
  if (!isPresent(windowVolume) || !isPresent(windowTrades) || windowTrades <= 0) return null;
  return windowVolume / windowTrades;
}

export function computeTraction(token) {
  const signals = [];
  let score = 0;

  const history = token.history || [];
  const first = history.find(h => h.liquidityUsd != null || h.marketCapUsd != null);
  const latest = history.length > 0 ? history[history.length - 1] : null;

  // --- Liquidity growth between first and latest observation ---
  let liquidityGrowthPct = null;
  if (first && latest && first !== latest && first.liquidityUsd > 0 && latest.liquidityUsd != null) {
    liquidityGrowthPct = ((latest.liquidityUsd - first.liquidityUsd) / first.liquidityUsd) * 100;
    if (liquidityGrowthPct >= 30) {
      score += WEIGHTS.liquidityGrowth;
      signals.push({ id: 'liquidityGrowth', status: 'pass', detail: `Liquidity +${liquidityGrowthPct.toFixed(0)}% since discovery` });
    } else if (liquidityGrowthPct >= 0) {
      score += Math.floor(WEIGHTS.liquidityGrowth / 2);
      signals.push({ id: 'liquidityGrowth', status: 'warn', detail: `Liquidity stable (${liquidityGrowthPct >= 0 ? '+' : ''}${liquidityGrowthPct.toFixed(0)}%)` });
    } else {
      signals.push({ id: 'liquidityGrowth', status: 'fail', detail: `Liquidity shrinking (${liquidityGrowthPct.toFixed(0)}%)` });
    }
  } else {
    signals.push({ id: 'liquidityGrowth', status: 'warn', detail: 'Not enough observations yet' });
  }

  // --- Buy pressure: 5-minute buys vs sells ---
  const m5 = token.txns?.m5;
  let buySellRatio = null;
  if (m5 && (m5.buys || 0) + (m5.sells || 0) >= 5) {
    buySellRatio = m5.sells > 0 ? m5.buys / m5.sells : m5.buys;
    if (buySellRatio >= 1.5) {
      score += WEIGHTS.buyPressure;
      signals.push({ id: 'buyPressure', status: 'pass', detail: `${m5.buys} buys / ${m5.sells} sells (5m)` });
    } else if (buySellRatio >= 1.0) {
      score += Math.floor(WEIGHTS.buyPressure / 2);
      signals.push({ id: 'buyPressure', status: 'warn', detail: `Balanced flow: ${m5.buys} buys / ${m5.sells} sells (5m)` });
    } else {
      signals.push({ id: 'buyPressure', status: 'fail', detail: `Sell-heavy: ${m5.buys} buys / ${m5.sells} sells (5m)` });
    }
  } else {
    signals.push({ id: 'buyPressure', status: 'warn', detail: 'Too few trades to judge (5m)' });
  }

  // --- Volume acceleration: is the last 5m outpacing the hourly average? ---
  if (token.volume5mUsd != null && token.volume1hUsd > 0) {
    const hourlySlice = token.volume1hUsd / 12; // average 5m share of the hour
    if (token.volume5mUsd >= hourlySlice * 1.5) {
      score += WEIGHTS.volumeAcceleration;
      signals.push({ id: 'volumeAccel', status: 'pass', detail: `5m volume ${(token.volume5mUsd / hourlySlice).toFixed(1)}x hourly pace` });
    } else if (token.volume5mUsd >= hourlySlice * 0.7) {
      score += Math.floor(WEIGHTS.volumeAcceleration / 2);
      signals.push({ id: 'volumeAccel', status: 'warn', detail: 'Volume steady' });
    } else {
      signals.push({ id: 'volumeAccel', status: 'fail', detail: 'Volume fading' });
    }
  } else {
    signals.push({ id: 'volumeAccel', status: 'warn', detail: 'No volume data yet' });
  }

  // --- Market cap trajectory ---
  let mcapGrowthPct = null;
  if (first && latest && first !== latest && first.marketCapUsd > 0 && latest.marketCapUsd != null) {
    mcapGrowthPct = ((latest.marketCapUsd - first.marketCapUsd) / first.marketCapUsd) * 100;
    if (mcapGrowthPct >= 20) {
      score += WEIGHTS.marketCapGrowth;
      signals.push({ id: 'mcapGrowth', status: 'pass', detail: `Market cap +${mcapGrowthPct.toFixed(0)}%` });
    } else if (mcapGrowthPct >= -15) {
      score += Math.floor(WEIGHTS.marketCapGrowth / 2);
      signals.push({ id: 'mcapGrowth', status: 'warn', detail: `Market cap flat (${mcapGrowthPct >= 0 ? '+' : ''}${mcapGrowthPct.toFixed(0)}%)` });
    } else {
      signals.push({ id: 'mcapGrowth', status: 'fail', detail: `Market cap down ${mcapGrowthPct.toFixed(0)}%` });
    }
  } else {
    signals.push({ id: 'mcapGrowth', status: 'warn', detail: 'Not enough observations yet' });
  }

  // --- Breadth: avg trade size (small = organic crowd) ---
  // Jimothy lesson: ~100k buys/24h, buys > sells, small average trade size = organic crowd
  const totalBuys = token.txns?.h1?.buys ?? 0;
  const totalSells = token.txns?.h1?.sells ?? 0;
  const totalTxns = totalBuys + totalSells;
  const avgTradeSize = breadthFromWindow(token.volume1hUsd, totalTxns);

  if (avgTradeSize != null) {
    // Small avg trade (<$50) = organic crowd; large (>$500) = whale-driven
    if (avgTradeSize < 50) {
      score += WEIGHTS.breadth;
      signals.push({ id: 'breadth', status: 'pass', detail: `Avg trade $${avgTradeSize.toFixed(0)} — organic crowd (${totalTxns} txns)` });
    } else if (avgTradeSize < 200) {
      score += Math.floor(WEIGHTS.breadth / 2);
      signals.push({ id: 'breadth', status: 'warn', detail: `Avg trade $${avgTradeSize.toFixed(0)} — mixed crowd` });
    } else {
      signals.push({ id: 'breadth', status: 'fail', detail: `Avg trade $${avgTradeSize.toFixed(0)} — whale-driven` });
    }
  } else {
    signals.push({ id: 'breadth', status: 'warn', detail: 'No breadth data yet' });
  }

  // --- Slow-climber bonus: tracked tokens with higher-low streak ---
  // This signal is set by the tracked tier's climber detection.
  // If the token has a climber badge, add bonus points.
  if (token.climber || token.tracked?.climber) {
    score += WEIGHTS.climberBonus;
    signals.push({ id: 'climber', status: 'pass', detail: 'Slow-climber pattern detected (higher lows + positive slope)' });
  } else {
    signals.push({ id: 'climber', status: 'warn', detail: 'No climber pattern detected' });
  }

  // --- Attention signal: boosted/profiled/socials appeared ---
  // Proxy for the Jimothy "narrative arrived" moment — teams boost before pushing
  if (token.attentionBoost === 'boosted') {
    score += WEIGHTS.attention;
    signals.push({ id: 'attention', status: 'pass', detail: 'DexScreener boosted — narrative signal' });
  } else if (token.attentionBoost === 'profiled') {
    score += Math.floor(WEIGHTS.attention * 0.7);
    signals.push({ id: 'attention', status: 'pass', detail: 'DexScreener profiled — attention building' });
  } else if (token.attentionBoost === 'socials') {
    score += Math.floor(WEIGHTS.attention * 0.5);
    signals.push({ id: 'attention', status: 'pass', detail: 'Socials appeared after launch — team activity' });
  } else {
    signals.push({ id: 'attention', status: 'warn', detail: 'No attention signals yet' });
  }

  // --- Smart-money presence (GMGN intelligence, additive bonus only) ---
  // Tokens without GMGN evidence score exactly as before; the final cap keeps 0-100.
  const smartWallets = token.smartWallets ?? null;
  const renowned = token.renownedCount ?? 0;
  let smartMoneyBonus = 0;
  if (smartWallets != null && smartWallets >= 10 && renowned >= 2) {
    smartMoneyBonus = 8;
    signals.push({ id: 'smartMoney', status: 'pass', detail: `${smartWallets} smart wallets (${renowned} renowned) in` });
  } else if (smartWallets != null && smartWallets >= 3) {
    smartMoneyBonus = 4;
    signals.push({ id: 'smartMoney', status: 'warn', detail: `${smartWallets} smart wallets watching` });
  } else {
    signals.push({ id: 'smartMoney', status: 'warn', detail: 'No smart-money evidence yet' });
  }
  score += smartMoneyBonus;

  return {
    tractionScore: Math.min(100, Math.round(score)),
    buySellRatio,
    liquidityGrowthPct,
    mcapGrowthPct,
    avgTradeSize,
    totalTxns,
    smartMoneyBonus,
    signals,
  };
}
