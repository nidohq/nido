/**
 * Real `Registry` backed by Soroban RPC read-only simulation of the
 * name-registry contract. Ported from packages/passkey-sdk/src/resolve.ts
 * (resolveName / lookupName) so the resolution rules stay identical to the app.
 *
 * simulateTransaction throws on transport/HTTP failure (→ handler answers 502)
 * and returns a SimulationError for a contract trap; an unregistered name or a
 * nameless account comes back as a `null`/None retval (→ 404 / name:null).
 */
import {
  Contract,
  TransactionBuilder,
  Account,
  rpc,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { Registry } from "./handler.js";

// Any funded-looking source works for recording-mode simulation; this all-zero
// account id is never charged or signed (matches resolve.ts).
const DUMMY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface RegistryConfig {
  rpcUrl: string;
  registryId: string;
  networkPassphrase: string;
}

export function makeRegistry(cfg: RegistryConfig): Registry {
  async function callString(method: string, arg: ReturnType<typeof nativeToScVal>): Promise<string | null> {
    const server = new rpc.Server(cfg.rpcUrl);
    const registry = new Contract(cfg.registryId);
    const tx = new TransactionBuilder(new Account(DUMMY_SOURCE, "0"), {
      fee: "100",
      networkPassphrase: cfg.networkPassphrase,
    })
      .addOperation(registry.call(method, arg))
      .setTimeout(0)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return null;
    const ok = sim as rpc.Api.SimulateTransactionSuccessResponse;
    if (!ok.result) return null;
    try {
      const value = scValToNative(ok.result.retval);
      return value || null;
    } catch {
      return null;
    }
  }

  return {
    resolve: (name) => callString("resolve", nativeToScVal(name, { type: "string" })),
    lookup: (address) => callString("lookup", nativeToScVal(address, { type: "address" })),
  };
}
