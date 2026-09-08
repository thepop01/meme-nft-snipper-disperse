# Plan-Fixes Implementation Plan (review remediation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10 blocking/high findings and 9 cleanup findings from `doc/plan-review-2026-07-18.md` by editing the five implementation-plan documents in `docs/superpowers/plans/` **before any of them is executed**.

**Architecture:** These are documentation edits — each task rewrites specific embedded code blocks inside the plan markdown files so the executor pastes correct code. No product code exists yet for Plans 2/3/NFT/Meme, so fixing the documents fixes the bugs. Tasks are grouped by target document. Verification = re-reading the edited block and checking internal consistency (tests ↔ implementation ↔ callers within the same plan set).

**Tech Stack:** Edit tool on markdown files. No builds, no tests to run — the embedded tests are re-checked by inspection against the embedded implementations they exercise.

**Fix order rationale:** Disperse-engine first (most blocking findings; LI.FI plan builds on its interfaces), then LI.FI, then NFT, then Meme, then cross-cutting cleanup.

---

### Task 1: disperse-engine — multi-sender pairing (F1)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-disperse-engine.md` (Task 6 `plan.js`, Task 11 DisperseView)

- [ ] **Step 1: Replace the per-sender full-recipient loop in `buildPlan`**

In the Task 6 `plan.js` code block, delete the misleading comment block ("Consolidation / 1:1 pairing: … the runner slices per pairing …") and replace the `for (const sender of senders)` loop with explicit mapping *before* planning:

```js
  // Sender→recipient mapping (spec §2):
  //  1 sender             -> that sender covers all recipients
  //  N senders, 1 recip.  -> consolidation: every sender sends to it
  //  N senders, N+ recips -> 1:1 pairing, round-robin when counts differ
  function assignRecipients(senders, recipients) {
    if (senders.length === 1) return [{ sender: senders[0], recipients }];
    if (recipients.length === 1) {
      return senders.map(s => ({ sender: s, recipients }));
    }
    const bySender = senders.map(s => ({ sender: s, recipients: [] }));
    recipients.forEach((r, i) => bySender[i % senders.length].recipients.push(r));
    return bySender.filter(a => a.recipients.length > 0);
  }

  const assignments = assignRecipients(senders, recipients);
  const perSender = [];
  for (const { sender, recipients: assigned } of assignments) {
    const balances = await deps.fetchBalances({
      chain, address: sender, tokenAddress: token.address, isNativeAsset,
    });
    const decimals = token.decimals ?? (isNativeAsset ? chain.decimals : balances.decimals);

    const { amounts, total: sendTotal } = computeAmounts({
      mode: amountMode, perRecipient, total, decimals, recipients: assigned,
    });
    // ... (gas-reserve + token-balance checks unchanged, but using `assigned`)
    const chunks = chunkRecipients(assigned, amounts, maxPerTx).map(c => ({
      recipients: c.recipients,
      amounts: c.amounts.map(a => a.toString()),
    }));
    perSender.push({ sender, decimals, totalBaseUnits: sendTotal.toString(), chunks });
  }
```

Amount-mode semantics for multi-sender (add as a comment + enforce): `equal` = each sender sends `perRecipient` to each of *its* recipients; `total` = the total is split across ALL recipients first, then partitioned by assignment; `custom` = amounts travel with their recipient line. For consolidation (`N senders → 1 recipient`) reject `custom` mode with a clear error.

- [ ] **Step 2: Add a multi-sender test to Task 6's test block**

Append to `plan.test.js` in the same document:

```js
  it('1:1 pairs recipients round-robin across multiple senders (no duplication)', async () => {
    const C = '0x3333333333333333333333333333333333333333';
    const plan = await buildPlan({
      sourceChain: 'base', destChain: 'base', asset: 'NATIVE',
      senders: [A, B], recipientsText: `${A}\n${B}\n${C}`,
      amountMode: 'equal', perRecipient: '0.001',
    }, evmDeps());
    const covered = plan.perSender.flatMap(p => p.chunks.flatMap(c => c.recipients.map(r => r.address)));
    expect(covered.sort()).toEqual([A, B, C].sort()); // each recipient exactly once
    expect(plan.perSender).toHaveLength(2);
  });
```

