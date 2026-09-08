# Plan v3 — Sleeper tracking, multi-chain (ETH + Robinhood), NFT drops fix
_Date: 2026-07-18. Investigation done live against OpenSea + DexScreener APIs; findings verified, not guessed._

## Part 1 — Case study: why $JIMOTHY worked (and what our scanner can learn)

Jimothy The Raccoon (`Ge87...pump`), launched July 16 on pump.fun → ~$11.5M market cap by July 18, +200% in 24h, ~$40M daily volume, ~52x from launch.

Why it pumped (per Bloomingbit + trader analysis on X):
1. **The narrative existed BEFORE the token** — a real Seattle raccoon with 10M+ views, Reddit fan art, lore. The token was just the on-chain wrapper for pre-existing attention.
2. **KOL pile-on** accelerated it across crypto Twitter.
3. **Platform amplification** — pump.fun Trending page + official X post, Moonshot verification.
4. **Reflexive loop** — volume → visibility → more buyers.

What a scanner can actually detect (in order of practicality):
- **It survived day 1 with growing liquidity/volume.** This is exactly the "sleeper" class we currently lose. Multi-day tracking (Part 3) is the single highest-value fix.
- **Breadth**: ~100k buys/24h, buys > sells, small average trade size = organic crowd, not 3 insider wallets. We already get txn counts from DexScreener and don't use breadth.
- **Pool proliferation**: 30 pools spawned (Meteora DLMM farms follow momentum). Pair-count growth is a free momentum signal in the DexScreener response we already parse.
- **Attention data is the leading indicator**: DexScreener token-boosts/token-profiles endpoints (free, no key) + pump.fun trending. Cross-referencing those against our watchlist approximates "narrative exists off-chain" without doing NLP on Reddit.

## Part 2 — What we have now (audited 2026-07-18)

### Meme scanner — better than believed, but sleeper handling is broken
The registry is NOT "drop after 15 min" anymore: it has a 9-pass schedule out to 240 min, then a `dormant` state with a 45s refresh loop and spike detection intended to wake sleepers. But in practice sleepers are still lost, for five concrete reasons:

1. **BUG (fatal): spike-wake has never worked.** `discovery/refreshLoop.js` `detectSpike()` calls `emit()` (lines 123, 130) but only imports `log` from bus.js → ReferenceError the moment any spike fires → the whole refresh tick aborts. Dormant tokens can never reactivate.
2. **Dormant tokens are evicted first.** `MAX_TOKENS = 300` and `trim()` deletes oldest dormant tokens before anything else. Pump.fun registers hundreds of launches/hour, so a sleeper is pushed out of memory within hours. Day-2 runners are structurally impossible to catch.
3. **No persistence.** The registry is an in-memory Map; every backend restart wipes watching/dormant/curated tokens.
4. **Wrong spike metric.** Wake compares 24h-volume between two 45-second ticks (needs 3x jump). A 24h rolling number moves too slowly — wake fires far too late or never.
5. **Wake schedule bug.** On reactivation `runPass` schedules next passes from `token.createdAt`; for a day-old token all 9 passes are past-due, so they burn back-to-back in ~2 min and it returns to dormant immediately.

Minor: `applyMarketPatch` appends to `history` with no cap (runPass caps at 20) → unbounded growth for curated/dormant tokens + inconsistent traction math. Traction scoring only rewards fast movers (+30% liq, 5m buy pressure); slow steady climbers score "warn" forever — no higher-lows/slope metric.

### NFT mint bot — why the list is "still wrong" (verified live today)
1. **OpenSea killed the `upcoming` and `featured` feeds** — both return 0 drops globally (tested every chain). Our upcoming view can never populate.
2. **The `chains=` filter is broken server-side**: `chains=base` returns 0 even though base drops exist in the unfiltered list; `chains=ethereum` returns 3 vs 42 unfiltered. Our 16 per-chain requests per cycle fetch a tiny skewed subset and waste the 60/min rate limit.
3. **The payload shape changed.** Drops now carry `is_minting`, `next_stage`, `opensea_url`, and NO `total_supply`/`max_supply`/`stages[]`. Our normalizer ignores all the new fields → 34 of 45 cached drops sit at status "unknown"; sold-out detection can never trigger; drops without `end_time` stay "live" forever (July 9 drops still shown as live) and are never pruned.
4. **Zombie carry-forward**: drops missing from a fetch are carried forward indefinitely, so the stale set never clears.
5. Upside discovered: the unfiltered feed already includes `robinhood`, `megaeth`, `shape`, `ape_chain` drops — free multi-chain expansion.

## Part 3 — The plan

### Phase 0 — Scanner quick fixes (half a day)
- Import `emit` in refreshLoop.js (unbreaks spike-wake).
- Cap history in `applyMarketPatch` (ring buffer, keep ~200 samples with downsampling for old entries — traction needs the early baseline).
- Persist the registry to `data/tokens.json` (debounced save on change, load at boot).
- On spike-wake, schedule re-analysis passes relative to wake time, not `createdAt` (add `passBaseAt`).

