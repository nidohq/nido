import { Account, Address, Operation, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { hex2buf, perch } from "@nidohq/passkey-sdk";
import { fetchFactoryAddress } from "../policyChainFetch.js";
import { NETWORK_PASSPHRASE, RELAYER_SIM_SOURCE, RPC_URL } from "../network.js";

/**
 * Read-only simulation of the factory's `get_c_address(setup_pk)` — the same
 * deterministic derivation `new-account/`'s own reservation step uses
 * (`perch.setupPublicKey`, not the raw salt — see `setupKey.ts`'s doc
 * comment for why `get_c_address` takes the setup key's PUBLIC key, not its
 * seed), run here so `/demo/start` can register a visit against the address
 * *before* handing off to the unmodified `new-account/` flow. Never signs,
 * never pays, changes nothing on-chain.
 */
export async function predictAddress(
  saltHex: string,
  server: rpc.Server = new rpc.Server(RPC_URL),
): Promise<string> {
  if (!RELAYER_SIM_SOURCE) {
    throw new Error("Relayer is not configured for account setup.");
  }

  const account = await server.getAccount(RELAYER_SIM_SOURCE);
  const sourceAccount = new Account(account.accountId(), account.sequenceNumber());

  const txn = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: await fetchFactoryAddress(),
        function: "get_c_address",
        args: [xdr.ScVal.scvBytes(Buffer.from(perch.setupPublicKey(hex2buf(saltHex))))],
      }),
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(txn);
  if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim)) {
    throw new Error(`Address prediction failed: ${"error" in sim ? sim.error : "restore needed"}`);
  }
  if (!sim.result) throw new Error("Address prediction returned no result.");

  return Address.fromScVal(sim.result.retval).toString();
}
