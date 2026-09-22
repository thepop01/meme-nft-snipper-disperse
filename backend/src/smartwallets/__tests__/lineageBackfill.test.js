import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeMadeOnSolLinkedPayload,
  parseHeliusFunder,
  parseRobinhoodFunder,
  backfillLinkedWallets,
} from '../lineageBackfill.js';
import { loadWallets, saveWallets } from '../tracker.js';
import { traceLineage } from '../scam.js';

describe('Lineage Backfill Engine (Phase 1)', () => {
  const SOL_WALLET_A = '6cNjLym8bDZ5JFGFSDom2us27iF7EBHYUXdFCdC5zWhX';
  const SOL_FUNDER_P = 'GW3fJ6bUjemSBcFh6zbP3eXxk1rLRFT7vB5JzyyuAXQP';
  const SOL_CHILD_C = 'cATq48AALCiD2hECKZDgKHp3VoSHbXc4aDxSzgQLbc3';

  const EVM_WALLET_A = '0x89e52627e283b40f6f4d0e11796191b29a1b41b9';
  const EVM_FUNDER_P = '0x4337038429b76948ee97eb2d8115513277c3abf5';

  beforeEach(() => {
    // Reset test wallet state
    saveWallets({
      updatedAt: new Date().toISOString(),
      wallets: [
        { address: SOL_WALLET_A, chain: 'solana', category: 'tracked', tags: ['early_buyer'] },
        { address: EVM_WALLET_A, chain: 'robinhood', category: 'tracked', tags: ['early_buyer'] },
      ],
      runners: [],
    });
  });

  describe('normalizeMadeOnSolLinkedPayload', () => {
    it('returns empty array on invalid or null payload', () => {
      expect(normalizeMadeOnSolLinkedPayload(SOL_WALLET_A, null)).toEqual([]);
      expect(normalizeMadeOnSolLinkedPayload(SOL_WALLET_A, {})).toEqual([]);
      expect(normalizeMadeOnSolLinkedPayload(SOL_WALLET_A, 'invalid')).toEqual([]);
    });

    it('parses parent funder relationship correctly', () => {
      const payload = {
        linked: [
          {
            wallet: SOL_FUNDER_P,
            relationship: 'parent',
            funded_amount: 15.5,
            signature: 'sig123',
          },
        ],
      };

      const res = normalizeMadeOnSolLinkedPayload(SOL_WALLET_A, payload);
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({
        parentAddress: SOL_FUNDER_P,
        childAddress: SOL_WALLET_A,
        amount: 15.5,
        txHash: 'sig123',
        chain: 'solana',
        source: 'madeonsol_linked',
      });
    });

    it('parses child sub-wallets and filters out self-references', () => {
      const payload = {
        sub_wallets: [
          { wallet: SOL_CHILD_C, relationship: 'child', amount: 2.5 },
          { wallet: SOL_WALLET_A, relationship: 'child', amount: 0 }, // self reference
        ],
      };

      const res = normalizeMadeOnSolLinkedPayload(SOL_WALLET_A, payload);
      expect(res).toHaveLength(1);
      expect(res[0].parentAddress).toBe(SOL_WALLET_A);
      expect(res[0].childAddress).toBe(SOL_CHILD_C);
      expect(res[0].amount).toBe(2.5);
    });
  });

  describe('parseHeliusFunder', () => {
    it('returns null if transaction does not fund the target wallet', () => {
      const tx = {
        signature: 'tx_other',
        nativeTransfers: [
          { fromUserAccount: 'sender1', toUserAccount: 'other_wallet', amount: 1000000000 },
        ],
      };
      expect(parseHeliusFunder(SOL_WALLET_A, tx)).toBeNull();
    });

    it('extracts parent funder and converts lamports to SOL', () => {
      const tx = {
        signature: 'tx_funder_sig',
        feePayer: SOL_FUNDER_P,
        type: 'TRANSFER',
        timestamp: 1726000000,
        nativeTransfers: [
          {
            fromUserAccount: SOL_FUNDER_P,
            toUserAccount: SOL_WALLET_A,
            amount: 5000000000, // 5 SOL
          },
        ],
      };

      const parsed = parseHeliusFunder(SOL_WALLET_A, tx);
      expect(parsed).not.toBeNull();
      expect(parsed.parentAddress).toBe(SOL_FUNDER_P);
      expect(parsed.childAddress).toBe(SOL_WALLET_A);
      expect(parsed.amount).toBe(5);
      expect(parsed.txHash).toBe('tx_funder_sig');
      expect(parsed.chain).toBe('solana');
    });

    it('ignores transfers where wallet funds itself', () => {
      const tx = {
        signature: 'tx_self',
        nativeTransfers: [
          { fromUserAccount: SOL_WALLET_A, toUserAccount: SOL_WALLET_A, amount: 1000000000 },
        ],
      };
      expect(parseHeliusFunder(SOL_WALLET_A, tx)).toBeNull();
    });
  });

  describe('parseRobinhoodFunder', () => {
    it('parses standard EVM transfer to target wallet', () => {
      const tx = {
        from: EVM_FUNDER_P,
        to: EVM_WALLET_A,
        valueWei: 2000000000000000000n, // 2 ETH
        hash: '0xabc123',
      };

      const parsed = parseRobinhoodFunder(EVM_WALLET_A, tx);
      expect(parsed).not.toBeNull();
      expect(parsed.parentAddress).toBe(EVM_FUNDER_P.toLowerCase());
      expect(parsed.childAddress).toBe(EVM_WALLET_A.toLowerCase());
      expect(parsed.amount).toBe(2);
      expect(parsed.txHash).toBe('0xabc123');
      expect(parsed.chain).toBe('robinhood');
    });

    it('parses GeckoTerminal trade funder record', () => {
      const trade = {
        attributes: {
          tx_from_address: EVM_FUNDER_P,
          to: EVM_WALLET_A,
          volume_in_usd: 150.75,
          tx_hash: '0xtrade456',
        },
      };

      const parsed = parseRobinhoodFunder(EVM_WALLET_A, trade);
      expect(parsed).not.toBeNull();
      expect(parsed.parentAddress).toBe(EVM_FUNDER_P.toLowerCase());
      expect(parsed.childAddress).toBe(EVM_WALLET_A.toLowerCase());
      expect(parsed.amount).toBe(150.75);
      expect(parsed.txHash).toBe('0xtrade456');
    });
  });

  describe('backfillLinkedWallets and Strict Zero Raw Tx Storage', () => {
    it('backfills Solana and Robinhood candidate wallets and establishes parent links', async () => {
      const mockSolanaFetcher = vi.fn().mockResolvedValue([
        {
          parentAddress: SOL_FUNDER_P,
          childAddress: SOL_WALLET_A,
          amount: 10,
          txHash: 'tx_sol_mock',
          chain: 'solana',
          source: 'test_funder',
        },
      ]);

      const mockRobinhoodFetcher = vi.fn().mockResolvedValue({
        parentAddress: EVM_FUNDER_P,
        childAddress: EVM_WALLET_A,
        amount: 3.5,
        txHash: '0xrh_mock',
        chain: 'robinhood',
      });

      const res = await backfillLinkedWallets({
        batchSize: 10,
        customSolanaFetcher: mockSolanaFetcher,
        customRobinhoodFetcher: mockRobinhoodFetcher,
      });

      expect(res.backfilledCount).toBe(2);
      expect(res.newLinkedWalletsCount).toBe(2);

      // Verify stored data
      const updatedStore = loadWallets();
      const solTarget = updatedStore.wallets.find(w => w.address === SOL_WALLET_A);
      expect(solTarget.lineageParent).toBe(SOL_FUNDER_P);
      expect(solTarget.lineageTx).toBe('tx_sol_mock');
      expect(solTarget.lineageAmount).toBe(10);

      const rhTarget = updatedStore.wallets.find(w => w.address.toLowerCase() === EVM_WALLET_A.toLowerCase());
      expect(rhTarget.lineageParent).toBe(EVM_FUNDER_P.toLowerCase());
      expect(rhTarget.lineageTx).toBe('0xrh_mock');

      // CRITICAL REQUIREMENT: STRICT ZERO RAW TRANSACTION STORAGE
      for (const w of updatedStore.wallets) {
        expect(w.transactions).toBeUndefined();
        expect(w.rawTxs).toBeUndefined();
        expect(w.trades).toBeUndefined();
        expect(w.swaps).toBeUndefined();
        expect(w.txLogs).toBeUndefined();
      }
    });

    it('allows traceLineage to traverse the newly backfilled parent-child graph', async () => {
      const mockSolanaFetcher = vi.fn().mockResolvedValue([
        {
          parentAddress: SOL_FUNDER_P,
          childAddress: SOL_WALLET_A,
          amount: 5,
          txHash: 'tx_hop_1',
          chain: 'solana',
        },
      ]);

      await backfillLinkedWallets({
        batchSize: 10,
        chain: 'solana',
        customSolanaFetcher: mockSolanaFetcher,
      });

      const store = loadWallets();
      const lineageFromParent = traceLineage(SOL_FUNDER_P, store.wallets, 3);
      expect(lineageFromParent.some(l => l.address === SOL_WALLET_A)).toBe(true);

      const lineageFromChild = traceLineage(SOL_WALLET_A, store.wallets, 3);
      expect(lineageFromChild.some(l => l.address === SOL_FUNDER_P)).toBe(true);
    });
  });
});
