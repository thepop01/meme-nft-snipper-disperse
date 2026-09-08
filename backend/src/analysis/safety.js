// "Genuineness" scoring for newly discovered tokens.
// Each check contributes points toward a 0-100 score; the breakdown is
// returned so the UI can show exactly why a token scored the way it did.
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { classifyScope } from '../scope/chainScope.js';
import { getEstablishedMcap } from './cloneCheck.js';

const connection = new Connection(config.rpcUrl, {
  commitment: 'confirmed',
  disableRetryOnRateLimit: true, // fail fast and mark check as 'warn' instead of retry-spamming
});

const WEIGHTS = {
  mintAuthority: 20,   // mint authority revoked (can't print more supply)
  freezeAuthority: 15, // freeze authority revoked (can't freeze your tokens)
  holderSpread: 20,    // top-10 holders below concentration threshold
  liquidity: 15,       // enough liquidity to actually exit
  sellRoute: 20,       // a sell route exists (basic honeypot check)
  socials: 10,         // website / twitter / telegram present
};

const BURN_ACCOUNT = '1nc1nerator11111111111111111111111111111111';

export function isAnalyzable(token) {
  return classifyScope(token) === 'supported';
}

// GMGN risk intelligence: pure, chain-agnostic checks over fields set by
// discovery/gmgn.js normalizers (or mergeGmgnIntelligence). Returns [] when
// the token carries no GMGN evidence — unknown stays unknown, never a fail.
export function gmgnRiskChecks(token) {
  const hasEvidence = ['rugRatio', 'bundlerPct', 'honeypot', 'renouncedMint', 'top10HolderPct', 'washTrading']
    .some(key => token?.[key] != null);
  if (!hasEvidence) return [];
  const checks = [];
  if (token.honeypot === true) {
    checks.push({ id: 'gmgnHoneypot', label: 'GMGN honeypot flag', status: 'fail', detail: 'GMGN flags this token as a honeypot — assume it cannot be sold' });
  }
  if (token.rugRatio != null) {
    const rug = Number(token.rugRatio);
    checks.push({
      id: 'gmgnRug', label: 'GMGN rug probability',
      status: rug >= 0.9 ? 'fail' : rug >= 0.5 ? 'warn' : 'pass',
      detail: `Rug ratio ${(rug * 100).toFixed(0)}%`,
    });
  }
  if (token.bundlerPct != null) {
    const bundled = Number(token.bundlerPct);
    checks.push({
      id: 'gmgnBundlers', label: 'GMGN bundled supply',
      status: bundled >= 40 ? 'warn' : 'pass',
      detail: `${bundled}% of supply from bundled wallets`,
    });
  }
  if (token.top10HolderPct != null && token.top10HolderPct >= 50) {
    checks.push({
      id: 'gmgnConcentration', label: 'GMGN holder concentration',
      status: 'warn',
      detail: `Top 10 hold ${token.top10HolderPct}% per GMGN (independent of RPC count)`,
    });
  }
  if (token.renouncedMint === false) {
    checks.push({ id: 'gmgnMintAuth', label: 'GMGN mint authority', status: 'warn', detail: 'Mint authority not renounced per GMGN' });
  }
  if (token.washTrading === true) {
    checks.push({ id: 'gmgnWash', label: 'GMGN wash trading', status: 'warn', detail: 'GMGN detected wash trading' });
  }
  if (checks.length === 0) {
    checks.push({ id: 'gmgnRisk', label: 'GMGN risk screen', status: 'pass', detail: 'No GMGN risk flags' });
  }
  return checks;
}

// Accounts are supplied in descending balance order by RPC. Do not drop the first
// one merely because it is large: exclude only an explicitly resolved system account.
export function top10ExcludingKnown(accounts, isKnown) {
  const held = accounts.filter(account => !isKnown(account.address)).slice(0, 10);
  return { held, top10Raw: held.reduce((sum, account) => sum + BigInt(account.amount ?? account.rawAmount), 0n) };
}

