/**
 * One hardcoded fallback address per resolvable name. Used ONLY when the
 * on-chain registry is unreachable (RPC error / no mapping). Keep these in
 * sync with the currently-deployed testnet contracts; the registry lookup is
 * always preferred and these only paper over a transient registry outage.
 */
export declare const REGISTRY_FALLBACKS: Record<string, string>;
export interface FetchRegistryAddressOptions {
    /** Soroban RPC endpoint (defaults to testnet). */
    rpcUrl?: string;
    /** Network passphrase (defaults to testnet). */
    networkPassphrase?: string;
    /** Registry contract id to query (defaults to the unverified testnet one). */
    registryId?: string;
    /**
     * Injectable on-chain lookup. Resolves a name to a contract id, or `null`
     * if the registry has no mapping. Throws if the registry is unreachable.
     * Defaults to a read-only Soroban simulation against the registry. Tests
     * pass a stub here to avoid network access.
     */
    lookup?: (name: string) => Promise<string | null>;
}
/**
 * Resolve a canonical contract NAME to its address via the on-chain registry,
 * falling back to a single hardcoded address (with a loud warning) only if the
 * registry is unreachable or has no mapping.
 *
 * @throws if the registry is unreachable AND there is no fallback for `name`.
 */
export declare function fetchRegistryAddress(name: string, opts?: FetchRegistryAddressOptions): Promise<string>;
//# sourceMappingURL=registry.d.ts.map