/**
 * Token explorer and ecosystem link generators.
 */

export function explorerUrl(chain, mint) {
  const encodedMint = encodeURIComponent(mint || '');
  const urls = {
    solana: `https://solscan.io/token/${encodedMint}`,
    monad: `https://monadscan.com/token/${encodedMint}`,
    robinhood: `https://robinhoodchain.blockscout.com/token/${encodedMint}`,
    ethereum: `https://etherscan.io/token/${encodedMint}`,
    base: `https://basescan.org/token/${encodedMint}`,
  };
  return urls[chain] || `https://solscan.io/token/${encodedMint}`;
}

export function ecosystemLinks(chain, mint) {
  const rawMint = mint || '';
  const encodedMint = encodeURIComponent(rawMint);
  if (chain === 'solana') {
    return [
      { label: 'Pump.fun', href: `https://pump.fun/coin/${encodedMint}` },
      { label: 'GMGN', href: `https://gmgn.ai/sol/token/${encodedMint}` },
    ];
  }
  if (chain === 'monad') {
    return [
      { label: 'nad.fun', href: `https://nad.fun/tokens/${encodedMint}` },
      { label: 'GMGN', href: `https://gmgn.ai/monad/token/${encodedMint}` },
    ];
  }
  if (chain === 'robinhood') {
    return [
      { label: 'Hood Runs', href: `https://hood.run/#${rawMint}` },
      { label: 'GMGN', href: `https://gmgn.ai/robinhood/token/${encodedMint}` },
    ];
  }
  return [];
}
