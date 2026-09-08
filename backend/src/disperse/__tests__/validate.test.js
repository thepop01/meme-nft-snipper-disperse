import { describe, it, expect } from 'vitest';
import { parseRecipients, computeAmounts } from '../validate.js';

describe('parseRecipients (evm)', () => {
  const A = '0x1111111111111111111111111111111111111111';
  const B = '0x2222222222222222222222222222222222222222';

  it('normalizes, dedups, and flags bad rows', () => {
    const text = `${A}\nnot-an-address\n${A.toUpperCase()}\n${B}`;
    const { recipients, errors } = parseRecipients(text, 'evm');
    expect(recipients.map(r => r.address)).toEqual([A, B]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });

  it('parses "address, amount" custom lines', () => {
    const text = `${A}, 1.5\n${B},2`;
    const { recipients, errors } = parseRecipients(text, 'evm');
    expect(errors).toEqual([]);
    expect(recipients).toEqual([
      { address: A, amount: '1.5' },
      { address: B, amount: '2' },
    ]);
  });

  it('rejects a negative or zero custom amount', () => {
    const text = `${A}, -1\n${B}, 0`;
    const { errors } = parseRecipients(text, 'evm');
    expect(errors).toHaveLength(2);
  });
});

describe('parseRecipients (sol)', () => {
  it('accepts base58 pubkeys and rejects evm addresses', () => {
    const sol = 'So11111111111111111111111111111111111111112';
    const { recipients, errors } = parseRecipients(
      `${sol}\n0x1111111111111111111111111111111111111111`, 'sol');
    expect(recipients.map(r => r.address)).toEqual([sol]);
    expect(errors).toHaveLength(1);
  });
});

describe('computeAmounts', () => {
  const recips = [{ address: 'a' }, { address: 'b' }, { address: 'c' }];

  it('equal mode gives each the same base-unit amount', () => {
    const out = computeAmounts({ mode: 'equal', perRecipient: '1.5', decimals: 6, recipients: recips });
    expect(out.amounts).toEqual([1500000n, 1500000n, 1500000n]);
    expect(out.total).toBe(4500000n);
  });

  it('total-split divides evenly with remainder to the last recipient', () => {
    const out = computeAmounts({ mode: 'total', total: '1', decimals: 6, recipients: recips });
    expect(out.amounts).toEqual([333333n, 333333n, 333334n]);
    expect(out.total).toBe(1000000n);
  });

  it('custom mode uses each recipient amount', () => {
    const custom = [{ address: 'a', amount: '1' }, { address: 'b', amount: '2.5' }];
    const out = computeAmounts({ mode: 'custom', decimals: 6, recipients: custom });
    expect(out.amounts).toEqual([1000000n, 2500000n]);
    expect(out.total).toBe(3500000n);
  });

  it('throws on empty recipients', () => {
    expect(() => computeAmounts({ mode: 'equal', perRecipient: '1', decimals: 6, recipients: [] }))
      .toThrow(/no recipients/i);
  });
});
