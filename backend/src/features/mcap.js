// Unknown supply is unknown; never substitute a hard-coded token supply.
export function supplyAwareMcap({ rawSupply, decimals, priceUsd }) {
  if (rawSupply == null || decimals == null || priceUsd == null) return null;
  return (Number(BigInt(rawSupply)) / 10 ** decimals) * Number(priceUsd);
}
