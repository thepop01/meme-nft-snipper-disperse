import { describe, expect, it } from 'vitest';
import { TERMINAL_META } from '../MemeFinderView.jsx';
describe('terminal scope', () => {
  it('locks solana terminal to solana copy', () => { expect(TERMINAL_META.solana.title).toMatch(/Solana/); });
  it('locks evm terminal to robinhood chain 4663 copy', () => { expect(TERMINAL_META.robinhood.title).toMatch(/EVM/); expect(TERMINAL_META.robinhood.subtitle).toMatch(/4663/); });
});
