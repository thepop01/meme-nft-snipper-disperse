# Meme Finder — Strategy Audit & BWC Duplicate Fix

_Date: 2026-07-20_

This report reviews every strategy on the Meme Finder page, identifies which
ones are producing results versus which are effectively dead, and recommends
what to keep, change, delete, replace, or add. It also documents the curated
wallet / curated-token criteria (curation is itself a strategy) and the root
cause + fix for the "BWC token showing multiple times, in all chains, in all
tabs" bug.

## How this was measured

The 12 built-in strategies live in
`frontend/src/utils/memeStrategies.js` (`DEFAULT_STRATEGIES`). Each has a
`matches(token)` predicate run client-side against the live token feed. The
audit compared each predicate against the current registry snapshot
(`backend/data/tokens.json`, 300 tokens: 291 `watching` / 9 `curated`;
sources: 275 pump.fun, 15 gecko-robinhood, 9 revival, 1 raydium) plus the
tracked tier (`/api/tracked`: 16 entries).

Key field-population facts from that snapshot (this is what kills or feeds each
strategy):

| Field the strategies rely on | Tokens with a usable value |
| --- | --- |
| `top10HolderPct` | **0 / 300** (never populated) |
| `attentionBoost` | **1 / 300** |
| `safety.score >= 70` | 0 / 227 scored |
| `safety.score >= 60` | 12 / 227 scored |
| `traction.tractionScore >= 45` | 3 / 226 |
| `traction.tractionScore >= 35` | 17 / 226 |
| `liquidityUsd >= $50k` | 8 |
| `liquidityUsd >= $25k` | 10 |
| `liquidityUsd >= $10k` | 12 |
| `volume5mUsd >= $5k` | 14 |
| `volume5mUsd > 0` | 82 |

The single most important finding: **`top10HolderPct` is populated on zero
tokens**, because nothing in the enrichment pipeline computes holder
concentration. Any strategy leg that requires it can never fire.

## Strategy-by-strategy verdict

### Alive and useful — keep

- **Movers & Revivals** (`movers`) — the Udin/Jimothy catcher. Matches on
  `source === 'revival'` (backend `movers.js` promotes aged tokens that surge)
  or an age+liquidity+momentum combo. The revival source alone gives it a
  steady supply (9 revival tokens in the snapshot, more promoted to tracked).
  This is the strategy the whole v3 redesign was built around. Keep as-is.

- **All Discovered** (`all-discovered`) — the research firehose,
  `matches: () => true`. Always populated by construction. Keep.

- **Curated Core** (`curated`) — matches `state === 'curated'`. Currently 9
  tokens. Small but real, and it is the output of the curation gate (see
  "Curation criteria" below). Keep. One inconsistency to fix: its `rules`
  advertise `minSafetyScore: 40, minTractionScore: 20`, but the backend
  curation gate actually requires safety >= 55. The displayed rule understates
  the real bar — align the label to 55 (see Recommendations).

- **Fresh Launch Momentum** (`fresh-momentum`) — age <= 2h, 5m vol >= $5k,
  buy/sell >= 1.1, liq >= $10k. All legs are populated fields. With 14 tokens
  at vol5m >= $5k and 12 at liq >= $10k, this returns a handful of matches at
  any time. Keep — this is a healthy young-launch filter.

- **Migration Watch** (`migration-watch`) — pump.fun / bonding-curve source,
  5m vol >= $2k, >= 1 pass. 275 pump.fun tokens feed it and the volume bar is
  low enough to match. Keep.

- **Early Microcaps** (`early-microcaps`) — mcap $10k-$250k, age <= 6h, liq >=
  $5k. Populated fields, reasonable bar. Keep.

### Marginal — keep but retune

- **Quality Breakout** (`quality-breakout`) — safety >= 60 AND traction >= 45
  AND liq >= $25k. Each leg individually has some matches (12 / 3 / 10), but
  the intersection of all three is near-empty right now (the 3 tokens above
  traction 45 are unlikely to also clear safety 60 and liq $25k). It is not
  dead by construction — the fields exist — but the combined bar is so high it
  almost never returns anything. Lower to safety >= 55, traction >= 35, liq >=
  $15k so it produces the "higher-confidence" shortlist it promises without
  being empty in practice.

- **Reversal Watch** (`reversal-watch`) — below first observed price AND
  traction >= 35 AND liq >= $10k. Depends on `history` having an early
  baseline, which curated/tracked tokens accumulate but fresh ones do not. It
  works for older tokens only, so it is sparse but not broken. Keep, and note
  in the UI copy that it needs price history to populate.

