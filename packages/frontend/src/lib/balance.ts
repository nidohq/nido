import { Address, Asset, Networks, rpc } from "@stellar/stellar-sdk";
import { simulateRead } from "./simulateRead.js";
import { RPC_URL as DEFAULT_RPC_URL } from "./network.js";

/**
 * Read a Soroban account's native-XLM balance via a read-only simulate of the
 * XLM SAC `balance` call. Returns a 7-dp decimal string (e.g. "12.5000000").
 * Returns "0" when the contract has no balance entry or simulation fails.
 * Extracted verbatim from account/index.astro so the wallet page and the
 * My Nido menu share one implementation.
 */
export async function fetchXlmBalance(
  contractAddress: string,
  rpcUrl: string = DEFAULT_RPC_URL,
): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const xlmSacId = Asset.native().contractId(Networks.TESTNET);
  const raw = await simulateRead(server, xlmSacId, "balance", [
    Address.fromString(contractAddress).toScVal(),
  ]);
  if (typeof raw !== "bigint") return "0";
  const xlm = Number(raw) / 10_000_000;
  return xlm.toFixed(7);
}
