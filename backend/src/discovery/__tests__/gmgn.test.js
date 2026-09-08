import { describe, expect, it } from 'vitest';
import { GMGN_CHAINS, aliasLaunchpad, normalizeGmgnRankItem, normalizeTrenchesItem } from '../gmgn.js';

// Fixture mirrors the real `gmgn-cli market trending --raw` item shape
// (verified 2026-09-06 against live solana trending output).
function rankFixture(overrides = {}) {
  return {
    chain: 'sol',
    address: 'DXSAxxLnsf1kFgjUEp492FZQR4xfpszac26FXrtjWvwf',
    name: 'SLOWLANA',
    symbol: 'SLOWLANA',
    logo: 'https://gmgn.ai/external-res/98185b088294dfcc37b67c53d2ad07ac_v2.webp',
    price: 0.0000384657,
    price_change_percent1m: 20.8672,
    price_change_percent5m: 71.1901,
    price_change_percent1h: 835.305,
    volume: 642773,
    liquidity: 13941.4,
    market_cap: 37221.2,
    swaps: 11638,
    buys: 5969,
    sells: 5669,
    holder_count: 540,
    top_10_holder_rate: 0.2133,
    open_timestamp: 1788707326,
    creation_timestamp: 1788707326,
    launchpad_platform: 'Pump.fun',
    exchange: 'pump_amm',
    renounced_mint: 1,
    renounced_freeze_account: 1,
    burn_status: 'burn',
    creator: 'bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa',
    rug_ratio: 0.98,
    sniper_count: 98,
    smart_degen_count: 69,
    renowned_count: 8,
    bundler_rate: 0.2382,
    bluechip_owner_percentage: 0,
    rat_trader_amount_rate: 0.0001,
    bot_degen_rate: 0.5846,
    is_honeypot: 0,
    is_wash_trading: false,
    twitter_username: 'https://x.com/toly/status/2096616458948427866',
    website: '',
    telegram: '',
    ...overrides,
  };
}

describe('GMGN chain matrix', () => {
  it('supports solana and robinhood for this release', () => {
    expect(GMGN_CHAINS.solana.cliChain).toBe('sol');
    expect(GMGN_CHAINS.robinhood.cliChain).toBe('robinhood');
    expect(GMGN_CHAINS.robinhood.chainId).toBe(4663);
  });
});

describe('normalizeGmgnRankItem', () => {
  it('maps a live solana rank item to a registry token', () => {
    const token = normalizeGmgnRankItem(rankFixture(), 'solana');
    expect(token).toMatchObject({
      mint: 'DXSAxxLnsf1kFgjUEp492FZQR4xfpszac26FXrtjWvwf',
      chain: 'solana',
      source: 'gmgn-trending',
      symbol: 'SLOWLANA',
      liquidityUsd: 13941.4,
      marketCapUsd: 37221.2,
      holderCount: 540,
      smartWallets: 69,
      snipers: 98,
    });
    expect(token.createdAt).toBe(1788707326 * 1000);
    expect(token.top10HolderPct).toBeCloseTo(21.33, 1);
  });

  it('lowercases EVM addresses on robinhood without solana assumptions', () => {
    const token = normalizeGmgnRankItem(rankFixture({
      chain: 'robinhood',
      address: '0xFDE2187cEA6aDb439EeCAa9d406188923Ca54A6D',
      symbol: 'ZisK',
    }), 'robinhood');
    expect(token.chain).toBe('robinhood');
    expect(token.mint).toBe('0xfde2187cea6adb439eecaa9d406188923ca54a6d');
  });

  it('rejects items below the liquidity floor', () => {
    expect(normalizeGmgnRankItem(rankFixture({ liquidity: 100 }), 'solana')).toBeNull();
  });

  it('rejects items without an address', () => {
    expect(normalizeGmgnRankItem(rankFixture({ address: '' }), 'solana')).toBeNull();
  });

  it('keeps risk intelligence for downstream safety scoring', () => {
    const token = normalizeGmgnRankItem(rankFixture(), 'solana');
    expect(token).toMatchObject({
      rugRatio: 0.98,
      bundlerPct: 23.82,
      renouncedMint: true,
      honeypot: false,
    });
  });
});

describe('normalizeTrenchesItem', () => {  it('tags early-discovery items with the trench type', () => {
    const token = normalizeTrenchesItem(rankFixture({ address: 'NEWMINT11111111111111111111111111111111111' }), 'solana', 'new_creation');
    expect(token).toMatchObject({
      mint: 'NEWMINT11111111111111111111111111111111111',
      chain: 'solana',
      source: 'gmgn-trenches',
      trenchType: 'new_creation',
    });
  });
});

describe('aliasLaunchpad', () => {
  it('maps GMGN platform names to internal scope vocabulary', () => {
    expect(aliasLaunchpad('Pump.fun')).toBe('pumpfun');
    expect(aliasLaunchpad('pump_amm')).toBe('pumpfun');
    expect(aliasLaunchpad('letsbonk')).toBe('letsbonk');
    expect(aliasLaunchpad('unknown-dex')).toBe('unknown-dex');
    expect(aliasLaunchpad(null)).toBeNull();
  });
  it('normalizes trending launchpads at ingest', () => {
    const token = normalizeGmgnRankItem({
      address: 'ABC123', symbol: 'T', liquidity: 10000, launchpad_platform: 'Pump.fun',
    }, 'solana');
    expect(token.launchpad).toBe('pumpfun');
  });
});
