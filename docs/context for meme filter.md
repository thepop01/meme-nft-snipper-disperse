Memecoin Filtering: Full Context for a Sniper Pipeline (Solana + Robinhood Chain)

0\. How the pros structure it

Almost every serious alpha group / bot uses a two-layer system:



Hard filters (kill switches) – binary pass/fail. If any fails, skip the token. Fast, on-chain, milliseconds.

Soft scoring – weighted heuristics that produce a score (0–100). Score decides whether to buy, how much to size, and when to exit.

Latency matters: hard filters must run in <1 slot (\~400ms on Solana). Anything requiring API calls to Twitter/DexScreener runs asynchronously and affects sizing rather than entry.



There is no formal "industry standard," but there is a strong de facto consensus around the checks below. The free tools (RugCheck, GMGN, Bubblemaps, Photon/BullX/Axiom UI flags) essentially codify what alpha groups do manually.



1\. Token / Contract-Level Filters (Solana SPL)

Check	Why	Typical rule

Mint authority revoked	Dev can print infinite supply	Must be null

Freeze authority revoked	Dev can freeze your wallet from selling	Must be null

Metadata mutable	Dev can swap name/image later (rug-and-rebrand)	Soft flag; immutable preferred

Token program	SPL Token vs Token-2022	Token-2022 extensions are red flags unless zero

↳ Transfer fee extension	Hidden sell tax	Fee must be 0%

↳ Transfer hook	Arbitrary code on transfer = honeypot vector	Reject

↳ Permanent delegate	Dev can move tokens from any wallet	Reject

↳ Non-transferable / default-frozen	Obvious	Reject

Supply / decimals sanity	Weird decimals break pricing bots	Standard: 6 or 9 decimals, \~1B supply (pump.fun standard)

Update authority	Who controls metadata	Pump.fun tokens default to pump.fun authority = "normal"

Pump.fun / LetsBonk / Moonshot tokens are created via factory programs, so mint/freeze are auto-revoked. The danger there is not contract-level, it's distribution-level (see §3).



2\. Liquidity-Level Filters

Launchpad vs. raw pool – Bonding-curve launches (pump.fun, letsbonk.fun, Moonshot, Boop) can't rug liquidity pre-migration. Raw Raydium/Meteora/Orca pools created directly by a dev can.

