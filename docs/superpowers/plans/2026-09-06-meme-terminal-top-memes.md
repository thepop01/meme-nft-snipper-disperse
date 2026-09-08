# Meme Terminal Top-Memes Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Meme Finder + Sniper Bot into a Sniper Terminal that surfaces top memes on Solana and Robinhood Chain with explainable analysis, fed by pump.fun launches and GMGN intelligence.

**Architecture:** Add a backend GMGN discovery/enrichment adapter (trenches + trending + token security) alongside the existing PumpPortal and GeckoTerminal feeds; merge all signals in the existing registry → enrich → safety/traction → curated pipeline; expose Top Gainers / New Pairs / Alpha Calls via existing `/api/tokens` + new `/api/gmgn/*` routes; rebuild the frontend terminal to match the reference layout (KPI strip, Sniper config, Alpha Calls, Top Gainers, New Pairs, Trading Terminal) reusing existing `meme/*` components.

**Tech Stack:** Node.js Express backend, React + Vite frontend, Postgres tape (`backend/src/tape/`), PumpPortal WS, official `gmgn-cli` Agent API path (trending + trenches, `--raw` JSON), GeckoTerminal free API, DexScreener enrichment, existing vitest suites.

---

## 0. Research findings (verified 2026-09-06, do not re-guess)

### 0.1 Robinhood Chain (must hard-code, not guess)

- Arbitrum Orbit L2, mainnet 2026-07-01, testnet 2026-02-10.
- Chain ID `4663` (testnet `46630`), gas token ETH, ~100ms blocks, centralized sequencer operated by Robinhood, 10% net sequencer revenue to Arbitrum.
- RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- Already in codebase: `backend/src/discovery/evm.js:8-13` (`EVM_CHAINS.robinhood = { networkSlug: 'robinhood', chainId: 4663, ecosystem: 'hood.run' }`), `frontend/src/components/meme/TokenWorkspace.jsx:35,46-48` (Blockscout link + hood.run link), `frontend/src/components/meme/TokenRow.jsx:16` (chain color `#00c805`).
- Meme reality: CASHCAT peaked ~$156-200M, daily DEX vol peaked ~$563-809M mid-July 2026, Uniswap v2/v3/v4 + UniswapX is primary DEX, launchpads: hood.fun / NOXA (60k tokens, halted 07-11) / Doppler / Pools.trade, Pump.fun added Robinhood trading support. Gas subsidized via Robinhood Wallet for 90 days (~until 2026-09-29) — volume metrics during subsidy are inflated.
- Implication: treat Robinhood as EVM ERC-20 + Uniswap-V3-liquidity chain. Never assume bonding-curve semantics there. Always verify contract via 2 sources (impostors launched within hours of every pump).

### 0.2 Solana + pump.fun (already wired, keep)

- Pump.fun program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, AMM `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. Bonding curve = constant-product virtual reserves, 1.25% fee, auto-migrates to PumpSwap on graduation.
- Codebase already subscribes via PumpPortal WS in `backend/src/discovery/pumpfun.js:152-215` (`subscribeNewToken`, `subscribeMigration`, per-mint `subscribeTokenTrade`), with tape mapping in `handlePumpMessage` + `routePumpMessage`, baseline window in `backend/src/discovery/baselineController.js`, structural evidence in `backend/src/discovery/structuralEvidence.js`.
- Known gaps (from `doc/meme-sniper.md`, `strategy.md`): one-shot scoring, holder check blindly skips largest account, Raydium throttle drops events, PumpPortal trade collection missing = no efficiency/bot-share/flow. Do not add new features until Phase 0 fixes land.

### 0.3 GMGN (official CLI path — implemented, do not scrape)

- Official Agent API / `gmgn-cli` (`github.com/GMGNAI/gmgn-skills`), installed globally via `npm install -g gmgn-cli`. Backend shells out to `gmgn-cli ... --raw` and parses JSON — never scrape `gmgn.ai` (direct keyless rank-URL calls return Cloudflare 403 from our network, verified 2026-09-06).
- Verified commands: `market trending --chain sol|robinhood --interval 1m|5m|1h|6h|24h --order-by volume --limit N`, `market trenches --chain sol|robinhood --type new_creation|near_completion|completed --limit N`. GMGN natively supports `robinhood` in trending/trenches/signal — the only provider covering both target chains with smart-money/bundler/KOL dimensions.
- Verified trending item fields (live Solana output): `address, symbol, name, logo, price, price_change_percent{,1m,5m,1h}, volume, liquidity, market_cap, swaps, buys, sells, holder_count, top_10_holder_rate (0-1), smart_degen_count, renowned_count, sniper_count, bundler_rate (0-1), rug_ratio, bluechip_owner_percentage, rat_trader_amount_rate, bot_degen_rate, renounced_mint (0/1), renounced_freeze_account, burn_status, is_honeypot, is_wash_trading, buy_tax, sell_tax, lock_percent, launchpad_platform (Pump.fun/letsbonk/stonkfun/...), exchange, creator, creator_token_status, twitter_username, website, telegram, creation_timestamp/open_timestamp` (unix seconds).
- Verified trenches shape: buckets at TOP level (`{ new_creation, near_completion, completed }`, no `data` wrapper). Trench items use `created_timestamp` (not `creation_timestamp`) and carry `liquidity: 0` — they must bypass the trending liquidity floor and enter as raw `watching` observations.
- Credentials: Ed25519 keypair generated locally (Node crypto `pkcs8`/`spki` PEM, OpenSSL-compatible), public key uploaded at `https://gmgn.ai/ai`, API key `gmgn_3a…f4bb` stored in `%USERPROFILE%\.config\gmgn\.env` (`GMGN_API_KEY` + `GMGN_PRIVATE_KEY`, user-only ACL) and `backend/.env` (`GMGN_API_KEY`, gitignored). Backend loads it via `dotenv/config` (`backend/src/config.js:1`) and passes env through to the `gmgn-cli` child process.
- Windows note: npm global bins are `.cmd` shims — `execFile` requires `shell: process.platform === 'win32'`. Never pass secrets as CLI args; `GMGN_API_KEY` travels via env only.
- Integration rule: 60s poll for trending (5m/1h) + trenches, `GMGN_API_KEY` required (feed logs one warn and skips without it), never expose key to frontend, never use GMGN as sole buy trigger — always cross-check with DexScreener + on-chain RPC per `strategy.md` admission rules. Trading API (`x-route-key` swap/submit) is out of scope.

