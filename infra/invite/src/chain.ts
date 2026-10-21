import { rpc, xdr } from "@stellar/stellar-sdk";

export const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";

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
