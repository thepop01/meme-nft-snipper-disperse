// Nansen (nansen.ai) Smart Money & Profiler Adapter
// Connects to Nansen REST API (/api/v1/smart-money) when apiKey is available,
// parses web CSV exports, and formats 1-click Profiler inspection URLs.

import { WHALE_WALLET_MIN_USD } from '../tiers.js';
import { isEvmAddress as isEvm, isSolAddress as isSol } from '../addresses.js';

export function getNansenProfilerUrl(address) {
  return `https://app.nansen.ai/profiler?address=${encodeURIComponent(address)}`;
}

export function normalizeNansenTrades(payload) {
  const list = payload?.data || payload?.trades || (Array.isArray(payload) ? payload : []);
  const out = [];
  const seen = new Set();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const rawAddr = item.wallet_address || item.address || item.wallet;
    if (!rawAddr || seen.has(rawAddr)) continue;

    const chain = item.chain === 'solana' ? 'solana' : 'robinhood';
    const normAddr = chain === 'robinhood' ? String(rawAddr).toLowerCase() : String(rawAddr);
    seen.add(normAddr);

    const valUsd = Number(item.value_usd ?? item.amount_usd ?? 0);
    const labels = Array.isArray(item.smart_money_labels) ? item.smart_money_labels : [];
    const isWhale = valUsd >= WHALE_WALLET_MIN_USD;

    out.push({
      address: normAddr,
      chain,
      category: isWhale ? 'whale' : 'smart',
      source: 'nansen-smart-money',
      score: valUsd,
      hits: 1,
      balanceUsd: isWhale ? valUsd : 0,
      memeHoldingsUsd: isWhale ? valUsd : 0,
      tags: ['nansen_smart_money', ...labels],
      evidence: {
        platform: 'nansen.ai',
        labels,
        tokenSymbol: item.token_symbol || null,
        txHash: item.tx_hash || null,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Parses CSV export from Nansen web platform for users without expensive API keys.
 */
export function parseNansenCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];

  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const addrIdx = headers.findIndex(h => h.includes('address') || h.includes('wallet'));
  if (addrIdx === -1) return [];

  const labelIdx = headers.findIndex(h => h.includes('label') || h.includes('name'));
  const balIdx = headers.findIndex(h => h.includes('balance'));
  const pnlIdx = headers.findIndex(h => h.includes('pnl') || h.includes('profit'));

  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const rawAddr = cols[addrIdx];
    if (!rawAddr) continue;

    const chain = isSol(rawAddr) ? 'solana' : isEvm(rawAddr) ? 'robinhood' : null;
    if (!chain) continue;

    const normAddr = chain === 'robinhood' ? rawAddr.toLowerCase() : rawAddr;
    const label = labelIdx !== -1 ? cols[labelIdx] : 'Smart Degen';
    const balance = balIdx !== -1 ? Number(cols[balIdx]) || 0 : 0;
    const pnl = pnlIdx !== -1 ? Number(cols[pnlIdx]) || 0 : 0;
    const isWhale = balance >= WHALE_WALLET_MIN_USD;

    out.push({
      address: normAddr,
      chain,
      category: isWhale ? 'whale' : 'smart',
      source: 'nansen-csv',
      score: pnl,
      hits: 1,
      balanceUsd: balance,
      realizedProfitUsd: pnl,
      tags: ['nansen_export', label].filter(Boolean),
      evidence: {
        platform: 'nansen.ai',
        label,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return out;
}

/**
 * Fetches Smart Money DEX trades from Nansen API (requires NANSEN_API_KEY).
 */
export async function fetchNansenSmartMoneyTrades({ chains = ['solana', 'ethereum'], limit = 50, apiKey = process.env.NANSEN_API_KEY } = {}) {
  if (!apiKey) return [];

  const url = 'https://api.nansen.ai/api/v1/smart-money/dex-trades';
  const body = {
    chains,
    pagination: { page: 1, per_page: limit },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'apiKey': apiKey,
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Nansen API error ${res.status}`);
    const json = await res.json();
    return normalizeNansenTrades(json);
  } catch {
    return [];
  }
}