LP burned or locked – For Raydium AMM v4 / CPMM pools: LP tokens should be sent to the burn address or a locker (Streamflow, etc.). PumpSwap (pump.fun's own AMM) auto-burns LP on migration.

Initial liquidity size – Too low (<5 SOL) = trivially manipulable; suspiciously high from a fresh wallet = likely bundled.

Liquidity-to-market-cap ratio – MC/liquidity > \~10–15× means price is fragile; you can't exit.

Bonding curve progress % – Many snipers only enter at 0–5% (earliest) or at 85–100% (pre-migration, anticipating the migration pump). Mid-curve is often dead zone.

Migration event – Pump.fun → PumpSwap/Raydium migration is itself a filter/trigger. "Migrated" tokens have survived a \~$60–70k MC bonding curve, which weeds out most instant rugs.

Pool age / creation slot – Used to detect re-launched pools and to enforce "buy only within first N slots" or "wait N slots to let bundlers dump."

3\. Holder Distribution Filters (most important on Solana)

This is where 80% of rugs on pump.fun-style platforms get caught.



Top 10 holders % (excluding LP/bonding curve) – Common threshold: <15–25%. Some groups use top 5 <10%.

Dev wallet % – Deployer holding >5% is a flag; >10% usually reject. Also flag if dev holds 0% (already sold before you got there).

Bundled buys (Jito bundles) – Multiple wallets buying in the same slot as token creation = dev bought his own supply with 5–30 wallets. Detect via: same slot, same funding source, sequential wallet creation, identical buy sizes. Bots display "Bundled: 34%". Threshold: reject if bundled supply >20–30% and not yet sold.

Sniper count in first slots – How many bot wallets got in slot 0–2. High sniper concentration = they'll dump on you.

Insider wallets – Wallets funded from the dev wallet or the same CEX withdrawal chain. Requires funding-tree analysis (walk SystemProgram.transfer history back 2–4 hops).

Fresh wallet ratio – Wallets created <24h holding most supply = sybil/bundle. Aged wallets with real history = organic.

Holder count and growth velocity – e.g., >100 holders in 5 min organic; but 500 holders all with 0.01% each in 30 sec = airdrop/sybil.

Known wallet labels – Smart money (GMGN/Cielo tagged), KOLs, known ruggers, known bot farms.

Holder overlap with previous rugs – If the same 20 wallets appear across the dev's last 5 tokens, it's a farm.

Gini / HHI concentration – Some quant groups compute a concentration index instead of raw top-10.

Bubblemaps cluster check – Visual/algorithmic cluster detection of linked wallets. Groups reject if one cluster controls >15–20%


4. Deployer / Dev Wallet Filters

Deployer history – Pull every token this wallet has created. Metrics: number of launches, % that rugged (LP pulled or dev dumped >50% within 1h), best ATH multiple, average lifespan. Rule of thumb: >3 prior launches all dead in <1h → reject. Serial deployer with 1–2 real runners → mild positive.

Deployer funding source – Where did the SOL come from? Fresh CEX withdrawal (Binance/Coinbase/OKX hot wallet) is neutral-to-good. Funded from another deployer wallet, a mixer, or a known rugger cluster → reject.

Deployer wallet age – Created <1h before launch and funded with exactly the launch cost → likely a disposable farm wallet.

Deployer SOL balance – Nearly empty after launch = no skin in game.

Dev buy on creation – On pump.fun, dev buys in the same tx as creation. 0–3% dev buy is normal; 10%+ is a dump risk; 0% dev buy on a "hyped" launch is sometimes a positive (community-first) but check for hidden bundles.

Dev sold % – Real-time tracking of deployer sells. Many bots hard-exit the moment dev sells >50% of their bag.

Linked wallets – Wallets that received SOL from the deployer within 24h of launch are treated as dev-controlled.

Deployer reputation databases – Alpha groups maintain private blacklists (rugger addresses) and whitelists (devs known for legitimate runners). This is one of the biggest real edges.

Rug-and-relaunch detection – Same name/ticker/image as a token that just died → almost always a relaunch farm. Compare metadata hashes and image URIs.

5\. Trading / Volume Pattern Filters

Buy/sell ratio in first N minutes – Organic launches lean heavily buy-side early; >40% sells in first 2 min = distribution happening.

Unique buyers vs. total buys – 200 buys from 12 wallets = wash trading.

Volume/MC ratio – Very high volume relative to market cap with flat price = wash or bot churn.

Wash trading fingerprint – Repeated identical buy sizes, round numbers, same-slot buy+sell pairs, wallets that only ever interact with this token.

Volume bot detection – Many devs pay for "volume bots" to trend on DexScreener. Signature: thousands of tiny alternating buys/sells from freshly funded wallets, each funded with \~0.05 SOL.

Price impact per buy – Measure how much your intended size will move price. Common rule: skip if your buy moves price >3–5%.

Slippage-required check – Simulate the swap; if honest slippage required is >15%, liquidity is fake or too thin.

Sell simulation (honeypot test) – Simulate a sell transaction via RPC simulateTransaction before buying. If sell fails or returns near-zero → honeypot.

Time-to-first-organic-buy – If nobody except bundlers bought in first 30s, the dev has no audience.

Large sell walls / MEV pattern – Detect sandwich-bot presence (Jito tip spikes on this token); heavy MEV means your entries get front-run.

Chart shape heuristics – Vertical wick up then instant retrace = bundle dump. Staircase up with rising holders = organic. Some groups actually run simple pattern classifiers on the first-5-minute candles.

6\. Social / Narrative Filters (async, affects sizing not entry)

Metadata completeness – Twitter, Telegram, website present. Missing all three = low-effort spam launch. All three present but created today = low value.

Twitter/X account checks – Account age, follower count, follower quality (bot ratio), whether the handle was recently renamed (rename = recycled account). Twitter handle in metadata that doesn't exist → flag.

Telegram group – Member count, member growth rate, ratio of messages to members, admin count, whether the group existed before the token.

Website – Domain age (WHOIS), whether it's a pump.fun template, whether it links back to the correct contract.

Narrative match – Is the token riding a live meta? (celebrity tweet, news event, AI agents, political, animal meta, etc.). Groups track "what's pumping right now" and only ape tokens matching the current 24–48h narrative.

Origin of the meme – Real viral content (a tweet with 100k likes, a news clip) vs. fabricated. First-mover tokens on a real viral event outperform 10th copies dramatically.

KOL involvement – Which influencers have bought (wallet tracking) or posted. Also negative: known paid-shill KOLs are a sell signal.

Ticker collision – If 40 tokens with the same ticker launched in the last hour, you need to identify the "real" one (usually earliest with most organic volume) and avoid the copies.

Name/image quality – Crude heuristics: AI-generated slop image, gibberish name, emoji-spam. LLM-based classifiers are increasingly used here.

Sentiment scrapers – Twitter/Telegram mention velocity over 5/15/60 min windows.

Dex/CT listing signals – DexScreener paid boost, "DEX paid" (dev paid $300 for DexScreener info update — mild commitment signal), CoinGecko/CMC fast-track.

7\. Timing / Market Regime Filters

SOL price action – Memecoin risk-on correlates with SOL trending up. Many groups cut sizing 50%+ when SOL is dumping.

Time of day – US afternoon / evening (UTC 14:00–02:00) has the most liquidity and runners. Asian session runners exist but exit liquidity is worse.

Launch rate – When pump.fun spawns 30k+ tokens/day, per-token attention is diluted; filters should tighten.

Graduation rate – % of pump.fun tokens migrating in the last hour. Low graduation rate = dead market, tighten filters.

Current meta saturation – 5th token on a narrative gets a fraction of the first one's flows.

Network congestion – High priority fees / failed tx rates make sniping unreliable; some bots pause.

8\. Robinhood Chain Specifics

Robinhood Chain is an Arbitrum Orbit L2 (EVM), currently in testnet/early rollout, primarily built for tokenized stocks — not a memecoin venue yet. Context you need:



Realistic situation:



Very few if any meme launches. Liquidity will initially be Robinhood-controlled tokenized RWAs, not permissionless memes.

If/when memes appear, they'll use standard EVM tooling (Uniswap-style pools) so filters are the EVM playbook, not the Solana one.

EVM filter checklist (applies to Robinhood Chain, Base, Arbitrum, etc.):



Check	Detail

Contract verified	Unverified source on the chain explorer = reject

Ownership	owner() renounced (0x000…dead), or check what owner-only functions exist

Proxy / upgradeable	Upgradeable proxy = dev can change logic post-launch → reject

Mint function	Any callable mint() → reject

Blacklist / whitelist functions	Can block your wallet from selling

Max tx / max wallet	Legit anti-bot, but check they can't be set to 0

Trading enabled toggle	enableTrading() / setTradingOpen() – dev can disable sells

Tax functions	Buy/sell tax; check max settable value (some contracts let dev set 99% sell tax)

Hidden transfer logic	Bytecode analysis for \_transfer overrides, hidden approve drains

Honeypot simulation	eth\_call a swap in → swap out; standard tools: honeypot.is, GoPlus, Token Sniffer

LP lock	LP tokens burned or locked (Unicrypt, Team Finance, or native locker)

Deployer nonce / history	Same as Solana: deployer's previous contracts and their fate

Bytecode similarity	Hash the bytecode; compare to known rug templates and known-good templates

Same-block sniping / MEV	On Orbit chains the sequencer is centralized, so no Jito-style bundles; first-come-first-served, latency to sequencer matters

Standard EVM data sources: GoPlus Security API, Token Sniffer, De.Fi Scanner, Honeypot.is, DexScreener, Bubblemaps (supports EVM chains), Arkham labels.



Practical advice: build the EVM filter module now against Base or Arbitrum (which have real memecoin flow) so it's battle-tested by the time Robinhood Chain opens up.



9\. How It Fits Together: A Representative Scoring Model

text

Copy

HARD FILTERS (any fail = skip):

&#x20; mint\_authority == null

&#x20; freeze\_authority == null

&#x20; no Token-2022 dangerous extensions

&#x20; sell\_simulation succeeds

&#x20; bundled\_supply\_unsold < 30%

&#x20; top10\_holders < 30%

&#x20; dev\_holdings < 15%

&#x20; deployer not on blacklist

&#x20; not a relaunch of a dead token (name+image hash)



SOFT SCORE (0–100):

&#x20; Distribution (35 pts)

&#x20;   top10 < 15%          +10

&#x20;   dev < 3%             +8

&#x20;   bundled < 10%        +8

&#x20;   fresh\_wallet\_ratio < 30%    +5

&#x20;   smart\_money\_present  +4



&#x20; Deployer (20 pts)

&#x20;   no prior rugs        +10

&#x20;   has prior runner     +6

&#x20;   CEX-funded, aged     +4



&#x20; Liquidity/Trading (20 pts)

&#x20;   buy/sell ratio > 70% first 2min   +8

&#x20;   unique buyers > 50 first 5min     +7

&#x20;   price impact of my size < 3%      +5



&#x20; Social/Narrative (25 pts, async)

&#x20;   matches live meta               +10

&#x20;   real Twitter (aged, non-renamed) +6

&#x20;   KOL wallet bought               +5

&#x20;   active TG w/ organic growth     +4



SIZING:

&#x20; score < 50  → skip

&#x20; 50–65       → 0.25× base size

&#x20; 65–80       → 1× base size

&#x20; 80+         → 2× base size

Exit rules are usually filter-driven too: auto-sell on dev sell >50%, bundle wallets dumping, top-holder concentration rising, or liquidity dropping >X%.



10\. Where Most Setups Fall Short \& What Can Be Improved

Funding-tree analysis is shallow. Most bots look at 1 hop. Ruggers fund through 3–5 hops or via CEX round-trips. Build a proper wallet-graph with labeled clusters; this is the single biggest edge.



Bundled-supply tracking is static. Everyone checks "bundled %" at launch. Few track bundle unwind in real time — i.e., have the bundle wallets started selling? Entering right after bundlers dump (the "post-bundle dip") is a well-known but under-automated play.



Deployer reputation is treated as binary. Better: a Bayesian prior on the deployer's expected outcome distribution based on their launch history, updated per-launch.



Nobody de-duplicates narrative copies well. Build a ticker/name/image similarity index (perceptual hash on image, fuzzy match on name/ticker) and rank copies by launch time + organic volume. Being able to auto-identify "the real one" among 40 clones within the first minute is a real edge; most manual traders do this by eye and lose 30–60 seconds.



Sell simulation is done once. Honeypots and rug mechanics can be armed after your buy (e.g., dev flips a Token-2022 fee, or on EVM toggles a blacklist). Re-simulate a sell every N seconds while holding and auto-exit on failure.



Social signals are consumed too slowly. Most bots poll Twitter every 30–60s. Streaming the X firehose (or filtered rules API) for the contract address / ticker gives you the first KOL mention seconds earlier. Same for Telegram: join the top 50 alpha groups with a listener bot and detect when a CA gets posted — this is essentially front-running the call groups.



Filters don't adapt to market regime. Thresholds are hardcoded. Better: dynamically tighten distribution/holder thresholds when graduation rate is low and loosen when the market is running. Track your own hit rate per regime and let it tune thresholds.



Sniper-vs-sniper dynamics are ignored. On popular launches you're competing with 50 other bots in slot 0. Detecting sniper density (how many known bot wallets bought in the first 2 slots) tells you whether you're early or you're the exit liquidity. Some groups deliberately avoid tokens with high sniper density and instead target tokens with low bot presence but rising organic buyers.



No survival-based backtesting. Most people evaluate filters by "did it rug." Better metric: for each filter, what's the expected multiple distribution of tokens that passed vs. failed? Some filters reduce rugs but also filter out most runners (e.g., strict top-10 <10% eliminates many real runners because early organic buyers naturally hold more). Measure filter value by PnL impact, not rug-rate.



Wallet labeling is outsourced. Relying only on GMGN/Cielo labels means everyone has the same information. Build your own "smart money" set: wallets with >60% win rate on 5+ memecoin trades, tracked over 30 days, and weight their buys accordingly. Also build your own "dumb money" set — wallets that consistently buy tops — as a contrarian signal.



Image/name classification is crude. An LLM/vision pass on the token image and name ("is this a real recognizable meme or slop?", "does this match a current news event?") takes \~1–2s and can be run async. It's cheap now and correlates surprisingly well with runners.



Exit filters are underdeveloped relative to entry filters. Most PnL is lost on exits, not entries. Apply the same filter stack continuously post-entry: holder concentration trending up, buy/sell ratio flipping, dev/insider wallets moving, LP changes, sniper wallets exiting. Each should be a weighted sell trigger, not a single hard stop.



11\. Data Sources \& Tooling (Solana)

Real-time on-chain:



Helius / Triton / QuickNode RPC with Geyser/Yellowstone gRPC streams for slot-level detection of pump.fun create instructions, Raydium/PumpSwap pool creation, and token transfers.

Jito for bundle submission and detecting bundled buys (same-slot multi-wallet analysis).

Direct program account subscriptions to pump.fun bonding curve accounts for progress %.

Token security:



RugCheck API (mint/freeze/LP/top holders in one call)

GoPlus Security (Solana + EVM)

Your own on-chain reads (faster and more reliable than any third party)

Holder / wallet intelligence:



Bubblemaps (cluster detection)

GMGN, Cielo, Arkham (wallet labels, smart money)

Helius DAS / Enhanced Transactions API for wallet history

Your own funding-graph database (Postgres/Neo4j)

Market data:



DexScreener, Birdeye, Jupiter price APIs

Pump.fun's own frontend API (undocumented but widely used) for King of the Hill, trending

Social:



X API v2 filtered stream (or scraping)

Telethon/Pyrogram listener bots in alpha groups

Custom scrapers for TikTok/Reddit trending (for narrative detection, slower)

Execution / reference bots:



Photon, BullX, Axiom, GMGN, Trojan, Maestro — study their filter UIs; they expose exactly the flags alpha groups use (bundled %, sniper %, dev %, insiders %, top-10 %, DEX paid, etc.)

12\. Reality Check

Pump.fun produces 20,000–40,000 tokens/day. Over 98% never graduate. Of those that graduate, most die within 24h. Filters get you from a \~1% base rate to maybe 5–15% "real runner" rate. That's the realistic ceiling for pure filtering; the rest is sizing, exits, and speed.

Every filter here is known to the ruggers too. They pass mint/freeze/LP checks trivially, spread bundles across aged wallets, buy fake Twitter followers, and pay for DEX boosts. The edge comes from the layers that are hard to fake: funding graph depth, deployer behavioral history, real-time bundle unwind, and organic buyer quality.

Robinhood Chain: build for EVM generically, test on Base/Arbitrum, and just have the chain config ready. Don't expect meme flow there until permissionless deployment and a real DEX exist.

