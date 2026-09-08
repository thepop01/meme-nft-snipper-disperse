// Read-only native-balance fetching over JSON-RPC batches.
import { ethers } from 'ethers';
import { getChain } from './chains.js';

export async function fetchNativeBalances(chainId, addresses) {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);
  const out = {};
  if (addresses.length === 0) return out;

  const batch = addresses.map((addr, i) => (
    chain.family === 'sol'
      ? { jsonrpc: '2.0', id: i, method: 'getBalance', params: [addr] }
      : { jsonrpc: '2.0', id: i, method: 'eth_getBalance', params: [addr, 'latest'] }
  ));

  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    const results = await res.json();
    const byId = new Map(
      (Array.isArray(results) ? results : [results]).map(r => [r.id, r]),
    );
    addresses.forEach((addr, i) => {
      const r = byId.get(i);
      if (!r || r.error) { out[addr] = null; return; }
      out[addr] = chain.family === 'sol'
        ? String((r.result?.value ?? 0) / 1e9)
        : ethers.formatEther(r.result || '0x0');
    });
  } catch {
    addresses.forEach(addr => { out[addr] = null; });
  }
  return out;
}
