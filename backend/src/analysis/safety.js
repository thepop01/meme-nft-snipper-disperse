// On-chain safety analysis and the centralized admission gate used by every buy path.
//
// Safety evidence is deliberately tri-state: pass, fail, or unknown.  In
// particular, an unavailable sell-route quote is not evidence that a token is
// sellable.  Qualification and execution callers must use the gate exported
// below rather than inferring safety from a score alone.
import { Connection, PublicKey } from '@solana/web3.js';
import {
  AccountState,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getExtensionTypes,
  getNonTransferable,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from '@solana/spl-token';
import { config } from '../config.js';
import { classifyScope } from '../scope/chainScope.js';
import { getEstablishedMcap } from './cloneCheck.js';

const connection = new Connection(config.rpcUrl, {
  commitment: 'confirmed',
  disableRetryOnRateLimit: true,
});

const WEIGHTS = {
  mintAuthority: 20,
  freezeAuthority: 15,
  holderSpread: 20,
  liquidity: 15,
  sellRoute: 20,
  socials: 10,
};

const BURN_ACCOUNT = '1nc1nerator11111111111111111111111111111111';
const WSOL = 'So11111111111111111111111111111111111111112';

// These checks are necessary before an asset may become qualified or be bought.
// Other checks add score, but are not universal (for example, a new bonding
// curve token may not have holder data yet).  A missing check is therefore
// different from a passing check and is never treated as safe.
export const REQUIRED_SAFETY_CHECKS = Object.freeze([
  'mintOwner',
  'mintAuthority',
  'freezeAuthority',
  'sellRoute',
]);
export const TOKEN_2022_EXTENSION_CHECK = 'token2022Extensions';
export const DEFAULT_SAFETY_FRESHNESS_MS = 5 * 60_000;

const DANGEROUS_TOKEN_2022_EXTENSIONS = new Set([
  ExtensionType.TransferHook,
  ExtensionType.PermanentDelegate,
  ExtensionType.TransferFeeConfig,
  ExtensionType.TransferFeeAmount,
  ExtensionType.NonTransferable,
]);

function keyString(value) {
  if (value == null) return null;
  try {
    return value.toBase58 ? value.toBase58() : String(value);
  } catch {
    return null;
  }
}

function statusFor(status) {
  return status === 'pass' || status === 'fail' || status === 'unknown' ? status : 'unknown';
}

function check(id, label, status, detail) {
  return { id, label, status: statusFor(status), detail };
}

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  // getAccountInfo returns a Buffer.  A base64 tuple is accepted as a small
  // deterministic adapter seam for fixtures and provider wrappers.
  if (Array.isArray(data) && typeof data[0] === 'string') {
    return Buffer.from(data[0], data[1] === 'base64' ? 'base64' : 'base64');
  }
  return null;
}

function extensionName(value) {
  return Object.entries(ExtensionType).find(([name, number]) => name === value || number === value)?.[0]
    ?? `Unknown(${value})`;
}

/**
 * Parse a Token-2022 mint account without doing any RPC.
 *
 * `owner` and `data` are intentionally inputs rather than fetched here.  This
 * keeps provider calls behind the injected connection used by analyzeToken and
 * lets tests use deterministic account fixtures.  Unknown owner/account bytes
 * are returned as unknown, never as a safe result.
 */