### 0.4 Reference image (AI-generated, layout only)

- Do NOT copy numbers ($PEPE2.0 +420%, $MOONPUP, fake PnL). Copy layout: top bar (logo SNIPER, tabs Dashboard/Sniper Bot/Alpha Calls/Positions/Watchlist/Analytics/Settings, chain selector Solana, wallet `0x3a2...97fc`, bell, avatar), KPI strip (Total P&L, Win Rate, Active Positions, Snipes Today, Alpha Calls, Live Scanning with pairs-scanned/new-tokens/high-potential), left nav (Overview/Sniper Bot/Alpha Calls/Watchlist/Positions/Analytics/Wallet Tracker/Settings + "Fastest to Alpha" footer), center (Sniper Bot Active card: Auto Sniping toggle, Slippage, Max Buy, Min Liquidity, Filters Anti-Rug/Honeypot/LP Locked/Mint Disabled, Save Settings; Alpha Meme Calls table Token/Strategy/Signals/Market Cap/Time/Action-Buy; Recent Snipes Token/Entry/Current/P&L/Status; Performance chart 1D/7D/30D/ALL), right rail (Top Gainers Live with 5m/1h/6h/24h tabs #/Token/Price/MC/24h; New Pairs Live Token/Age/Liquidity/MC), bottom Trading Terminal (chart 1m/5m/15m/1h/4h/1D + Price/MCap/Liq/Vol24h/Holders, Order Book Price/Amount/Total, Buy/Sell Market/Limit Amount SOL 25/50/75/100% Est.Tokens Buy button, Your Position Amount/Avg Price/Current Value/P&L Set TP/SL Close).

---

## 1. Approaches considered

### Approach A — GMGN-first discovery + existing pipeline as verifier (Recommended)

- Add `backend/src/discovery/gmgn.js` poller for Solana + Robinhood trending/trenches, register into `registry.js`, enrich with GMGN security/smart-money fields, keep DexScreener + RPC as verifiers.
- Pros: fastest path to "top memes with proper analysis" (smart-money, bundlers, holder count, 1m/5m momentum are GMGN-native); covers Robinhood where GeckoTerminal `new_pools` is thin; no new infra.
- Cons: GMGN Cloudflare rate limits; needs server-side caching. Mitigated by 30-60s polls + DexScreener fallback.
- Fits existing `PASS_SCHEDULE_MIN = [0,1,3,8,15,...]` in `backend/src/discovery/registry.js:63` and `evaluateLifecycle` gate.

### Approach B — Pure on-chain RPC + GeckoTerminal expansion

- Expand `evm.js` to poll hood.run/Uniswap subgraphs + Solana gRPC, build own trending.
- Pros: no third-party dependency, fully auditable.
- Cons: 3-6 weeks, needs indexer, misses smart-money/KOL labels entirely. Rejected for now; revisit as Phase 6 hardening.

### Approach C — Frontend-only GMGN iframe/links

- Add GMGN links only (already partially in `TokenWorkspace.jsx:40-48`).
- Pros: 1-hour change. Cons: no analysis, no ranking, does not meet "proper analysis" requirement. Rejected except as stopgap (Task 5 keeps the links).

---

## 2. File map (what changes where)

**Create:**

- `backend/src/discovery/gmgn.js` ✅ DONE — CLI-backed trending + trenches poller, normalizers, chain map `sol|robinhood`.
- `backend/src/discovery/__tests__/gmgn.test.js` ✅ DONE — 7 tests on live-shape fixtures, PASS.
- `backend/src/discovery/__tests__/gmgn-enrich.test.js` — merge-function test (Task 2).
- `frontend/src/components/meme/KpiStrip.jsx` — Total P&L / Win Rate / Active Positions / Snipes Today / Alpha Calls / Live Scanning.
- `frontend/src/components/meme/AlphaCallsTable.jsx` — Token / Strategy / Signals / Market Cap / Time / Buy.
- `frontend/src/components/meme/TopGainersPanel.jsx` — 5m/1h/6h/24h tabs, #/Token/Price/MC/change.
- `frontend/src/components/meme/NewPairsPanel.jsx` — Token/Age/Liquidity/MC.
- `frontend/src/components/meme/SniperConfigPanel.jsx` — Auto Sniping, Slippage, Max Buy, Min Liquidity, Filters, Save.
- `frontend/src/components/meme/TradingTerminal.jsx` — chart + stats + Buy/Sell ticket + Your Position (wraps existing `TokenChart.jsx` + `TradeTicket.jsx`).

**Modify:**

- `backend/server.js` ✅ DONE — `startGmgnFeeds()` wired after `startEvmFeeds()`; `/api/tokens` already includes robinhood (keep).
- `backend/src/discovery/enrich.js` — add `mergeGmgnIntelligence(token)` (verified CLI field names), keep DexScreener as price authority.
- `backend/src/discovery/evm.js:8-13` — add `hoodRun` + Uniswap V3 notes, keep GeckoTerminal as base.
- `backend/src/analysis/safety.js` + `backend/src/analysis/traction.js` — consume GMGN fields as additive signals (small weight per `strategy.md`), never as sole gate.
- `frontend/src/components/MemeFinderView.jsx:384-471` — compose terminal grid: KpiStrip + SniperConfig + AlphaCalls + TopGainers + NewPairs + TradingTerminal; add chain selector `Solana|Robinhood`.
- `frontend/src/components/SniperView.jsx:196-214` — add Live Scanning + chain badge, reuse SniperConfigPanel.
- `frontend/src/components/meme/TokenWorkspace.jsx:40-48` — add missing Robinhood GMGN link `https://gmgn.ai/robinhood/token/<mint>`.
- `frontend/src/utils/sniperApi.js` — add `api.gmgnTrending(chain, interval)`, `api.gmgnTrenches(chain)`.

---

## 3. Tasks (execute in order, one task per subagent)

### Task 1: GMGN discovery adapter (Solana + Robinhood) — ✅ DONE 2026-09-06

> As-built (supersedes the Step 1/Step 3 snippets below, which were drafted before live verification): `backend/src/discovery/gmgn.js` shells out to official `gmgn-cli ... --raw` via `runGmgnCli` (execFile, `shell:true` on win32, `GMGN_API_KEY` via env, 30s timeout, 8MB buffer). `GMGN_CHAINS = { solana: { cliChain: 'sol', chainId: null }, robinhood: { cliChain: 'robinhood', chainId: 4663 } }` with `minLiquidityUsd: 5000` floor for trending only. `normalizeGmgnRankItem` maps the verified live fields (`smart_degen_count → smartWallets`, `bundler_rate*100 → bundlerPct`, `top_10_holder_rate*100 → top10HolderPct`, `rug_ratio`, `renounced_mint === 1`, `is_honeypot === 1`); `normalizeTrenchesItem` adds `trenchType`, bypasses the floor, accepts `created_timestamp`. `fetchTrending`/`fetchTrenches` (top-level buckets) feed `startGmgnFeeds` (60s poll, intervals `5m`+`1h`, chain-aware dedupe via `getTokenByKey(chain:mint)` → `getTokenByMint`, skips with one warn when `GMGN_API_KEY` is unset). Wired in `backend/server.js` (import + `startGmgnFeeds()` after `startEvmFeeds()`). Live smoke test: `STONK liq=2875870 holders=25114 smart=249 rug=0.172`; `HOOD_NEW_N=60` → 60/60 normalized. Actual test file `backend/src/discovery/__tests__/gmgn.test.js` has 7 tests on live-shape fixtures — all pass. Git commit deferred (repo has a single `Initial commit`, whole tree untracked — commits start once the tree is intentionally staged, never with `.env`).

**Files:**

- Created: `backend/src/discovery/gmgn.js`
- Test: `backend/src/discovery/__tests__/gmgn.test.js` (7 tests, PASS)
- Modified: `backend/server.js` (import + start — done)

- [x] **Step 1: Write the failing test**

```js
// backend/src/discovery/__tests__/gmgn.test.js
import { describe, it, expect } from 'vitest';
import { normalizeGmgnRankItem, GMGN_CHAINS } from '../gmgn.js';

describe('normalizeGmgnRankItem', () => {
  it('maps rank item to registry token for solana', () => {
    const token = normalizeGmgnRankItem({
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'TEST', name: 'Test Token', logo: 'https://x/y.png',
      price: 0.00001245, liquidity: 120000, market_cap: 4200000,
      volume: 2400000, swaps: 5000, buys: 3000, sells: 2000,
      holder_count: 1842, smart_buy_24h: 12, smart_sell_24h: 3,
      sniper_count: 4, buy_tax: '0', sell_tax: '0',
      is_honeypot: 0, renounced: 1,
      launchpad_platform: 'Pump.fun', exchange: 'raydium',
      open_timestamp: 1725600000, creation_timestamp: 1725599000,
    }, 'solana');
    expect(token.mint).toBe('So11111111111111111111111111111111111111112');
    expect(token.chain).toBe('solana');
    expect(token.source).toBe('gmgn-trending');
    expect(token.liquidityUsd).toBe(120000);
    expect(token.smartWallets).toBe(12);
  });

  it('maps robinhood chain without solana assumptions', () => {
    const token = normalizeGmgnRankItem({ address: '0xAbC1230000000000000000000000000000000001', symbol: 'CASHCAT', liquidity: 50000, market_cap: 1000000 }, 'robinhood');
    expect(token.chain).toBe('robinhood');
    expect(token.mint).toBe('0xabc1230000000000000000000000000000000001');
  });

  it('exposes supported chains', () => {
    expect(GMGN_CHAINS.solana.rankSlug).toBe('sol');
    expect(GMGN_CHAINS.robinhood.gmgnSlug).toBe('robinhood');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/gmgn.test.js`

Result: FAILED with "Cannot find module '../gmgn.js'" as expected.

- [x] **Step 3: Write minimal implementation (as-built, see note above)**

The draft below is kept for history — it was superseded during live verification (direct-REST `fetchRank` replaced by `runGmgnCli`, `rankSlug/gmgnSlug` replaced by `cliChain`, trench handling added):

```js
// backend/src/discovery/gmgn.js
// GMGN discovery: trending rank + trenches for solana + robinhood.
// Server-side only (Cloudflare UA). Never auto-buys; registers into registry.
import { log } from '../bus.js';
import { registerToken, getTokenByMint } from './registry.js';

export const GMGN_CHAINS = {
  solana: { rankSlug: 'sol', gmgnSlug: 'sol', minLiquidityUsd: 5000 },
  robinhood: { rankSlug: 'robinhood', gmgnSlug: 'robinhood', minLiquidityUsd: 5000 },
};

const RANK_BASE = 'https://gmgn.ai/defi/quotation/v1/rank';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export function normalizeGmgnRankItem(item, chain) {
  const address = String(item?.address || '');
  if (!address) return null;
  const mint = chain === 'solana' ? address : address.toLowerCase();
  const liquidityUsd = item?.liquidity != null ? Number(item.liquidity) : null;
  if (liquidityUsd != null && liquidityUsd < (GMGN_CHAINS[chain]?.minLiquidityUsd ?? 5000)) return null;
  const createdAt = item?.creation_timestamp
    ? Number(item.creation_timestamp) * 1000
    : item?.open_timestamp ? Number(item.open_timestamp) * 1000 : Date.now();
  return {
    mint, chain,
    symbol: item?.symbol || '?',
    name: item?.name || item?.symbol || 'Unknown',
    imageUrl: item?.logo || null,
    source: 'gmgn-trending',
    createdAt,
    priceUsd: item?.price != null ? Number(item.price) : null,
    liquidityUsd,
    marketCapUsd: item?.market_cap != null ? Number(item.market_cap) : null,
    volume24hUsd: item?.volume != null ? Number(item.volume) : null,
    holderCount: item?.holder_count ?? null,
    smartWallets: item?.smart_buy_24h ?? null,
    smartSells: item?.smart_sell_24h ?? null,
    snipers: item?.sniper_count ?? null,
    buyTax: item?.buy_tax ?? null,
    sellTax: item?.sell_tax ?? null,
    isHoneypot: item?.is_honeypot === 1,
    renounced: Boolean(item?.renounced),
    launchpad: item?.launchpad_platform || null,
    dexId: item?.exchange || null,
    gmgn: { bluechipPct: item?.bluechip_owner_percentage ?? null, lockInfo: item?.lockInfo ?? null },
  };
}

async function fetchRank(chain, interval, orderby = 'volume') {
  const slug = GMGN_CHAINS[chain]?.rankSlug;
  if (!slug) return [];
  const url = `${RANK_BASE}/${slug}/swaps/${interval}?orderby=${orderby}&direction=desc`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
  });
  if (!res.ok) { log('warn', `GMGN ${chain} ${interval} returned ${res.status}`); return []; }
  const data = await res.json();
  return Array.isArray(data?.data?.rank) ? data.data.rank : [];
}

let timers = [];

export function startGmgnFeeds({ intervals = ['5m', '1h'] } = {}) {
  const poll = async () => {
    for (const chain of Object.keys(GMGN_CHAINS)) {
      for (const interval of intervals) {
        try {
          const items = await fetchRank(chain, interval);
          let added = 0;
          for (const item of items.slice(0, 50)) {
            const token = normalizeGmgnRankItem(item, chain);
            if (!token) continue;
            if (!getTokenByMint(token.mint)) { registerToken(token); added++; }
          }
          if (added) log('info', `GMGN ${chain} ${interval}: ${added} new tokens`);
        } catch (err) {
          log('warn', `GMGN ${chain} ${interval} poll failed: ${err.message}`);
        }
      }
    }
  };
  poll();
  const t = setInterval(poll, 60_000);
  t.unref?.();
  timers.push(t);
  log('info', 'GMGN feeds started (60s poll, solana + robinhood)');
}

export function stopGmgnFeeds() {
  for (const t of timers) clearInterval(t);
  timers = [];
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/gmgn.test.js`

Result: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add backend/src/discovery/gmgn.js backend/src/discovery/__tests__/gmgn.test.js
git commit -m "feat(discovery): add GMGN trending adapter for solana and robinhood"
```

Status: commit DEFERRED (repo has a single `Initial commit` with the whole tree untracked — stage intentionally later, never with `.env`).

### Task 2: Enrichment merge + safety/traction signals — ✅ DONE 2026-09-06

> As-built: `mergeGmgnIntelligence` in `backend/src/discovery/enrich.js` (pure, DexScreener stays price authority); pure `gmgnRiskChecks` in `backend/src/analysis/safety.js` (honeypot→fail, rug≥0.9→fail/−30, bundlers≥40/concentration≥50/unrenounced/wash→warn/−5, silent without evidence), applied as penalties in `analyzeToken` and surfaced with `score: null` on the out-of-scope path (Robinhood risk visible in UI); `aliasLaunchpad` in `backend/src/discovery/gmgn.js` maps `Pump.fun→pumpfun` so Solana tokens hit the supported scope; `traction.js` gains an additive `smartMoney` bonus (+8 for ≥10 smart/≥2 renowned, +4 for ≥3 smart, zero otherwise — existing weights untouched). Full backend suite: 73 files / 330 tests PASS.

**Files:**

- Done: `backend/server.js` import + `startGmgnFeeds()` (landed in Task 1)
- Modify: `backend/src/discovery/enrich.js:43-88`
- Modify: `backend/src/analysis/safety.js` + `backend/src/analysis/traction.js` (consume GMGN fields, small weight)
- Test: `backend/src/discovery/__tests__/gmgn-enrich.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/discovery/__tests__/gmgn-enrich.test.js
import { describe, it, expect } from 'vitest';
import { mergeGmgnIntelligence } from '../enrich.js';

describe('mergeGmgnIntelligence', () => {
  it('merges holder and smart-money fields without clobbering price', () => {
    const token = { mint: 'ABC', chain: 'solana', priceUsd: 0.001, liquidityUsd: 10000 };
    const merged = mergeGmgnIntelligence(token, {
      holder_count: 1842, smart_degen_count: 5, sniper_count: 2,
      rug_ratio: 0.3, bundler_rate: 0.1, top_10_holder_rate: 0.2,
      renounced_mint: 1, is_honeypot: 0,
    });
    expect(merged.priceUsd).toBe(0.001);
    expect(merged.holderCount).toBe(1842);
    expect(merged.smartWallets).toBe(5);
    expect(merged.rugRatio).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/gmgn-enrich.test.js`

Expected: FAIL with "mergeGmgnIntelligence is not a function".

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/discovery/enrich.js — append (keep existing enrichToken unchanged):
// Field names match the verified `gmgn-cli --raw` shapes (§0.3).
export function mergeGmgnIntelligence(token, gmgn) {
  if (!gmgn || typeof gmgn !== 'object') return token;
  if (gmgn.holder_count != null) token.holderCount = Number(gmgn.holder_count);
  if (gmgn.smart_degen_count != null) token.smartWallets = Number(gmgn.smart_degen_count);
  if (gmgn.renowned_count != null) token.renownedCount = Number(gmgn.renowned_count);
  if (gmgn.sniper_count != null) token.snipers = Number(gmgn.sniper_count);
  if (gmgn.top_10_holder_rate != null) token.top10HolderPct = Math.round(Number(gmgn.top_10_holder_rate) * 100 * 100) / 100;
  if (gmgn.bundler_rate != null) token.bundlerPct = Math.round(Number(gmgn.bundler_rate) * 100 * 100) / 100;
  if (gmgn.rug_ratio != null) token.rugRatio = Number(gmgn.rug_ratio);
  if (gmgn.bluechip_owner_percentage != null) token.bluechipPct = Number(gmgn.bluechip_owner_percentage);
  if (gmgn.rat_trader_amount_rate != null) token.ratTraderRate = Number(gmgn.rat_trader_amount_rate);
  if (gmgn.bot_degen_rate != null) token.botDegenRate = Number(gmgn.bot_degen_rate);
  if (gmgn.renounced_mint != null) token.renouncedMint = gmgn.renounced_mint === 1;
  if (gmgn.renounced_freeze_account != null) token.renouncedFreeze = gmgn.renounced_freeze_account === 1;
  if (gmgn.is_honeypot != null) token.honeypot = gmgn.is_honeypot === 1;
  if (gmgn.is_wash_trading !== undefined) token.washTrading = Boolean(gmgn.is_wash_trading);
  if (gmgn.buy_tax != null) token.buyTax = gmgn.buy_tax;
  if (gmgn.sell_tax != null) token.sellTax = gmgn.sell_tax;
  if (gmgn.lock_percent != null) token.lockPercent = Number(gmgn.lock_percent);
  if (gmgn.creator !== undefined) token.creator = gmgn.creator || token.creator || null;
  token.gmgnUpdatedAt = Date.now();
  return token;
}
```

`safety.js` addition (additive checks, small weight — never a sole gate): fail when `rugRatio >= 0.9`, warn when `bundlerPct >= 40` or `top10HolderPct >= 50` or `honeypot === true`. `traction.js` addition: bonus when `smartWallets >= 10` with `renownedCount >= 2`. Registry needs no gate change (`registerToken` already accepts any source; curation gate `CURATE_MIN_SCORE = 55` stays).

In `backend/src/discovery/registry.js`, no change required (verified: `registerToken` is source-agnostic).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/gmgn-enrich.test.js src/discovery/__tests__/gmgn.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/discovery/enrich.js backend/server.js backend/src/discovery/__tests__/gmgn-enrich.test.js
git commit -m "feat(discovery): wire GMGN feeds and intelligence merge"
```

### Task 3: Sniper terminal UI shell (KPI strip + panels, no fake data) — ✅ DONE 2026-09-06

> As-built: created `KpiStrip.jsx` (`computeKpis` + `computeTradeStats`), `TopGainersPanel.jsx` (`GAINER_TABS = 5m|1h|6h|24h`, `gainFor` with m5→h1→h24 fallback, `selectTopGainers`), `NewPairsPanel.jsx` (`selectNewPairs`). Tests use `.test.js` (frontend vitest `include` is `src/**/__tests__/**/*.test.js` — `.test.jsx` is NOT picked up). `KpiStrip` replaces `pulse-strip` (superset + real P&L/win-rate); panels stack with `TradeTicket` in a new `aside.meme-right-rail` (existing 3-col grid kept; ≤1200px rail spans full width). CSS added for `.kpi-strip/.kpi-card/.mini-tabs/.meme-right-rail`. Frontend suite 9 files/39 tests PASS; `npm run build` clean.

**Files:**

- Create: `frontend/src/components/meme/KpiStrip.jsx`
- Create: `frontend/src/components/meme/TopGainersPanel.jsx`
- Create: `frontend/src/components/meme/NewPairsPanel.jsx`
- Modify: `frontend/src/components/MemeFinderView.jsx:384-471`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/components/meme/__tests__/KpiStrip.test.jsx
import { describe, it, expect } from 'vitest';
import { computeKpis } from '../KpiStrip.jsx';

describe('computeKpis', () => {
  it('counts fresh launches and curated from real tokens', () => {
    const now = Date.now();
    const kpis = computeKpis([
      { createdAt: now - 10 * 60_000, volume5mUsd: 100, state: 'curated' },
      { createdAt: now - 2 * 3600_000, volume5mUsd: 0, state: 'watching' },
    ]);
    expect(kpis.newLaunches1h).toBe(1);
    expect(kpis.curated).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/KpiStrip.test.jsx`

Expected: FAIL with "Cannot find module '../KpiStrip.jsx'".

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/components/meme/KpiStrip.jsx
import React from 'react';

export function computeKpis(tokens) {
  const hourAgo = Date.now() - 60 * 60_000;
  return {
    newLaunches1h: tokens.filter(t => t.createdAt && t.createdAt > hourAgo).length,
    active5m: tokens.filter(t => (t.volume5mUsd ?? 0) > 0).length,
    curated: tokens.filter(t => t.state === 'curated').length,
    total: tokens.length,
  };
}

export default function KpiStrip({ tokens, positions, trades }) {
  const kpis = computeKpis(tokens);
  const wins = trades.filter(t => (t.pnlSol ?? 0) > 0).length;
  const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
  return (
    <div className="kpi-strip" data-testid="kpi-strip">
      <div className="kpi-card"><span>Total P&amp;L</span><strong>-- SOL</strong><small>live only</small></div>
      <div className="kpi-card"><span>Win Rate</span><strong>{winRate}%</strong><small>{wins} / {trades.length} trades</small></div>
      <div className="kpi-card"><span>Active Positions</span><strong>{positions.filter(p => p.status === 'open').length}</strong></div>
      <div className="kpi-card"><span>Live Scanning</span><strong>{kpis.total}</strong><small>{kpis.newLaunches1h} new / 1h · {kpis.curated} curated</small></div>
    </div>
  );
}
```

`TopGainersPanel.jsx` and `NewPairsPanel.jsx` render strictly from `tokens` prop sorted by `priceChange[target]` and `createdAt` — no hard-coded tokens, no fake percentages. Time tabs `5m|1h|6h|24h` map to `priceChange.m5|h1|h24` with `24h` fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/KpiStrip.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meme/KpiStrip.jsx frontend/src/components/meme/TopGainersPanel.jsx frontend/src/components/meme/NewPairsPanel.jsx
git commit -m "feat(ui): add sniper terminal KPI and gainers panels"
```

### Task 4: Alpha Calls + Sniper Config + Trading Terminal composition — ✅ DONE 2026-09-06

> As-built: `AlphaCallsTable.jsx` (`pickAlphaCalls`: curated-only, traction-sorted, strategy labels Smart Money/Narrative Shift/Early Liquidity/Social Momentum/Curated, Buy→TradeTicket); `SniperConfigPanel.jsx` (self-loads `api.bots()`, bot selector, Auto Sniping→start/stop, autoBuy/slippage/max-buy/min-liquidity/min-safety, filter chips honestly mapped: Anti-Rug→safety≥60, Honeypot→safety≥45, LP Locked→liq≥8000, Mint Disabled→safety≥75); `TradingTerminal.jsx` (header stats incl. GMGN holders/smart, `TokenChart`, pump.fun + GMGN + DexScreener links, Buy/Sell, position readout). Composed in `MemeFinderView` center column (config + calls above workspace, terminal below portfolio). Tests use `.test.js`. Frontend 10 files/41 tests PASS; build clean. No new `/api/gmgn/*` routes — GMGN flows through registry → `/api/tokens`, so no dead API.

**Files:**

- Create: `frontend/src/components/meme/AlphaCallsTable.jsx`
- Create: `frontend/src/components/meme/SniperConfigPanel.jsx`
- Create: `frontend/src/components/meme/TradingTerminal.jsx`
- Modify: `frontend/src/components/MemeFinderView.jsx`
- Modify: `frontend/src/utils/sniperApi.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/components/meme/__tests__/AlphaCalls.test.jsx
import { describe, it, expect } from 'vitest';
import { pickAlphaCalls } from '../AlphaCallsTable.jsx';

describe('pickAlphaCalls', () => {
  it('returns top curated tokens with reasons, never fabricates', () => {
    const calls = pickAlphaCalls([
      { mint: 'A', chain: 'solana', state: 'curated', traction: { tractionScore: 80 }, safety: { score: 70 } },
      { mint: 'B', chain: 'solana', state: 'watching', traction: { tractionScore: 99 }, safety: { score: 99 } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].mint).toBe('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/AlphaCalls.test.jsx`

Expected: FAIL with missing module.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/components/meme/AlphaCallsTable.jsx
import React from 'react';

export function pickAlphaCalls(tokens, limit = 5) {
  return tokens
    .filter(t => t.state === 'curated')
    .sort((a, b) => (b.traction?.tractionScore ?? 0) - (a.traction?.tractionScore ?? 0))
    .slice(0, limit);
}

export default function AlphaCallsTable({ tokens, onBuy }) {
  const calls = pickAlphaCalls(tokens);
  if (!calls.length) return <div className="panel"><div className="panel-title">Alpha Meme Calls</div><p className="text-dim">No curated calls yet — watch the scanner.</p></div>;
  return (
    <div className="panel">
      <div className="panel-title">Alpha Meme Calls <span className="text-dim">AI + onchain + social</span></div>
      <table className="data-table">
        <thead><tr><th>Token</th><th>Signals</th><th>Market Cap</th><th>Time</th><th></th></tr></thead>
        <tbody>{calls.map(t => (
          <tr key={t.key || t.mint}>
            <td><strong>{t.symbol}</strong> <small className="text-dim">{t.name}</small></td>
            <td className="text-dim">{t.launchpad || t.source} · T{t.traction?.tractionScore ?? '--'} S{t.safety?.score ?? '--'}</td>
            <td className="mono">{t.marketCapUsd ? `$${Math.round(t.marketCapUsd / 1000)}K` : '--'}</td>
            <td className="text-dim">{t.createdAt ? `${Math.round((Date.now() - t.createdAt) / 60000)}m ago` : '--'}</td>
            <td><button className="btn-primary btn-xs" onClick={() => onBuy?.(t)}>Buy</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
```

`SniperConfigPanel.jsx` binds to existing bot API (`api.bots()`): Auto Sniping toggle, Slippage select (5/10/15%), Max Buy SOL, Min Liquidity USD, filter chips Anti-Rug/Honeypot/LP Locked/Mint Disabled mapped to bot `minSafetyScore` + `maxTaxPct` + `requireRenounced`. Save calls `api.updateBot`. `TradingTerminal.jsx` wraps existing `TokenChart.jsx` + `TradeTicket.jsx` with header stats (Price/MCap/Liq/Vol24h/Holders) and chain-aware explorer links (Solscan for solana, Blockscout `robinhoodchain.blockscout.com` for robinhood, GMGN `gmgn.ai/{sol|robinhood}/token/<mint>`, pump.fun `pump.fun/coin/<mint>` for solana launchpad).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/meme/__tests__/AlphaCalls.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meme/AlphaCallsTable.jsx frontend/src/components/meme/SniperConfigPanel.jsx frontend/src/components/meme/TradingTerminal.jsx frontend/src/components/MemeFinderView.jsx frontend/src/utils/sniperApi.js
git commit -m "feat(ui): compose sniper terminal with alpha calls and trading terminal"
```

### Task 5: Chain switcher (Solana | Robinhood) + GMGN/pump.fun deep links — ✅ DONE 2026-09-06

> As-built: chain selector is now `Solana + Robinhood | Solana | Robinhood` (Monad option removed); `TokenWorkspace` Robinhood links = Hood Runs + GMGN (`gmgn.ai/robinhood/token/<mint>`); `backend/server.js /api/tokens` allowlist narrowed to `solana|robinhood`; guard test `chain-filter.test.js` pins robinhood chainId 4663 in both `evm.js` and `gmgn.js`. Backend 332 tests PASS, frontend 41 PASS, build clean.

**Files:**

- Modify: `frontend/src/components/MemeFinderView.jsx:431`
- Modify: `frontend/src/components/meme/TokenWorkspace.jsx:40-48`
- Modify: `backend/server.js:170-185`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/discovery/__tests__/chain-filter.test.js
import { describe, it, expect } from 'vitest';
import { EVM_CHAINS } from '../evm.js';

describe('chain matrix', () => {
  it('supports solana and robinhood only for this release', () => {
    expect(EVM_CHAINS.robinhood.chainId).toBe(4663);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/discovery/__tests__/chain-filter.test.js`

Expected: FAIL only if chainId drifts; otherwise documents the contract (still commit as guard).

- [ ] **Step 3: Write minimal implementation**

```jsx
// MemeFinderView.jsx chain selector — replace All chains with scoped list:
<select value={chain} onChange={e => setChain(e.target.value)}>
  <option value="">Solana + Robinhood</option>
  <option value="solana">Solana</option>
  <option value="robinhood">Robinhood</option>
</select>
```

```jsx
// TokenWorkspace.jsx — add Robinhood GMGN link:
...(chain === 'robinhood' ? [
  { label: 'Hood Runs', href: `https://hood.run/#${mint}`, icon: ExternalLink },
  { label: 'GMGN', href: `https://gmgn.ai/robinhood/token/${encodedMint}`, icon: ExternalLink },
] : []),
```

Backend `/api/tokens` already filters `['solana','monad','robinhood']` — narrow default to `solana,robinhood` when no `chain` param for this release.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/discovery/__tests__/chain-filter.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MemeFinderView.jsx frontend/src/components/meme/TokenWorkspace.jsx backend/server.js
git commit -m "feat(chains): scope terminal to solana and robinhood with GMGN links"
```

---

## 4. Non-goals / guardrails

- No live auto-buy from GMGN trending. Sniper only acts on `curated` queue via existing `botManager.js` risk gates (paper default, `DRY_RUN=true`). Every buy logs inputs, thresholds, evidence timestamp per `doc/meme-sniper.md`.
- No fake PnL, no hard-coded gainers, no copied token names from the AI image. All numbers render from `tokens`, `positions`, `trades` props with `--` fallbacks.
- No GMGN trading API (swap/submit) in this release. Discovery + intelligence only.
- No Monad/ETH/Base expansion in this release. Chain matrix is exactly Solana + Robinhood.
- Respect provider limits: GMGN via official CLI at 60s poll (trending 5m/1h + trenches), GeckoTerminal 60s, DexScreener 350ms gap (`enrich.js:32`). `gmgn-cli` must be installed globally (`npm install -g gmgn-cli`) and `GMGN_API_KEY` set in `backend/.env`. Server-side only, never call GMGN from browser.

## 5. Acceptance checks

- Prereqs: `gmgn-cli --version` works globally; `GMGN_API_KEY` in `backend/.env` (gitignored) and `%USERPROFILE%\.config\gmgn\.env`.
- `cd backend && npx vitest run` — gmgn (7) + enrich + all discovery/scoring tests pass.
- `cd frontend && npx vitest run` — KpiStrip + AlphaCalls tests pass.
- Manual: start backend (`npm start`), open `/memefinder`, chain selector shows Solana + Robinhood, Top Gainers tabs switch 5m/1h/6h/24h from live data, New Pairs shows age/liq/MC, Alpha Calls only lists `curated`, Buy opens existing TradeTicket in paper mode, TokenWorkspace shows pump.fun + GMGN links for Solana and hood.run + GMGN links for Robinhood.
- Replay/paper: curated queue stays small (most launches stay `watching`/`discarded` with reasons), per `PLAN.md` exit criteria.

## 6. Self-review (writing-plans checklist)

- Spec coverage: Solana ✓ (pump.fun + GMGN sol), Robinhood ✓ (GeckoTerminal + GMGN robinhood), pump.fun ✓ (existing feed kept), GMGN ✓ (new adapter), top-memes analysis ✓ (safety+traction+GMGN merge), terminal UI ✓ (6 panels mapped to reference layout).
- Placeholder scan: no TBD/TODO; every step has exact file, code block, command, expected output.
- Type consistency: `token.mint` (lowercased EVM), `token.chain` (`solana|robinhood`), `token.source` (`gmgn-trending|pumpfun|gecko-*|revival`), `token.smartWallets|holderCount|snipers|isHoneypot` used identically in backend + frontend.
