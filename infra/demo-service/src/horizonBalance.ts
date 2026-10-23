import type { StellarNetwork } from "./relayerKeys.js";

const HORIZON_URL: Record<StellarNetwork, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

interface HorizonBalance {
  asset_type: string;
  balance: string;
}

/** XLM balance for a Stellar account on the given network, or `null` if the
 *  account doesn't exist on chain yet (unfunded — Horizon 404s rather than
 *  returning a zero balance). */
export async function fetchXlmBalance(address: string, network: StellarNetwork): Promise<string | null> {
  const res = await fetch(`${HORIZON_URL[network]}/accounts/${address}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchXlmBalance failed for ${address}: ${res.status} ${await res.text()}`);
  const { balances }: { balances: HorizonBalance[] } = await res.json();
  return balances.find((b) => b.asset_type === "native")?.balance ?? null;
}