export function inspectToken2022Mint({ owner, data, address } = {}) {
  const ownerAddress = keyString(owner);
  const tokenProgram = keyString(TOKEN_PROGRAM_ID);
  const token2022Program = keyString(TOKEN_2022_PROGRAM_ID);

  if (!ownerAddress) {
    return {
      status: 'unknown',
      program: null,
      isToken2022: null,
      extensions: [],
      dangerousExtensions: [],
      detail: 'Mint owner is unavailable',
    };
  }
  if (ownerAddress === tokenProgram) {
    return {
      status: 'pass',
      program: 'spl-token',
      isToken2022: false,
      extensions: [],
      dangerousExtensions: [],
      detail: 'Mint is owned by the original SPL Token program',
    };
  }
  if (ownerAddress !== token2022Program) {
    return {
      status: 'fail',
      program: ownerAddress,
      isToken2022: false,
      extensions: [],
      dangerousExtensions: [],
      detail: `Unsupported mint owner ${ownerAddress}`,
    };
  }

  const bytes = asBuffer(data);
  if (!bytes) {
    return {
      status: 'unknown',
      program: 'spl-token-2022',
      isToken2022: true,
      extensions: [],
      dangerousExtensions: [],
      detail: 'Token-2022 mint account bytes are unavailable',
    };
  }

  try {
    let mintAddress = PublicKey.default;
    if (address) {
      try { mintAddress = new PublicKey(address); } catch { /* fixture/provider may omit a valid address */ }
    }
    const mint = unpackMint(
      mintAddress,
      { owner: new PublicKey(ownerAddress), data: bytes },
      TOKEN_2022_PROGRAM_ID,
    );
    const extensionTypes = getExtensionTypes(mint.tlvData);
    const extensions = extensionTypes.map(extensionName);
    const unknownExtensions = extensionTypes.filter(type => !Object.values(ExtensionType).includes(type));
    const dangerousExtensions = extensionTypes
      .filter(type => DANGEROUS_TOKEN_2022_EXTENSIONS.has(type))
      .map(extensionName);

    // Presence of a dangerous capability is a hard failure, even if its
    // authority happens to be null or its current fee is zero.
    if (dangerousExtensions.length > 0) {
      return {
        status: 'fail', program: 'spl-token-2022', isToken2022: true,
        extensions, dangerousExtensions,
        detail: `Dangerous Token-2022 extension(s): ${dangerousExtensions.join(', ')}`,
      };
    }
    if (unknownExtensions.length > 0) {
      return {
        status: 'unknown', program: 'spl-token-2022', isToken2022: true,
        extensions, dangerousExtensions,
        detail: `Unrecognised Token-2022 extension type(s): ${unknownExtensions.join(', ')}`,
      };
    }

    // Decode the extension payloads as well as their type tags.  This catches
    // malformed/default-frozen fixtures and avoids declaring unreadable bytes safe.
    if (extensionTypes.includes(ExtensionType.TransferHook) && !getTransferHook(mint)) {
      return { status: 'unknown', program: 'spl-token-2022', isToken2022: true, extensions, dangerousExtensions, detail: 'Transfer-hook extension could not be decoded' };
    }
    if (extensionTypes.includes(ExtensionType.PermanentDelegate) && !getPermanentDelegate(mint)) {
      return { status: 'unknown', program: 'spl-token-2022', isToken2022: true, extensions, dangerousExtensions, detail: 'Permanent-delegate extension could not be decoded' };
    }
    if (extensionTypes.includes(ExtensionType.TransferFeeConfig) && !getTransferFeeConfig(mint)) {
      return { status: 'unknown', program: 'spl-token-2022', isToken2022: true, extensions, dangerousExtensions, detail: 'Transfer-fee extension could not be decoded' };
    }
    if (extensionTypes.includes(ExtensionType.NonTransferable) && !getNonTransferable(mint)) {
      return { status: 'unknown', program: 'spl-token-2022', isToken2022: true, extensions, dangerousExtensions, detail: 'Non-transferable extension could not be decoded' };
    }
    if (extensionTypes.includes(ExtensionType.DefaultAccountState)) {
      const defaultState = getDefaultAccountState(mint);
      if (!defaultState) {
        return { status: 'unknown', program: 'spl-token-2022', isToken2022: true, extensions, dangerousExtensions, detail: 'Default account state extension could not be decoded' };
      }
      if (defaultState.state === AccountState.Frozen) {
        return {
          status: 'fail', program: 'spl-token-2022', isToken2022: true,
          extensions, dangerousExtensions: ['DefaultAccountState(Frozen)'],
          detail: 'Token-2022 mint defaults new accounts to frozen',
        };
      }
    }

    return {
      status: 'pass', program: 'spl-token-2022', isToken2022: true,
      extensions, dangerousExtensions,
      detail: extensions.length ? `Token-2022 extensions inspected: ${extensions.join(', ')}` : 'Token-2022 mint has no extensions',
    };
  } catch (err) {
    return {
      status: 'unknown', program: 'spl-token-2022', isToken2022: true,
      extensions: [], dangerousExtensions: [], detail: `Token-2022 mint parsing failed: ${err.message}`,
    };
  }
}

export function isAnalyzable(token) {
  return classifyScope(token) === 'supported';
}

