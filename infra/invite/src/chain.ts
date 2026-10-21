import { Address, Asset, Networks, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

export const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

const server = new rpc.Server(RPC_URL);

/** Whether `address`'s contract instance exists on chain yet — i.e. whether
 *  the factory's `create_account` for this invitation has landed. Soroban
 *  RPC rejects `getContractData` for a contract id with no instance, which
 *  is exactly the "not created yet" case the Poller is watching for. */
export async function accountExists(address: string): Promise<boolean> {
  try {
    await server.getContractData(address, xdr.ScVal.scvLedgerKeyContractInstance(), rpc.Durability.Persistent);
    return true;
  } catch {
    return false;
  }
}

/** Whether `address` holds a positive native XLM balance — i.e. the
 *  funder plugin's transfer has actually landed, not just the deploy.
 *  accountExists() alone goes true the moment create_account confirms,
 *  well before the separate, sometimes-slow async funding step
 *  (new-account/index.astro's fundAccount) finishes — printing "your
 *  wallet is ready" on deploy alone would hand out a receipt for an
 *  account that's still at a zero balance. */
export async function isFunded(address: string): Promise<boolean> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(NATIVE_SAC_ID).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Balance"), Address.fromString(address).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  try {
    const res = await server.getLedgerEntries(key);
    const entry = res.entries[0];
    if (!entry) return false;
    const native = scValToNative(entry.val.contractData().val());
    const amount = typeof native === "bigint" ? native : (native as { amount?: unknown } | null)?.amount;
    return typeof amount === "bigint" && amount > 0n;
  } catch {
    return false;
  }
}
