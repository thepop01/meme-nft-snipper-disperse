import { ethers } from 'ethers';

async function main() {
  const rpc = process.argv[2] || process.env.RPC_ETH || 'https://ethereum-rpc.publicnode.com';
  const address = process.argv[3] || '0xD152f549545093347A162Dce210e7293f1452150';
  const provider = new ethers.JsonRpcProvider(rpc);
  const code = await provider.getCode(address);
  if (!code || code === '0x') {
    console.error('No contract code at', address);
    process.exit(2);
  }
  const hash = ethers.keccak256(code);
  console.log('RPC:', rpc);
  console.log('Address:', address);
  console.log('Bytecode keccak256:', hash);
}

main().catch(err => { console.error(err); process.exit(1); });
