import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress, createTransferInstruction,
  createAssociatedTokenAccountInstruction, getAccount, getMint,
} from '@solana/spl-token';
import { ethers } from 'ethers';
import bs58 from 'bs58';

export function makeConnection(chain) {
  return new Connection(chain.rpc, 'confirmed');
}

export function keypairFromBase58(secret) {
  return Keypair.fromSecretKey(bs58.decode(String(secret).trim()));
}

export function baseUnits(value, decimals) {
  return ethers.parseUnits(String(value), decimals);
}

export async function fetchSolanaBalances(connection, address, tokenAddress) {
  const owner = new PublicKey(address);
  const nativeBalance = BigInt(await connection.getBalance(owner));
  if (!tokenAddress || tokenAddress === 'NATIVE') {
    return { nativeBalance, tokenBalance: null, decimals: 9 };
  }
  const mint = new PublicKey(tokenAddress);
  const [mintInfo, ata] = await Promise.all([
    getMint(connection, mint),
    getAssociatedTokenAddress(mint, owner),
  ]);
  let tokenBalance = 0n;
  try {
    tokenBalance = (await getAccount(connection, ata)).amount;
  } catch {
    // A missing associated token account is a real zero balance, not an RPC error.
  }
  return { nativeBalance, tokenBalance, decimals: mintInfo.decimals };
}

export async function disperseNativeChunk(connection, payer, chunk) {
  const tx = new Transaction();
  chunk.recipients.forEach((r, i) => {
    tx.add(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(r.address),
      lamports: Number(chunk.amounts[i]),
    }));
  });
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

export async function disperseTokenChunk(connection, payer, mintAddress, chunk) {
  const mint = new PublicKey(mintAddress);
  const source = await getAssociatedTokenAddress(mint, payer.publicKey);
  const tx = new Transaction();
  for (let i = 0; i < chunk.recipients.length; i++) {
    const dest = new PublicKey(chunk.recipients[i].address);
    const destAta = await getAssociatedTokenAddress(mint, dest);
    try {
      await getAccount(connection, destAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, destAta, dest, mint));
    }
    tx.add(createTransferInstruction(source, destAta, payer.publicKey, Number(chunk.amounts[i])));
  }
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
