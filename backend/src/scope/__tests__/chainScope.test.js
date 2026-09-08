import { describe, expect, it } from 'vitest';
import { classifyScope } from '../chainScope.js';

describe('chain scope', () => it('only supports Solana Pump.fun', () => {
  expect(classifyScope({ chain: 'solana', launchpad: 'pumpfun' })).toBe('supported');
  expect(classifyScope({ chain: 'solana', launchpad: 'raydium' })).toBe('unscored');
  expect(classifyScope(null)).toBe('unscored');
}));
