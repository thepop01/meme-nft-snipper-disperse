import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs and has WebCrypto available', () => {
    expect(typeof globalThis.crypto.subtle.deriveKey).toBe('function');
  });
});
