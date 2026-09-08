// Token-unit cohort retention (§12.3.5). A wallet that sells ONE token has not exited.
//
// The basis is every buy a cohort wallet makes up to the check horizon — not just its
// entry-window buy. Ignoring later buys makes a wallet that ADDS and then sells part of
// its stack look fully exited, understating retention for the most committed wallets.
export function cohortRetention(trades, t0, entryMs, checkMs, rawBoughtByWallet) {
  const cohort = new Set(trades.filter(trade => trade.side === 'buy' &&
    trade.chainTs >= t0 && trade.chainTs <= t0 + entryMs).map(trade => trade.wallet).filter(Boolean));
  if (cohort.size < 5) return null;

  const bought = new Map([...cohort].map(wallet => [wallet, 0n]));
  const net = new Map([...cohort].map(wallet => [wallet, 0n]));
  for (const trade of trades) {
    if (!cohort.has(trade.wallet) || trade.chainTs < t0 || trade.chainTs > t0 + checkMs) continue;
    const amount = BigInt(trade.rawTokens ?? 0);
    if (trade.side === 'buy') {
      bought.set(trade.wallet, bought.get(trade.wallet) + amount);
      net.set(trade.wallet, net.get(trade.wallet) + amount);
    } else if (trade.side === 'sell') {
      net.set(trade.wallet, net.get(trade.wallet) - amount);
    }
  }

  // Fall back to the caller-supplied basis only where the trade stream shows nothing,
  // so an out-of-band basis is still honoured but never overrides observed buys.
  for (const wallet of cohort) {
    if (bought.get(wallet) === 0n) {
      const seeded = rawBoughtByWallet?.get(wallet) ?? 0n;
      bought.set(wallet, seeded);
      net.set(wallet, net.get(wallet) + seeded);
    }
  }

  const positions = [...cohort].map(wallet => ({ bought: bought.get(wallet), held: net.get(wallet) }));
  const fullyExited = positions.filter(position => position.held <= 0n).length;
  const partiallySold = positions.filter(position =>
    position.held > 0n && position.held < position.bought).length;
  const remainingRaw = positions.reduce((sum, position) =>
    sum + (position.held > 0n ? position.held : 0n), 0n);
  const boughtRaw = positions.reduce((sum, position) => sum + position.bought, 0n);
  return { cohortSize: cohort.size, fullyExited, partiallySold,
    remainingTokenPct: boughtRaw === 0n ? null : Number(remainingRaw) / Number(boughtRaw) };
}
