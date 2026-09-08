require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Basic ERC20 ABI for transfer and decimals
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node bot.js <network> <token>");
    console.error("Example: node bot.js bsc USDC");
    console.error("Networks: ethereum, bsc, sepolia, bsc_testnet");
    process.exit(1);
  }

  const networkKey = args[0].toLowerCase();
  const tokenSymbol = args[1].toUpperCase();

  // Load config
  const configPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error("config.json not found.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!config.networks[networkKey]) {
    console.error(`Network '${networkKey}' not found in config.json`);
    process.exit(1);
  }

  const networkConfig = config.networks[networkKey];
  const tokenAddress = networkConfig.tokens[tokenSymbol];

  if (!tokenAddress) {
    console.error(`Token '${tokenSymbol}' not found for network '${networkKey}' in config.json`);
    process.exit(1);
  }

  // Load private key
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in .env file");
    process.exit(1);
  }

  // Load recipients
  const recipientsPath = path.join(__dirname, 'recipients.json');
  if (!fs.existsSync(recipientsPath)) {
    console.error("recipients.json not found.");
    process.exit(1);
  }
  const recipients = JSON.parse(fs.readFileSync(recipientsPath, 'utf8'));

  if (!Array.isArray(recipients) || recipients.length === 0) {
    console.error("recipients.json is empty or invalid format.");
    process.exit(1);
  }

  console.log(`🚀 Starting Multi-Sender on ${networkKey} for ${tokenSymbol}`);
  console.log(`📍 RPC URL: ${networkConfig.rpcUrl}`);
  console.log(`📍 Token Contract: ${tokenAddress}`);
  console.log(`👥 Total Recipients: ${recipients.length}`);

  // Setup Provider & Wallet
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  console.log(`🏦 Sender Address: ${wallet.address}`);

  try {
    const decimals = await tokenContract.decimals();
    console.log(`?? Token Decimals: ${decimals}`);

    // Pre-flight checks: validate addresses and total balance before sending anything.
    const validRecipients = recipients.filter(r => ethers.isAddress(r.address));
    if (validRecipients.length === 0) {
      console.error("No valid recipient addresses found.");
      process.exit(1);
    }
    const totalNeeded = validRecipients.reduce((sum, r) => sum + ethers.parseUnits(r.amount.toString(), decimals), 0n);
    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance < totalNeeded) {
      console.error(`Insufficient balance: have ${ethers.formatUnits(balance, decimals)}, need ${ethers.formatUnits(totalNeeded, decimals)} ${tokenSymbol}`);
      process.exit(1);
    }
    console.log(`Pre-checks passed: ${validRecipients.length} valid recipients, total ${ethers.formatUnits(totalNeeded, decimals)} ${tokenSymbol}`);

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const { address, amount } = recipient;
      
      console.log(`\n[${i + 1}/${recipients.length}] Preparing to send ${amount} ${tokenSymbol} to ${address}...`);
      
      if (!ethers.isAddress(address)) {
        console.error(`❌ Invalid address format: ${address}. Skipping.`);
        continue;
      }

      // Convert amount string to BigInt based on decimals
      const parsedAmount = ethers.parseUnits(amount.toString(), decimals);

      try {
        const tx = await tokenContract.transfer(address, parsedAmount);
        console.log(`⏳ Transaction sent! Hash: ${tx.hash}`);
        
        console.log(`⏳ Waiting for confirmation...`);
        const receipt = await tx.wait();
        console.log(`✅ Success! Confirmed in block ${receipt.blockNumber}`);
      } catch (txError) {
        console.error(`❌ Failed to send to ${address}:`, txError.message || txError);
      }
    }
    
    console.log(`\n🎉 All transfers processed.`);
    
  } catch (err) {
    console.error("❌ Critical Error:", err.message || err);
  }
}

main();
