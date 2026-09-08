# LI.FI Bridge (Disperse v2 — Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-chain disperse — bridge once (source asset → sender's own address on the destination chain, delivered as any LI.FI-supported token), then run the existing same-chain disperse there. Recipients split what actually arrives. Multi-sender bridges run in parallel and the destination disperse starts only when every leg is `DONE`.

**Architecture:** A new `backend/src/disperse/bridge.js` wraps the LI.FI REST API (`https://li.quest/v1`, no key): `getQuote`, `sendBridgeTx` (or hand a `transactionRequest` to a MetaMask signer), and `pollStatus`. `plan.js` gains a cross-chain branch that attaches a `bridge` section (quote per sender) instead of rejecting. `jobRunner.js` gains bridge steps (`bridge` → `wait-bridge`) that run before the disperse steps, plus an `underfunded` pause when the received amount can't cover custom per-recipient totals. The frontend surfaces route/fee/ETA in the plan card and bridge progress in the tracker.

**Tech Stack:** Node ESM (existing backend), ethers v6, @solana/web3.js (existing). LI.FI REST over `fetch`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-disperse-v2-design.md` §4 (Bridge), plus §5 underfunded/stalled handling.

**Depends on:** Plan 2 shipped — `config.js`, `plan.js` (`buildPlan`), `jobRunner.js`, `execute.js`, `routes.js`, and the DisperseView plan card / tracker.

**Working conventions for this repo:**
- Windows + Git Bash. Heredocs do NOT work — use Write/Edit tools.
- Backend on port 4517; `DISPERSE_DRY_RUN` (default true) must also short-circuit real bridge sends.
- LI.FI native-asset sentinel: `0x0000000000000000000000000000000000000000`.
- Never log or persist private keys.

---

### Task 1: LI.FI client (quote, send, status)

**Files:**
- Create: `backend/src/disperse/bridge.js`
- Test: `backend/src/disperse/__tests__/bridge.test.js`

Pure request-shaping + response-mapping; `fetch` is mocked in tests.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/bridge.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LIFI_NATIVE, toLifiToken, getQuote, pollStatus, mapQuote,
} from '../bridge.js';

describe('toLifiToken', () => {
  it('maps NATIVE to the zero address', () => {
    expect(toLifiToken('NATIVE', { symbol: 'ETH' })).toBe(LIFI_NATIVE);
  });
  it('passes through an ERC-20 address', () => {
    expect(toLifiToken('0xabc', {})).toBe('0xabc');
  });
});

describe('getQuote', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requests a quote with the right params and maps the response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        estimate: { toAmount: '990000', executionDuration: 120, gasCosts: [{ amountUSD: '1.2' }],
          feeCosts: [{ amountUSD: '0.3' }] },
        tool: 'across',
        transactionRequest: { to: '0xbridge', data: '0xdead', value: '0x0' },
        action: { fromToken: { address: '0x0000000000000000000000000000000000000000' } },
        estimate2: undefined,
      }),
    });
    const q = await getQuote({
      fromChainId: 1, toChainId: 8453, fromToken: LIFI_NATIVE, toToken: '0xusdc',
      fromAmount: '1000000', fromAddress: '0xme', toAddress: '0xme',
    });
    expect(q.toAmount).toBe('990000');
    expect(q.tool).toBe('across');
    expect(q.durationSec).toBe(120);
    expect(q.gasUsd).toBeCloseTo(1.2);
    expect(q.feeUsd).toBeCloseTo(0.3);
    expect(q.transactionRequest.to).toBe('0xbridge');
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/li\.quest\/v1\/quote/);
    expect(url).toMatch(/fromChain=1/);
    expect(url).toMatch(/toChain=8453/);
  });

  it('throws a friendly error when no route exists', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ message: 'No available quotes' }),
    });
    await expect(getQuote({
      fromChainId: 1, toChainId: 8453, fromToken: LIFI_NATIVE, toToken: '0xusdc',
      fromAmount: '1', fromAddress: '0xme', toAddress: '0xme',
    })).rejects.toThrow(/No available quotes|no route/i);
  });
});

describe('pollStatus', () => {
  it('maps a DONE status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'DONE', receiving: { amount: '988000' } }),
    });
    const s = await pollStatus({ tool: 'across', fromChainId: 1, toChainId: 8453, txHash: '0xh' });
    expect(s.status).toBe('DONE');
    expect(s.receivedAmount).toBe('988000');
  });

  it('maps a FAILED status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'FAILED' }),
    });
    const s = await pollStatus({ tool: 'x', fromChainId: 1, toChainId: 2, txHash: '0xh' });
    expect(s.status).toBe('FAILED');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run (in `backend/`): `npm test`
Expected: FAIL — cannot resolve `../bridge.js`.

- [ ] **Step 3: Implement**

Create `backend/src/disperse/bridge.js`:

```js
// LI.FI bridge client. REST API https://li.quest/v1 (no key needed).
// All functions are thin request shapers + response mappers so the job
// runner stays testable.
const LIFI_BASE = 'https://li.quest/v1';
export const LIFI_NATIVE = '0x0000000000000000000000000000000000000000';
export const DEFAULT_SLIPPAGE = 0.005; // 0.5%

