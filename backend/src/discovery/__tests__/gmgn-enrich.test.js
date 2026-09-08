import { describe, expect, it } from 'vitest';
import { mergeGmgnIntelligence } from '../enrich.js';

describe('mergeGmgnIntelligence', () => {
  it('merges holder and smart-money fields without clobbering price', () => {
    const token = { mint: 'ABC', chain: 'solana', priceUsd: 0.001, liquidityUsd: 10000 };
    const merged = mergeGmgnIntelligence(token, {
      holder_count: 1842, smart_degen_count: 5, sniper_count: 2,
      rug_ratio: 0.3, bundler_rate: 0.1, top_10_holder_rate: 0.2,
      renounced_mint: 1, is_honeypot: 0,
    });
    expect(merged.priceUsd).toBe(0.001);
    expect(merged.holderCount).toBe(1842);
    expect(merged.smartWallets).toBe(5);
    expect(merged.rugRatio).toBe(0.3);
    expect(merged.bundlerPct).toBe(10);
    expect(merged.top10HolderPct).toBe(20);
    expect(merged.renouncedMint).toBe(true);
    expect(merged.honeypot).toBe(false);
    expect(merged.gmgnUpdatedAt).toBeTypeOf('number');
  });

  it('ignores missing or non-object input', () => {
    const token = { mint: 'ABC', priceUsd: 0.5 };
    expect(mergeGmgnIntelligence(token, null)).toBe(token);
    expect(mergeGmgnIntelligence(token, undefined).priceUsd).toBe(0.5);
  });
});