function isKnownSystemAccount(address, token) {
  return new Set([
    BURN_ACCOUNT, token.bondingCurveKey, token.bondingCurve, token.curve,
    ...(token.knownSystemAccounts ?? []),
  ].filter(Boolean)).has(address);
}

export async function analyzeToken(token) {
  if (!isAnalyzable(token)) {
    // Out-of-scope chains (e.g. Robinhood EVM) skip RPC analysis, but GMGN
    // intelligence is chain-agnostic — surface it so the UI can show risk.
    const gmgnChecks = gmgnRiskChecks(token);
    if (gmgnChecks.length > 0) return { score: null, checks: gmgnChecks, scope: 'unscored' };
    return { score: null, checks: { scope: 'unscored' } };
  }
  const checks = [];
  let score = 0;

  // --- On-chain mint account: mint + freeze authority ---
  try {
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(token.mint));
    const parsed = mintInfo.value?.data?.parsed?.info;
    if (parsed) {
      const mintRevoked = parsed.mintAuthority == null;
      checks.push({
        id: 'mintAuthority',
        label: 'Mint authority revoked',
        status: mintRevoked ? 'pass' : 'fail',
        detail: mintRevoked ? 'Supply is fixed' : 'Creator can mint more tokens',
      });
      if (mintRevoked) score += WEIGHTS.mintAuthority;

      const freezeRevoked = parsed.freezeAuthority == null;
      checks.push({
        id: 'freezeAuthority',
        label: 'Freeze authority revoked',
        status: freezeRevoked ? 'pass' : 'fail',
        detail: freezeRevoked ? 'Tokens cannot be frozen' : 'Creator can freeze holder wallets',
      });
      if (freezeRevoked) score += WEIGHTS.freezeAuthority;

      token.decimals = parsed.decimals;
      token.supply = parsed.supply;
    } else {
      checks.push({ id: 'mintAuthority', label: 'Mint account readable', status: 'warn', detail: 'Could not parse mint account' });
    }
  } catch (err) {
    checks.push({ id: 'mintAuthority', label: 'Mint account readable', status: 'warn', detail: 'RPC error: ' + err.message });
  }

  // --- Holder concentration ---
  try {
    const largest = await connection.getTokenLargestAccounts(new PublicKey(token.mint));
    const accounts = largest.value || [];
    const supplyResp = await connection.getTokenSupply(new PublicKey(token.mint));
    const supply = BigInt(supplyResp.value.amount);
    if (supply > 0n && accounts.length > 0) {
      const { top10Raw } = top10ExcludingKnown(accounts, address => isKnownSystemAccount(address, token));
      const pct = Number(top10Raw * 10_000n / supply) / 100;
      token.top10HolderPct = Math.round(pct * 10) / 10;
      const ok = pct < 30;
      checks.push({
        id: 'holderSpread',
        label: 'Holder distribution',
        status: ok ? 'pass' : pct < 50 ? 'warn' : 'fail',
        detail: `Top 10 (excl. resolved system accounts) hold ${token.top10HolderPct}% of supply`,
      });
      if (ok) score += WEIGHTS.holderSpread;
      else if (pct < 50) score += Math.floor(WEIGHTS.holderSpread / 2);
    }
  } catch (err) {
    checks.push({ id: 'holderSpread', label: 'Holder distribution', status: 'warn', detail: 'Could not fetch holders' });
  }

  // --- Liquidity (from DexScreener enrichment) ---
  if (token.liquidityUsd != null) {
    const ok = token.liquidityUsd >= 10000;
    const mid = token.liquidityUsd >= 3000;
    checks.push({
      id: 'liquidity',
      label: 'Liquidity depth',
      status: ok ? 'pass' : mid ? 'warn' : 'fail',
      detail: `$${Math.round(token.liquidityUsd).toLocaleString()} pooled`,
    });
    if (ok) score += WEIGHTS.liquidity;
    else if (mid) score += Math.floor(WEIGHTS.liquidity / 2);
  } else if (token.onCurve) {
    // Pre-graduation pump.fun token: liquidity is the bonding curve
    checks.push({
      id: 'liquidity',
      label: 'Liquidity depth',
      status: 'warn',
      detail: 'On bonding curve (not yet graduated to a DEX pool)',
    });
    score += Math.floor(WEIGHTS.liquidity / 3);
  }

  // --- Sell route exists (basic honeypot check via Jupiter quote) ---
  try {
    const sellable = await checkSellRoute(token.mint);
    checks.push({
      id: 'sellRoute',
      label: 'Sell route (honeypot check)',
      status: sellable === true ? 'pass' : sellable === false ? 'fail' : 'warn',
      detail: sellable === true ? 'Jupiter can route a sell' : sellable === false ? 'No sell route found — possible honeypot' : 'Not routable yet (too new)',
    });
    if (sellable === true) score += WEIGHTS.sellRoute;
    else if (sellable === null && token.onCurve) score += Math.floor(WEIGHTS.sellRoute / 2); // curve tokens are sellable on the curve
  } catch {
    checks.push({ id: 'sellRoute', label: 'Sell route (honeypot check)', status: 'warn', detail: 'Quote request failed' });
  }

  // --- Socials / metadata presence ---
  const socialCount = Object.values(token.socials || {}).filter(Boolean).length;
  checks.push({
    id: 'socials',
    label: 'Socials & metadata',
    status: socialCount >= 2 ? 'pass' : socialCount === 1 ? 'warn' : 'fail',
    detail: socialCount > 0 ? `${socialCount} link(s) found` : 'No website/twitter/telegram found',
  });
  score += Math.round(WEIGHTS.socials * Math.min(socialCount, 2) / 2);

  // --- GMGN risk intelligence (no RPC needed, additive penalties only) ---
  // Tokens without GMGN evidence are untouched: unknown stays unknown.
  for (const check of gmgnRiskChecks(token)) {
    checks.push(check);
    if (check.id === 'gmgnHoneypot' && check.status === 'fail') score = Math.min(score, 10);
    else if (check.id === 'gmgnRug' && check.status === 'fail') score = Math.max(0, score - 30);
    else if (check.status === 'warn') score = Math.max(0, score - 5);
  }

  // --- Clone check ---
  // Only check if token has enough liquidity to be considered ($2k+) to save rate limits
  if ((token.liquidityUsd || 0) >= 2000 && token.symbol) {
    try {
      const establishedMcap = await getEstablishedMcap(token.symbol);
      const currentMcap = token.marketCapUsd || ((token.liquidityUsd || 0) * 2);
      if (establishedMcap > 5_000_000 && currentMcap > 0 && currentMcap < establishedMcap * 0.1) {
        checks.push({
          id: 'cloneCheck',
          label: 'Clone of established token',
          status: 'fail',
          detail: `Symbol '${token.symbol}' already belongs to a $${Math.round(establishedMcap / 1_000_000)}M mcap token`,
        });
        token.isClone = true; // Flag for registry to discard
      }
    } catch {
      // ignore errors to fail open
    }
  }

  return { score: Math.min(100, Math.round(score)), checks };
}

const WSOL = 'So11111111111111111111111111111111111111112';

// Ask Jupiter for a token->SOL quote; if no route exists the token
// probably can't be sold (or is too new to be indexed).
async function checkSellRoute(mint) {
  try {
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${mint}&outputMint=${WSOL}&amount=1000000&slippageBps=500`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      if (body.error?.includes('not tradable') || body.errorCode === 'TOKEN_NOT_TRADABLE') return null;
      return false;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.outAmount ? true : false;
  } catch {
    return null;
  }
}
