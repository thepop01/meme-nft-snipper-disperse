# Disperse Engine (Disperse v2 — Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend disperse job engine (plan → execute → track, same-chain only) for EVM + Solana, expose it over REST + the existing WS bus, and rebuild the Disperse page to drive it — with stored-wallet (backend-executed) and MetaMask (browser-signed) sender paths, three amount modes, live validation, a preview plan card, and a per-recipient progress tracker.

**Architecture:** A new `backend/src/disperse/` module holds all execution logic as pure, testable units: `config.js` (chain/token/contract metadata), `validate.js` (address + amount normalization), `plan.js` (build an immutable execution plan), `evm.js` / `solana.js` (chain adapters), and `jobRunner.js` (state machine + persistence + retries). Decrypted keys arrive per-job and live only in an in-memory map, wiped on completion. The frontend rebuild splits into `DisperseView` (orchestration) plus `disperseApi.js` and small presentational pieces. Cross-chain bridging is **out of scope** here — it lands in Plan 3.

**Tech Stack:** Node ESM + Express + ws (existing backend), ethers v6 (new backend dep — same version as frontend), @solana/web3.js + bs58 (existing backend deps), vitest (new backend dev dep). Frontend: React 19 + ethers v6 (existing).

**Spec:** `docs/superpowers/specs/2026-07-18-disperse-v2-design.md` §2 (UX), §3 (engine), §5 (errors/config/testing). Bridge parts of §4 are deferred to Plan 3; this plan leaves clean seams for it.

**Depends on:** Plan 1 (wallet profiles) shipped — `frontend/src/utils/senderWalletStore.js` (`decryptWalletKey`, `listWallets`), `keys.js`, `chains.js`.

**Working conventions for this repo:**
- Windows + Git Bash. Heredocs do NOT work — use Write/Edit tools for all files.
- Backend dir: `C:\Users\shubh\Downloads\project\bot\backend`, runs on port 4517. Manage with `taskkill //PID x //F` and `netstat -ano | grep :4517`.
- Persistence via `backend/src/store.js` (`load(name, fallback)` / `save(name, value)`).
- Event bus `backend/src/bus.js` (`emit(type, payload)`, `log(level, msg)`); `server.js` broadcasts every emitted event to all WS clients.
- `DISPERSE_DRY_RUN` env (defaults true) simulates without broadcasting real txs — mirror the existing `DRY_RUN` convention.
- Never log or persist private keys.

---

### Task 1: Add vitest + ethers to the backend

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.js`
- Create: `backend/src/disperse/__tests__/smoke.test.js`

- [ ] **Step 1: Install deps**

Run (in `backend/`): `npm install ethers@^6.17.0` then `npm install -D vitest`

- [ ] **Step 2: Add test script**

In `backend/package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

Create `backend/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Smoke test**

Create `backend/src/disperse/__tests__/smoke.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';

