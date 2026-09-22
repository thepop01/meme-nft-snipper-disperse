// Multi-Explorer & Lineage RPC Adapter
// Provides explorer URLs (Solscan, Blockscout, HoodScan, RobinScan)
// and parses on-chain funder parent-child transactions for Lineage Wallets.

export function getExplorerUrls(address, chain = 'solana') {
  const enc = encodeURIComponent(address);
  if (chain === 'solana') {
    return {
      solscan: `https://solscan.io/account/${enc}`,
      solanaFm: `https://solana.fm/address/${enc}`,
    };
  }

  return {
    blockscout: `https://robinhoodchain.blockscout.com/address/${enc}`,
    hoodscan: `https://hoodscan.co/address/${enc}`,
    robinscan: `https://robinscan.xyz/address/${enc}`,
  };
}

export function parseFunderFromTx(tx, chain = 'solana') {
  if (!tx || typeof tx !== 'object') return null;

  if (chain === 'solana') {
    const parent = tx.signer || tx.from || tx.sender;
    const child = tx.recipient || tx.to;
    const lamports = Number(tx.amountLamports ?? tx.lamports ?? 0);
    const amount = lamports > 0 ? lamports / 1e9 : Number(tx.amount || 0);
    const txHash = tx.signature || tx.txHash || tx.hash || null;

    return {
      parentAddress: parent,
      childAddress: child,
      amount,
      txHash,
      chain: 'solana',
    };
  }

  // EVM
  const parent = tx.from ? String(tx.from).toLowerCase() : null;
  const child = tx.to ? String(tx.to).toLowerCase() : null;
  const wei = Number(tx.valueWei ?? tx.value ?? 0);
  const amount = wei > 0 ? wei / 1e18 : Number(tx.amount || 0);
  const txHash = tx.hash || tx.txHash || null;

  return {
    parentAddress: parent,
    childAddress: child,
    amount,
    txHash,
    chain: 'robinhood',
  };
}
