// Cielo Finance (cielo.finance) Real-Time Alert Webhook Adapter
// Ingests live wallet buy/sell alerts and records trade hits.

import { emit, log } from '../../bus.js';

export function handleCieloWebhookPayload(payload) {
  const data = payload?.data || payload;
  if (!data || typeof data !== 'object') return null;

  const wallet = data.wallet || data.wallet_address || data.address;
  if (!wallet) return null;

  const chain = data.chain === 'robinhood' || data.chain === 'evm' ? 'robinhood' : 'solana';
  const token = data.token_bought?.mint || data.token?.mint || data.token_address || data.token || 'UNKNOWN';
  const symbol = data.token_bought?.symbol || data.token?.symbol || data.symbol || 'TOKEN';
  const amountUsd = Number(data.amount_usd ?? data.value_usd ?? data.amount ?? 0);
  const txHash = data.tx_hash || data.signature || data.hash || null;
  const ts = (data.timestamp ? Number(data.timestamp) * 1000 : null) || Date.now();

  const record = {
    wallet,
    chain,
    token,
    symbol,
    action: data.action || 'swap',
    amountUsd,
    txHash,
    ts,
  };

  emit('cielo:trade', record);
  log('info', `[cielo] Live trade from ${wallet.slice(0, 6)}…: ${record.action} $${amountUsd} of ${symbol}`);

  return record;
}
