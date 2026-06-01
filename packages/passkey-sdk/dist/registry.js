import { rpc, Contract, TransactionBuilder, Account, Networks, nativeToScVal, scValToNative, } from "@stellar/stellar-sdk";
/**
 * Registry-routed contract resolution.
 *
 * Every contract ADDRESS the SDK / frontend needs (factory, name-registry,
 * the status-message sample dApp, …) is resolved by canonical NAME through the
 * on-chain registry rather than baking the address into source. This means a
 * redeploy of any of those contracts only requires re-registering its name —
 * no SDK/frontend change.
 *
 * Each name keeps exactly ONE hardcoded fallback (`REGISTRY_FALLBACKS`) that is
 * used only when the registry is unreachable / returns no mapping, and we
 * `console.warn` loudly whenever a fallback fires so a silently-stale address
 * is impossible to miss. When the registry is reachable behaviour is identical
 * to a direct lookup.
 */
const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;
/**
 * Unverified registry on testnet — the one holding bare-name → contract-id
 * mappings. The verified registry (CAMLHK…) doesn't dispatch prefixed names
 * natively; the CLI does that client-side. We target unverified directly so
 * `fetch_contract_id("factory")` resolves without a prefix. This mirrors the
 * factory contract's own `REGISTRY` constant.
 */
const DEFAULT_REGISTRY_ID = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
const DUMMY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
/**
 * One hardcoded fallback address per resolvable name. Used ONLY when the
 * on-chain registry is unreachable (RPC error / no mapping). Keep these in
 * sync with the currently-deployed testnet contracts; the registry lookup is
 * always preferred and these only paper over a transient registry outage.
 */
export const REGISTRY_FALLBACKS = {
    factory: "CDQDNOT4RWQKAIJIZYJE5HK7DMIVTYBJ4QXHIERNOZPPYMUNBT2JZ2SK",
    "name-registry": "CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX",
    "status-message": "CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV",
    // The verifier registered under `unverified/verifier` on testnet by
    // scripts/deploy-policy-builder-v1.sh. `policyChainFetch.fetchVerifierAddress`
    // prefers the verifier the account's own rule references and only falls back
    // to this registry lookup; this entry covers the case where that lookup also
    // can't reach the registry.
    verifier: "CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY",
};
/** Default on-chain lookup: simulate `fetch_contract_id(name)` on the registry. */
async function registryLookup(name, rpcUrl, networkPassphrase, registryId) {
    const server = new rpc.Server(rpcUrl);
    const registry = new Contract(registryId);
    const source = new Account(DUMMY_SOURCE, "0");
    const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase,
    })
        .addOperation(registry.call("fetch_contract_id", nativeToScVal(name, { type: "string" })))
        .setTimeout(0)
        .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`registry fetch_contract_id(${name}) failed: ${sim.error}`);
    }
    const result = sim.result;
    if (!result)
        return null;
    const addr = scValToNative(result.retval);
    return addr || null;
}
/**
 * Resolve a canonical contract NAME to its address via the on-chain registry,
 * falling back to a single hardcoded address (with a loud warning) only if the
 * registry is unreachable or has no mapping.
 *
 * @throws if the registry is unreachable AND there is no fallback for `name`.
 */
export async function fetchRegistryAddress(name, opts = {}) {
    const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
    const networkPassphrase = opts.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
    const registryId = opts.registryId ?? DEFAULT_REGISTRY_ID;
    const lookup = opts.lookup ??
        ((n) => registryLookup(n, rpcUrl, networkPassphrase, registryId));
    let resolved = null;
    let lookupError;
    try {
        resolved = await lookup(name);
    }
    catch (err) {
        lookupError = err;
    }
    if (resolved)
        return resolved;
    const fallback = REGISTRY_FALLBACKS[name];
    if (fallback) {
        console.warn(`[g2c] registry lookup for "${name}" ${lookupError ? `failed (${String(lookupError)})` : "returned no mapping"}; falling back to hardcoded address ${fallback}. ` +
            "This address may be stale — check the registry deployment.");
        return fallback;
    }
    throw new Error(`[g2c] could not resolve "${name}" via the registry and no fallback exists` +
        (lookupError ? `: ${String(lookupError)}` : ""));
}
//# sourceMappingURL=registry.js.map