const LIFI_BASE = 'https://li.quest/v1';
export const LIFI_NATIVE = '0x0000000000000000000000000000000000000000';
export const DEFAULT_SLIPPAGE = 0.005;

export function toLifiToken(asset) {
  return asset === 'NATIVE' ? LIFI_NATIVE : asset;
}

function num(x) {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

export function mapQuote(raw) {
  return {
    tool: raw.tool,
    toAmount: raw.estimate?.toAmount ?? '0',
    durationSec: raw.estimate?.executionDuration ?? null,
    gasUsd: (raw.estimate?.gasCosts || []).reduce((s, c) => s + num(c.amountUSD), 0),
    feeUsd: (raw.estimate?.feeCosts || []).reduce((s, c) => s + num(c.amountUSD), 0),
    approvalAddress: raw.estimate?.approvalAddress || raw.transactionRequest?.to || null,
    transactionRequest: raw.transactionRequest || null,
    raw,
  };
}

export async function getQuote({
  fromChainId, toChainId, fromToken, toToken, fromAmount, fromAddress, toAddress,
  slippage = DEFAULT_SLIPPAGE,
}) {
  const params = new URLSearchParams({
    fromChain: String(fromChainId), toChain: String(toChainId),
    fromToken, toToken, fromAmount: String(fromAmount),
    fromAddress, toAddress, slippage: String(slippage),
  });
  const res = await fetch(`${LIFI_BASE}/quote?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `No route from LI.FI (${res.status})`);
  }
  return mapQuote(data);
}

export async function pollStatus({ tool, fromChainId, toChainId, txHash }) {
  const params = new URLSearchParams({
    bridge: tool || '', fromChain: String(fromChainId), toChain: String(toChainId), txHash,
  });
  const res = await fetch(`${LIFI_BASE}/status?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `LI.FI status error (${res.status})`);
  return {
    status: data.status || 'PENDING',
    substatus: data.substatus,
    receivedAmount: data.receiving?.amount ?? null,
  };
}
