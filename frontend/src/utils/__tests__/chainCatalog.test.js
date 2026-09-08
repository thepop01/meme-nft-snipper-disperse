import { describe, it, expect } from 'vitest';
import {
  CHAIN_BAR_TO_DISPERSE,
  CHAIN_BAR_TO_BALANCES,
  DISPERSE_SUPPORTED_LABELS,
  disperseChainFor,
  balanceChainFor,
  chainLabelFor,
} from '../chainCatalog.js';

describe('chainCatalog disperse mapping', () => {
  it('maps canonical UI ids to disperse backend ids', () => {
    expect(disperseChainFor('ethereum')).toBe('eth');
    expect(disperseChainFor('arbitrum')).toBe('arb');
    expect(disperseChainFor('optimism')).toBe('op');
    expect(disperseChainFor('avalanche')).toBe('avax');
    expect(disperseChainFor('solana')).toBe('sol');
    expect(disperseChainFor('monad')).toBe('monad');
    expect(disperseChainFor('base')).toBe('base');
    expect(disperseChainFor('polygon')).toBe('polygon');
    expect(disperseChainFor('bsc')).toBe('bsc');
  });

  it('returns null for unsupported chains', () => {
    expect(disperseChainFor('starknet')).toBeNull();
    expect(disperseChainFor('robinhood')).toBeNull();
    expect(disperseChainFor('zora')).toBeNull();
    expect(disperseChainFor('nope')).toBeNull();
  });

  it('exposes a supported-labels string naming the 9 chains', () => {
    expect(DISPERSE_SUPPORTED_LABELS).toBe(
      'Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Solana or Monad',
    );
    expect(Object.keys(CHAIN_BAR_TO_DISPERSE)).toHaveLength(9);
  });
});

describe('chainCatalog balances mapping', () => {
  it('maps canonical UI ids to wallet-balances backend names', () => {
    expect(balanceChainFor('ethereum')).toBe('ethereum');
    expect(balanceChainFor('arbitrum')).toBe('arbitrum');
    expect(balanceChainFor('robinhood')).toBe('robinhood');
    expect(balanceChainFor('apechain')).toBe('ape_chain');
    expect(balanceChainFor('zora')).toBe('zora');
  });

  it('returns null for unsupported chains (solana has no balances backend)', () => {
    expect(balanceChainFor('solana')).toBeNull();
    expect(balanceChainFor('monad')).toBeNull();
    expect(balanceChainFor('starknet')).toBeNull();
    expect(balanceChainFor('nope')).toBeNull();
  });

  it('exposes the balances map with 10 entries', () => {
    expect(Object.keys(CHAIN_BAR_TO_BALANCES)).toHaveLength(10);
  });
});

describe('chainLabelFor', () => {
  it('resolves known labels and falls back otherwise', () => {
    expect(chainLabelFor('ethereum')).toBe('Ethereum');
    expect(chainLabelFor('robinhood')).toBe('Robinhood');
    expect(chainLabelFor('monad')).toBe('Monad');
    expect(chainLabelFor('nope')).toBe('nope');
    expect(chainLabelFor('nope', 'Unknown')).toBe('Unknown');
  });
});
