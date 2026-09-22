import { describe, expect, it } from 'vitest';
import { ecosystemLinks, explorerUrl } from '../tokenLinks.js';

const mint = 'So11111111111111111111111111111111111111112';

describe('tokenLinks', () => {
  it('builds chain explorers and falls back to solscan', () => {
    expect(explorerUrl('solana', mint)).toBe(`https://solscan.io/token/${mint}`);
    expect(explorerUrl('robinhood', mint)).toBe(`https://robinhoodchain.blockscout.com/token/${mint}`);
    expect(explorerUrl('unknown', mint)).toBe(`https://solscan.io/token/${mint}`);
  });

  it('returns the ecosystem pair for solana and robinhood', () => {
    expect(ecosystemLinks('solana', mint).map(link => link.label)).toEqual(['Pump.fun', 'GMGN']);
    expect(ecosystemLinks('robinhood', '0xabc').map(link => link.href)).toEqual([
      'https://hood.run/#0xabc',
      'https://gmgn.ai/robinhood/token/0xabc',
    ]);
    expect(ecosystemLinks('ethereum', mint)).toEqual([]);
  });
});