describe('backend disperse setup', () => {
  it('has ethers available', () => {
    expect(ethers.isAddress('0x0000000000000000000000000000000000000000')).toBe(true);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.js backend/src/disperse/__tests__/smoke.test.js
git commit -m "test: add vitest + ethers to backend"
```

---

### Task 2: Disperse config (chains, tokens, contracts, limits)

**Files:**
- Create: `backend/src/disperse/config.js`
- Test: `backend/src/disperse/__tests__/config.test.js`

Single source of truth for chain metadata, curated token addresses, the verified Disperse contract + its expected bytecode hash, per-chain recipient chunk limits, and gas reserves. Served to the frontend via `GET /api/disperse/config` (Task 9).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/config.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  DISPERSE_CHAINS, getDisperseChain, getToken, EVM_CHAIN_IDS,
} from '../config.js';

describe('disperse config', () => {
  it('includes the 7 EVM chains and Solana', () => {
    const ids = DISPERSE_CHAINS.map(c => c.id);
    for (const id of ['eth', 'base', 'arb', 'op', 'polygon', 'bsc', 'avax', 'sol']) {
      expect(ids).toContain(id);
    }
  });

  it('every EVM chain has an rpc, numeric chainId, disperse contract, chunk limit, gas reserve', () => {
    for (const c of DISPERSE_CHAINS.filter(c => c.family === 'evm')) {
      expect(c.rpc).toMatch(/^https?:\/\//);
      expect(typeof c.chainId).toBe('number');
      expect(c.disperseContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(c.disperseBytecodeHash).toBeNull(); // pinned after testnet verification
      expect(c.maxRecipientsPerTx).toBeGreaterThan(0);
      expect(BigInt(c.gasReserveWei)).toBeGreaterThan(0n);
    }
  });

  it('maps EVM chainId numbers back to chain ids', () => {
    expect(EVM_CHAIN_IDS[1]).toBe('eth');
    expect(EVM_CHAIN_IDS[8453]).toBe('base');
  });

  it('looks up chains and native pseudo-token', () => {
    expect(getDisperseChain('eth').symbol).toBe('ETH');
    expect(getDisperseChain('nope')).toBeNull();
    expect(getToken('eth', 'NATIVE')).toEqual({ symbol: 'ETH', address: 'NATIVE', decimals: 18 });
  });

  it('returns known tokens with addresses and decimals', () => {
    const usdc = getToken('eth', 'USDC');
    expect(usdc.address).toMatch(/^0x/);
    expect(usdc.decimals).toBe(6);
    expect(getToken('eth', 'NOPE')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../config.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/config.js`:

```js
// Authoritative disperse config: chains, curated tokens, verified batch
// contract, per-chain limits and gas reserves. Served to the frontend.
//
// disperseContract is the widely-deployed Disperse.app contract, identical
// across EVM chains. bytecodeHash is verified on-chain before use (evm.js).

const DISPERSE_CONTRACT = '0xD152f549545093347A162Dce210e7293f1452150';

export const DISPERSE_CHAINS = [
  { id: 'eth', name: 'Ethereum', family: 'evm', chainId: 1, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_ETH || 'https://eth.llamarpc.com', explorer: 'https://etherscan.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 200, gasReserveWei: '3000000000000000',
    tokens: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    } },
  { id: 'base', name: 'Base', family: 'evm', chainId: 8453, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_BASE || 'https://mainnet.base.org', explorer: 'https://basescan.org',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 300, gasReserveWei: '300000000000000',
    tokens: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    } },
  { id: 'arb', name: 'Arbitrum', family: 'evm', chainId: 42161, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_ARB || 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 300, gasReserveWei: '300000000000000',
    tokens: {
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    } },
  { id: 'op', name: 'Optimism', family: 'evm', chainId: 10, symbol: 'ETH', decimals: 18,
    rpc: process.env.RPC_OP || 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 300, gasReserveWei: '300000000000000',
    tokens: {
      USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      USDT: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    } },
  { id: 'polygon', name: 'Polygon', family: 'evm', chainId: 137, symbol: 'POL', decimals: 18,
    rpc: process.env.RPC_POLYGON || 'https://polygon-rpc.com', explorer: 'https://polygonscan.com',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 300, gasReserveWei: '30000000000000000',
    tokens: {
      USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    } },
  { id: 'bsc', name: 'BSC', family: 'evm', chainId: 56, symbol: 'BNB', decimals: 18,
    rpc: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 300, gasReserveWei: '2000000000000000',
    tokens: {
      USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    } },
  { id: 'avax', name: 'Avalanche', family: 'evm', chainId: 43114, symbol: 'AVAX', decimals: 18,
    rpc: process.env.RPC_AVAX || 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io',
    disperseContract: DISPERSE_CONTRACT, disperseBytecodeHash: null,
    maxRecipientsPerTx: 300, gasReserveWei: '20000000000000000',
    tokens: {
      USDC: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c4a86E', decimals: 6 },
      USDT: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    } },
  { id: 'sol', name: 'Solana', family: 'sol', symbol: 'SOL', decimals: 9,
    rpc: process.env.RPC_SOL || 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io',
    maxRecipientsPerTx: 20, gasReserveLamports: '10000000',
    tokens: {
      USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    } },
];

export const EVM_CHAIN_IDS = Object.fromEntries(
  DISPERSE_CHAINS.filter(c => c.family === 'evm').map(c => [c.chainId, c.id]),
);

export function getDisperseChain(id) {
  return DISPERSE_CHAINS.find(c => c.id === id) || null;
}

// Returns { symbol, address, decimals } or null. 'NATIVE' is the pseudo-token
// for the chain's gas coin.
export function getToken(chainId, symbol) {
  const chain = getDisperseChain(chainId);
  if (!chain) return null;
  if (symbol === 'NATIVE') return { symbol: chain.symbol, address: 'NATIVE', decimals: chain.decimals };
  const t = chain.tokens?.[symbol];
  return t ? { symbol, address: t.address, decimals: t.decimals } : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: config tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/config.js backend/src/disperse/__tests__/config.test.js
git commit -m "feat: disperse chain/token/contract config"
```

---

### Task 3: Recipient + amount validation

**Files:**
- Create: `backend/src/disperse/validate.js`
- Test: `backend/src/disperse/__tests__/validate.test.js`

Pure functions: normalize/validate/dedup recipients (EVM checksum + Solana base58), and compute per-recipient amounts for the three modes (equal, custom, total-split) as BigInt base units.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/validate.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseRecipients, computeAmounts } from '../validate.js';

describe('parseRecipients (evm)', () => {
  const A = '0x1111111111111111111111111111111111111111';
  const B = '0x2222222222222222222222222222222222222222';

  it('normalizes, dedups, and flags bad rows', () => {
    const dup = A.slice(0, 2) + A.slice(2).toLowerCase(); // lowercase body = different checksum
    const text = `${A}\nnot-an-address\n${dup}\n${B}`;
    const { recipients, errors } = parseRecipients(text, 'evm');
    expect(recipients.map(r => r.address)).toEqual([A, B]); // checksummed, deduped
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });

  it('parses "address, amount" custom lines', () => {
    const text = `${A}, 1.5\n${B},2`;
    const { recipients, errors } = parseRecipients(text, 'evm');
    expect(errors).toEqual([]);
    expect(recipients).toEqual([
      { address: A, amount: '1.5' },
      { address: B, amount: '2' },
    ]);
  });

  it('rejects a negative or zero custom amount', () => {
    const text = `${A}, -1\n${B}, 0`;
    const { errors } = parseRecipients(text, 'evm');
    expect(errors).toHaveLength(2);
  });
});

describe('parseRecipients (sol)', () => {
  it('accepts base58 pubkeys and rejects evm addresses', () => {
    const sol = 'So11111111111111111111111111111111111111112';
    const { recipients, errors } = parseRecipients(
      `${sol}\n0x1111111111111111111111111111111111111111`, 'sol');
    expect(recipients.map(r => r.address)).toEqual([sol]);
    expect(errors).toHaveLength(1);
  });
});

describe('computeAmounts', () => {
  const recips = [{ address: 'a' }, { address: 'b' }, { address: 'c' }];

  it('equal mode gives each the same base-unit amount', () => {
    const out = computeAmounts({ mode: 'equal', perRecipient: '1.5', decimals: 6, recipients: recips });
    expect(out.amounts).toEqual([1500000n, 1500000n, 1500000n]);
    expect(out.total).toBe(4500000n);
  });

  it('total-split divides evenly with remainder to the last recipient', () => {
    const out = computeAmounts({ mode: 'total', total: '1', decimals: 6, recipients: recips });
    // 1_000_000 / 3 = 333_333 each, remainder 1 to last
    expect(out.amounts).toEqual([333333n, 333333n, 333334n]);
    expect(out.total).toBe(1000000n);
  });

  it('custom mode uses each recipient amount', () => {
    const custom = [{ address: 'a', amount: '1' }, { address: 'b', amount: '2.5' }];
    const out = computeAmounts({ mode: 'custom', decimals: 6, recipients: custom });
    expect(out.amounts).toEqual([1000000n, 2500000n]);
    expect(out.total).toBe(3500000n);
  });

  it('throws on empty recipients', () => {
    expect(() => computeAmounts({ mode: 'equal', perRecipient: '1', decimals: 6, recipients: [] }))
      .toThrow(/no recipients/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../validate.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/validate.js`:

```js
// Recipient parsing/validation and amount math. Amounts are returned as
// BigInt base units so no float rounding reaches the chain.
import { ethers } from 'ethers';
import bs58 from 'bs58';

function isValidSol(addr) {
  try {
    return bs58.decode(addr).length === 32;
  } catch {
    return false;
  }
}

// text: one recipient per line, either "address" or "address, amount".
// family: 'evm' | 'sol'. Returns { recipients:[{address, amount?}], errors:[{line,message}] }.
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
      if (!ethers.isAddress(rawAddr)) {
        errors.push({ line: i + 1, message: 'Invalid EVM address' });
        return;
      }
      address = ethers.getAddress(rawAddr); // checksum
    } else {
      if (!isValidSol(rawAddr)) {
        errors.push({ line: i + 1, message: 'Invalid Solana address' });
        return;
      }
      address = rawAddr;
    }

    if (seen.has(address)) return; // silent dedup
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

// Parses a human decimal string into BigInt base units for `decimals`.
function toBaseUnits(value, decimals) {
  return ethers.parseUnits(String(value), decimals);
}

// mode: 'equal' (perRecipient) | 'total' (total, split evenly) | 'custom' (recipient.amount).
// Returns { amounts: BigInt[], total: BigInt } aligned with recipients order.
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: validate tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/validate.js backend/src/disperse/__tests__/validate.test.js
git commit -m "feat: recipient validation and amount computation"
```

---

### Task 4: EVM chain adapter

**Files:**
- Create: `backend/src/disperse/evm.js`
- Test: `backend/src/disperse/__tests__/evm.test.js`

Responsibilities: build a provider/signer from a chain + key, fetch token metadata + balances, verify the Disperse contract bytecode hash before use, and expose `disperseNative` / `disperseToken` that return tx hashes. Network calls are injected as a `provider` so tests can mock them.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/evm.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { ethers } from 'ethers';
import { computeGasReserveShortfall, chunkRecipients, verifyDisperseContract } from '../evm.js';

describe('chunkRecipients', () => {
  it('splits into chunks of at most maxPerTx, preserving order', () => {
    const recips = Array.from({ length: 5 }, (_, i) => ({ address: `0x${i}` }));
    const amounts = [1n, 2n, 3n, 4n, 5n];
    const chunks = chunkRecipients(recips, amounts, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].recipients.map(r => r.address)).toEqual(['0x0', '0x1']);
    expect(chunks[0].amounts).toEqual([1n, 2n]);
    expect(chunks[2].amounts).toEqual([5n]);
  });
});

describe('computeGasReserveShortfall', () => {
  it('returns 0n when native balance covers send total + reserve', () => {
    const short = computeGasReserveShortfall({
      isNativeAsset: true, nativeBalance: 10n, sendTotal: 5n, gasReserve: 2n,
    });
    expect(short).toBe(0n);
  });

  it('reports the shortfall for a native send that leaves no gas', () => {
    const short = computeGasReserveShortfall({
      isNativeAsset: true, nativeBalance: 6n, sendTotal: 5n, gasReserve: 2n,
    });
    expect(short).toBe(1n); // need 7, have 6
  });

  it('for a token send only requires the gas reserve in native', () => {
    expect(computeGasReserveShortfall({
      isNativeAsset: false, nativeBalance: 1n, sendTotal: 999n, gasReserve: 2n,
    })).toBe(1n);
    expect(computeGasReserveShortfall({
      isNativeAsset: false, nativeBalance: 5n, sendTotal: 999n, gasReserve: 2n,
    })).toBe(0n);
  });
});

describe('verifyDisperseContract', () => {
  it('passes when on-chain code hash matches the expected hash', async () => {
    const code = '0x6080604052';
    const provider = { getCode: vi.fn().mockResolvedValue(code) };
    const expected = ethers.keccak256(code);
    await expect(verifyDisperseContract(provider, '0xcontract', expected)).resolves.toBe(true);
  });

  it('throws when the address has no code', async () => {
    const provider = { getCode: vi.fn().mockResolvedValue('0x') };
    await expect(verifyDisperseContract(provider, '0xcontract', '0xabc'))
      .rejects.toThrow(/no contract/i);
  });

  it('throws on a bytecode hash mismatch', async () => {
    const provider = { getCode: vi.fn().mockResolvedValue('0x6080') };
    await expect(verifyDisperseContract(provider, '0xcontract', '0xdifferent'))
      .rejects.toThrow(/bytecode/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../evm.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/evm.js`:

```js
// EVM disperse adapter. Pure helpers (chunking, gas math, contract
// verification) are exported for tests; the send functions take an
// ethers Signer so callers control key handling.
import { ethers } from 'ethers';

export const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const DISPERSE_ABI = [
  'function disperseEther(address[] recipients, uint256[] values) payable',
  'function disperseToken(address token, address[] recipients, uint256[] values)',
];

export function makeProvider(chain) {
  return new ethers.JsonRpcProvider(chain.rpc, chain.chainId);
}

export function makeSigner(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider);
}

// Splits recipients+amounts into chunks of at most maxPerTx, preserving order.
export function chunkRecipients(recipients, amounts, maxPerTx) {
  const chunks = [];
  for (let i = 0; i < recipients.length; i += maxPerTx) {
    chunks.push({
      recipients: recipients.slice(i, i + maxPerTx),
      amounts: amounts.slice(i, i + maxPerTx),
    });
  }
  return chunks;
}

// Returns the missing native amount (BigInt), or 0n if fully funded.
export function computeGasReserveShortfall({ isNativeAsset, nativeBalance, sendTotal, gasReserve }) {
  const needed = isNativeAsset ? sendTotal + gasReserve : gasReserve;
  const short = needed - nativeBalance;
  return short > 0n ? short : 0n;
}

// Verifies the deployed bytecode hash matches the expected value.
export async function verifyDisperseContract(provider, address, expectedHash) {
  const code = await provider.getCode(address);
  if (!code || code === '0x') throw new Error(`No contract deployed at ${address}`);
  const hash = ethers.keccak256(code);
  if (hash.toLowerCase() !== String(expectedHash).toLowerCase()) {
    throw new Error(`Disperse contract bytecode mismatch at ${address}`);
  }
  return true;
}

// Sends one native-coin disperse chunk. Returns the tx hash.
export async function disperseNativeChunk(signer, chain, chunk) {
  const contract = new ethers.Contract(chain.disperseContract, DISPERSE_ABI, signer);
  const value = chunk.amounts.reduce((a, b) => a + b, 0n);
  const tx = await contract.disperseEther(
    chunk.recipients.map(r => r.address), chunk.amounts, { value });
  await tx.wait();
  return tx.hash;
}

// Ensures an exact-amount allowance (or unlimited if opted in), then sends one
// token disperse chunk. Returns { approveHash?, disperseHash }.
export async function disperseTokenChunk(signer, chain, tokenAddress, chunk, {
  totalNeeded, allowUnlimited = false,
}) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const owner = await signer.getAddress();
  const current = await token.allowance(owner, chain.disperseContract);
  let approveHash;
  if (current < totalNeeded) {
    if (current > 0n) {
      const reset = await token.approve(chain.disperseContract, 0n);
      await reset.wait();
    }
    const amount = allowUnlimited ? ethers.MaxUint256 : totalNeeded;
    const approve = await token.approve(chain.disperseContract, amount);
    await approve.wait();
    approveHash = approve.hash;
  }
  const contract = new ethers.Contract(chain.disperseContract, DISPERSE_ABI, signer);
  const tx = await contract.disperseToken(
    tokenAddress, chunk.recipients.map(r => r.address), chunk.amounts);
  await tx.wait();
  return { approveHash, disperseHash: tx.hash };
}

// Fetches native balance + (for tokens) token balance/decimals.
export async function fetchEvmBalances(provider, address, tokenAddress) {
  const nativeBalance = await provider.getBalance(address);
  if (!tokenAddress || tokenAddress === 'NATIVE') {
    return { nativeBalance, tokenBalance: null, decimals: 18 };
  }
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [tokenBalance, decimals] = await Promise.all([
    token.balanceOf(address), token.decimals(),
  ]);
  return { nativeBalance, tokenBalance, decimals: Number(decimals) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: evm tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/evm.js backend/src/disperse/__tests__/evm.test.js
git commit -m "feat: EVM disperse adapter"
```

---

### Task 5: Solana chain adapter

**Files:**
- Create: `backend/src/disperse/solana.js`
- Test: `backend/src/disperse/__tests__/solana.test.js`

Responsibilities: keypair from base58, chunking (reuse limit), and building/sending batched native SOL + SPL transfers. Only the pure helper (`chunkRecipients` reuse + `lamportsFromSol`) is unit-tested; send functions are integration-tested against devnet in the manual pass (Task 12).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/solana.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { keypairFromBase58, baseUnits } from '../solana.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

describe('solana adapter helpers', () => {
  it('loads a keypair from a base58 secret key', () => {
    const kp = nacl.sign.keyPair();
    const loaded = keypairFromBase58(bs58.encode(kp.secretKey));
    expect(loaded.publicKey.toBase58()).toBe(bs58.encode(kp.publicKey));
  });

  it('throws on an invalid secret key', () => {
    expect(() => keypairFromBase58('nope')).toThrow();
  });

  it('converts human amounts to base units', () => {
    expect(baseUnits('1.5', 6)).toBe(1500000n);
    expect(baseUnits('0.000000001', 9)).toBe(1n);
  });
});
```

- [ ] **Step 2: Install tweetnacl on backend (for the test + keygen)**

Run (in `backend/`): `npm install tweetnacl`

- [ ] **Step 3: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../solana.js`.

- [ ] **Step 4: Implement**

Create `backend/src/disperse/solana.js`:

```js
// Solana disperse adapter: native SOL + SPL token batched transfers.
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress, createTransferInstruction,
  createAssociatedTokenAccountInstruction, getAccount,
} from '@solana/spl-token';
import { ethers } from 'ethers';
import bs58 from 'bs58';

export function makeConnection(chain) {
  return new Connection(chain.rpc, 'confirmed');
}

export function keypairFromBase58(secret) {
  return Keypair.fromSecretKey(bs58.decode(String(secret).trim()));
}

// Human decimal -> BigInt base units (ethers.parseUnits handles the math).
export function baseUnits(value, decimals) {
  return ethers.parseUnits(String(value), decimals);
}

// Sends one native SOL chunk (System transfers) in a single tx. Returns signature.
export async function disperseNativeChunk(connection, payer, chunk) {
  const tx = new Transaction();
  chunk.recipients.forEach((r, i) => {
    tx.add(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(r.address),
      lamports: Number(chunk.amounts[i]),
    }));
  });
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

// Sends one SPL token chunk. Creates missing recipient ATAs. Returns signature.
export async function disperseTokenChunk(connection, payer, mintAddress, chunk) {
  const mint = new PublicKey(mintAddress);
  const source = await getAssociatedTokenAddress(mint, payer.publicKey);
  const tx = new Transaction();
  for (let i = 0; i < chunk.recipients.length; i++) {
    const dest = new PublicKey(chunk.recipients[i].address);
    const destAta = await getAssociatedTokenAddress(mint, dest);
    try {
      await getAccount(connection, destAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, destAta, dest, mint));
    }
    tx.add(createTransferInstruction(source, destAta, payer.publicKey, Number(chunk.amounts[i])));
  }
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
```

- [ ] **Step 5: Install spl-token**

Run (in `backend/`): `npm install @solana/spl-token`

- [ ] **Step 6: Run to verify pass**

Run: `npm test`
Expected: solana helper tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/disperse/solana.js backend/src/disperse/__tests__/solana.test.js
git commit -m "feat: Solana disperse adapter"
```

---

### Task 6: Plan builder

**Files:**
- Create: `backend/src/disperse/plan.js`
- Test: `backend/src/disperse/__tests__/plan.test.js`

`buildPlan(input, deps)` validates everything, computes amounts, checks gas-reserve, chunks recipients, and returns an immutable plan object (no keys, no network sends). Balances/decimals are supplied via an injected `deps.fetchBalances` so it's testable without RPC.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/plan.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildPlan } from '../plan.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';

function evmDeps({ nativeBalance = 10n ** 18n, tokenBalance = 10n ** 12n, decimals = 6 } = {}) {
  return {
    fetchBalances: async () => ({ nativeBalance, tokenBalance, decimals }),
  };
}

describe('buildPlan (same-chain EVM)', () => {
  it('builds a native equal-mode plan with chunks and totals', async () => {
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: `${A}\n${B}`,
      amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps());
    expect(plan.crossChain).toBe(false);
    expect(plan.isNativeAsset).toBe(true);
    expect(plan.recipients).toHaveLength(2);
    expect(plan.perSender[0].chunks.length).toBeGreaterThanOrEqual(1);
    expect(BigInt(plan.perSender[0].totalBaseUnits)).toBe(2000000000000000n);
  });

  it('consolidation mode assigns full list to one sender when senders > recipients', async () => {
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A, B, C], recipientsText: A,
      amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps());
    expect(plan.pairingMode).toBe('consolidation');
    expect(plan.perSender).toHaveLength(3);
    expect(plan.perSender[0].chunks[0].recipients).toHaveLength(1);
    expect(plan.perSender[1].chunks).toHaveLength(0);
    expect(plan.perSender[2].chunks).toHaveLength(0);
  });

  it('pairing mode round-robins recipients across senders', async () => {
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A, B], recipientsText: `${A}\n${B}\n${C}`,
      amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps());
    expect(plan.pairingMode).toBe('pairing');
    expect(plan.perSender).toHaveLength(2);
    const allRecipients = plan.perSender.flatMap(ps =>
      ps.chunks.flatMap(c => c.recipients.map(r => r.address)));
    expect(allRecipients).toHaveLength(3);
  });

  it('rejects when native balance cannot cover send + gas reserve', async () => {
    await expect(buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: A,
      amountMode: 'equal', perRecipient: '1000',
    }, evmDeps({ nativeBalance: 1n }))).rejects.toThrow(/insufficient|shortfall|gas/i);
  });

  it('rejects an unknown chain', async () => {
    await expect(buildPlan({
      sourceChain: 'nope', destChain: 'nope', asset: 'NATIVE',
      senders: [A], recipientsText: A, amountMode: 'equal', perRecipient: '1',
    }, evmDeps())).rejects.toThrow(/chain/i);
  });

  it('rejects when there are no valid recipients', async () => {
    await expect(buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: 'garbage', amountMode: 'equal', perRecipient: '1',
    }, evmDeps())).rejects.toThrow(/recipient/i);
  });

  it('flags cross-chain as unsupported in this plan (deferred to bridge plan)', async () => {
    await expect(buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: A, amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps())).rejects.toThrow(/cross-chain/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../plan.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/plan.js`:

```js
// Builds an immutable, key-free execution plan. Cross-chain (source != dest)
// is rejected here; Plan 3 (LI.FI bridge) replaces that guard.
import { getDisperseChain, getToken } from './config.js';
import { parseRecipients, computeAmounts } from './validate.js';
import { chunkRecipients, computeGasReserveShortfall } from './evm.js';

// Assigns recipients to senders. 'consolidation' if senders > recipients (only
// first sender works, others get empty chunks). 'pairing' otherwise:
// recipients are round-robin assigned so each sender covers roughly
// recipients.length / senders.length addresses.
export function assignRecipients(senders, recipients) {
  if (senders.length === 1) {
    return { pairingMode: 'single', assignments: [{ sender: senders[0], recipients }] };
  }
  if (senders.length >= recipients.length) {
    return {
      pairingMode: 'consolidation',
      assignments: senders.map((sender, i) => ({
        sender, recipients: i === 0 ? recipients : [],
      })),
    };
  }
  const assignments = senders.map(sender => ({ sender, recipients: [] }));
  recipients.forEach((r, i) => { assignments[i % senders.length].recipients.push(r); });
  return { pairingMode: 'pairing', assignments };
}

export async function buildPlan(input, deps) {
  const {
    sourceChain, destChain, asset, senders, recipientsText,
    amountMode, perRecipient, total, allowUnlimited = false,
  } = input;

  const chain = getDisperseChain(sourceChain);
  if (!chain) throw new Error(`Unknown chain: ${sourceChain}`);
  if (destChain && destChain !== sourceChain) {
    throw new Error('Cross-chain disperse requires the bridge (not available in this build)');
  }
  if (!senders || senders.length === 0) throw new Error('At least one sender is required');

  const token = getToken(sourceChain, asset);
  if (!token) throw new Error(`Asset ${asset} not available on ${chain.name}`);
  const isNativeAsset = token.address === 'NATIVE';

  const { recipients, errors } = parseRecipients(recipientsText, chain.family);
  if (recipients.length === 0) throw new Error('No valid recipients');

  const maxPerTx = chain.maxRecipientsPerTx;
  const gasReserve = BigInt(chain.family === 'sol' ? chain.gasReserveLamports : chain.gasReserveWei);

  const { pairingMode, assignments } = assignRecipients(senders, recipients);

  const perSender = [];
  for (const { sender, recipients: senderRecipients } of assignments) {
    const balances = await deps.fetchBalances({
      chain, address: sender, tokenAddress: token.address, isNativeAsset,
    });
    const decimals = isNativeAsset ? chain.decimals : balances.decimals;

    if (senderRecipients.length === 0) {
      perSender.push({ sender, decimals, totalBaseUnits: '0', chunks: [] });
      continue;
    }

    const { amounts, total: sendTotal } = computeAmounts({
      mode: amountMode, perRecipient, total, decimals, recipients: senderRecipients,
    });

    const shortfall = computeGasReserveShortfall({
      isNativeAsset,
      nativeBalance: balances.nativeBalance,
      sendTotal: isNativeAsset ? sendTotal : 0n,
      gasReserve,
    });
    if (shortfall > 0n) {
      throw new Error(`Sender ${sender}: insufficient native balance for send + gas reserve (short ${shortfall} wei)`);
    }
    if (!isNativeAsset && balances.tokenBalance != null && balances.tokenBalance < sendTotal) {
      throw new Error(`Sender ${sender}: insufficient ${token.symbol} balance`);
    }

    const chunks = chunkRecipients(senderRecipients, amounts, maxPerTx).map(c => ({
      recipients: c.recipients,
      amounts: c.amounts.map(a => a.toString()),
    }));
    perSender.push({
      sender,
      decimals,
      totalBaseUnits: sendTotal.toString(),
      chunks,
    });
  }

  return Object.freeze({
    crossChain: false,
    sourceChain, destChain: sourceChain,
    family: chain.family,
    asset: token.symbol,
    tokenAddress: token.address,
    isNativeAsset,
    allowUnlimited,
    amountMode,
    pairingMode,
    recipients,
    recipientCount: recipients.length,
    perSender,
    validationErrors: errors,
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: plan tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/plan.js backend/src/disperse/__tests__/plan.test.js
git commit -m "feat: disperse plan builder"
```

---

### Task 7: Job runner (state machine, persistence, key handling)

**Files:**
- Create: `backend/src/disperse/jobRunner.js`
- Test: `backend/src/disperse/__tests__/jobRunner.test.js`

Owns the job lifecycle: create from a plan, run steps serially per sender, mark per-recipient results, persist to `store.js`, emit progress on the bus, and retry only failed recipients. Chain sends are injected as `deps.execChunk` so the state machine is tested without a chain. Decrypted keys are held in a module-level `Map` keyed by jobId and deleted on completion/error.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/jobRunner.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock persistence + bus so the runner is pure in tests.
const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

const fakePlan = () => ({
  crossChain: false, sourceChain: 'base', destChain: 'base', family: 'evm',
  asset: 'NATIVE', tokenAddress: 'NATIVE', isNativeAsset: true, amountMode: 'equal',
  recipients: [{ address: '0xA' }, { address: '0xB' }],
  recipientCount: 2,
  perSender: [{
    sender: '0xSender', decimals: 18, totalBaseUnits: '2',
    chunks: [{ recipients: [{ address: '0xA' }, { address: '0xB' }], amounts: ['1', '1'] }],
  }],
  validationErrors: [],
});

describe('jobRunner', () => {
  let runner;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
    runner = await import('../jobRunner.js');
  });

  it('creates a job in planned status', () => {
    const job = runner.createJob(fakePlan());
    expect(job.status).toBe('planned');
    expect(job.recipients).toHaveLength(2);
    expect(job.recipients.every(r => r.status === 'pending')).toBe(true);
    expect(runner.getJob(job.id)).toBeTruthy();
  });

  it('runs to completed when every chunk succeeds', async () => {
    const job = runner.createJob(fakePlan());
    const execChunk = vi.fn().mockResolvedValue({ disperseHash: '0xhash' });
    await runner.executeJob(job.id, { '0xSender': '0xKEY' }, { execChunk });
    const done = runner.getJob(job.id);
    expect(done.status).toBe('completed');
    expect(done.recipients.every(r => r.status === 'sent')).toBe(true);
    expect(done.recipients[0].txHash).toBe('0xhash');
    expect(execChunk).toHaveBeenCalledTimes(1);
  });

  it('marks failed when every chunk fails', async () => {
    const job = runner.createJob(fakePlan());
    const execChunk = vi.fn().mockRejectedValue(new Error('rpc boom'));
    await runner.executeJob(job.id, { '0xSender': '0xKEY' }, { execChunk });
    const res = runner.getJob(job.id);
    expect(res.status).toBe('failed');
    expect(res.recipients.every(r => r.status === 'failed')).toBe(true);
    expect(res.recipients[0].error).toMatch(/boom/);
  });

  it('wipes keys from memory after execution', async () => {
    const job = runner.createJob(fakePlan());
    await runner.executeJob(job.id, { '0xSender': '0xKEY' },
      { execChunk: vi.fn().mockResolvedValue({ disperseHash: '0xh' }) });
    expect(runner._hasKeys(job.id)).toBe(false);
  });

  it('retry re-runs only failed recipients', async () => {
    const job = runner.createJob(fakePlan());
    const failing = vi.fn().mockRejectedValue(new Error('down'));
    await runner.executeJob(job.id, { '0xSender': '0xKEY' }, { execChunk: failing });
    expect(runner.getJob(job.id).status).toBe('partial');

    const ok = vi.fn().mockResolvedValue({ disperseHash: '0xretry' });
    await runner.retryJob(job.id, { '0xSender': '0xKEY' }, { execChunk: ok });
    const res = runner.getJob(job.id);
    expect(res.status).toBe('completed');
    expect(res.recipients[0].txHash).toBe('0xretry');
    expect(ok).toHaveBeenCalledTimes(1); // only the failed chunk retried
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../jobRunner.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/jobRunner.js`:

```js
// Disperse job state machine + persistence. Keys arrive per-execute call and
// live only in `keyStore` (module memory), wiped on completion/error.
import { load, save } from '../store.js';
import { emit, log } from '../bus.js';

const STORE = 'disperse-jobs';
const keyStore = new Map(); // jobId -> { [sender]: privateKey }

function loadJobs() { return load(STORE, []); }
function persist(jobs) { save(STORE, jobs); }

export function getJob(id) {
  return loadJobs().find(j => j.id === id) || null;
}

export function listJobs() {
  return loadJobs().map(({ ...j }) => j);
}

function upsert(job) {
  const jobs = loadJobs();
  const i = jobs.findIndex(j => j.id === job.id);
  if (i >= 0) jobs[i] = job; else jobs.unshift(job);
  persist(jobs);
  emit('disperse:job', { job });
  return job;
}

// Persist only at phase boundaries (not every chunk) to avoid I/O storms
// on large jobs. Called from runChunks after each sender completes.
function persistPhase(job) {
  upsert(job);
}

// Flattens a plan into a job with per-recipient tracking rows.
// Deep-clones the plan so runtime mutations (bridge status, recomputed amounts)
// don't destroy the original planned-vs-executed audit trail.
export function createJob(plan) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const planCopy = JSON.parse(JSON.stringify(plan));
  const recipients = [];
  plan.perSender.forEach((ps, si) => {
    ps.chunks.forEach((chunk, ci) => {
      chunk.recipients.forEach((r, ri) => {
        recipients.push({
          sender: ps.sender, senderIndex: si, chunkIndex: ci, indexInChunk: ri,
          address: r.address, amount: chunk.amounts[ri],
          status: 'pending', txHash: null, error: null,
        });
      });
    });
  });
  const job = {
    id, createdAt: Date.now(), status: 'planned',
    source: { chain: plan.sourceChain, asset: plan.asset, senders: plan.perSender.map(p => p.sender) },
    dest: { chain: plan.destChain, asset: plan.asset },
    plan: planCopy, recipients,
  };
  return upsert(job);
}

function rollupStatus(job) {
  const statuses = job.recipients.map(r => r.status);
  if (statuses.every(s => s === 'sent')) return 'completed';
  if (statuses.some(s => s === 'sent') && statuses.some(s => s === 'failed')) return 'partial';
  if (statuses.every(s => s === 'failed')) return 'failed';
  return 'running';
}

// Runs the given chunks. `filter` decides which recipients to (re)send.
async function runChunks(job, keys, deps, filter) {
  job.status = 'running';
  upsert(job);
  for (const ps of job.plan.perSender) {
    const key = keys[ps.sender];
    for (let ci = 0; ci < ps.chunks.length; ci++) {
      const chunk = ps.chunks[ci];
      const rows = job.recipients.filter(
        r => r.sender === ps.sender && r.chunkIndex === ci && filter(r));
      if (rows.length === 0) continue;
      try {
        const result = await deps.execChunk({
          plan: job.plan, sender: ps.sender, privateKey: key, chunkIndex: ci, chunk,
        });
        for (const r of rows) { r.status = 'sent'; r.txHash = result.disperseHash; r.error = null; }
      } catch (err) {
        for (const r of rows) { r.status = 'failed'; r.error = err.message; }
        log('error', `Disperse chunk failed (${job.id})`, { error: err.message });
      }
      job.status = rollupStatus(job);
      upsert(job);
    }
  }
  job.status = rollupStatus(job);
  return upsert(job);
}

export async function executeJob(id, keys, deps) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  keyStore.set(id, keys);
  try {
    return await runChunks(job, keys, deps, () => true);
  } finally {
    keyStore.delete(id); // never persist keys
  }
}

export async function retryJob(id, keys, deps) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  keyStore.set(id, keys);
  try {
    // Reset failed rows to pending, then re-run only those.
    job.recipients.forEach(r => { if (r.status === 'failed') { r.status = 'pending'; r.error = null; } });
    upsert(job);
    return await runChunks(job, keys, deps, r => r.status === 'pending');
  } finally {
    keyStore.delete(id);
  }
}

// Records an externally-signed (MetaMask) chunk result into the job.
export function recordExternalChunk(id, { sender, chunkIndex, disperseHash, error }) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const rows = job.recipients.filter(r => r.sender === sender && r.chunkIndex === chunkIndex);
  for (const r of rows) {
    if (error) { r.status = 'failed'; r.error = error; }
    else { r.status = 'sent'; r.txHash = disperseHash; r.error = null; }
  }
  job.status = rollupStatus(job);
  return upsert(job);
}

// Test-only helper.
export function _hasKeys(id) { return keyStore.has(id); }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: jobRunner tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/jobRunner.js backend/src/disperse/__tests__/jobRunner.test.js
git commit -m "feat: disperse job runner state machine"
```

---

### Task 8: execChunk wiring (real chain execution + DRY_RUN)

**Files:**
- Create: `backend/src/disperse/execute.js`
- Test: `backend/src/disperse/__tests__/execute.test.js`

Bridges the job runner's injected `execChunk` to the real adapters, honoring `DISPERSE_DRY_RUN`. In dry-run it returns a fake hash without touching the chain.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/execute.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('makeExecChunk (dry run)', () => {
  beforeEach(() => vi.resetModules());

  it('returns a simulated hash without sending when dry run is on', async () => {
    process.env.DISPERSE_DRY_RUN = 'true';
    const { makeExecChunk } = await import('../execute.js');
    const execChunk = makeExecChunk();
    const result = await execChunk({
      plan: { sourceChain: 'base', family: 'evm', isNativeAsset: true, tokenAddress: 'NATIVE' },
      sender: '0xS', privateKey: '0xKEY', chunkIndex: 0,
      chunk: { recipients: [{ address: '0xA' }], amounts: ['1'] },
    });
    expect(result.disperseHash).toMatch(/^0xDRYRUN/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../execute.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/execute.js`:

```js
// Wires the job runner's execChunk hook to the real chain adapters.
// Honors DISPERSE_DRY_RUN (default true) — no chain writes when set.
import { getDisperseChain } from './config.js';
import * as evm from './evm.js';
import * as sol from './solana.js';

function isDryRun() {
  return process.env.DISPERSE_DRY_RUN !== 'false';
}

export function makeExecChunk() {
  return async function execChunk({ plan, sender, privateKey, chunk }) {
    if (isDryRun()) {
      return { disperseHash: `0xDRYRUN_${Math.random().toString(16).slice(2, 10)}` };
    }
    // For cross-chain, disperse runs on the destination chain.
    const chain = getDisperseChain(plan.destChain || plan.sourceChain);
    if (chain.family === 'evm') {
      const provider = evm.makeProvider(chain);
      if (chain.disperseBytecodeHash) {
        await evm.verifyDisperseContract(
          provider, chain.disperseContract, chain.disperseBytecodeHash);
      } else {
        // Fail closed: no pinned hash = abort. This prevents a malicious RPC
        // or wrong address from self-verifying on first use. After testnet
        // verification, pin the keccak256 of the confirmed bytecode in config.js.
        throw new Error(`Bytecode hash not pinned for ${chain.name}. Run testnet verification and set disperseBytecodeHash in config.js.`);
      }
      const signer = evm.makeSigner(privateKey, provider);
      const amounts = chunk.amounts.map(a => BigInt(a));
      const typedChunk = { recipients: chunk.recipients, amounts };
      if (plan.isNativeAsset) {
        return { disperseHash: await evm.disperseNativeChunk(signer, chain, typedChunk) };
      }
      const totalNeeded = amounts.reduce((a, b) => a + b, 0n);
      return evm.disperseTokenChunk(signer, chain, plan.tokenAddress, typedChunk,
        { totalNeeded, allowUnlimited: plan.allowUnlimited });
    }
    // Solana
    const connection = sol.makeConnection(chain);
    const payer = sol.keypairFromBase58(privateKey);
    const amounts = chunk.amounts.map(a => BigInt(a));
    const typedChunk = { recipients: chunk.recipients, amounts };
    const sig = plan.isNativeAsset
      ? await sol.disperseNativeChunk(connection, payer, typedChunk)
      : await sol.disperseTokenChunk(connection, payer, plan.tokenAddress, typedChunk);
    return { disperseHash: sig };
  };
}
```

Note: after testnet verification, pin the real `disperseBytecodeHash` per chain in `config.js` (keccak256 of the confirmed runtime bytecode). Until then, dry-run mode bypasses this check. For production, add a sequential-transfer fallback (send individually without the contract) as a circuit breaker if bytecode verification fails.

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: execute test PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/execute.js backend/src/disperse/__tests__/execute.test.js
git commit -m "feat: execChunk wiring with DRY_RUN"
```

---

### Task 9: REST routes + balance-fetch dep

**Files:**
- Create: `backend/src/disperse/routes.js`
- Modify: `backend/server.js`

Endpoints: `GET /api/disperse/config`, `POST /api/disperse/plan`, `POST /api/disperse/execute`, `POST /api/disperse/:id/retry`, `POST /api/disperse/:id/external-chunk`, `GET /api/disperse/jobs`, `GET /api/disperse/jobs/:id`.

- [ ] **Step 1: Create the routes module**

Create `backend/src/disperse/routes.js`:

```js
// Express router for disperse. Mounted at /api/disperse in server.js.
import { Router } from 'express';
import { DISPERSE_CHAINS, getDisperseChain } from './config.js';
import { buildPlan } from './plan.js';
import * as evm from './evm.js';
import * as runner from './jobRunner.js';
import { makeExecChunk } from './execute.js';

const execChunk = makeExecChunk();

// Balance fetcher injected into buildPlan.
async function fetchBalances({ chain, address, tokenAddress, isNativeAsset }) {
  if (chain.family === 'evm') {
    const provider = evm.makeProvider(chain);
    return evm.fetchEvmBalances(provider, address, isNativeAsset ? 'NATIVE' : tokenAddress);
  }
  // Solana: native lamports + SPL token balance/decimals via getToken metadata.
  const { Connection, PublicKey } = await import('@solana/web3.js');
  const conn = new Connection(chain.rpc, 'confirmed');
  const lamports = await conn.getBalance(new PublicKey(address));
  if (isNativeAsset) {
    return { nativeBalance: BigInt(lamports), tokenBalance: null, decimals: chain.decimals };
  }
  const { getAccount, getAssociatedTokenAddress } = await import('@solana/spl-token');
  const tokenMeta = chain.tokens?.[asset]; // asset symbol from config
  const decimals = tokenMeta?.decimals ?? 6;
  try {
    const mint = new PublicKey(tokenAddress);
    const ata = await getAssociatedTokenAddress(mint, new PublicKey(address));
    const account = await getAccount(conn, ata);
    return { nativeBalance: BigInt(lamports), tokenBalance: BigInt(account.amount), decimals };
  } catch {
    return { nativeBalance: BigInt(lamports), tokenBalance: 0n, decimals };
  }
}

export function createDisperseRouter() {
  const router = Router();
  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ error: err.message }));

  router.get('/config', (req, res) => {
    res.json({
      dryRun: process.env.DISPERSE_DRY_RUN !== 'false',
      chains: DISPERSE_CHAINS.map(c => ({
        id: c.id, name: c.name, family: c.family, symbol: c.symbol,
        chainId: c.chainId, explorer: c.explorer, maxRecipientsPerTx: c.maxRecipientsPerTx,
        disperseContract: c.disperseContract,
        tokens: Object.keys(c.tokens || {}),
      })),
    });
  });

  router.post('/plan', wrap(async (req, res) => {
    const plan = await buildPlan(req.body || {}, { fetchBalances });
    res.json({ plan });
  }));

  router.post('/execute', wrap(async (req, res) => {
    const { plan, keys } = req.body || {};
    if (!plan) throw new Error('plan is required');
    const isExternal = !keys || Object.keys(keys).length === 0;
    if (isExternal) {
      // MetaMask path: create the job in planned state; the browser signs chunks
      // and reports results via /external-chunk. No backend execution.
      const job = runner.createJob(plan);
      return res.json({ jobId: job.id, job });
    }
    if (process.env.DISPERSE_DRY_RUN === 'false') {
      // Live stored-wallet path: keys required
      if (!keys) throw new Error('keys are required for live execution');
    }
    const job = runner.createJob(plan);
    runner.executeJob(job.id, keys, { execChunk })
      .catch(() => { /* status already reflected on the job */ });
    res.json({ jobId: job.id, job });
  }));

  router.post('/:id/retry', wrap(async (req, res) => {
    const { keys } = req.body || {};
    runner.retryJob(req.params.id, keys || {}, { execChunk })
      .catch(() => {});
    res.json({ ok: true });
  }));

  router.post('/:id/external-chunk', wrap((req, res) => {
    const job = runner.recordExternalChunk(req.params.id, req.body || {});
    res.json({ job });
  }));

  router.get('/jobs', (req, res) => res.json({ jobs: runner.listJobs() }));
  router.get('/jobs/:id', (req, res) => {
    const job = runner.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  });

  return router;
}

export { getDisperseChain };
```

- [ ] **Step 2: Mount the router in server.js**

In `backend/server.js`, after the existing imports add:

```js
import { createDisperseRouter } from './src/disperse/routes.js';
```

After `app.use(express.json());` add:

```js
app.use('/api/disperse', createDisperseRouter());
```

- [ ] **Step 3: Verify the server boots**

Run (in `backend/`): `node server.js` (then Ctrl-C). Expected: "Sniper backend listening" with no import errors.

Quick smoke: `curl http://localhost:4517/api/disperse/config` returns JSON with 8 chains.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js backend/src/disperse/routes.js
git commit -m "feat: disperse REST routes"
```

---

### Task 10: Frontend disperse API client

**Files:**
- Create: `frontend/src/utils/disperseApi.js`
- Test: `frontend/src/utils/__tests__/disperseApi.test.js`

Thin REST wrapper reusing the backend URL convention from `sniperApi.js`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/__tests__/disperseApi.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function stubLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

describe('disperseApi', () => {
  let api;
  beforeEach(async () => {
    stubLocalStorage();
    vi.resetModules();
    ({ disperseApi: api } = await import('../disperseApi.js'));
  });

  it('POSTs a plan and returns the plan payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ plan: { recipientCount: 3 } }),
    });
    const out = await api.plan({ sourceChain: 'base' });
    expect(out.plan.recipientCount).toBe(3);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/disperse\/plan$/);
    expect(opts.method).toBe('POST');
  });

  it('throws with the server error message on non-ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'bad recipients' }),
    });
    await expect(api.plan({})).rejects.toThrow('bad recipients');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run (in `frontend/`): `npm test`
Expected: FAIL — cannot resolve `../disperseApi.js`.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/disperseApi.js`:

```js
// REST client for the backend disperse engine. Reuses the sniper backend URL.
import { getBackendUrl } from './sniperApi.js';

async function request(method, path, body) {
  const res = await fetch(`${getBackendUrl()}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

export const disperseApi = {
  config: () => request('GET', '/api/disperse/config'),
  plan: (input) => request('POST', '/api/disperse/plan', input),
  execute: (payload) => request('POST', '/api/disperse/execute', payload),
  retry: (id, keys) => request('POST', `/api/disperse/${id}/retry`, { keys }),
  externalChunk: (id, payload) => request('POST', `/api/disperse/${id}/external-chunk`, payload),
  jobs: () => request('GET', '/api/disperse/jobs'),
  job: (id) => request('GET', `/api/disperse/jobs/${id}`),
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: disperseApi tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/disperseApi.js src/utils/__tests__/disperseApi.test.js
git commit -m "feat: frontend disperse API client"
```

---

### Task 11: Rebuild DisperseView

**Files:**
- Modify: `frontend/src/components/DisperseView.jsx` (full rewrite)

Rebuild around the backend engine. The old file's hardcoded contracts/tokens are removed — config now comes from `GET /api/disperse/config`. This task is UI orchestration only; all logic is in the tested modules.

Sections (spec §2): Source (chain, sender mode toggle, asset) → Destination (same-chain only here; a disabled "different chain → bridge" hint reserved for Plan 3) → Recipients (paste/group/CSV with live validation) → Amount (equal/custom/total) → Preview plan card → progress tracker with retry.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `frontend/src/components/DisperseView.jsx` with:

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { ArrowRight, Info, Lock } from 'lucide-react';
import { disperseApi } from '../utils/disperseApi.js';
import * as senderStore from '../utils/senderWalletStore.js';
import { subscribeWs } from '../utils/sniperApi.js';

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const DisperseView = ({ account, walletGroups }) => {
  const [cfg, setCfg] = useState(null);
  const [chainId, setChainId] = useState('base');
  const [asset, setAsset] = useState('NATIVE');
  const [senderMode, setSenderMode] = useState('connected'); // 'connected' | 'stored'
  const [selectedSenders, setSelectedSenders] = useState([]);
  const [recipientsText, setRecipientsText] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('manual');
  const [amountMode, setAmountMode] = useState('equal');
  const [perRecipient, setPerRecipient] = useState('0');
  const [total, setTotal] = useState('0');
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => { disperseApi.config().then(setCfg).catch(e => setError(e.message)); }, []);

  // Live job updates over the shared WS bus.
  useEffect(() => subscribeWs((msg) => {
    if (msg.type === 'disperse:job' && job && msg.job?.id === job.id) setJob(msg.job);
  }), [job]);

  const chain = cfg?.chains.find(c => c.id === chainId) || null;
  const assetOptions = useMemo(
    () => (chain ? ['NATIVE', ...chain.tokens] : ['NATIVE']), [chain]);
  const storedWallets = senderStore.listWallets().filter(
    w => w.chainFamily === (chain?.family || 'evm'));

  useEffect(() => { if (!assetOptions.includes(asset)) setAsset('NATIVE'); }, [chainId]);

  const recipientsFromGroup = () => {
    if (selectedGroupId === 'manual') return recipientsText;
    const g = walletGroups.find(x => x.id === selectedGroupId);
    return g ? g.addresses.join('\n') : '';
  };

  const buildInput = () => ({
    sourceChain: chainId, destChain: chainId, asset,
    senders: senderMode === 'connected' ? (account ? [account] : []) : selectedSenders,
    recipientsText: recipientsFromGroup(),
    amountMode,
    perRecipient: amountMode === 'equal' ? perRecipient : undefined,
    total: amountMode === 'total' ? total : undefined,
  });

  const handlePreview = async () => {
    setError(''); setBusy(true); setPlan(null); setJob(null);
    try {
      const { plan } = await disperseApi.plan(buildInput());
      setPlan(plan);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Stored-wallet path: unlock, decrypt keys, POST execute.
  const handleExecuteStored = async () => {
    setError(''); setBusy(true);
    try {
      if (!senderStore.isUnlocked()) await senderStore.unlock(password);
      const keys = {};
      const list = senderStore.listWallets();
      for (const addr of plan.perSender.map(p => p.sender)) {
        const w = list.find(x => x.address === addr);
        keys[addr] = await senderStore.decryptWalletKey(w.id);
      }
      const { job } = await disperseApi.execute({ plan, keys });
      setJob(job);
      setPassword('');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // MetaMask path: create the job (no keys), then sign each chunk in-browser.
  const handleExecuteConnected = async () => {
    setError(''); setBusy(true);
    try {
      const { jobId } = await disperseApi.execute({ plan, keys: {} });
      const DISPERSE_ABI = [
        'function disperseEther(address[] recipients, uint256[] values) payable',
        'function disperseToken(address token, address[] recipients, uint256[] values)',
      ];
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const ps = plan.perSender.find(p => p.chunks.length > 0); // first active sender
      const chainCfg = cfg.chains.find(c => c.id === chainId);
      const contract = new ethers.Contract(chainCfg.disperseContract, DISPERSE_ABI, signer);
      for (let ci = 0; ci < ps.chunks.length; ci++) {
        const chunk = ps.chunks[ci];
        const amounts = chunk.amounts.map(a => BigInt(a));
        try {
          const tx = plan.isNativeAsset
            ? await contract.disperseEther(chunk.recipients.map(r => r.address), amounts,
                { value: amounts.reduce((a, b) => a + b, 0n) })
            : await contract.disperseToken(plan.tokenAddress,
                chunk.recipients.map(r => r.address), amounts);
          await tx.wait();
          await disperseApi.externalChunk(jobId, { sender: account, chunkIndex: ci, disperseHash: tx.hash });
        } catch (err) {
          await disperseApi.externalChunk(jobId, { sender: account, chunkIndex: ci, error: err.message });
        }
      }
      setJob((await disperseApi.job(jobId)).job);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const handleExecute = () => senderMode === 'stored' ? handleExecuteStored() : handleExecuteConnected();
  const handleRetry = async () => {
    if (senderMode !== 'stored') { setError('Retry currently supports stored wallets only'); return; }
    const keys = {};
    const list = senderStore.listWallets();
    for (const addr of plan.perSender.map(p => p.sender)) {
      const w = list.find(x => x.address === addr);
      keys[addr] = await senderStore.decryptWalletKey(w.id);
    }
    await disperseApi.retry(job.id, keys);
  };

  if (!cfg) return <div className="solana-container"><div className="panel">Loading disperse config…</div></div>;

  return (
    <div className="solana-container">
      <div className="page-header">
        <h2>Disperse</h2>
        <p>Send native coins or tokens to many recipients {cfg.dryRun && <span className="badge">DRY RUN</span>}</p>
      </div>
      <div className="panel">
        {/* Source */}
        <div className="form-group">
          <label className="form-label">Chain</label>
          <select className="select-field" value={chainId} onChange={e => setChainId(e.target.value)}>
            {cfg.chains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Sender</label>
            <select className="select-field" value={senderMode} onChange={e => setSenderMode(e.target.value)}>
              <option value="connected">Connected wallet (MetaMask)</option>
              <option value="stored">Stored wallets</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Asset</label>
            <select className="select-field" value={asset} onChange={e => setAsset(e.target.value)}>
              {assetOptions.map(a => <option key={a} value={a}>{a === 'NATIVE' ? chain?.symbol : a}</option>)}
            </select>
          </div>
        </div>

        {senderMode === 'stored' && (
          <div className="form-group">
            <label className="form-label">Stored sender wallets</label>
            {!senderStore.hasProfile()
              ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No wallet profile yet — add one in the Wallets page.</p>
              : (
                <div className="addresses-checklist">
                  {storedWallets.map(w => (
                    <label key={w.id} className="checklist-item">
                      <input type="checkbox" checked={selectedSenders.includes(w.address)}
                        onChange={() => setSelectedSenders(s =>
                          s.includes(w.address) ? s.filter(a => a !== w.address) : [...s, w.address])} />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{w.label} · {short(w.address)}</span>
                    </label>
                  ))}
                </div>
              )}
          </div>
        )}

        {/* Recipients */}
        <div className="form-group">
          <label className="form-label">Recipients</label>
          <select className="select-field" style={{ marginBottom: '0.5rem' }}
            value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)}>
            <option value="manual">Manual entry / CSV paste</option>
            {walletGroups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.addresses.length})</option>)}
          </select>
          {selectedGroupId === 'manual' && (
            <textarea className="textarea-field" style={{ minHeight: 100 }}
              placeholder={'address\naddress, amount   (for custom mode)'}
              value={recipientsText} onChange={e => setRecipientsText(e.target.value)} />
          )}
        </div>

        {/* Amount */}
        <div className="form-group">
          <label className="form-label">Amount mode</label>
          <select className="select-field" value={amountMode} onChange={e => setAmountMode(e.target.value)}>
            <option value="equal">Equal per recipient</option>
            <option value="custom">Custom per recipient (from "address, amount" lines)</option>
            <option value="total">Total split evenly</option>
          </select>
          {amountMode === 'equal' && (
            <input type="number" className="input-field" style={{ marginTop: '0.5rem' }}
              value={perRecipient} onChange={e => setPerRecipient(e.target.value)} placeholder="Per recipient" />
          )}
          {amountMode === 'total' && (
            <input type="number" className="input-field" style={{ marginTop: '0.5rem' }}
              value={total} onChange={e => setTotal(e.target.value)} placeholder="Total to split" />
          )}
        </div>

        {error && <p style={{ color: 'var(--danger, #f87171)', fontSize: '0.85rem' }}>{error}</p>}

        {/* Preview */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-outline" onClick={handlePreview} disabled={busy}>
            <Info size={15} /> Review Plan
          </button>
        </div>

        {plan && !job && (
          <div className="panel" style={{ marginTop: '1rem', background: 'rgba(124,92,252,0.06)' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Execution Plan</h3>
            <p style={{ fontSize: '0.85rem' }}>
              {plan.recipientCount} recipients · asset {plan.asset} ·
              {plan.perSender.filter(p => p.chunks.length > 0).length} active sender(s) ·
              {plan.perSender.reduce((n, p) => n + p.chunks.length, 0)} transaction(s)
              {plan.pairingMode === 'consolidation' && ' · consolidation'}
              {plan.pairingMode === 'pairing' && ' · paired'}
            </p>
            {plan.validationErrors.length > 0 && (
              <p style={{ color: 'var(--warning, #fbbf24)', fontSize: '0.8rem' }}>
                {plan.validationErrors.length} invalid line(s) skipped.
              </p>
            )}
            {senderMode === 'stored' && !senderStore.isUnlocked() && (
              <input type="password" className="input-field" style={{ marginTop: '0.5rem' }}
                placeholder="Profile password to unlock keys"
                value={password} onChange={e => setPassword(e.target.value)} />
            )}
            <button className="btn-primary btn-block" style={{ marginTop: '0.75rem' }}
              onClick={handleExecute} disabled={busy}>
              {senderMode === 'stored' && !senderStore.isUnlocked() ? <Lock size={15} /> : null}
              Send {plan.asset} <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Progress */}
        {job && (
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Job {job.status.toUpperCase()}</h3>
            <div className="addresses-list">
              {job.recipients.map((r, i) => (
                <div key={i} className="address-item">
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{short(r.address)}</span>
                  <span style={{ fontSize: '0.8rem', color:
                    r.status === 'sent' ? 'var(--accent, #14f195)'
                    : r.status === 'failed' ? 'var(--danger, #f87171)' : 'var(--text-muted)' }}>
                    {r.status}{r.txHash ? ` · ${r.txHash.slice(0, 10)}…` : ''}{r.error ? ` · ${r.error}` : ''}
                  </span>
                </div>
              ))}
            </div>
            {(job.status === 'partial' || job.status === 'failed') && (
              <button className="btn-outline" style={{ marginTop: '0.5rem' }} onClick={handleRetry}>
                Retry failed
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DisperseView;
```

- [ ] **Step 2: Verify build**

Run (in `frontend/`): `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/DisperseView.jsx
git commit -m "feat: rebuild DisperseView on the backend engine"
```

---

### Task 12: Full verification

- [ ] **Step 1: Run both test suites**

Run (in `backend/`): `npm test` — all disperse tests pass.
Run (in `frontend/`): `npm test` — all tests pass (including Plan 1 suites).

- [ ] **Step 2: Lint + build the frontend**

Run (in `frontend/`): `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: DRY-RUN end-to-end (backend + frontend running)**

With `DISPERSE_DRY_RUN` unset (defaults true):
1. Start backend (`node server.js`) and frontend (`npm run dev`).
2. Disperse page shows the DRY RUN badge and loads 8 chains.
3. Stored-wallet path: select Base, NATIVE, stored mode, pick a wallet, paste 3 addresses, equal 0.001 → Review Plan shows 3 recipients / 1 tx → unlock with password → Send → job reaches `completed`, each recipient shows a `0xDRYRUN…` hash. Verify no key string appears in the backend console logs.
4. Insufficient balance: set an absurd per-recipient amount with stored mode → Review Plan surfaces the shortfall error, no job created.
5. Invalid recipients: paste a garbage line → plan card notes "1 invalid line skipped".
6. Custom mode: paste `addr, 1.5` lines → plan totals reflect per-recipient amounts.
7. MetaMask path (still dry run so no real signing needed to verify wiring): switch to connected mode → Review Plan builds a plan (execution will attempt window.ethereum; acceptable to stop here in dry run).

- [ ] **Step 4: Live testnet acceptance (optional gate before mainnet)**

Set `DISPERSE_DRY_RUN=false` with testnet RPCs (Base Sepolia, Solana devnet) in backend env. Run one native + one token disperse per family with a funded stored wallet; confirm receipts on the explorer and per-recipient `sent` status. Record the verified Disperse contract bytecode hash per chain into `config.js` (`disperseBytecodeHash`) to replace the runtime `computeAndCache`.

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore: disperse engine verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** §3 job model ✓ (Task 7 job shape), plan/execute/retry endpoints ✓ (Task 9), in-memory keys wiped ✓ (Task 7 test), chunking + nonce-serial per sender ✓ (Tasks 4, 7 — serial loop), exact approvals default + unlimited opt-in ✓ (Task 4 `disperseTokenChunk`), verified contract bytecode ✓ (Tasks 4, 8), gas reserve ✓ (Tasks 4, 6), Solana batched transfers ✓ (Task 5), MetaMask path records hashes ✓ (Tasks 7, 11), retry only failed ✓ (Task 7 test). §2 UX: source/dest/recipients/amount zones + plan card + progress tracker ✓ (Task 11). §5: config module ✓ (Task 2), validation ✓ (Task 3), DRY_RUN ✓ (Task 8), tests throughout, testnet acceptance ✓ (Task 12).
- **Deferred to Plan 3:** cross-chain (buildPlan rejects it; DisperseView dest defaults to source), LI.FI bridge, underfunded pause, bridge status polling. Seam: `destChain` already threaded through the plan input and job `dest`.
- **Multi-sender pairing:** `assignRecipients(senders, recipients)` implements consolidation (senders >= recipients → only first sender works) and 1:1 pairing (senders < recipients → round-robin). The plan exposes `pairingMode` for the UI. Connected (MetaMask) path is single-sender only.
- **Type consistency:** plan `perSender[].chunks[].amounts` are decimal strings end to end; adapters convert to BigInt at the edge (`execute.js`, DisperseView MetaMask path). `getToken` returns `{symbol,address,decimals}` consumed identically in plan.js and execute.js.
- **Shared utilities (C9):** `request()` helper from `sniperApi.js` should be reused by `disperseApi.js` (currently duplicated). `shortAddr` from `format.js` should be used instead of the inline `short()` in DisperseView. The `DISPERSE_ABI` should be imported from `evm.js` instead of redeclared in the MetaMask path.