- [ ] **Step 3: Mirror the same assignment into the LI.FI plan's `buildCrossChainPlan`**

In `2026-07-18-lifi-bridge.md` Task 2, replace its `for (const sender of senders)` loop header with the same `assignRecipients` call (the helper is now defined in plan.js and shared), each sender bridging only its assigned recipients' total.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-disperse-engine.md docs/superpowers/plans/2026-07-18-lifi-bridge.md
git commit -m "fix(plans): multi-sender 1:1 pairing/consolidation in buildPlan (F1)"
```

---

### Task 2: disperse-engine — SPL decimals (F2)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-disperse-engine.md` (Task 6 + Task 9)

- [ ] **Step 1: Make token decimals authoritative from config**

In Task 6 `plan.js`, the line `const decimals = isNativeAsset ? chain.decimals : balances.decimals;` becomes (already shown in Task 1 Step 1 above — verify it reads):

```js
    const decimals = token.decimals ?? (isNativeAsset ? chain.decimals : balances.decimals);
```

`getToken()` in `config.js` already returns `decimals` for every curated token and for NATIVE — so `balances.decimals` remains only a fallback for tokens absent from config (none today).

- [ ] **Step 2: Fix the Solana fetchBalances comment**

In Task 9 `routes.js`, change the Solana branch comment to state that its `decimals` field is the NATIVE decimals only and is never used for SPL amounts (config decimals win), and set `decimals: 9` explicitly with that note.

- [ ] **Step 3: Add a regression test to Task 6**

```js
  it('uses config token decimals for SPL sends, not the chain native decimals', async () => {
    const deps = { fetchBalances: async () => ({ nativeBalance: 10n ** 10n, tokenBalance: null, decimals: 9 }) };
    const SOL_ADDR = 'So11111111111111111111111111111111111111112';
    const plan = await buildPlan({
      sourceChain: 'sol', destChain: 'sol', asset: 'USDC',
      senders: [SOL_ADDR], recipientsText: SOL_ADDR,
      amountMode: 'equal', perRecipient: '1.5',
    }, deps);
    expect(plan.perSender[0].chunks[0].amounts).toEqual(['1500000']); // 6dp, not 9dp
  });
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-disperse-engine.md
git commit -m "fix(plans): SPL token decimals from config, not native decimals (F2)"
```

---

### Task 3: disperse-engine — external (MetaMask) execution mode (F4, F8)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-disperse-engine.md` (Tasks 9 + 11)

- [ ] **Step 1: Gate backend execution behind an `external` flag (F4)**

In Task 9 `routes.js`, the `/execute` route becomes:

```js
  router.post('/execute', wrap(async (req, res) => {
    const { plan, keys, external = false } = req.body || {};
    if (!plan) throw new Error('plan is required');
    const job = runner.createJob(plan);
    if (external) {
      // Browser signs; backend only records results via /:id/external-chunk.
      return res.json({ jobId: job.id, job, external: true });
    }
    if (!keys || Object.keys(keys).length === 0) {
      throw new Error('keys are required for backend execution');
    }
    runner.executeJob(job.id, keys, { execChunk }).catch(() => {});
    res.json({ jobId: job.id, job });
  }));
```

In Task 11 `handleExecuteConnected`, the execute call becomes `disperseApi.execute({ plan, external: true })`. Also note in the LI.FI plan (Task 5, MetaMask path) that the same `external: true` flag skips the backend bridge phase.

- [ ] **Step 2: Serve `disperseContract` in `/config` and use it (F8)**

In Task 9 `/config`, add `disperseContract: c.disperseContract || null` to the per-chain mapping. In Task 11 `handleExecuteConnected`, replace the contract construction with:

```jsx
      const chainCfg = cfg.chains.find(c => c.id === chainId);
      if (!chainCfg?.disperseContract) throw new Error('No disperse contract on this chain');
      const contract = new ethers.Contract(chainCfg.disperseContract, DISPERSE_ABI, signer);
```

