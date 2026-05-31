const PREVIEW_SEP = "--pr-";
/**
 * Reserved subdomains that map to a built-in dApp path on this site.
 * `status-message.<base>` is served the same static bundle as the wallet,
 * but the root page redirects to the listed path. Keep keys lowercase.
 */
export const RESERVED_DAPP_SUBDOMAINS = {
    'status-message': '/status-message/',
};
/**
 * If `host` is a reserved dApp subdomain, return the path the root should
 * redirect to. Strips any `--pr-N` preview suffix before matching, so
 * `status-message--pr-24.<base>` resolves the same as production.
 */
export function dappPathFromHostname(host) {
    const parts = host.split(".");
    if (parts.length <= 1)
        return null;
    const sub = parts[0];
    const sepIndex = sub.indexOf(PREVIEW_SEP);
    const raw = (sepIndex !== -1 ? sub.slice(0, sepIndex) : sub).toLowerCase();
    return RESERVED_DAPP_SUBDOMAINS[raw] ?? null;
}
/**
 * Build a protocol-relative URL to a reserved-dApp subdomain, preserving the
 * preview prefix if the calling page is in a PR preview. Mirrors `accountUrl`
 * but for dApp names rather than contract IDs.
 *
 *   dappUrl("cabc--pr-24.mysoroban.xyz", "status-message", "/?contract=C…")
 *     → "//status-message--pr-24.mysoroban.xyz/?contract=C…"
 *
 *   dappUrl("cabc.mysoroban.xyz", "status-message", "/?contract=C…")
 *     → "//status-message.mysoroban.xyz/?contract=C…"
 *
 * Pass `window.location.host` (with port) as the host parameter.
 */
export function dappUrl(host, dappName, path = "/") {
    const preview = previewPrefix(host);
    if (preview) {
        // Drop the calling page's first label entirely (whether it's a
        // contract+preview subdomain, bare preview root, or another reserved
        // dApp) and rebuild from the apex.
        const apex = host.split(".").slice(1).join(".");
        return `//${dappName}${PREVIEW_SEP}${preview}.${apex}${path}`;
    }
    // Production: the calling host could be a contract subdomain
    // (cabc.mysoroban.xyz), a name subdomain (alice.mysoroban.xyz), the apex
    // (mysoroban.xyz), or another reserved dApp (status-message.mysoroban.xyz).
    // Strip to the apex: 3+ labels means there's a subdomain to drop, 2 labels
    // means we're already at the apex. (This codebase doesn't deal with
    // multi-segment TLDs like co.uk.)
    const parts = host.split(".");
    const apex = parts.length > 2 ? parts.slice(1).join(".") : host;
    return `//${dappName}.${apex}${path}`;
}
/**
 * Check if a subdomain string looks like a Stellar contract ID.
 * Contract IDs are exactly 56 characters starting with C.
 */
export function isContractId(subdomain) {
    return subdomain.length === 56 && /^[cC]/i.test(subdomain);
}
/**
 * Extract contract ID from a subdomain hostname.
 * Handles both production and preview URLs:
 *   "cabc1234.mysoroban.xyz"             → "CABC1234"
 *   "cabc1234--pr-10.mysoroban.xyz"      → "CABC1234"
 * Returns null if hostname has no subdomain or contract ID.
 */
export function contractIdFromHostname(hostname) {
    const parts = hostname.split(".");
    if (parts.length <= 1)
        return null;
    const sub = parts[0];
    const sepIndex = sub.indexOf(PREVIEW_SEP);
    const raw = sepIndex !== -1 ? sub.slice(0, sepIndex) : sub;
    return raw ? raw.toUpperCase() : null;
}
/**
 * Extract a human-readable name from a subdomain hostname.
 * Returns null if the subdomain is a contract ID, empty, or a preview prefix.
 *   "alice.mysoroban.xyz"               → "alice"
 *   "alice--pr-10.mysoroban.xyz"        → "alice"
 *   "cabc1234...mysoroban.xyz"          → null (contract ID)
 *   "pr-10.mysoroban.xyz"              → null (preview root)
 */
export function nameFromHostname(hostname) {
    const parts = hostname.split(".");
    if (parts.length <= 1)
        return null;
    const sub = parts[0];
    const sepIndex = sub.indexOf(PREVIEW_SEP);
    const raw = sepIndex !== -1 ? sub.slice(0, sepIndex) : sub;
    if (!raw)
        return null;
    if (isContractId(raw))
        return null;
    if (/^pr-\d+$/.test(sub))
        return null;
    if (RESERVED_DAPP_SUBDOMAINS[raw.toLowerCase()])
        return null;
    return raw.toLowerCase();
}
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
export function accountUrl(host, contractId, path = "/") {
    const preview = previewPrefix(host);
    if (preview) {
        // We're about to emit `<acc>--pr-N.<apex>`, so the base we want is the
        // bare apex — NOT what `stripSubdomain` returns (which preserves the
        // preview prefix as its own segment for wallet-context usage). Drop
        // the first label, whether it's a contract+preview subdomain
        // (`<x>--pr-N`), a bare preview root (`pr-N`), or a reserved-dApp
        // preview (`status-message--pr-N`).
        const apex = host.split(".").slice(1).join(".");
        return `//${contractId.toLowerCase()}${PREVIEW_SEP}${preview}.${apex}${path}`;
    }
    return `//${contractId.toLowerCase()}.${host}${path}`;
}
/**
 * Strip the contract ID from a host string, preserving any preview prefix.
 *   "cabc1234.mysoroban.xyz"            → "mysoroban.xyz"
 *   "cabc1234--pr-10.mysoroban.xyz"     → "pr-10.mysoroban.xyz"
 *   "cabc1234.localhost:3000"           → "localhost:3000"
 */
export function stripSubdomain(host) {
    const parts = host.split(".");
    if (parts.length <= 1)
        return host;
    const sub = parts[0];
    const rest = parts.slice(1).join(".");
    const sepIndex = sub.indexOf(PREVIEW_SEP);
    if (sepIndex !== -1) {
        // Preserve the preview prefix: "contract--pr-10" → "pr-10"
        return `pr-${sub.slice(sepIndex + PREVIEW_SEP.length)}.${rest}`;
    }
    return rest;
}
/**
 * Extract the preview prefix (e.g. "pr-10") from a hostname, or null if production.
 * Checks the first subdomain segment for the --pr-<N> separator,
 * and also matches bare "pr-<N>" subdomains (the preview root).
 */
function previewPrefix(host) {
    const parts = host.split(".");
    if (parts.length <= 1)
        return null;
    const sub = parts[0];
    // Contract subdomain with preview: "cabc1234--pr-10"
    const sepIndex = sub.indexOf(PREVIEW_SEP);
    if (sepIndex !== -1) {
        return sub.slice(sepIndex + PREVIEW_SEP.length);
    }
    // Bare preview root: "pr-10"
    const prMatch = sub.match(/^pr-(\d+)$/);
    if (prMatch) {
        return prMatch[1];
    }
    return null;
}
//# sourceMappingURL=url.js.map