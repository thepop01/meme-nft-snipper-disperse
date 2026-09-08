// OpenSea sale-standard mint calldata + preflight simulation + minted-token
// extraction. Calldata comes ONLY from OpenSea's mint endpoint — never guessed.
const OPENSEA_BASE = 'https://api.opensea.io/api/v2';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export async function fetchMintTx(slug, minterAddress, quantity) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
  const res = await fetch(`${OPENSEA_BASE}/drops/${slug}/mint`, {
    method: 'POST', headers,
    body: JSON.stringify({ minter: minterAddress, quantity }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`manual-only: OpenSea cannot build this mint (${data.errors?.[0] || res.status})`);
  }
  const tx = data.transaction || data;
  return { to: tx.to, data: tx.input_data || tx.data, value: BigInt(tx.value ?? 0) };
}

// eth_call preflight from the wallet. eligible | not-eligible | unknown.
export async function simulateMint(provider, tx, from) {
  try {
    await provider.call({ to: tx.to, data: tx.data, value: tx.value, from });
    return { result: 'eligible', reason: null };
  } catch (err) {
    const msg = err.reason || err.shortMessage || err.message || '';
    if (err.code === 'CALL_EXCEPTION' || /revert/i.test(msg)) {
      return { result: 'not-eligible', reason: msg };
    }
    return { result: 'unknown', reason: msg };
  }
}

// ERC-721 Transfer(to=wallet) logs -> minted token ids.
export function extractMintedTokenIds(receipt, wallet) {
  const walletTopic = '0x' + wallet.slice(2).toLowerCase().padStart(64, '0');
  const out = [];
  for (const log of receipt.logs || []) {
    if (log.topics?.[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length !== 4) continue; // ERC-721 has indexed tokenId
    if (log.topics[2].toLowerCase() !== walletTopic) continue;
    out.push({ contract: log.address, tokenId: BigInt(log.topics[3]).toString() });
  }
  return out;
}
