import { describe, expect, it } from 'vitest';
import { deriveWalletDeltas, tokenBalance } from '../externalTrading.js';

const owner = 'Wallet1111111111111111111111111111111111';
const mint = 'Mint111111111111111111111111111111111111';
const accountKey = { toBase58: () => owner };

describe('external trade receipt deltas', () => {
  it('sums split token accounts for the prepared owner only', () => {
    const balances = [
      { mint, owner, uiTokenAmount: { uiAmountString: '2.5' } },
      { mint, owner, uiTokenAmount: { uiAmountString: '1.5' } },
      { mint, owner: 'other', uiTokenAmount: { uiAmountString: '99' } },
    ];
    expect(tokenBalance(balances, mint, owner)).toBe(4);
  });

  it('derives actual token, native, and fee deltas from a confirmed receipt', () => {
    const receipt = {
      transaction: { message: { staticAccountKeys: [accountKey] } },
      meta: {
        preBalances: [2_000_000_000], postBalances: [1_899_995_000], fee: 5_000,
        preTokenBalances: [{ mint, owner, uiTokenAmount: { uiAmountString: '0' } }],
        postTokenBalances: [{ mint, owner, uiTokenAmount: { uiAmountString: '250' } }],
      },
    };
    expect(deriveWalletDeltas(receipt, owner, mint)).toMatchObject({
      tokenDelta: 250, lamportDelta: -100_005_000, networkFeeSol: 0.000005,
    });
  });

  it('rejects a receipt that does not contain the prepared signer', () => {
    const receipt = { transaction: { message: { staticAccountKeys: [] } }, meta: {} };
    expect(() => deriveWalletDeltas(receipt, owner, mint)).toThrow(/prepared wallet/);
  });
});