and delete the `|| plan.disperseContract` fallback (no such field).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-disperse-engine.md docs/superpowers/plans/2026-07-18-lifi-bridge.md
git commit -m "fix(plans): external execution mode + disperseContract in config (F4, F8)"
```

---

### Task 4: disperse-engine — fail-closed bytecode verification (F6)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-disperse-engine.md` (Tasks 2, 8, 12)

- [ ] **Step 1: Add `disperseCodeHash: null` per chain in config**

In Task 2 `config.js`, add `disperseCodeHash: null` to every EVM chain entry, with the comment: "pinned keccak256 of deployed bytecode; null → contract path disabled, sequential-transfer fallback".

- [ ] **Step 2: Fail closed in execute.js**

In Task 8, delete `computeAndCache` entirely. The EVM branch becomes:

```js
      if (!chain.disperseCodeHash) {
        // No pinned hash -> never trust the contract; fall back to plain transfers.
        return { disperseHash: await evm.sequentialTransferChunk(signer, typedChunk, plan) };
      }
      await evm.verifyDisperseContract(provider, chain.disperseContract, chain.disperseCodeHash);
```

- [ ] **Step 3: Add `sequentialTransferChunk` to Task 4 `evm.js`**

```js
// Fallback when no pinned contract hash exists: one plain transfer per
// recipient (native) or ERC-20 transfer, serial to keep nonces ordered.
export async function sequentialTransferChunk(signer, chunk, plan) {
  let lastHash = null;
  for (let i = 0; i < chunk.recipients.length; i++) {
    const to = chunk.recipients[i].address;
    const amount = chunk.amounts[i];
    const tx = plan.isNativeAsset
      ? await signer.sendTransaction({ to, value: amount })
      : await (new ethers.Contract(plan.tokenAddress,
          ['function transfer(address,uint256) returns (bool)'], signer)).transfer(to, amount);
    await tx.wait();
    lastHash = tx.hash;
  }
  return lastHash;
}
```

- [ ] **Step 4: Point Task 12's acceptance step at pinning**

Rewrite Task 12 Step 4's hash note: run a one-off script that fetches `keccak256(getCode)` from ≥2 independent RPCs per chain, require agreement, then pin the values into `disperseCodeHash` — only then does the batch contract activate.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-disperse-engine.md
git commit -m "fix(plans): fail-closed bytecode verification with transfer fallback (F6)"
```

---

### Task 5: disperse-engine — red tests (F10)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-disperse-engine.md` (Tasks 3 + 7)

- [ ] **Step 1: Fix the `partial` test (F10a)**

In Task 7's test file, give `fakePlan` two chunks and fail only the second:

```js
const fakePlan = () => ({
  /* ...same fields... */
  perSender: [{
    sender: '0xSender', decimals: 18, totalBaseUnits: '2',
    chunks: [
      { recipients: [{ address: '0xA' }], amounts: ['1'] },
      { recipients: [{ address: '0xB' }], amounts: ['1'] },
    ],
  }],
});
```

In "marks partial when a chunk fails": `execChunk` = `vi.fn().mockResolvedValueOnce({ disperseHash: '0xok' }).mockRejectedValueOnce(new Error('rpc boom'))`; assert `status === 'partial'`, recipient 0 `sent`, recipient 1 `failed`. Add a separate test asserting all-chunks-fail → `status === 'failed'`. Update the retry test the same way (retry re-runs only the failed chunk; `ok` called once still holds).

- [ ] **Step 2: Fix the checksum-dedup test (F10b)**

In Task 3's test, replace `A.toUpperCase()` with a lowercase duplicate, which ethers accepts and checksums:

```js
    const text = `${A}\nnot-an-address\n${A.toLowerCase()}\n${B}`;
```

