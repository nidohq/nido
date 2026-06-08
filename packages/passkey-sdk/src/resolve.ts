import {
  Contract,
  TransactionBuilder,
  Account,
  rpc,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

declare const sessionStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DUMMY_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Resolve a human-readable name to a contract address via the name registry.
 * Uses Soroban RPC simulation (read-only, no transaction submission).
 *
 * @returns The contract ID string, or null if the name is not registered.
 */
export async function resolveName(
  rpcUrl: string,
  registryContractId: string,
  name: string,
  networkPassphrase: string
): Promise<string | null> {
  const server = new rpc.Server(rpcUrl);
  const registry = new Contract(registryContractId);

  const dummySource = new Account(DUMMY_SOURCE, "0");

  const tx = new TransactionBuilder(dummySource, {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(
      registry.call("resolve", nativeToScVal(name, { type: "string" }))
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;

  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (!successSim.result) return null;

  try {
    const result = scValToNative(successSim.result.retval);
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a name with sessionStorage caching (5-minute TTL).
 */
export async function resolveNameCached(
  rpcUrl: string,
  registryContractId: string,
  name: string,
  networkPassphrase: string
): Promise<string | null> {
  const cacheKey = `g2c:name:${name}`;

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { contractId, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL_MS) {
        return contractId;
      }
    }
  } catch {
    // sessionStorage unavailable or parse error — proceed without cache
  }

  const contractId = await resolveName(
    rpcUrl,
    registryContractId,
    name,
    networkPassphrase
  );

  if (contractId) {
    try {
      sessionStorage.setItem(
        cacheKey,
        JSON.stringify({ contractId, timestamp: Date.now() })
      );
    } catch {
      // ignore storage errors
    }
  }

  return contractId;
}

/**
 * Reverse lookup: the registered name for an address, or null. Read-only RPC
 * simulation of the registry's `lookup(owner) -> Option<String>`. Best-effort —
 * used only to display a canonical name next to a resolved address.
 */
export async function lookupName(
  rpcUrl: string,
  registryContractId: string,
  address: string,
  networkPassphrase: string
): Promise<string | null> {
  const server = new rpc.Server(rpcUrl);
  const registry = new Contract(registryContractId);
  const dummySource = new Account(DUMMY_SOURCE, "0");

  const tx = new TransactionBuilder(dummySource, {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(
      registry.call("lookup", nativeToScVal(address, { type: "address" }))
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;

  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (!successSim.result) return null;

  try {
    const result = scValToNative(successSim.result.retval);
    return result || null;
  } catch {
    return null;
  }
}
