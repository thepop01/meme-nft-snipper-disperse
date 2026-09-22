// Early Meme Caller Engine
// Identifies high-velocity micro-cap meme launches with strong liquidity,
// accelerating 5-minute volume, and heavy net buy pressure before mainstream breakout.
// Example profile: ~$40k MCap, >$6k 5m volume, >$4k liquidity, >1.3x buy/sell ratio.

export const EARLY_CALLER_CONFIG = {
  minMcapUsd: 20_000,
  maxMcapUsd: 150_000,
  targetMcapUsd: 40_000, // Ideal sweet spot
  minVolume5mUsd: 5_000, // Velocity trigger ($6k+ preferred)
  minLiquidityUsd: 3_500, // Minimum bonding curve or initial pool depth
  minBuySellRatio: 1.25, // Net positive buy flow
  minBuys5m: 8, // Minimum trade count to eliminate single-wallet wash trades
  minVelocityPct: 0.10, // 5m volume must be >= 10% of total market cap
};

/**
 * Evaluates whether a token exhibits the "Early Runner" breakout signature.
 * Returns detailed signal breakdown and confidence rating.
 */
export function evaluateEarlyCaller(token, customConfig = {}) {
  const config = { ...EARLY_CALLER_CONFIG, ...customConfig };
  const signals = [];
  let score = 0;

  const mcap = Number(token?.marketCapUsd || 0);
  const vol5m = Number(token?.volume5mUsd || 0);
  const liq = Number(token?.liquidityUsd || 0);
  const m5 = token?.txns?.m5 || {};
  const buys = Number(m5.buys || 0);
  const sells = Number(m5.sells || 0);
  const totalTxns = buys + sells;

  // 1. Market Cap Window Check ($20k - $150k, optimal ~$40k)
  const isMcapValid = mcap >= config.minMcapUsd && mcap <= config.maxMcapUsd;
  if (isMcapValid) {
    score += 25;
    const distFromSweetSpot = Math.abs(mcap - config.targetMcapUsd);
    if (distFromSweetSpot <= 25_000) {
      score += 10; // Extra bonus for ~$40k sweet spot
      signals.push(`Sweet spot early MCap ($${Math.round(mcap / 1000)}k)`);
    } else {
      signals.push(`Early MCap bracket ($${Math.round(mcap / 1000)}k)`);
    }
  } else if (mcap > config.maxMcapUsd) {
    signals.push(`MCap too high for early call ($${Math.round(mcap / 1000)}k > $150k)`);
  }

  // 2. 5-Minute Volume Velocity Check (>$5k-$6k)
  const isVolumeValid = vol5m >= config.minVolume5mUsd;
  if (isVolumeValid) {
    score += 25;
    if (vol5m >= 6_000) score += 5; // Extra bonus for exceeding user's $6k threshold
    signals.push(`5m volume surge ($${Math.round(vol5m / 1000)}k >= $${Math.round(config.minVolume5mUsd / 1000)}k)`);
  }

  // 3. Volume-to-MCap Velocity Ratio (is 5m volume >= 10-15% of market cap?)
  const velocityRatio = mcap > 0 ? (vol5m / mcap) : 0;
  if (velocityRatio >= config.minVelocityPct) {
    score += 15;
    signals.push(`High turnover velocity (${(velocityRatio * 100).toFixed(0)}% MCap traded in 5m)`);
  }

  // 4. Liquidity Depth Check
  const isLiquidityValid = liq >= config.minLiquidityUsd;
  if (isLiquidityValid) {
    score += 15;
    signals.push(`Safe liquidity backing ($${Math.round(liq / 1000)}k liq)`);
  }

  // 5. Buy Pressure / Order Flow Ratio
  const buyRatio = sells > 0 ? buys / sells : (buys >= config.minBuys5m ? 3.0 : 1.0);
  const isFlowValid = (buys >= config.minBuys5m) && (buyRatio >= config.minBuySellRatio);
  if (isFlowValid) {
    score += 15;
    signals.push(`Bullish order flow (${buyRatio.toFixed(1)}x ratio · ${buys}B/${sells}S in 5m)`);
  }

  // 6. Smart Money Synergy Bonus
  const smartCount = Number(token?.smartWallets || 0);
  if (smartCount >= 1) {
    score += 15;
    signals.push(`Smart money detected (${smartCount} smart wallet${smartCount > 1 ? 's' : ''})`);
  }

  // 7. Safety Verification (must not be an obvious rug/honeypot)
  const freezeRevoked = token?.freezeAuthority === null || token?.safety?.freezeRevoked;
  const mintRevoked = token?.mintAuthority === null || token?.safety?.mintRevoked;
  if (freezeRevoked && mintRevoked) {
    score += 10;
  }

  // Determine overall qualification
  const isEarlySignal = isMcapValid && isVolumeValid && isLiquidityValid && isFlowValid;
  const confidence = (isEarlySignal && score >= 80) ? 'HIGH' : (isEarlySignal || score >= 60) ? 'MEDIUM' : 'LOW';

  return {
    isEarlySignal,
    confidence,
    score: Math.min(100, score),
    strategy: 'Early Runner',
    signals,
    metrics: {
      marketCapUsd: mcap,
      volume5mUsd: vol5m,
      liquidityUsd: liq,
      buyRatio: Number(buyRatio.toFixed(2)),
      buys5m: buys,
      sells5m: sells,
      velocityPct: Number((velocityRatio * 100).toFixed(1)),
      smartWallets: smartCount,
    },
  };
}

export function isEarlyRunnerCandidate(token) {
  return evaluateEarlyCaller(token).isEarlySignal;
}
