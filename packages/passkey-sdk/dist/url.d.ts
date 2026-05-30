/**
 * Reserved subdomains that map to a built-in dApp path on this site.
 * `status-message.<base>` is served the same static bundle as the wallet,
 * but the root page redirects to the listed path. Keep keys lowercase.
 */
export declare const RESERVED_DAPP_SUBDOMAINS: Record<string, string>;
/**
 * If `host` is a reserved dApp subdomain, return the path the root should
 * redirect to. Strips any `--pr-N` preview suffix before matching, so
 * `status-message--pr-24.<base>` resolves the same as production.
 */
export declare function dappPathFromHostname(host: string): string | null;
/**
 * Check if a subdomain string looks like a Stellar contract ID.
 * Contract IDs are exactly 56 characters starting with C.
 */
export declare function isContractId(subdomain: string): boolean;
/**
 * Extract contract ID from a subdomain hostname.
 * Handles both production and preview URLs:
 *   "cabc1234.mysoroban.xyz"             → "CABC1234"
 *   "cabc1234--pr-10.mysoroban.xyz"      → "CABC1234"
 * Returns null if hostname has no subdomain or contract ID.
 */
export declare function contractIdFromHostname(hostname: string): string | null;
/**
 * Extract a human-readable name from a subdomain hostname.
 * Returns null if the subdomain is a contract ID, empty, or a preview prefix.
 *   "alice.mysoroban.xyz"               → "alice"
 *   "alice--pr-10.mysoroban.xyz"        → "alice"
 *   "cabc1234...mysoroban.xyz"          → null (contract ID)
 *   "pr-10.mysoroban.xyz"              → null (preview root)
 */
export declare function nameFromHostname(hostname: string): string | null;
/**
 * Build a protocol-relative URL with the contract ID as subdomain.
 * In preview environments (hostname contains --pr-<N>), encodes the
 * contract ID into the same subdomain level:
 *   accountUrl("pr-10.mysoroban.xyz", "CABC", "/account/")
 *     → "//cabc--pr-10.mysoroban.xyz/account/"
 *
 * In production:
 *   accountUrl("mysoroban.xyz", "CABC", "/account/")
 *     → "//cabc.mysoroban.xyz/account/"
 *
 * Pass `window.location.host` (includes port) as the host parameter.
 */
export declare function accountUrl(host: string, contractId: string, path?: string): string;
/**
 * Strip the contract ID from a host string, preserving any preview prefix.
 *   "cabc1234.mysoroban.xyz"            → "mysoroban.xyz"
 *   "cabc1234--pr-10.mysoroban.xyz"     → "pr-10.mysoroban.xyz"
 *   "cabc1234.localhost:3000"           → "localhost:3000"
 */
export declare function stripSubdomain(host: string): string;
//# sourceMappingURL=url.d.ts.map