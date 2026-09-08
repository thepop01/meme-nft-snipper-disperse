const supported = new Set(['solana:pumpfun']);

export function classifyScope(token) {
  if (!token?.chain || !token?.launchpad) return 'unscored';
  return supported.has(`${token.chain}:${token.launchpad}`) ? 'supported' : 'unscored';
}