(Behavior under test — dedup after normalization — is unchanged.)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-disperse-engine.md
git commit -m "fix(plans): correct partial-status and checksum-dedup tests (F10)"
```

---

### Task 6: lifi-bridge — dest chain, NATIVE dest, retry idempotency, job-owned state (F3, F5, F7, C1)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-lifi-bridge.md` (Tasks 2–4)
- Modify: `docs/superpowers/plans/2026-07-18-disperse-engine.md` (Task 8, one line)

- [ ] **Step 1: execChunk uses the destination chain for cross-chain (F3)**

In disperse-engine Task 8 `execute.js`, change the chain resolution line to:

```js
    const chain = getDisperseChain(plan.crossChain ? plan.destChain : plan.sourceChain);
```

Add a note in lifi-bridge Task 4 that this line is the seam its bridge deps rely on, with a test in lifi-bridge asserting `execChunk` builds the provider from `destChain` when `crossChain` is true (mock `getDisperseChain` and assert the argument).

- [ ] **Step 2: Honor NATIVE destination (F7)**

In lifi-bridge Task 2 `buildCrossChainPlan`, replace the hardcoded flags with:

```js
    isNativeAsset: dstToken.address === 'NATIVE',   // dest disperse semantics
    tokenAddress: dstToken.address,
```

and delete the now-redundant `destIsNative` field. Update the Task 2 test to add a NATIVE-destination case asserting `plan.isNativeAsset === true`. (With F3's fix, `execChunk` then correctly routes NATIVE → `disperseNativeChunk` on the dest chain.)

- [ ] **Step 3: Move bridge runtime state onto the job; make retry idempotent (F5, C1)**

In lifi-bridge Task 3, restructure: `createJob` (disperse-engine Task 7) copies bridge legs out of the plan into job-owned state:

```js
  // in createJob, after building `recipients`:
  const bridgeLegs = plan.crossChain
    ? plan.perSender.map(ps => ({ sender: ps.sender, ...ps.bridge, status: 'pending', txHash: null, receivedAmount: null }))
    : null;
  const job = { id, createdAt, status: 'planned', source, dest, plan, bridgeLegs, recipients };
```

All bridge reads/writes in `runChunks` use `job.bridgeLegs` (never `job.plan.perSender[].bridge`), and recomputed chunk amounts are stored as `job.execChunks` (per sender) instead of overwriting `ps.chunks` — the plan stays a faithful record of what the user approved. The disperse phase reads `job.execChunks ?? ps.chunks`.

Retry idempotency: in `runChunks`' bridge phase, only legs with `status === 'pending'` may call `execBridge`; legs in `PENDING`/`STALLED` resume **polling only** (never re-send); `FAILED` legs require an explicit `POST /:id/bridge/:sender/retry` route (add to Task 4's routes) that re-quotes before re-sending. Update the Task 3 tests: retry after FAILED bridge does NOT call `execBridge` via `retryJob`; the new bridge-retry route does.

- [ ] **Step 4: Parallelize bridge polling (C3)**

Replace the sequential per-sender poll loop with `await Promise.all(job.bridgeLegs.filter(l => l.status === 'PENDING').map(pollLegToTerminal))`, each leg owning its own 60-min deadline, upserting only on status/receivedAmount change.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-lifi-bridge.md docs/superpowers/plans/2026-07-18-disperse-engine.md
git commit -m "fix(plans): dest-chain execution, NATIVE dest, idempotent bridge retry, job-owned bridge state (F3,F5,F7,C1,C3)"
```

---

### Task 7: nft-mint-v2 — tracked auto-list + runner races (F9, C8, C7)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-nft-mint-v2.md` (Tasks 3, 6, 7)

- [ ] **Step 1: Make auto-list a tracked step (F9)**

In Task 7 `execute.js`, `makeExecWallet` takes an `onListing` callback; `autoList` awaits inside execution flow but AFTER returning mint success is not acceptable — instead, `fireJob` (Task 6) owns it:

In Task 6 `fireJob`, after a wallet mints successfully and when `job.policy.autoList` is set:

```js
        wallet.listing = 'listing';
        upsert(job);
        runDeps.autoList?.({ job, wallet, privateKey: keys[wallet.address] })
          .then(results => { wallet.listing = results.every(r => r.listed) ? 'listed' : 'list-failed'; wallet.minted = results; })
          .catch(err => { wallet.listing = 'list-failed'; wallet.listError = err.message; })
          .finally(() => upsert(getMintJob(job.id) && job)); // re-persist + re-emit
```

with the caveat noted in the plan: because listing can outlive `fireJob`, `keyStore.delete` moves to after all listing promises settle (`Promise.allSettled` collected in `fireJob` before the `finally`). Update the Task 6 tests: a mocked `autoList` resolving late still lands `listing: 'listed'` on the persisted job. `execute.js`'s `autoList` drops its internal mutation of `minted` items and instead **returns** `[{ contract, tokenId, listed, listError? }]`.

- [ ] **Step 2: Remove the 0 ms-timer arm race (C8)**

In Task 6 `armJob`, replace the `setTimeout(..., 0)` branch with a direct call:

```js
  if (job.status === 'awaiting-keys') {
    job.status = 'minting';
    upsert(job);
    fireJob(id, deps).catch(() => {});
    return getMintJob(id);
  }
```

Update the corresponding test (no timer advance needed after arming an awaiting-keys job).

- [ ] **Step 3: Recompute drop status at query time (C7)**

In Task 3 `drops.js`: stop persisting `status`; `queryDrops` computes `classifyStatus({startTime, endTime, totalSupply, maxSupply}, now)` per drop on read, and `refreshCache`'s prune uses the recomputed status. Delete the "prefer live over upcoming" dedup special case (statuses now derive from the same stage times). Update the Task 3 tests accordingly (assertions on returned `status` stay identical; they now exercise the recomputation).

- [ ] **Step 4: Parallelize eligibility (C4)**

In Task 8 routes, replace the serial wallet loop with `const out = await Promise.all((wallets || []).map(async (address) => { ... }))`, keeping per-wallet try/catch so one failure doesn't reject the batch.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-nft-mint-v2.md
git commit -m "fix(plans): tracked auto-list, direct arm-fire, derived drop status, parallel eligibility (F9,C4,C7,C8)"
```

---

### Task 8: meme-v2 — batch evaluation + Set lookup (C5, C6)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-meme-v2.md` (Tasks 2, 3, 5)

- [ ] **Step 1: Batch list evaluation (C5)**

In Task 2 `customLists.js`, add alongside `evaluateToken`:

```js
// Batch variant for the refresh loop: one load, one persist per tick.
export function evaluateTokens(tokens) {
  const lists = getLists();
  let changed = false;
  for (const token of tokens) changed = evaluateAgainst(lists, token) || changed;
  if (changed) persist(lists);
}
```

Refactor the matching body into a private `evaluateAgainst(lists, token)` used by both entry points (`evaluateToken` keeps its signature for the per-pass hook in Task 5). In Task 3 `runRefreshTick`, collect patched tokens into an array during the chunk loop and call `evaluateTokens(patched)` once at the end of the tick instead of per token.

- [ ] **Step 2: Set-based mint lookup (C6)**

