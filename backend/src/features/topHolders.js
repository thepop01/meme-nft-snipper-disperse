// System accounts are excluded only after authority/PDA resolution, never by balance rank.
export async function top10ExLp(rpc, mint, resolvers) {
  const { rawSupply } = await rpc.getMintInfo(mint);
  if (rawSupply == null || BigInt(rawSupply) <= 0n) return { top10ExLpPct: null, resolvedExclusions: false };
  const accounts = await rpc.getTokenLargestAccounts(mint);
  const held = [];
  for (const account of accounts) {
    const info = await rpc.getAccountAuthority(account.address);
    if (resolvers.isCurvePool(info) || resolvers.isAmmVault(info) || resolvers.isBurn(account.address)) continue;
    held.push(account);
    if (held.length === 10) break;
  }
  const heldRaw = held.reduce((total, account) => total + BigInt(account.rawAmount ?? account.amount), 0n);
  return { top10ExLpPct: Number(heldRaw) / Number(BigInt(rawSupply)), resolvedExclusions: true };
}