### Phase 1 — NFT drops rebuild (1 day) — user-visible pain, do first
- Replace 16 per-chain requests with **one unfiltered `recently_minted` fetch** per 5-min cycle; filter chains client-side. Add `robinhood`, `megaeth`, `shape`, `ape_chain` to `NFT_CHAINS` + `chains.js` (robinhood chainId 4663).
- Normalize v2: `is_minting` is the authoritative live flag; times/price from `active_stage`; `next_stage` gives the real "upcoming" (next stage of live drops — the only upcoming data OpenSea still exposes); link from `opensea_url`; drop supply-based sold-out logic (data no longer exists) — treat `is_minting: false` flip as ended.
- Pruning: a drop absent from N=3 consecutive fetches and not minting → ended; hard-expire carry-forwards after 24h.
- Acceptance: list matches opensea.io spot-checks; no status:"unknown" entries; no week-old "live" zombies.

### Phase 2 — Tracked tier: sleepers, day-2 runners, slow climbers (2–3 days)
New long-horizon watchlist, separate from the 300-cap discovery registry:
- `data/tracked.json`, capacity ~100 tokens, retention up to **14 days**, never touched by `trim()`.
- **Auto-promotion** into tracked: survived 6h with liq > $10k; OR traction score ≥ 60 at any pass; OR curated; OR manual pin from UI ("Track" button — the user's "few selected tokens").
- **Cadence tiers** (all batched DexScreener, 30 mints/request, fits free limits): curated + open positions 45s; tracked 5 min; tracked-but-quiet-48h 30 min.
- **Real sleeper wake**: keep rolling h1-volume samples in tracked history; wake when current h1 vol > 3x trailing 6h average, or price +15% in 30 min, or liquidity +2x. On wake: full re-analysis series (relative to now), `SLEEPER WAKE` alert, eligible for agent-mode entry.
- **Slow-climber detector** (the "climbs slowly then jumps" class): on 5-min samples compute higher-low streak and mcap slope over 6h/24h. Streak ≥ 6h of higher lows + positive slope → `climber` badge + alert; exposed to bot agent mode as an entry signal alongside traction.
- **Breadth + pool-count signals** (Jimothy lessons): avg trade size (volume/txns; small = organic) and pair-count growth added to traction as new weighted signals.
- UI: "Tracked" tab showing curated + tracked + dormant with age, wake events, climber badges, and per-token sparkline from history.

### Phase 3 — Multi-chain: Ethereum + Robinhood Chain (3–4 days)
Robinhood Chain context (July 2026): mainnet live ~July 1, chain id **4663**, Arbitrum-stack L2, currently the hottest memecoin venue ($400–500M daily DEX volume, CASHCAT etc.). DexScreener supports it (slug `robinhood`).
- **Registry becomes chain-aware**: key `chain:address`, `token.chain` ∈ solana | ethereum | robinhood; UI chain filter chips. Solana path unchanged.
- **Discovery**:
  - Ethereum: GeckoTerminal free API `GET /api/v2/networks/eth/new_pools`, poll 60s; filter to WETH/USDC-quoted, min initial liquidity (ETH gas makes micro-caps untradeable — set floor ~$25k liq).
  - Robinhood: same via network slug (verify exact GeckoTerminal slug at build time; fall back to polling DexScreener `latest/dex/search?q=` per new-pairs if needed). **Tag launchpad hook-gated pools** (can't be bought pre-graduation by outside routers) so bots never try to enter them.
- **Enrichment**: existing DexScreener path already works for EVM addresses — minimal change.
- **Safety scoring per chain**: Solana keeps current checks. EVM scorer: GoPlus `token_security` API (free) for honeypot/tax/ownership/mintable, holder concentration (top-10 share via RPC), LP lock heuristic, contract verified on explorer. Same 0–100 scale so lifecycle/curation gates reuse unchanged.
- **Scope guard**: v1 is watch/track/curate/alert only — **no EVM execution**. Buying on ETH/Robinhood needs router integration + gas management + nonce handling; that is its own later phase behind the same DRY_RUN discipline.
- Traction, lifecycle, tracked tier: reused as-is (all inputs are DexScreener pair fields, chain-agnostic).

### Phase 4 — Attention signals (optional, 1–2 days)
- Poll DexScreener `token-boosts/latest` + `token-profiles/latest` (free) every 5 min; flag matches in watching/tracked ("boosted" badge, traction bump) — proxy for the Jimothy "narrative arrived" moment.
- Social-presence signal already exists (enrich socials) — add "socials appeared after launch" event detection (teams add links right before pushing).

### Order & prerequisites
Phase 0 → 1 → 2 → 3 → 4. Reminder: 38 confirmed findings from the 2026-07-17 code review are still unfixed (`doc/code-review-2026-07-17.md`) — the top-5 idempotency fixes remain mandatory before any live-money trading, independent of this plan.
