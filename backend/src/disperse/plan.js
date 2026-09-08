import { getDisperseChain, getToken } from './config.js';
import { parseRecipients, computeAmounts } from './validate.js';
import { chunkRecipients, computeGasReserveShortfall } from './evm.js';
import { toLifiToken } from './bridge.js';

// A recipient is assigned to exactly one sender. Amounts are computed for the
// complete recipient set before this partition happens, so total-mode plans
// cannot accidentally spend the requested total once per sender.
export function assignRecipients(senders, recipients) {
  const assignments = senders.map(sender => ({ sender, recipients: [] }));
  recipients.forEach((recipient, index) => {
    assignments[index % senders.length].recipients.push(recipient);
  });
  return {
    pairingMode: senders.length === 1
      ? 'single'
      : senders.length > recipients.length ? 'sparse-pairing' : 'pairing',
    assignments,
  };
}

function excludeSenderRecipients(recipients, senders, enabled) {
  if (!enabled) return { recipients, excluded: [] };
  const senderSet = new Set(senders.map(address => String(address).toLowerCase()));
  const excluded = recipients.filter(r => senderSet.has(String(r.address).toLowerCase()));
  return {
    recipients: recipients.filter(r => !senderSet.has(String(r.address).toLowerCase())),
    excluded,
  };
}

export async function buildPlan(input, deps) {
  const {
    sourceChain, destChain, asset, destAsset, senders, recipientsText,
    amountMode, perRecipient, total, allowUnlimited = false, excludeSenders = true,
  } = input;

  const chain = getDisperseChain(sourceChain);
  if (!chain) throw new Error(`Unknown chain: ${sourceChain}`);
  if (destChain && destChain !== sourceChain) {
    return buildCrossChainPlan(input, deps);
  }
  if (!senders || senders.length === 0) throw new Error('At least one sender is required');

  const token = getToken(sourceChain, asset);
  if (!token) throw new Error(`Asset ${asset} not available on ${chain.name}`);
  const isNativeAsset = token.address === 'NATIVE';

  const parsed = parseRecipients(recipientsText, chain.family);
  const { recipients, excluded } = excludeSenderRecipients(parsed.recipients, senders, excludeSenders);
  const errors = [...parsed.errors, ...excluded.map(r => ({ address: r.address, message: 'Sender excluded from recipients' }))];
  if (recipients.length === 0) throw new Error('No valid recipients');

  const maxPerTx = chain.maxRecipientsPerTx;
  const gasReserve = BigInt(chain.family === 'sol' ? chain.gasReserveLamports : chain.gasReserveWei);

  const { amounts: allAmounts } = computeAmounts({
    mode: amountMode, perRecipient, total, decimals: token.decimals, recipients,
  });
  const amountByAddress = new Map(recipients.map((recipient, index) => [recipient.address, allAmounts[index]]));
  const { pairingMode, assignments } = assignRecipients(senders, recipients);

  const perSender = [];
  for (const { sender, recipients: senderRecipients } of assignments) {
    const balances = await deps.fetchBalances({
      chain, address: sender, tokenAddress: token.address, isNativeAsset,
    });
    const decimals = isNativeAsset ? chain.decimals : balances.decimals;
    if (decimals !== token.decimals) throw new Error(`Configured decimals for ${token.symbol} do not match the chain`);
    if (senderRecipients.length === 0) {
      perSender.push({ sender, decimals, totalBaseUnits: '0', chunks: [] });
      continue;
    }
    const amounts = senderRecipients.map(recipient => amountByAddress.get(recipient.address));
    const sendTotal = amounts.reduce((sum, amount) => sum + amount, 0n);

    const shortfall = computeGasReserveShortfall({
      isNativeAsset,
      nativeBalance: balances.nativeBalance,
      sendTotal: isNativeAsset ? sendTotal : 0n,
      gasReserve,
    });
    if (shortfall > 0n) {
      throw new Error(`Sender ${sender}: insufficient native balance for send + gas reserve (short ${shortfall} wei)`);
    }
    if (!isNativeAsset && balances.tokenBalance != null && balances.tokenBalance < sendTotal) {
      throw new Error(`Sender ${sender}: insufficient ${token.symbol} balance`);
    }

    const chunks = chunkRecipients(senderRecipients, amounts, maxPerTx).map(c => ({
      recipients: c.recipients,
      amounts: c.amounts.map(a => a.toString()),
    }));
    perSender.push({
      sender,
      decimals,
      totalBaseUnits: sendTotal.toString(),
      balance: {
        nativeBaseUnits: balances.nativeBalance.toString(),
        tokenBaseUnits: balances.tokenBalance?.toString() ?? null,
        networkFeeReserveBaseUnits: gasReserve.toString(),
        estimatedNativeRemainingBaseUnits: (balances.nativeBalance
          - (isNativeAsset ? sendTotal : 0n) - gasReserve).toString(),
        estimatedAssetRemainingBaseUnits: isNativeAsset
          ? (balances.nativeBalance - sendTotal - gasReserve).toString()
          : balances.tokenBalance != null ? (balances.tokenBalance - sendTotal).toString() : null,
      },
      chunks,
    });
  }

  return Object.freeze({
    crossChain: false,
    sourceChain, destChain: sourceChain,
    family: chain.family,
    asset: token.symbol,
    tokenAddress: token.address,
    network: { id: chain.id, name: chain.name, chainId: chain.chainId ?? null, explorer: chain.explorer },
    assetDecimals: token.decimals,
    totalBaseUnits: allAmounts.reduce((sum, amount) => sum + amount, 0n).toString(),
    requiredApproval: !isNativeAsset,
    isNativeAsset,
    allowUnlimited,
    amountMode,
    pairingMode,
    excludeSenders,
    recipients,
    recipientCount: recipients.length,
    perSender,
    validationErrors: errors,
  });
}