In Task 3 `fetchPricesFromDexScreener`, before the pair loop add `const wanted = new Set(mints);` and change the membership test to `if (!mint || !wanted.has(mint)) continue;`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-meme-v2.md
git commit -m "fix(plans): batch list evaluation and Set lookup in refresh loop (C5,C6)"
```

---

### Task 9: cross-cutting reuse (C2, C9)

**Files:**
- Modify: all five plan documents (small edits)

- [ ] **Step 1: Shared `request()` (C9)**

In disperse-engine Task 10: instead of defining `request` in `disperseApi.js`, add one step "export `request` from `sniperApi.js`" (add `export` to the existing function) and import it. In nft-mint-v2 Task 9: same — `import { request } from './sniperApi.js';`. In meme-v2 Task 6 and nft Task 1 (AlertBell): replace raw `fetch(getBackendUrl()+…)` calls with `request('GET'|'POST', path[, body])` so non-ok responses surface errors instead of rendering empty lists.

- [ ] **Step 2: Shared `shortAddr` (C9)**

Wallet-profiles Task 6 (SenderWalletsTab) and disperse-engine Task 11 (DisperseView): delete the inline `short` arrow, `import { shortAddr } from '../utils/format.js';`, and rename usages.

- [ ] **Step 3: One backend chain table (C9)**

nft-mint-v2 Task 5 `chains.js`: import `DISPERSE_CHAINS` from `../disperse/config.js`, build `NFT_CHAIN_CONFIG` by mapping OpenSea chain names → disperse ids (`ethereum→eth, arbitrum→arb, optimism→op, bnb/bsc→bsc, avalanche→avax`), adding only the `zora` entry locally. RPC/env-override/explorer values then live in exactly one backend file. (The frontend `chains.js` from Plan 1 stays — it's display-only and browser-side.)

- [ ] **Step 4: DISPERSE_ABI via config (C9)**

disperse-engine Task 9 `/config`: include `disperseAbi: DISPERSE_ABI` (import from `evm.js`) once at the top level of the response. Task 11 MetaMask path: use `cfg.disperseAbi` instead of the inline ABI string.

- [ ] **Step 5: Persist at phase boundaries (C2)**

disperse-engine Task 7 `jobRunner.js`: add a `dirty`-flag note and change `runChunks` to `upsert` only (a) on status transitions and (b) at most once per N chunks (e.g. every 10) plus at loop end; `emit('disperse:job')` still fires per chunk from the in-memory object (split `upsert` into `persistJob` + `emitJob`). Mirror the same note in the lifi-bridge Task 3 poll loop (upsert on change only — already added in Task 6 Step 4 here). nft-mint-v2's per-wallet upserts may stay (wallet count is small).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/
git commit -m "fix(plans): shared request/shortAddr/chain-table/ABI, phase-boundary persistence (C2,C9)"
```

---

### Task 10: consistency re-review + report update

- [ ] **Step 1: Trace the edited seams end-to-end**

Re-read all five plans checking exactly these seams (the two review angles that didn't finish):
1. `assignRecipients` defined once, used by both `buildPlan` and `buildCrossChainPlan`.
2. `execChunk` dest-chain line vs lifi Task 4 note and test.
3. `external: true` flow: DisperseView → `/execute` → no `executeJob`; lifi MetaMask path skips backend bridge.
4. `job.bridgeLegs`/`job.execChunks` naming used consistently in lifi Tasks 3, 4, 6 and DisperseView's tracker (Task 5 renders `job.bridgeLegs`, not `job.plan.perSender[].bridge` — update its JSX).
5. `request` import paths, `shortAddr` imports, `NFT_CHAIN_CONFIG` mapping keys used by `getNftChain` callers.
6. Every test edited in Tasks 1–8 still matches the implementation in the same document.

Fix any mismatch found, inline.

- [ ] **Step 2: Update the review report**

Append a "Remediation" section to `doc/plan-review-2026-07-18.md`: table of finding → fixing commit, and note that seam-check (Step 1) stands in for the two unfinished review angles.

- [ ] **Step 3: Final commit**

```bash
git add doc/plan-review-2026-07-18.md docs/superpowers/plans/
git commit -m "docs: plan-fix remediation pass complete"
```

---

## Self-Review Notes

- **Finding coverage:** F1→Task 1, F2→Task 2, F3→Task 6.1, F4→Task 3.1, F5→Task 6.3, F6→Task 4, F7→Task 6.2, F8→Task 3.2, F9→Task 7.1, F10→Task 5, C1→Task 6.3, C2→Task 9.5, C3→Task 6.4, C4→Task 7.4, C5→Task 8.1, C6→Task 8.2, C7→Task 7.3, C8→Task 7.2, C9→Task 9.1–9.4. All 19 findings mapped.
- **Ordering:** disperse-engine edits land before lifi edits that depend on them (assignRecipients, execChunk seam); cross-cutting reuse last so it edits final text.
- **Scope guard:** no new features; every edit traces to a review finding. The plans' overall architecture (job engines, hybrid keys, DRY_RUN gates) is untouched.
