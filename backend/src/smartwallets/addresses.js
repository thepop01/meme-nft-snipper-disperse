const EVM = /^0x[0-9a-fA-F]{40}$/i;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isEvmAddress(value) {
  return EVM.test(String(value || ''));
}

export function isSolAddress(value) {
  return SOL.test(String(value || ''));
}

export function normalizeAddress(chain, address) {
  const raw = String(address || '');
  return chain === 'robinhood' ? raw.toLowerCase() : raw;
}

export function isAddressForChain(chain, address) {
  return chain === 'robinhood' ? isEvmAddress(address) : isSolAddress(address);
}
