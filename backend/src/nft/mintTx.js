// OpenSea REST sale-standard mint calldata + preflight simulation +
// minted-token extraction. Calldata comes only from the documented OpenSea
// REST mint endpoint; this module never guesses selectors or scrapes a page.
const OPENSEA_BASE = 'https://api.opensea.io/api/v2';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const DATA_RE = /^0x[0-9a-fA-F]*$/;
const UINT_RE = /^(0|[1-9][0-9]*)$/;

function fail(message) {
  throw Object.assign(new Error(message), { code: 'NFT_TX_VALIDATION' });
}

function asAddress(value, label) {
  const address = String(value || '');
  if (!ADDRESS_RE.test(address)) fail(`${label} must be a valid EVM address`);
  return address.toLowerCase();
}

function asQuantity(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && UINT_RE.test(value) && BigInt(value) > 0n && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  fail('Mint quantity must be a positive integer');
}

function asWei(value, label = 'Native value') {
  try {
    const wei = typeof value === 'bigint' ? value : BigInt(value ?? 0);
    if (wei < 0n) fail(`${label} must not be negative`);
    return wei;
  } catch {
    fail(`${label} must be an integer amount in wei`);
  }
}

function asCalldata(value) {
  if (typeof value !== 'string' || !DATA_RE.test(value) || value.length < 10 || (value.length - 2) % 2 !== 0) {
    fail('Mint calldata must be hex with a four-byte function selector');
  }
  if (/^0x0{8}/i.test(value)) fail('Mint calldata selector must not be zero');
  return value.toLowerCase();
}

export async function fetchMintTx(slug, minterAddress, quantity, { saleAdapter = 'opensea-rest' } = {}) {
  if (!String(slug || '').trim()) fail('Mint slug is required');
  const normalizedQuantity = asQuantity(quantity);
  if (saleAdapter !== 'opensea-rest') fail(`Unsupported NFT sale adapter ${saleAdapter}`);

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
  const res = await fetch(`${OPENSEA_BASE}/drops/${encodeURIComponent(slug)}/mint`, {
    method: 'POST', headers,
    body: JSON.stringify({ minter: minterAddress, quantity: normalizedQuantity }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`manual-only: OpenSea cannot build this mint (${data.errors?.[0] || res.status})`);
  }
  const tx = data.transaction || data;
  if (!tx || typeof tx !== 'object') fail('OpenSea returned no mint transaction');
  // Return only the transaction fields accepted by the execution layer. A
  // response is not trusted merely because it came from an HTTP 2xx response.
  return {
    to: tx.to,
    data: tx.input_data || tx.data,
    value: asWei(tx.value ?? 0),
    ...(tx.chainId != null ? { chainId: tx.chainId } : {}),
    ...(tx.from != null ? { from: tx.from } : {}),
  };
}

/**
 * Validate all transaction fields that can be checked without signing.
 * `expectedTarget` must come from reviewed collection metadata (not from an
 * arbitrary fallback). The returned object is normalized for provider calls.
 */
export function validateMintTransaction(tx, {
  expectedChainId,
  signerAddress,
  expectedTarget,
  quantity,
  maxValueWei,
} = {}) {
  if (!tx || typeof tx !== 'object') fail('Mint transaction is missing');
  const to = asAddress(tx.to, 'Mint transaction target');
  const data = asCalldata(tx.data);
  const value = asWei(tx.value);

  if (!Number.isInteger(Number(expectedChainId)) || Number(expectedChainId) <= 0) {
    fail('Expected mint chain is invalid');
  }
  if (tx.chainId != null && Number(tx.chainId) !== Number(expectedChainId)) {
    fail(`Mint transaction chain mismatch: expected ${expectedChainId}, got ${tx.chainId}`);
  }

  const signer = asAddress(signerAddress, 'Signer address');
  if (tx.from != null && asAddress(tx.from, 'Mint transaction sender') !== signer) {
    fail('Mint transaction signer mismatch');
  }

  if (expectedTarget == null) fail('Mint target contract is required for execution');
  if (to !== asAddress(expectedTarget, 'Expected target contract')) {
    fail(`Mint transaction target mismatch: expected ${expectedTarget}, got ${tx.to}`);
  }

  const normalizedQuantity = asQuantity(quantity);
  if (maxValueWei != null && value > asWei(maxValueWei, 'Maximum native value')) {
    fail('Mint native value exceeds the configured cost cap');
  }
  return { ...tx, to, data, value, signer, quantity: normalizedQuantity };
}

// eth_call preflight from the wallet. Only an explicit eligible result may
// proceed to signing. RPC errors are intentionally not treated as eligible.
export async function simulateMint(provider, tx, from) {
  try {
    await provider.call({ to: tx.to, data: tx.data, value: tx.value, from });
    return { result: 'eligible', reason: null };
  } catch (err) {
    const msg = err.reason || err.shortMessage || err.message || 'Simulation failed';
    if (err.code === 'CALL_EXCEPTION' || /revert/i.test(msg)) {
      return { result: 'not-eligible', reason: msg };
    }
    return { result: 'unknown', reason: msg };
  }
}

export function assertSimulationEligible(simulation) {
  if (!simulation || simulation.result !== 'eligible') {
    const result = simulation?.result || 'unknown';
    throw new Error(`Mint simulation is not eligible (${result}): ${simulation?.reason || 'no successful simulation'}`);
  }
  return simulation;
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