async function buildCrossChainPlan(input, deps) {
  const {
    sourceChain, destChain, asset, destAsset, senders, recipientsText,
    amountMode, perRecipient, total, allowUnlimited = false, excludeSenders = true,
  } = input;

  const src = getDisperseChain(sourceChain);
  const dst = getDisperseChain(destChain);
  if (!src) throw new Error(`Unknown source chain: ${sourceChain}`);
  if (!dst) throw new Error(`Unknown destination chain: ${destChain}`);
  if (src.family !== 'evm' || dst.family !== 'evm') {
    throw new Error('Cross-chain currently supports EVM ↔ EVM only');
  }
  if (!destAsset) throw new Error('A destination asset is required for cross-chain');
  if (!senders || senders.length === 0) throw new Error('At least one sender is required');

  const srcToken = getToken(sourceChain, asset);
  if (!srcToken) throw new Error(`Asset ${asset} not available on ${src.name}`);
  const dstToken = getToken(destChain, destAsset);
  if (!dstToken) throw new Error(`Destination asset ${destAsset} not available on ${dst.name}`);
  const isNativeAsset = srcToken.address === 'NATIVE';

  const parsed = parseRecipients(recipientsText, dst.family);
  const { recipients, excluded } = excludeSenderRecipients(parsed.recipients, senders, excludeSenders);
  const errors = [...parsed.errors, ...excluded.map(r => ({ address: r.address, message: 'Sender excluded from recipients' }))];
  if (recipients.length === 0) throw new Error('No valid recipients');

  const srcGasReserve = BigInt(src.gasReserveWei);
  const { amounts: allSourceAmounts } = computeAmounts({
    mode: amountMode, perRecipient, total, decimals: srcToken.decimals, recipients,
  });
  const sourceAmountByAddress = new Map(recipients.map((recipient, index) => [recipient.address, allSourceAmounts[index]]));
  const { pairingMode, assignments } = assignRecipients(senders, recipients);
  const perSender = [];

  for (const { sender, recipients: senderRecipients } of assignments) {
    if (senderRecipients.length === 0) {
      perSender.push({
        sender, decimals: dstToken.decimals, totalBaseUnits: '0', chunks: [],
        bridge: { status: 'SKIPPED' },
      });
      continue;
    }
    const srcSendTotal = senderRecipients
      .map(recipient => sourceAmountByAddress.get(recipient.address))
      .reduce((sum, amount) => sum + amount, 0n);

    const balances = await deps.fetchBalances({
      chain: src, address: sender, tokenAddress: srcToken.address, isNativeAsset,
    });
    const shortfall = computeGasReserveShortfall({
      isNativeAsset, nativeBalance: balances.nativeBalance,
      sendTotal: isNativeAsset ? srcSendTotal : 0n, gasReserve: srcGasReserve,
    });
    if (shortfall > 0n) throw new Error(`Sender ${sender}: insufficient native balance for bridge + gas reserve`);
    if (!isNativeAsset && balances.tokenBalance != null && balances.tokenBalance < srcSendTotal) {
      throw new Error(`Sender ${sender}: insufficient ${srcToken.symbol} balance for bridge`);
    }

    const quote = await deps.getQuote({
      fromChainId: src.chainId, toChainId: dst.chainId,
      fromToken: toLifiToken(srcToken.address), toToken: toLifiToken(dstToken.address),
      fromAmount: srcSendTotal.toString(), fromAddress: sender, toAddress: sender,
    });

    const received = BigInt(quote.toAmount);
    const n = BigInt(senderRecipients.length);
    const base = received / n;
    const remainder = received - base * n;
    const destAmounts = senderRecipients.map((_, i) => (i === senderRecipients.length - 1 ? base + remainder : base));

    const chunks = chunkRecipients(senderRecipients, destAmounts, dst.maxRecipientsPerTx).map(c => ({
      recipients: c.recipients, amounts: c.amounts.map(a => a.toString()),
    }));

    perSender.push({
      sender,
      decimals: dstToken.decimals,
      totalBaseUnits: received.toString(),
      balance: {
        nativeBaseUnits: balances.nativeBalance.toString(),
        tokenBaseUnits: balances.tokenBalance?.toString() ?? null,
        networkFeeReserveBaseUnits: srcGasReserve.toString(),
        estimatedNativeRemainingBaseUnits: (balances.nativeBalance
          - (isNativeAsset ? srcSendTotal : 0n) - srcGasReserve).toString(),
        estimatedAssetRemainingBaseUnits: isNativeAsset
          ? (balances.nativeBalance - srcSendTotal - srcGasReserve).toString()
          : balances.tokenBalance != null ? (balances.tokenBalance - srcSendTotal).toString() : null,
      },
      bridge: {
        tool: quote.tool,
        toAddress: sender,
        fromAmount: srcSendTotal.toString(),
        estimatedReceived: quote.toAmount,
        durationSec: quote.durationSec,
        gasUsd: quote.gasUsd,
        feeUsd: quote.feeUsd,
        approvalAddress: quote.approvalAddress,
        transactionRequest: quote.transactionRequest,
        status: 'PLANNED',
        txHash: null,
      },
      chunks,
    });
  }

  return Object.freeze({
    crossChain: true,
    sourceChain, destChain,
    family: dst.family,
    asset: srcToken.symbol,
    destAsset: dstToken.symbol,
    tokenAddress: dstToken.address,
    srcTokenAddress: srcToken.address,
    sourceNetwork: { id: src.id, name: src.name, chainId: src.chainId, explorer: src.explorer },
    destinationNetwork: { id: dst.id, name: dst.name, chainId: dst.chainId, explorer: dst.explorer },
    sourceAssetDecimals: srcToken.decimals,
    assetDecimals: dstToken.decimals,
    sourceTotalBaseUnits: allSourceAmounts.reduce((sum, amount) => sum + amount, 0n).toString(),
    totalBaseUnits: perSender.reduce((sum, sender) => sum + BigInt(sender.totalBaseUnits), 0n).toString(),
    requiredApproval: srcToken.address !== 'NATIVE' || dstToken.address !== 'NATIVE',
    isNativeAsset: dstToken.address === 'NATIVE',
    destIsNative: dstToken.address === 'NATIVE',
    allowUnlimited,
    amountMode,
    pairingMode,
    excludeSenders,
    recipients,
    recipientCount: recipients.length,
    perSender,
    validationErrors: errors,
  });
}
