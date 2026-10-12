import { Account, Address, Asset, Contract, Networks, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { getPending, markFunded, type Visit } from "./store.js";
import { printReceipt } from "./printer.js";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

// Simulation never submits, so this just needs to be syntactically valid —
// never funded, never real.
const SIM_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Native XLM balance of a C-address, via a read-only simulated call to the
 *  native SAC's `balance`. */
export async function getBalance(
  address: string,
  server: rpc.Server = new rpc.Server(RPC_URL),
): Promise<bigint> {
  const sourceAccount = new Account(SIM_SOURCE, "0");
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(NATIVE_SAC_ID).call("balance", Address.fromString(address).toScVal()))
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Balance check failed: ${sim.error}`);
  }
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) throw new Error("Balance check returned no result.");
  return scValToNative(result.retval) as bigint;
}

/** Checks every pending visit once; flips funded ones and calls `onFunded`.
 *  A failed check for one visit is logged and skipped, not fatal — it's
 *  retried on the next tick. */
export async function pollOnce(
  server: rpc.Server = new rpc.Server(RPC_URL),
  onFunded: (id: string, visit: Visit) => void = printReceipt,
): Promise<void> {
  const pending = getPending();
  console.log(`[poller] checking ${pending.length} pending visit(s)`);
  for (const [id, visit] of pending) {
    try {
      const balance = await getBalance(visit.address, server);
      if (balance > 0n) {
        const funded = markFunded(id);
        if (funded) onFunded(id, funded);
      }
    } catch (err) {
      console.warn(`[poller] balance check failed for visit ${id}`, err);
    }
  }
}

/** Self-rescheduling loop — reschedules only after the current tick
 *  finishes, so a slow RPC call can't cause overlapping ticks. */
export function startPolling(intervalMs = 3000): void {
  void (async function tick() {
    await pollOnce();
    setTimeout(tick, intervalMs);
  })();
}