- **Risk Watch** (`risk-watch`, monitoring-only) — `rugged` OR safety < 40 OR
  top10 > 50%. The `rugged` and low-safety legs work and produce matches; the
  `top10 > 50%` leg is dead (never populated). Keep the strategy — it is still
  useful for the first two legs — but drop the dead top10 leg until holder
  concentration is actually computed.

### Dead by construction — fix the data or remove

- **Liquidity-Safe Memes** (`liquidity-safe`) — **DEAD**. Requires safety >=
  70 (0 tokens qualify) AND liq >= $50k (8 tokens) AND `top10HolderPct <= 35`
  (0 tokens — the field is never populated, and the predicate treats
  `null` as a fail via `top10HolderPct != null`). The intersection is
  guaranteed empty. This strategy has never returned a token and cannot until
  (a) holder concentration is computed and (b) the safety score can actually
  reach 70. **Recommendation: either implement holder-concentration
  enrichment (see below) or remove this strategy.** Shipping a permanently
  empty strategy erodes trust in the whole panel.

- **Attention & Flow** (`attention-flow`) — **NEARLY DEAD**. Requires
  `attentionBoost` truthy (1 / 300) AND buy/sell >= 1.2 AND traction >= 35.
  The attention signal is the bottleneck: DexScreener token-boosts/profiles
  rarely match our discovered tokens, so `attentionBoost` is almost never set.
  Before this audit the matcher was also chain-blind (see BWC section), which
  made the rare match unreliable. **Recommendation: keep only if attention
  coverage improves; otherwise fold it into Movers.** With the chain-aware fix
  applied it is at least correct when it does fire.

## Curation criteria (curation is a strategy)

"Curated Core" and the curated wallet/token list are produced by the backend
lifecycle gate in `backend/src/discovery/registry.js`. A token moves
`watching -> curated` only when **all** of these hold on a re-analysis pass:

- `safety.score >= 55` (`CURATE_MIN_SCORE`)
- `liquidityUsd >= $5,000` (`CURATE_MIN_LIQUIDITY_USD`)
- at least **2** completed analysis passes (`CURATE_MIN_PASSES`)
- not shrinking: traction `liquidityGrowthPct > -30%` **and**
  `mcapGrowthPct > -30%`

Re-analysis passes run on a schedule after discovery, in minutes:
`[0, 1, 3, 8, 15, 30, 60, 120, 240]` (`PASS_SCHEDULE_MIN`). Each pass
re-enriches, re-scores safety + traction, and appends to `history`.

A token is **discarded** when any of these fire (checked before curation, so a
rug disqualifies even a curated token):

- liquidity drops **> 70%** from its observed peak (`DISCARD_LIQ_DROP_PCT`) —
  treated as a rug signal
- safety score still `< 25` (`DISCARD_MAX_SCORE`) after >= 2 passes
- no meaningful activity within 6h (`DISCARD_MAX_AGE_MIN = 360`) for tokens
  that never showed life

A token that completes all 9 passes without being curated but showed some life
(volume/liquidity/peak-liquidity ever > $1,000, `DORMANT_ACTIVITY_USD`) goes
**dormant** instead of discarded: it stays in the system with lightweight
monitoring so spike detection can re-activate it days later. Dormant wake fires
on a **3x volume** or **2x liquidity** spike in the refresh loop
(`VOLUME_SPIKE_MULT` / `LIQ_SPIKE_MULT`), which resets passes and re-queues the
token for full analysis. This is the mechanism that catches sleeper revivals
like Udin.

The **tracked tier** (`backend/src/analysis/tracked.js`) is a separate curated
list on top of this: curated tokens, revivals, and high-traction tokens are
auto-promoted, and it runs its own cadence tiers (normal 5 min, quiet-48h 30
min) with sleeper-wake and slow-climber detection.

## Recommendations summary

**Delete or gate behind a data fix:**

- `liquidity-safe` — dead by construction (needs `top10HolderPct`, never
  populated, plus an unreachable safety >= 70). Remove it, or implement holder
  concentration first.

**Retune thresholds so they stop returning empty:**

- `quality-breakout` — safety 60->55, traction 45->35, liq $25k->$15k.
- `curated` — display bar should read safety >= 55 (matches the real backend
  gate), not 40.

**Trim dead legs:**

- `risk-watch` — drop the `top10 > 50%` leg until holder data exists.
- `attention-flow` — keep only if attention coverage improves; otherwise fold
  into Movers.

