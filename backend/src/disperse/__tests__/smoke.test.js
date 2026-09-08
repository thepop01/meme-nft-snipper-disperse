import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';

describe('backend disperse setup', () => {
  it('has ethers available', () => {
    expect(ethers.isAddress('0x0000000000000000000000000000000000000000')).toBe(true);
  });
});