// GMGN risk intelligence is additive; absent evidence remains absent.
export function gmgnRiskChecks(token) {
  const hasEvidence = ['rugRatio', 'bundlerPct', 'honeypot', 'renouncedMint', 'top10HolderPct', 'washTrading']
    .some(key => token?.[key] != null);
  if (!hasEvidence) return [];
  const checks = [];
  if (token.honeypot === true) checks.push(check('gmgnHoneypot', 'GMGN honeypot flag', 'fail', 'GMGN flags this token as a honeypot — assume it cannot be sold'));
  if (token.rugRatio != null) {
    const rug = Number(token.rugRatio);
    checks.push(check('gmgnRug', 'GMGN rug probability', rug >= 0.9 ? 'fail' : rug >= 0.5 ? 'unknown' : 'pass', `Rug ratio ${(rug * 100).toFixed(0)}%`));
  }
  if (token.bundlerPct != null) {
    const bundled = Number(token.bundlerPct);
    checks.push(check('gmgnBundlers', 'GMGN bundled supply', bundled >= 40 ? 'unknown' : 'pass', `${bundled}% of supply from bundled wallets`));
  }
  if (token.top10HolderPct != null && token.top10HolderPct >= 50) checks.push(check('gmgnConcentration', 'GMGN holder concentration', 'unknown', `Top 10 hold ${token.top10HolderPct}% per GMGN (independent of RPC count)`));
  if (token.renouncedMint === false) checks.push(check('gmgnMintAuth', 'GMGN mint authority', 'unknown', 'Mint authority not renounced per GMGN'));
  if (token.washTrading === true) checks.push(check('gmgnWash', 'GMGN wash trading', 'unknown', 'GMGN detected wash trading'));
  if (checks.length === 0) checks.push(check('gmgnRisk', 'GMGN risk screen', 'pass', 'No GMGN risk flags'));
  return checks;
}

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

export function summarizeSafetyChecks(checks, tokenProgram = null) {
  const list = Array.isArray(checks) ? checks : [];
  const byId = new Map(list.map(item => [item.id, item]));
  const required = [...REQUIRED_SAFETY_CHECKS];
  if (tokenProgram === 'spl-token-2022') required.push(TOKEN_2022_EXTENSION_CHECK);
  const missing = required.filter(id => !byId.has(id));
  const unknown = required.filter(id => byId.has(id) && statusFor(byId.get(id).status) === 'unknown');
  const failed = required.filter(id => byId.has(id) && statusFor(byId.get(id).status) === 'fail');
  return {
    required,
    missing,
    unknown,
    failed,
    complete: missing.length === 0 && unknown.length === 0,
    safe: missing.length === 0 && unknown.length === 0 && failed.length === 0,
  };
}

export function safetyAdmission(token, { now = Date.now(), maxAgeMs = DEFAULT_SAFETY_FRESHNESS_MS, includeLifecycle = true } = {}) {
  const reasons = [];
  const safety = token?.safety;
  const checks = Array.isArray(safety?.checks) ? safety.checks : [];
  const tokenProgram = safety?.tokenProgram ?? token?.tokenProgram ?? null;
  const completeness = summarizeSafetyChecks(checks, tokenProgram);

  if (includeLifecycle && token?.state !== 'curated') reasons.push(`state is ${token?.state ?? 'unknown'}, not curated`);
  if (includeLifecycle && token?.admission !== 'qualified') reasons.push(`admission is ${token?.admission ?? 'unknown'}, not qualified`);
  if (token?.rugged) reasons.push('token is marked rugged');
  if (token?.enrichmentStatus !== 'fresh' || token?.enrichmentStale) reasons.push('market enrichment is missing or stale');
  if (!Number.isFinite(token?.enrichedAt) || now - token.enrichedAt > maxAgeMs) reasons.push('market enrichment is too old');
  const analyzedAt = token?.analyzedAt ?? safety?.analyzedAt;
  if (!Number.isFinite(analyzedAt) || analyzedAt < token.enrichedAt) reasons.push('safety analysis is missing or older than enrichment');

  if (completeness.missing.length) reasons.push(`missing safety checks: ${completeness.missing.join(', ')}`);
  if (completeness.unknown.length) reasons.push(`unknown safety checks: ${completeness.unknown.join(', ')}`);
  if (completeness.failed.length) reasons.push(`failed safety checks: ${completeness.failed.join(', ')}`);

  return {
    ok: reasons.length === 0,
    reasons,
    completeness,
    sellRoute: checks.find(item => item.id === 'sellRoute')?.status ?? 'unknown',
    checkedAt: analyzedAt ?? null,
  };
}

export function isTokenBuyable(token, options) {
  return safetyAdmission(token, options).ok;
}

