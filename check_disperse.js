const { ethers } = require('ethers');

const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';

async function checkDisperse() {
  const ethProvider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com');
  const bscProvider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org');

  const ethCode = await ethProvider.getCode(DISPERSE_ADDRESS);
  const bscCode = await bscProvider.getCode(DISPERSE_ADDRESS);

  console.log('ETH Code Length:', ethCode.length);
  console.log('BSC Code Length:', bscCode.length);
}

checkDisperse();
