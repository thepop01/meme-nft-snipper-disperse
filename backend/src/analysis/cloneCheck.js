const cache = new Map();
const MAX_CACHE_SIZE = 10000;

export async function getEstablishedMcap(symbol) {
  if (!symbol) return 0;
  const sym = String(symbol).toUpperCase().trim();
  
  // Single letter or very long names are usually not what we want to clone-check
  if (sym.length < 2 || sym.length > 15) return 0; 
  
  if (cache.has(sym)) return cache.get(sym);

  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(sym)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    
    // If rate limited or errors, just return 0 to fail open (allow the token)
    if (!res.ok) return 0;
    
    const data = await res.json();
    let maxMcap = 0;
    
    for (const p of data.pairs || []) {
      if (p.baseToken?.symbol?.toUpperCase() === sym) {
        const mcap = Number(p.marketCap || p.fdv || 0);
        if (mcap > maxMcap) maxMcap = mcap;
      }
    }
    
    if (cache.size >= MAX_CACHE_SIZE) {
      // LRU eviction: JavaScript Maps are insertion-ordered, so deleting the first element evicts the oldest
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    
    cache.set(sym, maxMcap);
    return maxMcap;
  } catch (err) {
    // Timeout or network error
    return 0;
  }
}
