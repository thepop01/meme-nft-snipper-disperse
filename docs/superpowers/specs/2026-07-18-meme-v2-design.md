# Meme v2 — Design

**Date:** 2026-07-18
**Status:** Approved in brainstorming; pending implementation plan.
**Builds on:** the existing registry lifecycle (`watching → curated | discarded`,
re-analysis passes at 1/3/8/15 min) and `doc/meme-sniper.md`. Reuses the alert
center from the NFT Mint v2 spec.

## Summary

Keep curated meme tokens' prices live instead of frozen after the observation
window, let the user define rule-based custom lists that act as first-class
feeds beside Curated, and stamp entry prices so every feed shows % change since
curation — turning the feed into a scoreboard for curation quality.

## Decisions (locked)

| Question | Decision |
|---|---|
| Live prices | Continuous refresh (~45 s) for curated tokens, custom-list matches, and open positions, for as long as they hold that state. Watching tokens keep the existing 1/3/8/15-min passes. |
| Custom lists | Rule-based named lists (multiple allowed), evaluated automatically; separate feed tabs. No manual pinning, no override of the built-in gate. |
| Performance | % since curated/listed shown per token + aggregate stats strip per feed. |
| Alerts | In-app alert center only (from NFT Mint v2 spec). |

## 1. Live Prices

- `backend/src/discovery/registry.js` gains a **refresh loop**: every 45 s,
  collect all mints that are `curated`, matched to any enabled custom list, or
  held in an open position; batch-query DexScreener (up to 30 mints per call —
  its multi-token endpoint) and update `priceUsd`, `liquidityUsd`,
  `marketCapUsd`, `volume24hUsd`; append `{ts, priceUsd, liquidityUsd,
  marketCapUsd}` to `history`; emit `token:update` per changed token.
- The frontend already applies `token:update` to the feed and open drawer, so
  prices go live with no UI changes beyond displaying freshness.
- **Rug auto-flag**: a curated token whose liquidity drops ≥70 % from peak is
  marked `rugged` (kept visible with a red pill, excluded from the curated
  default filter), and an alert fires. No silent stale rows.
- Rate-limit safety: one batch call per tick regardless of token count (chunked
  at 30 mints/request, sequential chunks 500 ms apart); the loop skips a tick if
  the previous one is still running.

## 2. Custom Lists (rule-based)

**Backend** `backend/src/analysis/customLists.js` + routes under `/api/lists`:

- List = `{ id, name, color, enabled, rules, matched: [{ mint, listedAt,
  listedPriceUsd, exited: bool }], createdAt }`, persisted in
  `backend/data/custom-lists.json`. REST CRUD:
  `GET/POST /api/lists`, `PATCH/DELETE /api/lists/:id`.
- **Rules** (all optional, AND-ed): min/max liquidity USD · min safety score ·
  min traction score · max top-10 holder % · max age minutes · min 24 h volume ·
  source (`pumpfun`/`raydium`) · symbol/name keyword include list · keyword
  exclude list · min holder count · require socials (any of site/X/TG).
- **Evaluation**: after every analysis pass and every refresh tick, each
  enabled list's rules run against current token data. On entry: append to
  `matched` with `listedAt` + `listedPriceUsd` stamp, fire `alert:new`
  ("SYMBOL matched list 'NAME'"), emit `token:listed` WS event. Tokens can
  match multiple lists. Leaving criteria sets `exited: true` (marker shown;
  manual ✕ removes the entry) — matches are never silently dropped.
- Matched tokens join the 45 s refresh loop even if never curated by the
  built-in gate.

**Frontend** (MemeFinderView):

- Feed toggle becomes ✨ Curated · All · one colored tab per enabled list.
- A Lists manager modal: create/edit/delete, one form field per rule (blank =
  ignore), enable/disable toggle, live match count.
- Rows in a list tab show which rule(s) admitted the token (tooltip), the
  `exited` marker when applicable, and a ✕ to remove.

## 3. Since-Curated Performance

- Entering `curated` stamps `curatedPriceUsd` (alongside the existing
  `curatedAt`). Custom-list entries stamp `listedPriceUsd` per list (see §2).
- Feed rows + drawer show **% since curated/listed** (green/red) computed from
  the live price.
- Stats strip per feed tab (Curated and each custom list): median % change,
  win rate (> 0 %), best and worst performer — windows: 24 h and 7 d. Computed
  on request from stamped prices + current prices (`GET /api/lists/:id/stats`,
  `GET /api/tokens/curated-stats`); no extra storage beyond the stamps.
- This makes built-in curation and each custom list directly comparable —
  the user can prove whether their criteria beat the default gate.

## Testing

- Unit (vitest, backend): rule evaluator (each rule, combinations, keyword
  include/exclude, blank-rule ignore), entry-price stamping on curate/list,
  % -change computation, refresh-loop batching and chunking (mocked
  DexScreener), rug auto-flag threshold, exited-marker transitions.
- Integration: registry pass → list evaluation → WS events sequence with a
  mocked bus; restart persistence of lists and stamps.
- Manual acceptance: a token visibly updating price in the curated feed ≥ 15
  min after launch; creating a list whose rules match an existing token
  (immediate match + alert); stats strip showing plausible values; a
  simulated liquidity collapse flagging `rugged` + alert.

## Out of Scope (v2)

- Manual pinning of arbitrary tokens to lists.
- Custom lists replacing/overriding the built-in curation gate.
- OR-logic or nested rule groups (rules are AND-ed only).
- Price alerts on user-set thresholds (alert center covers list entry + rug
  events only in this build).
- Telegram/Discord notifications.
