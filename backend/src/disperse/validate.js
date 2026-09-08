import { ethers } from 'ethers';
import bs58 from 'bs58';

function isValidSol(addr) {
  try {
    return bs58.decode(addr).length === 32;
  } catch {
    return false;
  }
}

export function parseRecipients(text, family) {
  const recipients = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text || '').split('\n');

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(',').map(p => p.trim());
    const rawAddr = parts[0];
    const rawAmount = parts[1];

    let address;
    if (family === 'evm') {
      const normalized = rawAddr.startsWith('0X') ? '0x' + rawAddr.slice(2) : rawAddr;
      if (!ethers.isAddress(normalized)) {
        errors.push({ line: i + 1, message: 'Invalid EVM address' });
        return;
      }
      address = ethers.getAddress(normalized);
    } else {
      if (!isValidSol(rawAddr)) {
        errors.push({ line: i + 1, message: 'Invalid Solana address' });
        return;
      }
      address = rawAddr;
    }

    if (seen.has(address)) return;
    seen.add(address);

    const entry = { address };
    if (rawAmount !== undefined && rawAmount !== '') {
      const n = Number(rawAmount);
      if (!isFinite(n) || n <= 0) {
        errors.push({ line: i + 1, message: 'Amount must be a positive number' });
        return;
      }
      entry.amount = rawAmount;
    }
    recipients.push(entry);
  });

  return { recipients, errors };
}

function toBaseUnits(value, decimals) {
  return ethers.parseUnits(String(value), decimals);
}

export function computeAmounts({ mode, perRecipient, total, decimals, recipients }) {
  if (!recipients || recipients.length === 0) throw new Error('No recipients');
  const n = recipients.length;

  if (mode === 'equal') {
    const each = toBaseUnits(perRecipient, decimals);
    if (each <= 0n) throw new Error('Amount must be positive');
    const amounts = recipients.map(() => each);
    return { amounts, total: each * BigInt(n) };
  }

  if (mode === 'total') {
    const totalUnits = toBaseUnits(total, decimals);
    if (totalUnits <= 0n) throw new Error('Total must be positive');
    const base = totalUnits / BigInt(n);
    const remainder = totalUnits - base * BigInt(n);
    const amounts = recipients.map((_, i) => (i === n - 1 ? base + remainder : base));
    return { amounts, total: totalUnits };
  }

  if (mode === 'custom') {
    const amounts = recipients.map(r => {
      const units = toBaseUnits(r.amount, decimals);
      if (units <= 0n) throw new Error('Amount must be positive');
      return units;
    });
    return { amounts, total: amounts.reduce((a, b) => a + b, 0n) };
  }

  throw new Error(`Unknown amount mode: ${mode}`);
}