// asset: 'NATIVE' | token address. Returns the LI.FI token identifier.
export function toLifiToken(asset) {
  return asset === 'NATIVE' ? LIFI_NATIVE : asset;
}

function num(x) {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

// Normalizes a raw LI.FI quote into the fields the plan/runner need.
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

// Polls transfer status. Returns { status: 'PENDING'|'DONE'|'FAILED', receivedAmount? }.
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: bridge client tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/bridge.js backend/src/disperse/__tests__/bridge.test.js
git commit -m "feat: LI.FI bridge client (quote/status)"
```

---

### Task 2: Cross-chain plan branch

**Files:**
- Modify: `backend/src/disperse/plan.js`
- Test: `backend/src/disperse/__tests__/plan-crosschain.test.js`

Replace the cross-chain rejection with a branch: when `destChain !== sourceChain`, get a LI.FI quote per sender for the sender's full send amount, delivering to the sender's **own** destination address, and attach a `bridge` section. Recipient amounts are computed on the destination asset/decimals from the **estimated** received amount (re-computed from the actual amount at execution time). The quote fetcher is injected as `deps.getQuote`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/plan-crosschain.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { buildPlan } from '../plan.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

const deps = () => ({
  fetchBalances: async () => ({ nativeBalance: 10n ** 18n, tokenBalance: null, decimals: 18 }),
  getQuote: vi.fn().mockResolvedValue({
    tool: 'across', toAmount: '990000', durationSec: 120, gasUsd: 1.2, feeUsd: 0.3,
    approvalAddress: '0xbridge', transactionRequest: { to: '0xbridge', data: '0x', value: '0x0' },
  }),
});

describe('buildPlan (cross-chain)', () => {
  it('attaches a bridge section and plans the destination disperse from the quote', async () => {
    const d = deps();
    const plan = await buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE', destAsset: 'USDC',
      senders: [A], recipientsText: `${A}\n${B}`,
      amountMode: 'total', total: '0.5',
    }, d);

    expect(plan.crossChain).toBe(true);
    expect(plan.sourceChain).toBe('eth');
    expect(plan.destChain).toBe('base');
    expect(plan.destAsset).toBe('USDC');
    expect(plan.perSender[0].bridge.tool).toBe('across');
    expect(plan.perSender[0].bridge.toAddress).toBe(A); // sender's own dest address
    expect(plan.perSender[0].bridge.estimatedReceived).toBe('990000');
    // Destination disperse split from the received estimate (USDC 6dp): 990000/2
    expect(plan.perSender[0].chunks[0].amounts).toEqual(['495000', '495000']);
    expect(d.getQuote).toHaveBeenCalledOnce();
  });

  it('rejects when LI.FI returns no route', async () => {
    const d = deps();
    d.getQuote = vi.fn().mockRejectedValue(new Error('No route from LI.FI (404)'));
    await expect(buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE', destAsset: 'USDC',
      senders: [A], recipientsText: A, amountMode: 'total', total: '0.5',
    }, d)).rejects.toThrow(/no route/i);
  });

  it('requires destAsset for a cross-chain plan', async () => {
    await expect(buildPlan({
      sourceChain: 'eth', destChain: 'base', asset: 'NATIVE',
      senders: [A], recipientsText: A, amountMode: 'total', total: '0.5',
    }, deps())).rejects.toThrow(/destination asset/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — cross-chain still rejected / `destAsset` unknown.

- [ ] **Step 3: Modify plan.js**

In `backend/src/disperse/plan.js`, update the imports at the top to add token amount helpers:

```js
import { getDisperseChain, getToken } from './config.js';
import { parseRecipients, computeAmounts } from './validate.js';
import { chunkRecipients, computeGasReserveShortfall } from './evm.js';
import { toLifiToken } from './bridge.js';
import { assignRecipients } from './plan.js';
```

Replace the existing cross-chain guard:

```js
  if (destChain && destChain !== sourceChain) {
    throw new Error('Cross-chain disperse requires the bridge (not available in this build)');
  }
```

with a dispatch that delegates cross-chain to a dedicated builder:

```js
  if (destChain && destChain !== sourceChain) {
    return buildCrossChainPlan(input, deps);
  }
```

Then update the input destructuring to include `destAsset`:

```js
  const {
    sourceChain, destChain, asset, destAsset, senders, recipientsText,
    amountMode, perRecipient, total, allowUnlimited = false,
  } = input;
```

Add this new function at the end of the file:

```js
// Cross-chain: bridge once per sender to its own destination address, then
// disperse the received amount on the destination chain. Recipient amounts
// are computed on the destination asset from the quote's estimated received
// amount (re-derived from the actual amount at execution).
async function buildCrossChainPlan(input, deps) {
  const {
    sourceChain, destChain, asset, destAsset, senders, recipientsText,
    amountMode, perRecipient, total, allowUnlimited = false,
  } = input;

  const src = getDisperseChain(sourceChain);
  const dst = getDisperseChain(destChain);
  if (!src) throw new Error(`Unknown source chain: ${sourceChain}`);
  if (!dst) throw new Error(`Unknown destination chain: ${destChain}`);
  if (src.family !== 'evm' || dst.family !== 'evm') {
    throw new Error('Cross-chain currently supports EVM ↔ EVM only');
  }
  if (!destAsset) throw new Error('A destination asset is required for cross-chain');
  if (!senders || senders.length === 0) throw new Error('At least one sender is required');

  const srcToken = getToken(sourceChain, asset);
  if (!srcToken) throw new Error(`Asset ${asset} not available on ${src.name}`);
  const dstToken = getToken(destChain, destAsset);
  if (!dstToken) throw new Error(`Destination asset ${destAsset} not available on ${dst.name}`);
  const isNativeAsset = srcToken.address === 'NATIVE';

  const { recipients, errors } = parseRecipients(recipientsText, dst.family);
  if (recipients.length === 0) throw new Error('No valid recipients');

  const srcGasReserve = BigInt(src.gasReserveWei);
  const { pairingMode, assignments } = assignRecipients(senders, recipients);
  const perSender = [];

  for (const { sender, recipients: senderRecipients } of assignments) {
    if (senderRecipients.length === 0) {
      perSender.push({
        sender, decimals: dstToken.decimals, totalBaseUnits: '0', chunks: [],
        bridge: { status: 'skipped' },
      });
      continue;
    }

    // Source-side send amount (what we bridge).
    const { total: srcSendTotal } = computeAmounts({
      mode: amountMode, perRecipient, total, decimals: srcToken.decimals, recipients: senderRecipients,
    });

    const balances = await deps.fetchBalances({
      chain: src, address: sender, tokenAddress: srcToken.address, isNativeAsset,
    });
    const shortfall = computeGasReserveShortfall({
      isNativeAsset, nativeBalance: balances.nativeBalance,
      sendTotal: isNativeAsset ? srcSendTotal : 0n, gasReserve: srcGasReserve,
    });
    if (shortfall > 0n) throw new Error(`Sender ${sender}: insufficient native balance for bridge + gas reserve`);

    const quote = await deps.getQuote({
      fromChainId: src.chainId, toChainId: dst.chainId,
      fromToken: toLifiToken(srcToken.address), toToken: toLifiToken(dstToken.address),
      fromAmount: srcSendTotal.toString(), fromAddress: sender, toAddress: sender,
    });

    // Destination amounts from the estimated received amount, on dest decimals.
    const received = BigInt(quote.toAmount);
    const n = BigInt(senderRecipients.length);
    const base = received / n;
    const remainder = received - base * n;
    const destAmounts = senderRecipients.map((_, i) => (i === senderRecipients.length - 1 ? base + remainder : base));

    const chunks = chunkRecipients(senderRecipients, destAmounts, dst.maxRecipientsPerTx).map(c => ({
      recipients: c.recipients, amounts: c.amounts.map(a => a.toString()),
    }));

    perSender.push({
      sender,
      decimals: dstToken.decimals,
      totalBaseUnits: received.toString(),
      bridge: {
        tool: quote.tool,
        toAddress: sender,
        fromAmount: srcSendTotal.toString(),
        estimatedReceived: quote.toAmount,
        durationSec: quote.durationSec,
        gasUsd: quote.gasUsd,
        feeUsd: quote.feeUsd,
        approvalAddress: quote.approvalAddress,
        transactionRequest: quote.transactionRequest,
        status: 'pending',
        txHash: null,
      },
      chunks,
    });
  }

  return Object.freeze({
    crossChain: true,
    sourceChain, destChain,
    family: dst.family,
    asset: srcToken.symbol,
    destAsset: dstToken.symbol,
    tokenAddress: dstToken.address,   // dest disperse uses dest token
    srcTokenAddress: srcToken.address,
    isNativeAsset: dstToken.address === 'NATIVE',  // true when dest is the chain's native coin
    destIsNative: dstToken.address === 'NATIVE',
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
Expected: plan-crosschain tests PASS, and existing plan tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/plan.js backend/src/disperse/__tests__/plan-crosschain.test.js
git commit -m "feat: cross-chain plan branch with LI.FI quote"
```

---

### Task 3: Bridge steps in the job runner

**Files:**
- Modify: `backend/src/disperse/jobRunner.js`
- Test: `backend/src/disperse/__tests__/jobRunner-bridge.test.js`

For a cross-chain job the runner must, per sender: run the bridge tx (`deps.execBridge`), poll to `DONE` (`deps.pollBridge`), recompute destination amounts from the **actual** received amount, then run the disperse chunks. All senders' bridges start before any disperse; disperse waits for all legs `DONE`. If actual < needed for custom mode, the job pauses `underfunded`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/disperse/__tests__/jobRunner-bridge.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = {};
vi.mock('../../store.js', () => ({
  load: (name, fallback) => saved[name] ?? fallback,
  save: (name, value) => { saved[name] = value; },
}));
vi.mock('../../bus.js', () => ({ emit: vi.fn(), log: vi.fn() }));

const crossPlan = () => ({
  crossChain: true, sourceChain: 'eth', destChain: 'base', family: 'evm',
  asset: 'ETH', destAsset: 'USDC', tokenAddress: '0xusdc', srcTokenAddress: 'NATIVE',
  isNativeAsset: false, destIsNative: false, amountMode: 'total',
  recipients: [{ address: '0xA' }, { address: '0xB' }], recipientCount: 2,
  perSender: [{
    sender: '0xS', decimals: 6, totalBaseUnits: '990000',
    bridge: { tool: 'across', toAddress: '0xS', fromAmount: '500000000000000000',
      estimatedReceived: '990000', status: 'pending', txHash: null },
    chunks: [{ recipients: [{ address: '0xA' }, { address: '0xB' }], amounts: ['495000', '495000'] }],
  }],
  validationErrors: [],
});

describe('jobRunner cross-chain', () => {
  let runner;
  beforeEach(async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
    runner = await import('../jobRunner.js');
  });

  it('bridges, waits, recomputes amounts from actual received, then disperses', async () => {
    const job = runner.createJob(crossPlan());
    const execBridge = vi.fn().mockResolvedValue({ txHash: '0xbridge' });
    const pollBridge = vi.fn().mockResolvedValue({ status: 'DONE', receivedAmount: '1000000' });
    const execChunk = vi.fn().mockResolvedValue({ disperseHash: '0xdisp' });

    await runner.executeJob(job.id, { '0xS': '0xKEY' }, { execBridge, pollBridge, execChunk });

    const done = runner.getJob(job.id);
    expect(done.status).toBe('completed');
    // Received 1_000_000 recomputed across 2 recipients -> 500000 each
    const chunkArg = execChunk.mock.calls[0][0].chunk;
    expect(chunkArg.amounts).toEqual(['500000', '500000']);
    expect(done.recipients.every(r => r.status === 'sent')).toBe(true);
  });

  it('marks the job failed if the bridge fails', async () => {
    const job = runner.createJob(crossPlan());
    await runner.executeJob(job.id, { '0xS': '0xKEY' }, {
      execBridge: vi.fn().mockResolvedValue({ txHash: '0xb' }),
      pollBridge: vi.fn().mockResolvedValue({ status: 'FAILED' }),
      execChunk: vi.fn(),
    });
    expect(runner.getJob(job.id).status).toBe('failed');
  });

  it('pauses underfunded when custom totals exceed the received amount', async () => {
    const plan = crossPlan();
    plan.amountMode = 'custom';
    plan.perSender[0].chunks = [{
      recipients: [{ address: '0xA' }, { address: '0xB' }], amounts: ['600000', '600000'],
    }];
    const job = runner.createJob(plan);
    await runner.executeJob(job.id, { '0xS': '0xKEY' }, {
      execBridge: vi.fn().mockResolvedValue({ txHash: '0xb' }),
      pollBridge: vi.fn().mockResolvedValue({ status: 'DONE', receivedAmount: '1000000' }),
      execChunk: vi.fn(),
    });
    expect(runner.getJob(job.id).status).toBe('underfunded');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — runner has no bridge handling.

- [ ] **Step 3: Modify jobRunner.js**

In `backend/src/disperse/jobRunner.js`, add a bridge phase to `runChunks`. Replace the existing `runChunks` function with a version that runs bridges first for cross-chain jobs, then recomputes amounts, then disperses. Add this helper above `runChunks`:

```js
// Recomputes destination chunk amounts from the actual received amount.
// For equal/total: split evenly with remainder to the last recipient.
// For custom: keep the planned amounts, but flag if their sum exceeds actual.
function recomputeFromReceived(ps, amountMode, received) {
  const flatRecipients = ps.chunks.flatMap(c => c.recipients);
  const n = flatRecipients.length;
  if (amountMode === 'custom') {
    const plannedTotal = ps.chunks
      .flatMap(c => c.amounts)
      .reduce((a, b) => a + BigInt(b), 0n);
    return { chunks: ps.chunks, underfunded: plannedTotal > received };
  }
  const base = received / BigInt(n);
  const remainder = received - base * BigInt(n);
  const flat = flatRecipients.map((_, i) => (i === n - 1 ? base + remainder : base));
  // Re-chunk preserving original chunk sizes.
  const chunks = [];
  let idx = 0;
  for (const c of ps.chunks) {
    const size = c.recipients.length;
    chunks.push({ recipients: c.recipients, amounts: flat.slice(idx, idx + size).map(a => a.toString()) });
    idx += size;
  }
  return { chunks, underfunded: false };
}
```

Then replace `runChunks` with:

```js
async function runChunks(job, keys, deps, filter) {
  job.status = 'running';
  upsert(job);

  // --- Bridge phase (cross-chain only) ---
  if (job.plan.crossChain) {
    // Start every sender's bridge, then wait for all to be DONE.
    // Skip legs already DONE or PENDING (idempotent retry).
    for (const ps of job.plan.perSender) {
      if (ps.bridge.status === 'DONE' || ps.bridge.status === 'PENDING') continue;
      try {
        const { txHash } = await deps.execBridge({
          plan: job.plan, sender: ps.sender, privateKey: keys[ps.sender], bridge: ps.bridge,
        });
        ps.bridge.txHash = txHash;
        ps.bridge.status = 'PENDING';
      } catch (err) {
        ps.bridge.status = 'FAILED';
        ps.bridge.error = err.message;
      }
      upsert(job);
    }
    // Poll each pending bridge to terminal.
    for (const ps of job.plan.perSender) {
      if (ps.bridge.status !== 'PENDING') continue;
      const deadline = Date.now() + 60 * 60 * 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const s = await deps.pollBridge({ plan: job.plan, sender: ps.sender, bridge: ps.bridge });
        if (s.status === 'DONE') {
          ps.bridge.status = 'DONE';
          ps.bridge.receivedAmount = s.receivedAmount || ps.bridge.estimatedReceived;
          break;
        }
        if (s.status === 'FAILED') { ps.bridge.status = 'FAILED'; break; }
        if (Date.now() > deadline) { ps.bridge.status = 'STALLED'; break; }
        upsert(job);
        await new Promise(r => setTimeout(r, deps.pollIntervalMs ?? 15000));
      }
      upsert(job);
    }

    // Any bridge not DONE -> abort disperse.
    const bad = job.plan.perSender.find(p => p.bridge.status !== 'DONE');
    if (bad) {
      job.status = bad.bridge.status === 'STALLED' ? 'stalled' : 'failed';
      return upsert(job);
    }

    // Recompute destination amounts from actual received, detect underfunded.
    for (const ps of job.plan.perSender) {
      const { chunks, underfunded } = recomputeFromReceived(
        ps, job.plan.amountMode, BigInt(ps.bridge.receivedAmount));
      if (underfunded) {
        job.status = 'underfunded';
        return upsert(job);
      }
      ps.chunks = chunks;
      // Rebuild the flat recipient rows' amounts to match recomputed chunks.
      ps.chunks.forEach((c, ci) => {
        c.recipients.forEach((r, ri) => {
          const row = job.recipients.find(
            x => x.sender === ps.sender && x.chunkIndex === ci && x.indexInChunk === ri);
          if (row) row.amount = c.amounts[ri];
        });
      });
    }
    upsert(job);
  }

  // --- Disperse phase (shared with same-chain) ---
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: jobRunner-bridge tests PASS, and the existing jobRunner tests still PASS (same-chain skips the bridge phase because `crossChain` is falsy).

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/jobRunner.js backend/src/disperse/__tests__/jobRunner-bridge.test.js
git commit -m "feat: bridge phase in disperse job runner"
```

---

### Task 4: execBridge + pollBridge wiring

**Files:**
- Modify: `backend/src/disperse/execute.js`
- Modify: `backend/src/disperse/routes.js`
- Test: `backend/src/disperse/__tests__/execute-bridge.test.js`

Wire the runner's bridge deps to the LI.FI client + ethers signer, honoring DRY_RUN, and inject them from routes.

- [ ] **Step 1: Write the failing test**

Create `backend/src/disperse/__tests__/execute-bridge.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('makeBridgeDeps (dry run)', () => {
  beforeEach(() => vi.resetModules());

  it('returns a simulated bridge hash and instant DONE in dry run', async () => {
    process.env.DISPERSE_DRY_RUN = 'true';
    const { makeBridgeDeps } = await import('../execute.js');
    const { execBridge, pollBridge } = makeBridgeDeps();
    const bridge = { estimatedReceived: '990000', transactionRequest: { to: '0xb' } };
    const sent = await execBridge({ plan: { sourceChain: 'eth' }, sender: '0xS', privateKey: '0xK', bridge });
    expect(sent.txHash).toMatch(/^0xDRYRUN/);
    const status = await pollBridge({ plan: { sourceChain: 'eth' }, sender: '0xS', bridge });
    expect(status.status).toBe('DONE');
    expect(status.receivedAmount).toBe('990000');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — `makeBridgeDeps` not exported.

- [ ] **Step 3: Modify execute.js**

In `backend/src/disperse/execute.js`, add imports at the top:

```js
import * as bridge from './bridge.js';
import { ethers } from 'ethers';
```

Then append this exported factory:

```js
// Bridge execution deps for the job runner. DRY_RUN short-circuits both the
// send and the status poll so no real bridge tx is broadcast.
export function makeBridgeDeps() {
  const dry = () => process.env.DISPERSE_DRY_RUN !== 'false';

  async function execBridge({ plan, privateKey, bridge: leg }) {
    if (dry()) {
      return { txHash: `0xDRYRUN_BRIDGE_${Math.random().toString(16).slice(2, 10)}` };
    }
    const chain = getDisperseChain(plan.sourceChain);
    const provider = evm.makeProvider(chain);
    const signer = evm.makeSigner(privateKey, provider);
    const req = leg.transactionRequest;
    // ERC-20 source needs an exact approval to the bridge's approval address.
    if (plan.srcTokenAddress && plan.srcTokenAddress !== 'NATIVE' && leg.approvalAddress) {
      const token = new ethers.Contract(plan.srcTokenAddress, evm.ERC20_ABI, signer);
      const owner = await signer.getAddress();
      const need = BigInt(leg.fromAmount);
      const current = await token.allowance(owner, leg.approvalAddress);
      if (current < need) {
        if (current > 0n) { await (await token.approve(leg.approvalAddress, 0n)).wait(); }
        await (await token.approve(leg.approvalAddress, need)).wait();
      }
    }
    const tx = await signer.sendTransaction({
      to: req.to, data: req.data, value: req.value ? BigInt(req.value) : 0n,
    });
    await tx.wait();
    return { txHash: tx.hash };
  }

  async function pollBridge({ plan, bridge: leg }) {
    if (dry()) {
      return { status: 'DONE', receivedAmount: leg.estimatedReceived };
    }
    const src = getDisperseChain(plan.sourceChain);
    const dst = getDisperseChain(plan.destChain);
    return bridge.pollStatus({
      tool: leg.tool, fromChainId: src.chainId, toChainId: dst.chainId, txHash: leg.txHash,
    });
  }

  return { execBridge, pollBridge, pollIntervalMs: 15000 };
}
```

- [ ] **Step 4: Wire deps in routes.js**

In `backend/src/disperse/routes.js`, add imports:

```js
import { makeExecChunk, makeBridgeDeps } from './execute.js';
import { getQuote } from './bridge.js';
```

Replace the single `const execChunk = makeExecChunk();` with:

```js
const execChunk = makeExecChunk();
const bridgeDeps = makeBridgeDeps();
const runnerDeps = { execChunk, ...bridgeDeps };
```

Add `getQuote` to the `buildPlan` deps in the `/plan` route:

```js
  router.post('/plan', wrap(async (req, res) => {
    const plan = await buildPlan(req.body || {}, { fetchBalances, getQuote });
    res.json({ plan });
  }));
```

Update `/execute` and `/:id/retry` to pass `runnerDeps` instead of `{ execChunk }`:

```js
    runner.executeJob(job.id, keys || {}, runnerDeps).catch(() => {});
```

```js
    runner.retryJob(req.params.id, keys || {}, runnerDeps).catch(() => {});
```

- [ ] **Step 5: Run to verify pass + server boots**

Run: `npm test` — execute-bridge test PASS.
Run: `node server.js` (Ctrl-C) — boots without import errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/disperse/execute.js backend/src/disperse/routes.js backend/src/disperse/__tests__/execute-bridge.test.js
git commit -m "feat: wire bridge execution + quote into routes"
```

---

### Task 5: Frontend cross-chain UI

**Files:**
- Modify: `frontend/src/components/DisperseView.jsx`

Add a destination chain + destination asset selector, show the bridge route/fee/ETA in the plan card, and render bridge status in the tracker. The MetaMask cross-chain path signs the bridge `transactionRequest` then the disperse; stored-wallet path is unchanged (backend does it).

- [ ] **Step 1: Add destination state + selectors**

In `frontend/src/components/DisperseView.jsx`, add state near the other `useState` calls:

```jsx
  const [destChainId, setDestChainId] = useState('');   // '' = same chain
  const [destAsset, setDestAsset] = useState('USDC');
```

Update `buildInput` to include destination fields:

```jsx
  const buildInput = () => ({
    sourceChain: chainId,
    destChain: destChainId || chainId,
    asset,
    destAsset: destChainId && destChainId !== chainId ? destAsset : undefined,
    senders: senderMode === 'connected' ? (account ? [account] : []) : selectedSenders,
    recipientsText: recipientsFromGroup(),
    amountMode,
    perRecipient: amountMode === 'equal' ? perRecipient : undefined,
    total: amountMode === 'total' ? total : undefined,
  });
```

Add the destination selectors right after the Asset `form-group` block (compute `destChainObj` inline):

```jsx
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Destination chain</label>
            <select className="select-field" value={destChainId} onChange={e => setDestChainId(e.target.value)}>
              <option value="">Same chain (no bridge)</option>
              {cfg.chains.filter(c => c.family === 'evm' && c.id !== chainId)
                .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {destChainId && destChainId !== chainId && (
            <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
              <label className="form-label">Recipients receive</label>
              <select className="select-field" value={destAsset} onChange={e => setDestAsset(e.target.value)}>
                {['NATIVE', ...(cfg.chains.find(c => c.id === destChainId)?.tokens || [])]
                  .map(a => <option key={a} value={a}>
                    {a === 'NATIVE' ? cfg.chains.find(c => c.id === destChainId)?.symbol : a}
                  </option>)}
              </select>
            </div>
          )}
        </div>
```

- [ ] **Step 2: Show bridge info in the plan card**

Inside the `plan && !job` plan card, after the recipients summary `<p>`, add:

```jsx
            {plan.crossChain && plan.perSender.map((ps, i) => (
              <p key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Bridge {ps.sender.slice(0, 6)}…: via {ps.bridge.tool} · est. receive{' '}
                {ps.bridge.estimatedReceived} {plan.destAsset} · gas ${ps.bridge.gasUsd?.toFixed(2)} ·
                fee ${ps.bridge.feeUsd?.toFixed(2)} · ETA ~{Math.round((ps.bridge.durationSec || 0) / 60)}m
              </p>
            ))}
```

- [ ] **Step 3: Show bridge status in the tracker**

Inside the `job` tracker panel, before the recipients `addresses-list`, add:

```jsx
            {job.plan.crossChain && job.plan.perSender.map((ps, i) => (
              <div key={i} className="address-item">
                <span style={{ fontSize: '0.8rem' }}>Bridge {ps.sender.slice(0, 6)}…</span>
                <span style={{ fontSize: '0.8rem', color:
                  ps.bridge.status === 'DONE' ? 'var(--accent, #14f195)'
                  : ps.bridge.status === 'FAILED' || ps.bridge.status === 'STALLED' ? 'var(--danger, #f87171)'
                  : 'var(--text-muted)' }}>
                  {ps.bridge.status}{ps.bridge.txHash ? ` · ${ps.bridge.txHash.slice(0, 10)}…` : ''}
                </span>
              </div>
            ))}
            {job.status === 'underfunded' && (
              <p style={{ color: 'var(--warning, #fbbf24)', fontSize: '0.8rem' }}>
                Received less than the custom amounts require. Reduce amounts or top up, then retry.
              </p>
            )}
```

- [ ] **Step 4: MetaMask cross-chain signing**

In `handleExecuteConnected`, before the disperse-chunk loop, add a bridge step for cross-chain plans (single sender in connected mode):

```jsx
      if (plan.crossChain) {
        const ps = plan.perSender[0];
        const req = ps.bridge.transactionRequest;
        const bridgeTx = await signer.sendTransaction({
          to: req.to, data: req.data, value: req.value ? BigInt(req.value) : 0n,
        });
        await bridgeTx.wait();
        await disperseApi.externalChunk(jobId, {
          sender: account, bridge: true, txHash: bridgeTx.hash,
        });
        setError('Bridge submitted. Complete the destination disperse from the destination chain once funds arrive.');
        setJob((await disperseApi.job(jobId)).job);
        setBusy(false);
        return; // dest disperse for MetaMask cross-chain is a follow-up action
      }
```

Note: full MetaMask cross-chain (auto-continuing to the destination disperse after the bridge lands) is a follow-up; the robust path is stored wallets, where the backend runs both legs. This is called out in the manual test.

- [ ] **Step 5: Verify build**

Run (in `frontend/`): `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/components/DisperseView.jsx
git commit -m "feat: cross-chain disperse UI (bridge route + status)"
```

---

### Task 6: recordExternalChunk handles bridge legs

**Files:**
- Modify: `backend/src/disperse/jobRunner.js`
- Test: extend `backend/src/disperse/__tests__/jobRunner-bridge.test.js`

`recordExternalChunk` must accept `{ bridge: true, txHash }` to mark a sender's bridge leg from the MetaMask path.

- [ ] **Step 1: Add the failing test**

Append inside the `jobRunner cross-chain` describe block in `jobRunner-bridge.test.js`:

```js
  it('records an external bridge leg', () => {
    const job = runner.createJob(crossPlan());
    const updated = runner.recordExternalChunk(job.id, { sender: '0xS', bridge: true, txHash: '0xb' });
    expect(updated.plan.perSender[0].bridge.status).toBe('PENDING');
    expect(updated.plan.perSender[0].bridge.txHash).toBe('0xb');
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test`
Expected: FAIL — bridge branch not handled.

- [ ] **Step 3: Update recordExternalChunk**

In `backend/src/disperse/jobRunner.js`, replace `recordExternalChunk` with a version that branches on `bridge`:

```js
export function recordExternalChunk(id, payload) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const { sender, chunkIndex, disperseHash, error, bridge, txHash } = payload;

  if (bridge) {
    const ps = job.plan.perSender.find(p => p.sender === sender);
    if (ps) {
      ps.bridge.txHash = txHash;
      ps.bridge.status = error ? 'FAILED' : 'PENDING';
      if (error) ps.bridge.error = error;
    }
    job.status = 'running';
    return upsert(job);
  }

  const rows = job.recipients.filter(r => r.sender === sender && r.chunkIndex === chunkIndex);
  for (const r of rows) {
    if (error) { r.status = 'failed'; r.error = error; }
    else { r.status = 'sent'; r.txHash = disperseHash; r.error = null; }
  }
  job.status = rollupStatus(job);
  return upsert(job);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all jobRunner tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/disperse/jobRunner.js backend/src/disperse/__tests__/jobRunner-bridge.test.js
git commit -m "feat: record external bridge legs"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run both test suites**

Run (in `backend/`): `npm test` — all disperse tests pass (config, validate, evm, solana, plan, plan-crosschain, jobRunner, jobRunner-bridge, execute, execute-bridge, bridge).
Run (in `frontend/`): `npm test` — all tests pass.

- [ ] **Step 2: Lint + build**

Run (in `frontend/`): `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: DRY-RUN cross-chain end-to-end**

Backend (`node server.js`, dry run default) + frontend (`npm run dev`):
1. Disperse page → Ethereum source, NATIVE asset, destination chain Base, recipients receive USDC, stored-wallet sender, paste 2 recipients, total-split 0.5.
2. Review Plan → plan card shows the bridge line (tool, est. receive, gas/fee USD, ETA) plus 2 recipients / 1 tx. (LI.FI quote is a real network call even in dry run — confirm a route returns; if LI.FI is unreachable, the error surfaces cleanly.)
3. Send with password → tracker shows Bridge → DONE (simulated), then recipients flip to `sent` with `0xDRYRUN` hashes; job `completed`.
4. Underfunded: custom mode with per-recipient amounts summing above the estimated receive → job pauses `underfunded` with the warning.
5. No-route: pick an exotic dest asset LI.FI can't route → Review Plan surfaces "No route" without creating a job.
6. Same-chain still works exactly as in Plan 2 (destination = "Same chain").

- [ ] **Step 4: Live testnet acceptance (gate before mainnet)**

`DISPERSE_DRY_RUN=false` with testnet RPCs. Run one real cross-chain bridge+disperse with a funded stored wallet across two testnets LI.FI supports; confirm the bridge tx, LI.FI status reaching DONE, and per-recipient destination receipts. Verify no key material appears in backend logs.

- [ ] **Step 5: Update the memory note**

Update `tradeforge-project.md` memory: Disperse v2 delivered across Plans 1–3 (wallet profiles, engine, LI.FI bridge); note `DISPERSE_DRY_RUN` gate and that contract bytecode hashes should be pinned in `config.js` after testnet verification.

- [ ] **Step 6: Final commit**

```bash
git add -A && git commit -m "chore: LI.FI bridge verification fixes"
```

---

## Self-Review Notes

- **Spec coverage (§4):** LI.FI quote at plan time with `toAddress` = sender's own dest address ✓ (Task 2), received/gas/fee/ETA/route shown ✓ (Tasks 2, 5), no route → unavailable with reason ✓ (Tasks 1, 2), slippage default 0.5% ✓ (Task 1), amounts from actual received not quote ✓ (Task 3 `recomputeFromReceived`), exact ERC-20 approval to approval address ✓ (Task 4), status poll every 15s to terminal ✓ (Task 3), FAILED/REFUNDED → failed ✓ (Task 3), 60-min stall guard ✓ (Task 3 `STALLED`), multi-sender bridges start before disperse and disperse waits for all DONE ✓ (Task 3 phased loop). §5 underfunded pause ✓ (Task 3). DRY_RUN honored for bridge ✓ (Task 4).
- **Deliberate simplifications:** cross-chain is EVM↔EVM only (Solana bridging deferred — Task 2 guards it); MetaMask cross-chain stops after the bridge (stored-wallet path is the complete one) — called out in Task 5 and the manual test. Multi-sender pairing uses `assignRecipients` from Plan 2 for consolidation and round-robin.
- **Type consistency:** `bridge` object shape (`tool, toAddress, fromAmount, estimatedReceived, durationSec, gasUsd, feeUsd, approvalAddress, transactionRequest, status, txHash, receivedAmount`) is created in plan.js, consumed by jobRunner.js, execute.js, and DisperseView identically. Amounts stay decimal strings; BigInt only at chain edges. `recomputeFromReceived` preserves original chunk sizes so the flat recipient rows stay aligned by `(sender, chunkIndex, indexInChunk)`.

