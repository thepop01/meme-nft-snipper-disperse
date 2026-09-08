import { describe, expect, it } from 'vitest';
import { SolanaStructuralRpc } from '../solanaStructuralRpc.js';
import { manualClock } from '../clock.js';

describe('SolanaStructuralRpc', () => {
  it('caches immutable wallet-age and account-authority lookups', async () => {
    let signatures = 0; let authority = 0;
    const connection = {
      getSignaturesForAddress: async () => { signatures += 1; return [{ blockTime: 1 }]; },
      getParsedAccountInfo: async () => { authority += 1; return { value: { owner: { toBase58: () => 'program' }, data: { parsed: { info: { owner: 'wallet' } } } } }; },
    };
    const rpc = new SolanaStructuralRpc({ rpcUrl: 'unused', clock: manualClock(10_000), maxRequestsPerMinute: 10, connection });
    expect(await rpc.walletAge('11111111111111111111111111111111')).toBe(9000);
    await rpc.walletAge('11111111111111111111111111111111');
    expect(await rpc.getAccountAuthority('11111111111111111111111111111111')).toMatchObject({ owner: 'program', authority: 'wallet' });
    await rpc.getAccountAuthority('11111111111111111111111111111111');
    expect([signatures, authority]).toEqual([1, 1]);
  });
});