export function assertTokenBuyable(token, options) {
  const result = safetyAdmission(token, options);
  if (!result.ok) {
    const err = new Error(`Token is not admitted for buying: ${result.reasons.join('; ')}`);
    err.code = 'TOKEN_NOT_ADMITTED';
    err.reasons = result.reasons;
    err.admission = result;
    throw err;
  }
  return result;
}

// Explicit aliases make the gate discoverable to adapters and callers.
export const evaluateTokenBuyAdmission = safetyAdmission;
export const assertBuyAdmission = assertTokenBuyable;

export async function analyzeToken(token, {
  rpcConnection = connection,
  checkSellRoute: sellRouteCheck = checkSellRoute,
  inspectMint = inspectToken2022Mint,
  getMintAccount = null,
} = {}) {
  if (!isAnalyzable(token)) {
    const gmgnChecks = gmgnRiskChecks(token);
    return {
      score: null,
      checks: gmgnChecks,
      scope: 'unscored',
      checkCompleteness: summarizeSafetyChecks(gmgnChecks),
      tokenProgram: null,
    };
  }

  const checks = [];
  let score = 0;
  let tokenProgram = null;
  let mintValue = null;

  // --- Mint owner, authorities, and Token-2022 extensions ---
  try {
    const mintInfo = await rpcConnection.getParsedAccountInfo(new PublicKey(token.mint));
    mintValue = mintInfo?.value ?? null;
    const owner = mintValue?.owner ?? null;
    const ownerEvidence = inspectMint({ owner, data: null, address: token.mint });
    tokenProgram = ownerEvidence.program;
    checks.push(check('mintOwner', 'Mint owner', ownerEvidence.status, ownerEvidence.detail));

    if (ownerEvidence.isToken2022 === true) {
      let rawAccount = null;
      try {
        rawAccount = getMintAccount
          ? await getMintAccount(token.mint, rpcConnection)
          : typeof rpcConnection.getAccountInfo === 'function'
            ? await rpcConnection.getAccountInfo(new PublicKey(token.mint))
            : null;
      } catch {
        rawAccount = null;
      }
      const extensionEvidence = inspectMint({
        owner: rawAccount?.owner ?? owner,
        data: rawAccount?.data ?? null,
        address: token.mint,
      });
      checks.push(check('token2022Extensions', 'Token-2022 capabilities', extensionEvidence.status, extensionEvidence.detail));
      token.token2022Extensions = extensionEvidence.extensions;
      token.tokenProgram = 'spl-token-2022';
    } else if (ownerEvidence.isToken2022 === false) {
      checks.push(check('token2022Extensions', 'Token-2022 capabilities', 'pass', 'Not a Token-2022 mint'));
      token.tokenProgram = ownerEvidence.program;
    } else {
      checks.push(check('token2022Extensions', 'Token-2022 capabilities', 'unknown', 'Mint owner is unavailable'));
    }

    const parsed = mintValue?.data?.parsed?.info;
    if (parsed) {
      const mintRevoked = parsed.mintAuthority == null;
      checks.push(check('mintAuthority', 'Mint authority revoked', mintRevoked ? 'pass' : 'fail', mintRevoked ? 'Supply is fixed' : 'Creator can mint more tokens'));
      if (mintRevoked) score += WEIGHTS.mintAuthority;
      const freezeRevoked = parsed.freezeAuthority == null;
      checks.push(check('freezeAuthority', 'Freeze authority revoked', freezeRevoked ? 'pass' : 'fail', freezeRevoked ? 'Tokens cannot be frozen' : 'Creator can freeze holder wallets'));
      if (freezeRevoked) score += WEIGHTS.freezeAuthority;
      token.decimals = parsed.decimals;
      token.supply = parsed.supply;
    } else {
      checks.push(check('mintAuthority', 'Mint account readable', 'unknown', 'Could not parse mint account'));
      checks.push(check('freezeAuthority', 'Mint account readable', 'unknown', 'Could not parse mint account'));
    }
  } catch (err) {
    checks.push(check('mintOwner', 'Mint owner', 'unknown', `RPC error: ${err.message}`));
    checks.push(check('token2022Extensions', 'Token-2022 capabilities', 'unknown', 'Mint owner could not be inspected'));
    checks.push(check('mintAuthority', 'Mint account readable', 'unknown', 'RPC error while reading mint account'));
    checks.push(check('freezeAuthority', 'Mint account readable', 'unknown', 'RPC error while reading mint account'));
  }

  // --- Holder concentration ---
  try {
    const largest = await rpcConnection.getTokenLargestAccounts(new PublicKey(token.mint));
    const accounts = largest.value || [];
    const supplyResp = await rpcConnection.getTokenSupply(new PublicKey(token.mint));
    const supply = BigInt(supplyResp.value.amount);
    if (supply > 0n && accounts.length > 0) {
      const { top10Raw } = top10ExcludingKnown(accounts, address => isKnownSystemAccount(address, token));
      const pct = Number(top10Raw * 10_000n / supply) / 100;
      token.top10HolderPct = Math.round(pct * 10) / 10;
      const ok = pct < 30;
      checks.push(check('holderSpread', 'Holder distribution', ok ? 'pass' : pct < 50 ? 'unknown' : 'fail', `Top 10 (excl. resolved system accounts) hold ${token.top10HolderPct}% of supply`));
      if (ok) score += WEIGHTS.holderSpread;
      else if (pct < 50) score += Math.floor(WEIGHTS.holderSpread / 2);
    }
  } catch {
    checks.push(check('holderSpread', 'Holder distribution', 'unknown', 'Could not fetch holders'));
  }

  // --- Liquidity ---
  if (token.liquidityUsd != null) {
    const ok = token.liquidityUsd >= 10000;
    const mid = token.liquidityUsd >= 3000;
    checks.push(check('liquidity', 'Liquidity depth', ok ? 'pass' : mid ? 'unknown' : 'fail', `$${Math.round(token.liquidityUsd).toLocaleString()} pooled`));
    if (ok) score += WEIGHTS.liquidity;
    else if (mid) score += Math.floor(WEIGHTS.liquidity / 2);
  } else if (token.onCurve) {
    checks.push(check('liquidity', 'Liquidity depth', 'unknown', 'On bonding curve (not yet graduated to a DEX pool)'));
  }

  // --- Sell route: null/errors are unknown and never earn points ---
  try {
    const sellable = await sellRouteCheck(token.mint, token);
    const status = sellable === true ? 'pass' : sellable === false ? 'fail' : 'unknown';
    checks.push(check('sellRoute', 'Sell route (honeypot check)', status,
      sellable === true ? 'Jupiter can route a sell' : sellable === false ? 'No sell route found — possible honeypot' : 'Sell-route evidence unavailable'));
    if (sellable === true) score += WEIGHTS.sellRoute;
  } catch (err) {
    checks.push(check('sellRoute', 'Sell route (honeypot check)', 'unknown', `Sell-route check failed: ${err.message}`));
  }

  // --- Socials / metadata ---
  const socialCount = Object.values(token.socials || {}).filter(Boolean).length;
  checks.push(check('socials', 'Socials & metadata', socialCount >= 2 ? 'pass' : socialCount === 1 ? 'unknown' : 'fail', socialCount > 0 ? `${socialCount} link(s) found` : 'No website/twitter/telegram found'));
  score += Math.round(WEIGHTS.socials * Math.min(socialCount, 2) / 2);

  // --- GMGN intelligence ---
  for (const item of gmgnRiskChecks(token)) {
    checks.push(item);
    if (item.id === 'gmgnHoneypot' && item.status === 'fail') score = Math.min(score, 10);
    else if (item.id === 'gmgnRug' && item.status === 'fail') score = Math.max(0, score - 30);
    else if (item.status === 'unknown') score = Math.max(0, score - 5);
  }

  // --- Clone check ---
  if ((token.liquidityUsd || 0) >= 2000 && token.symbol) {
    try {
      const establishedMcap = await getEstablishedMcap(token.symbol);
      const currentMcap = token.marketCapUsd || ((token.liquidityUsd || 0) * 2);
      if (establishedMcap > 5_000_000 && currentMcap > 0 && currentMcap < establishedMcap * 0.1) {
        checks.push(check('cloneCheck', 'Clone of established token', 'fail', `Symbol '${token.symbol}' already belongs to a $${Math.round(establishedMcap / 1_000_000)}M mcap token`));
        token.isClone = true;
      }
    } catch {
      // Clone evidence is optional; it must not be represented as a pass.
    }
  }

  return {
    score: Math.min(100, Math.round(score)),
    checks,
    tokenProgram,
    checkCompleteness: summarizeSafetyChecks(checks, tokenProgram),
  };
}

// Ask Jupiter for a token->SOL quote.  Provider errors are unknown, not false
// and not true.  The caller decides whether unknown evidence is admissible.
export async function checkSellRoute(mint) {
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
