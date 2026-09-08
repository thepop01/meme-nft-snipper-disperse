# Project Memory (local fallback — Hindsight MCP unavailable 2026-09-06)

> Typed per `AGENTS.md` taxonomy so these can be imported into Hindsight later
> (`hindsight_retain` with the listed type). No secrets are stored here — only
> locations and conventions. Code is source of truth; this file records why.

## ARCHITECTURE_DECISION

1. **GMGN via official `gmgn-cli --raw` child process.** Direct scraping of
   `gmgn.ai/defi/quotation/v1/rank/...` returns Cloudflare 403 from our
   network (verified 2026-09-06). Backend-only, `GMGN_API_KEY` passed via env,
   never as CLI args, never to the frontend. (`backend/src/discovery/gmgn.js`)
2. **GMGN data absorbed into the existing pipeline** (registry → enrich →
   safety/traction → curated). No separate `/api/gmgn/*` routes — they would
   be dead API since the registry already carries GMGN fields to `/api/tokens`.
3. **Sniper reacts only to the curated queue**, paper mode by default
   (`DRY_RUN=true`), manual Buy confirmation. No auto-buy from GMGN trending.
4. **Terminal UI reuses existing components** (`meme/*`, `.data-table`,
   `.panel` CSS). Right rail stacks TradeTicket + Gainers + New Pairs inside
   the existing 3-col grid; `KpiStrip` replaced (not duplicated) `pulse-strip`.
5. **GMGN scoring is penalties/additive-only.** Safety applies penalties
   (honeypot→cap 10, rug≥0.9→−30, warns→−5); traction adds a smart-money bonus
   (+8/+4, capped at 100). Existing weights untouched; absent evidence changes
   nothing (`unknown ≠ zero`).

## PROJECT_DECISION

6. **Chain scope is Solana + Robinhood only** for this release (user choice
   2026-09-06). Monad removed from the Meme Finder selector and the
   `/api/tokens` allowlist. Robinhood pinned to chain ID 4663.
7. **No git commits until the tree is intentionally staged.** Repo has a single
   `Initial commit`; everything is untracked. Never commit `.env`
   (root + backend gitignored).
8. **Frontend tests must be `.test.js`.** `frontend/vitest.config.js`
   `include` is `src/**/__tests__/**/*.test.js` — `.test.jsx` files are
   silently ignored.
9. **Sniper filter chips map honestly to real bot thresholds**: Anti-Rug→
   safety≥60, Honeypot→safety≥45 (sell-route is inside the score), LP
   Locked→liq≥8000, Mint Disabled→safety≥75. No fake mappings.

## PROJECT_REQUIREMENT

10. **GMGN prerequisites:** `gmgn-cli` installed globally
    (`npm install -g gmgn-cli`); `GMGN_API_KEY` in `backend/.env` (gitignored)
    and `%USERPROFILE%\.config\gmgn\.env` (user-only ACL); Ed25519 public key
    uploaded at `https://gmgn.ai/ai`.
11. **Paper + manual Buy until replay/paper acceptance passes** (`PLAN.md`
    exit criteria). Sniper defaults to the conservative paper agent.
12. **Product principles** (`doc/implementation-plan.md`): identify tokens by
    `(chainId, tokenAddress)`; providers/venues behind adapters; PnL from
    confirmed fills, not intent; explainable matches and risk labels.
13. **Every automated decision needs an immutable audit record** with inputs,
    thresholds, evidence timestamp, and risk-gate outcome (`doc/meme-sniper.md`).

## KNOWN_PROBLEM

14. **Windows npm bins are `.cmd` shims** — `execFile` needs
    `shell: process.platform === 'win32'`.
15. **GMGN trenches shape:** buckets at top level (`new_creation`,
    `near_completion`, `completed` — no `data` wrapper); trench items carry
    `liquidity: 0` (must bypass the trending floor, curation gate still
    applies) and use `created_timestamp` (not `creation_timestamp`).
16. **Repo hygiene:** single `Initial commit`, whole tree untracked, root
    README (a `# bot` stub) deleted in worktree. Needs a real README and an
    intentional first commit.

## LESSON_LEARNED

17. **Live-verify provider shapes before finalizing normalizers.** Plan
    snippets were superseded twice by actual `gmgn-cli --raw` output.
18. **`icacls` with a bare `%USERNAME%` creates a broken ACE**
    (`shubh\` with empty user → file inaccessible). Grant `domain\user`
    (`shubh\shubh`) explicitly.
19. **Prefer official API/CLI paths over scraping** — Cloudflare blocks
    datacenter requests; the official path also yields richer fields
    (rug_ratio, bundler_rate, smart_degen_count).

## IMPLEMENTATION_PATTERN

20. **TDD with pure-function normalizers + live-shape fixtures**
    (`backend/src/discovery/__tests__/gmgn.test.js`); registry curation gate
    (`CURATE_MIN_SCORE = 55`) stays unchanged. Backend 332 / frontend 41 tests
    green 2026-09-06; both builds clean.

## TEMPORAL_CHANGE

21. **2026-09-06: discovery approach changed** from direct-REST rank polling
    (plan draft) to official `gmgn-cli` (as-built). Reason: Cloudflare 403 on
    direct calls + verified official CLI covering both target chains.
    Supersedes the Task 1 draft in
    `docs/superpowers/plans/2026-09-06-meme-terminal-top-memes.md`.
