import { Connection, PublicKey } from '@solana/web3.js';

const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';

// A small shared scheduler bounds structural RPC work.  Caches are keyed by immutable
// wallet/account facts, never by token, so hot and control tokens see identical depth.
export class SolanaStructuralRpc {
  constructor({ rpcUrl, clock, maxRequestsPerMinute = 90, connection = null }) {
    this.connection = connection ?? new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
    this.clock = clock; this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestTimes = []; this.queue = []; this.running = false;
    this.walletAgeCache = new Map(); this.funderCache = new Map(); this.authorityCache = new Map();
  }

  _schedule(operation) {
    return new Promise((resolve, reject) => { this.queue.push({ operation, resolve, reject }); this._drain(); });
  }

  _drain() {
    if (this.running || !this.queue.length) return;
    const now = this.clock.now();
    this.requestTimes = this.requestTimes.filter(ts => now - ts < 60_000);
    if (this.requestTimes.length >= this.maxRequestsPerMinute) {
      const delay = Math.max(1, 60_000 - (now - this.requestTimes[0]));
      setTimeout(() => this._drain(), delay).unref?.();
      return;
    }
    const job = this.queue.shift(); this.running = true; this.requestTimes.push(now);
    Promise.resolve(job.operation()).then(job.resolve, job.reject).finally(() => { this.running = false; this._drain(); });
  }

  async getMintInfo(mint) {
    const result = await this._schedule(() => this.connection.getTokenSupply(new PublicKey(mint)));
    return { rawSupply: result.value.amount };
  }

  async getTokenLargestAccounts(mint) {
    const result = await this._schedule(() => this.connection.getTokenLargestAccounts(new PublicKey(mint)));
    return result.value.map(account => ({ address: account.address.toBase58(), rawAmount: BigInt(account.amount) }));
  }

  async getAccountAuthority(address) {
    if (this.authorityCache.has(address)) return this.authorityCache.get(address);
    const value = await this._schedule(() => this.connection.getParsedAccountInfo(new PublicKey(address)));
    const info = { address, owner: value.value?.owner?.toBase58?.() ?? null, authority: value.value?.data?.parsed?.info?.owner ?? null };
    this.authorityCache.set(address, info);
    return info;
  }

  async rawBalanceOf(wallet, mint) {
    const result = await this._schedule(() => this.connection.getParsedTokenAccountsByOwner(
      new PublicKey(wallet), { mint: new PublicKey(mint) }));
    return result.value.reduce((total, account) => total + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n);
  }

  async walletAge(wallet) {
    if (this.walletAgeCache.has(wallet)) return this.walletAgeCache.get(wallet);
    const signatures = await this._schedule(() => this.connection.getSignaturesForAddress(new PublicKey(wallet), { limit: 1000 }));
    const oldest = signatures.at(-1)?.blockTime;
    const age = oldest == null ? null : Math.max(0, this.clock.now() - oldest * 1000);
    this.walletAgeCache.set(wallet, age);
    return age;
  }

  // One bounded inbound-transfer hop.  A missing/unparseable funder stays unknown and cannot link wallets.
  async fundingSourceFor(wallet, fromTs, toTs) {
    const cacheKey = `${wallet}:${fromTs}:${toTs}`;
    if (this.funderCache.has(cacheKey)) return this.funderCache.get(cacheKey);
    const signatures = await this._schedule(() => this.connection.getSignaturesForAddress(new PublicKey(wallet), { limit: 50 }));
    const candidates = signatures.filter(signature => signature.blockTime != null && signature.blockTime * 1000 >= fromTs && signature.blockTime * 1000 <= toTs);
    let source = null;
    for (const signature of candidates.reverse()) {
      const transaction = await this._schedule(() => this.connection.getParsedTransaction(signature.signature, { maxSupportedTransactionVersion: 0 }));
      const instruction = transaction?.transaction.message.instructions.find(item => item.parsed?.type === 'transfer'
        && item.parsed.info?.destination === wallet && item.parsed.info?.source);
      if (instruction) { source = instruction.parsed.info.source; break; }
    }
    this.funderCache.set(cacheKey, source);
    return source;
  }
}

export function solanaResolvers(asset) {
  return {
    isCurvePool: info => Boolean(asset?.created?.curve ?? asset?.curve) && info.address === (asset.created?.curve ?? asset.curve),
    isAmmVault: info => Boolean(info?.authority && asset?.knownAmmAuthorities?.includes(info.authority)),
    isBurn: address => address === BURN_ADDRESS,
    isKnownService: address => asset?.knownServiceAddresses?.includes(address) ?? false,
  };
}