**Add (fills real gaps):**

1. **Holder-concentration enrichment** — compute `top10HolderPct` (Solana:
   `getTokenLargestAccounts` / holder API; EVM: holder index). This is the
   single change that revives `liquidity-safe` and the `risk-watch` top10 leg,
   and it is a genuine safety signal we currently claim to use but do not.
2. **Volume-surge / high-flow strategy** — `volume5mUsd > 0` covers 82 tokens
   but only 14 clear $5k; a mid-tier "5m volume >= $1k AND buy/sell >= 1.3"
   strategy would surface early flow the current bars miss.
3. **Graduated / migrated strategy** — pump.fun tokens that actually complete
   their bonding curve and migrate to Raydium are the real graduation signal;
   `migration-watch` currently lumps all curve tokens together.

**Keep unchanged:** `movers`, `all-discovered`, `fresh-momentum`,
`migration-watch`, `early-microcaps`, `reversal-watch`.

## The BWC bug — "shows multiple times, in all chains, in all tabs"

BWC = "Bull Wif Cup", an EVM token
(`0x30272953a5141934ca905ea6ee0727b541f7425c`, source `gecko-robinhood`). It
appeared duplicated, on every chain filter, and in every tab. Five distinct
root causes, all now fixed:

1. **Registry reload dropped the chain-aware key**
   (`registry.js` `loadTokens`). Tokens are keyed `chain:address` for EVM but
   `loadTokens` did `tokens.set(t.mint, t)` — reloading BWC under its plain
   `0x...` mint. The live GeckoTerminal feed then re-registered it under
   `robinhood:0x...`, so the same token existed under two keys = a duplicate
   row. **Fix:** reload under `t.key || tokenKey(t.mint, t.chain)`.

2. **Analysis-queue lookups used `token.mint` not `token.key`**
   (`registry.js` `pumpAnalysisQueue`). EVM tokens keyed `chain:addr` failed
   the `tokens.has(token.mint)` guard. **Fix:** use `token.key ?? token.mint`.

3. **Enrichment picked the deepest DexScreener pair with no chain filter**
   (`enrich.js`). An EVM address can exist on several chains; the deepest pair
   was often on a different chain, so BWC inherited another chain's
   price/liquidity — which is why it looked live "in all chains". **Fix:**
   `pickPair()` restricts to the token's own `chainId` (mapped via
   `DEXSCREENER_CHAIN_ID`), falling back to all pairs only when the chain is
   unknown so Solana never regresses.

4. **Refresh loop had the same no-chain-filter bug and a broken key lookup**
   (`refreshLoop.js`). It collected plain mints and looked tokens up by mint,
   so EVM tokens keyed `chain:addr` were either missed or patched
   chain-blind. **Fix:** `collectRefreshMints` now returns `{mint, chain}`
   descriptors, the DexScreener fetcher filters pairs by chain, and
   `processPrices` resolves tokens via `getTokenByKey` and patches by
   `before.key`.

5. **Frontend WS handlers deduped/selected by `mint` not key**
   (`MemeFinderView.jsx`). Even with the backend fixed, `token:new` /
   `token:update` / `token:discarded` matched on `mint`, so a same-address
   token on another chain would clobber or duplicate the row. **Fix:** all
   three handlers now dedupe and select by a chain-aware key
   (`token.key || chain:mint`).

Additionally, **attention matching was chain-blind** (`attention.js`) — boosts
were keyed by lowercased address only, so a boost on one chain could light up a
same-address token on another. Fixed by keying boosts/profiles and the socials
snapshot as `chainId:address` and passing the token's chain through
`getAttentionSignals`.

### Why "in all tabs"

The tabs (strategies) all read from the same token feed. Because BWC carried
another chain's inflated liquidity/volume (root cause 3) and existed under two
keys (root cause 1), the duplicated + mis-enriched record satisfied multiple
strategy predicates and rendered under multiple keys — so it showed up
everywhere at once. Fixing the keying and chain-scoped enrichment collapses it
back to a single correct row on its own chain.

### Verification

- Backend: 151/151 tests pass (added `getTokenByKey` to the refresh-loop mock,
  updated collect/fetch tests for the new `{mint, chain}` descriptor shape, and
  corrected the stale `RULE_FIELDS` expectation that was already failing before
  this work).
- Frontend: 39/39 tests pass; `npm run build` is clean.
- The duplicate cannot recur across a server restart because reload now
  preserves the chain-aware key.

