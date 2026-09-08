import { ethers } from 'ethers';

export const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const DISPERSE_ABI = [
  'function disperseEther(address[] recipients, uint256[] values) payable',
  'function disperseToken(address token, address[] recipients, uint256[] values)',
];

export function makeProvider(chain) {
  if (!chain?.rpc) throw new Error(`RPC is not configured for ${chain?.name || 'this chain'}`);
  return new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
}

export function makeSigner(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider);
}

export function chunkRecipients(recipients, amounts, maxPerTx) {
  const chunks = [];
  for (let i = 0; i < recipients.length; i += maxPerTx) {
    chunks.push({
      recipients: recipients.slice(i, i + maxPerTx),
      amounts: amounts.slice(i, i + maxPerTx),
    });
  }
  return chunks;
}

export function computeGasReserveShortfall({ isNativeAsset, nativeBalance, sendTotal, gasReserve }) {
  const needed = isNativeAsset ? sendTotal + gasReserve : gasReserve;
  const short = needed - nativeBalance;
  return short > 0n ? short : 0n;
}

export async function verifyDisperseContract(provider, address, expectedHash) {
  const code = await provider.getCode(address);
  if (!code || code === '0x') throw new Error(`No contract deployed at ${address}`);
  const hash = ethers.keccak256(code);
  if (hash.toLowerCase() !== String(expectedHash).toLowerCase()) {
    throw new Error(`Disperse contract bytecode mismatch at ${address}`);
  }
  return true;
}

export async function disperseNativeChunk(signer, chain, chunk) {
  const contract = new ethers.Contract(chain.disperseContract, DISPERSE_ABI, signer);
  const value = chunk.amounts.reduce((a, b) => a + b, 0n);
  const tx = await contract.disperseEther(
    chunk.recipients.map(r => r.address), chunk.amounts, { value });
  await tx.wait();
  return tx.hash;
}

export async function disperseTokenChunk(signer, chain, tokenAddress, chunk, {
  totalNeeded, allowUnlimited = false,
}) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const owner = await signer.getAddress();
  const current = await token.allowance(owner, chain.disperseContract);
  let approveHash;
  if (current < totalNeeded) {
    if (current > 0n) {
      const reset = await token.approve(chain.disperseContract, 0n);
      await reset.wait();
    }
    const amount = allowUnlimited ? ethers.MaxUint256 : totalNeeded;
    const approve = await token.approve(chain.disperseContract, amount);
    await approve.wait();
    approveHash = approve.hash;
  }
  const contract = new ethers.Contract(chain.disperseContract, DISPERSE_ABI, signer);
  const tx = await contract.disperseToken(
    tokenAddress, chunk.recipients.map(r => r.address), chunk.amounts);
  await tx.wait();
  return { approveHash, disperseHash: tx.hash };
}

export async function fetchEvmBalances(provider, address, tokenAddress) {
  const nativeBalance = await provider.getBalance(address);
  if (!tokenAddress || tokenAddress === 'NATIVE') {
    return { nativeBalance, tokenBalance: null, decimals: 18 };
  }
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [tokenBalance, decimals] = await Promise.all([
    token.balanceOf(address), token.decimals(),
  ]);
  return { nativeBalance, tokenBalance, decimals: Number(decimals) };
}
